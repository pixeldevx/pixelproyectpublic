import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { isDocumentFolder } from '@/lib/document-storage';

export type DocumentFolderAccessMode = 'all' | 'restricted' | 'inherit';

export type ManagedFolderSegment = {
  id: string;
  name: string;
  accessMode?: DocumentFolderAccessMode;
  allowedMemberIds?: string[];
  metadata?: Record<string, any>;
};

const normalizeFolderName = (value: unknown) =>
  String(value || '').trim().replace(/[\\/]+/g, '-').replace(/\s+/g, ' ');

const folderLookupKey = (parentFolderId: string | null | undefined, name: string) =>
  `${parentFolderId || '__root__'}\u0000${normalizeFolderName(name).toLocaleLowerCase()}`;

const hasFolderValueChanged = (current: unknown, next: unknown) =>
  JSON.stringify(current ?? null) !== JSON.stringify(next ?? null);

export const loadProjectDocumentFolders = async (projectId: string) => {
  const snapshot = await getDocs(collection(db, 'projects', projectId, 'documents'));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => isDocumentFolder(item));
};

export const createIndexedDocumentFolder = async ({
  projectId,
  name,
  parentFolderId = null,
  userId,
  accessMode = 'inherit',
  allowedMemberIds = [],
  metadata = {},
}: {
  projectId: string;
  name: string;
  parentFolderId?: string | null;
  userId?: string | null;
  accessMode?: DocumentFolderAccessMode;
  allowedMemberIds?: string[];
  metadata?: Record<string, any>;
}) => {
  const cleanName = normalizeFolderName(name);
  if (!cleanName) throw new Error('El nombre de la carpeta no es válido.');

  const reference = await addDoc(collection(db, 'projects', projectId, 'documents'), {
    projectId,
    name: cleanName,
    type: 'folder',
    itemKind: 'folder',
    scope: 'project',
    parentFolderId: parentFolderId || null,
    createdAt: serverTimestamp(),
    uploadedAt: serverTimestamp(),
    createdBy: userId || null,
    uploadedBy: userId || null,
    accessMode: parentFolderId && accessMode === 'all' ? 'inherit' : accessMode,
    allowedMemberIds: accessMode === 'restricted' ? allowedMemberIds : [],
    providerPathVersion: 'structured-v2',
    ...metadata,
  });

  return {
    id: reference.id,
    name: cleanName,
    parentFolderId: parentFolderId || null,
    itemKind: 'folder',
    accessMode: parentFolderId && accessMode === 'all' ? 'inherit' : accessMode,
    allowedMemberIds: accessMode === 'restricted' ? allowedMemberIds : [],
    ...metadata,
  };
};

export const ensureManagedDocumentFolderPath = async ({
  projectId,
  segments,
  userId,
  parentFolderId = null,
}: {
  projectId: string;
  segments: ManagedFolderSegment[];
  userId?: string | null;
  parentFolderId?: string | null;
}) => {
  let parentId = parentFolderId;
  const folders: any[] = [];

  for (const [index, segment] of segments.entries()) {
    const cleanName = normalizeFolderName(segment.name);
    const folderRef = doc(db, 'projects', projectId, 'documents', segment.id);
    const existingSnapshot = await getDoc(folderRef);
    const existing = existingSnapshot.exists() ? existingSnapshot.data() : null;
    const accessMode = existing?.accessMode || segment.accessMode || (index === 0 && !parentId ? 'all' : 'inherit');
    const allowedMemberIds = accessMode === 'restricted'
      ? (Array.isArray(existing?.allowedMemberIds) ? existing.allowedMemberIds : segment.allowedMemberIds || [])
      : [];
    const metadata = segment.metadata || {};
    const shouldPersistFolder = !existing
      || normalizeFolderName(existing.name) !== cleanName
      || (existing.parentFolderId || null) !== (parentId || null)
      || existing.accessMode !== accessMode
      || hasFolderValueChanged(existing.allowedMemberIds || [], allowedMemberIds)
      || Object.entries(metadata).some(([key, value]) => hasFolderValueChanged(existing[key], value));

    if (shouldPersistFolder) {
      await setDoc(folderRef, {
        projectId,
        name: cleanName,
        type: 'folder',
        itemKind: 'folder',
        scope: 'project',
        parentFolderId: parentId || null,
        ...(existing ? {} : { createdAt: serverTimestamp() }),
        uploadedAt: serverTimestamp(),
        ...(existing ? {} : { createdBy: userId || null }),
        uploadedBy: userId || null,
        accessMode,
        allowedMemberIds,
        managedFolder: true,
        providerPathVersion: 'structured-v2',
        ...metadata,
      }, { merge: true });
    }

    const folder = {
      id: segment.id,
      name: cleanName,
      parentFolderId: parentId || null,
      itemKind: 'folder',
      accessMode,
      allowedMemberIds,
      ...metadata,
    };
    folders.push(folder);
    parentId = segment.id;
  }

  return { folders, leafFolderId: parentId };
};

export const createFolderPathFromRelativeSegments = async ({
  projectId,
  segments,
  parentFolderId,
  userId,
  folders,
  rootAccessMode = 'inherit',
  rootAllowedMemberIds = [],
  batchId,
}: {
  projectId: string;
  segments: string[];
  parentFolderId?: string | null;
  userId?: string | null;
  folders: any[];
  rootAccessMode?: DocumentFolderAccessMode;
  rootAllowedMemberIds?: string[];
  batchId?: string;
}) => {
  const lookup = new Map(
    folders
      .filter((folder) => isDocumentFolder(folder))
      .map((folder) => [folderLookupKey(folder.parentFolderId, folder.name), folder])
  );
  let currentParentId = parentFolderId || null;
  const created: any[] = [];

  for (const [index, rawName] of segments.entries()) {
    const name = normalizeFolderName(rawName);
    if (!name || name === '.' || name === '..') continue;
    const key = folderLookupKey(currentParentId, name);
    let folder = lookup.get(key);

    if (!folder) {
      folder = await createIndexedDocumentFolder({
        projectId,
        name,
        parentFolderId: currentParentId,
        userId,
        accessMode: index === 0 ? rootAccessMode : 'inherit',
        allowedMemberIds: index === 0 ? rootAllowedMemberIds : [],
        metadata: {
          uploadBatchId: batchId || null,
          documentContext: 'folderImport',
        },
      });
      folders.push(folder);
      created.push(folder);
      lookup.set(key, folder);
    }

    currentParentId = folder.id;
  }

  return { leafFolderId: currentParentId, createdFolders: created };
};
