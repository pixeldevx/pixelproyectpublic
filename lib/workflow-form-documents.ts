import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from '@/lib/supabase/document-store';
import { getDownloadURL, ref, uploadBytes } from '@/lib/supabase/storage-shim';
import { db, storage } from '@/lib/backend';
import {
  buildDocumentStoragePath,
  getDocumentFolderStorageSegments,
  getTaskStorageFolderSegments,
  slugifyStorageSegment,
} from '@/lib/document-storage';
import { loadProjectDocumentFolders } from '@/lib/document-folders';
import { getOrganizationIds } from '@/lib/organizations';
import { getTaskDisplayTitle } from '@/lib/task-title';

export const WORKFLOW_DOCUMENT_VALUE_KIND = 'workflow-document';

export type WorkflowDocumentVersion = {
  version: number;
  name: string;
  fileName: string;
  url: string;
  storagePath: string;
  storageFolder?: string;
  fileSize?: number;
  contentType?: string | null;
  uploadedAt: string;
  uploadedBy?: string | null;
  stepIndex?: number | null;
  stepLabel?: string | null;
  fieldId?: string | null;
  fieldLabel?: string | null;
};

export type WorkflowDocumentValue = {
  kind: typeof WORKFLOW_DOCUMENT_VALUE_KIND;
  documentId: string;
  name: string;
  fileName: string;
  url: string;
  storagePath: string;
  storageFolder?: string;
  fileSize?: number;
  contentType?: string | null;
  uploadedAt?: string;
  uploadedBy?: string | null;
  stepIndex?: number | null;
  stepLabel?: string | null;
  fieldId?: string | null;
  fieldLabel?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  documentKey?: string | null;
  documentVersioning?: boolean;
  documentFolderPath?: string | null;
  documentFolderSegments?: string[];
  projectId?: string | null;
  sourceProjectId?: string | null;
  destinationProjectId?: string | null;
  destinationProjectName?: string | null;
  destinationFolderId?: string | null;
  destinationFolderPath?: string | null;
  documentDestinationMode?: 'task' | 'repository';
  version?: number;
  versionCount?: number;
};

const getUserId = (user: any) => user?.uid || user?.id || user?.memberId || null;

const getTimeValue = (value: any) => {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const isWorkflowDocumentValue = (value: any): value is WorkflowDocumentValue =>
  Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value.kind === WORKFLOW_DOCUMENT_VALUE_KIND || value.type === 'workflow_form_document') &&
      (value.url || value.documentId || value.storagePath),
  );

export const isWorkflowDocumentValueArray = (value: any): value is WorkflowDocumentValue[] =>
  Array.isArray(value) && value.length > 0 && value.every(isWorkflowDocumentValue);

export const getWorkflowDocumentDisplayName = (value: any) =>
  value?.name || value?.fileName || 'Documento adjunto';

const normalizeDocumentKey = (value: unknown) =>
  slugifyStorageSegment(value, '').slice(0, 80);

const getDocumentFolderSegments = (value: unknown) =>
  String(value || '')
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .slice(0, 12);

const getExistingVersions = (documentData: any): WorkflowDocumentVersion[] => {
  const versions = Array.isArray(documentData?.versions)
    ? documentData.versions.filter((version: any) => version?.storagePath || version?.url)
    : [];
  if (versions.length > 0) return versions;
  if (!documentData?.storagePath && !documentData?.url) return [];

  return [{
    version: Number(documentData?.currentVersion) || 1,
    name: documentData?.name || documentData?.fileName || 'Documento',
    fileName: documentData?.fileName || documentData?.name || 'Documento',
    url: documentData?.url || '',
    storagePath: documentData?.storagePath || '',
    storageFolder: documentData?.storageFolder || undefined,
    fileSize: documentData?.fileSize,
    contentType: documentData?.contentType || null,
    uploadedAt: documentData?.uploadedAt || documentData?.createdAt || new Date().toISOString(),
    uploadedBy: documentData?.uploadedBy || null,
    stepIndex: documentData?.workflowStepIndex ?? null,
    stepLabel: documentData?.workflowStepLabel ?? null,
    fieldId: documentData?.formFieldId ?? null,
    fieldLabel: documentData?.formFieldLabel ?? null,
  }];
};

const getProjectName = (project: any, fallback: string) =>
  String(project?.name || project?.projectName || project?.title || fallback);

const getFolderChain = (folderId: string | null, folders: any[]) => {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [String(folder.id), folder]));
  const chain: any[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);

  while (current?.id && !visited.has(String(current.id))) {
    visited.add(String(current.id));
    chain.unshift(current);
    current = current.parentFolderId ? byId.get(String(current.parentFolderId)) : null;
  }

  return chain;
};

const resolveRepositoryDestination = async ({
  sourceProjectId,
  field,
}: {
  sourceProjectId: string;
  field: any;
}) => {
  const destinationProjectId = String(field?.documentDestinationProjectId || '').trim();
  if (!destinationProjectId) {
    throw new Error('Este documento no tiene un repositorio de destino configurado.');
  }

  const sourceSnapshot = await getDoc(doc(db, 'projects', sourceProjectId));
  const destinationSnapshot = destinationProjectId === sourceProjectId
    ? sourceSnapshot
    : await getDoc(doc(db, 'projects', destinationProjectId));
  if (!sourceSnapshot.exists() || !destinationSnapshot.exists()) {
    throw new Error('No tienes acceso al proyecto de origen o al repositorio de destino.');
  }

  const sourceProject = { id: sourceSnapshot.id, ...sourceSnapshot.data() };
  const destinationProject = { id: destinationSnapshot.id, ...destinationSnapshot.data() };
  if (destinationProjectId !== sourceProjectId) {
    const sourceOrganizationIds = getOrganizationIds(sourceProject);
    const destinationOrganizationIds = getOrganizationIds(destinationProject);
    const sharesOrganization = sourceOrganizationIds.some((id) => destinationOrganizationIds.includes(id));
    if (!sharesOrganization) {
      throw new Error('El repositorio de destino debe pertenecer a la misma organización del proyecto.');
    }
  }

  const folders = await loadProjectDocumentFolders(destinationProjectId);
  const destinationFolderId = field?.documentDestinationFolderId
    ? String(field.documentDestinationFolderId)
    : null;
  const folderChain = getFolderChain(destinationFolderId, folders);
  if (destinationFolderId && folderChain.at(-1)?.id !== destinationFolderId) {
    throw new Error('La carpeta configurada ya no existe o no tienes permiso para acceder a ella.');
  }

  return {
    projectId: destinationProjectId,
    projectName: getProjectName(destinationProject, destinationProjectId),
    folderId: destinationFolderId,
    folderNames: folderChain.map((folder) => String(folder.name || 'Carpeta')),
    storageFolderSegments: getDocumentFolderStorageSegments(destinationFolderId, folders),
  };
};

export async function uploadWorkflowFormDocument({
  file,
  projectId,
  projectName,
  task,
  tasks = [],
  user,
  field,
  stepIndex,
  stepLabel,
}: {
  file: File;
  projectId: string;
  projectName?: string;
  task: any;
  tasks?: any[];
  user?: any;
  field?: any;
  stepIndex?: number | null;
  stepLabel?: string | null;
}): Promise<WorkflowDocumentValue> {
  if (!file) throw new Error('Selecciona un archivo para adjuntar.');
  if (!projectId) throw new Error('No se encontró el proyecto para guardar el documento.');

  const fieldLabel = field?.label || 'Documento';
  const documentName = String(field?.documentName || fieldLabel).trim() || fieldLabel;
  const documentVersioning = Boolean(field?.documentVersioning);
  const documentKey = documentVersioning ? normalizeDocumentKey(field?.documentKey || documentName) : '';
  if (documentVersioning && !documentKey) {
    throw new Error('Este campo necesita una clave documental para crear versiones.');
  }

  const userId = getUserId(user);
  const uploadedAt = new Date().toISOString();
  const documentDestinationMode = field?.documentDestinationMode === 'repository' ? 'repository' : 'task';
  const repositoryDestination = documentDestinationMode === 'repository'
    ? await resolveRepositoryDestination({ sourceProjectId: projectId, field })
    : null;
  const destinationProjectId = repositoryDestination?.projectId || projectId;
  const destinationProjectName = repositoryDestination?.projectName || projectName || task?.projectName || 'Proyecto';
  const taskFolderSegments = getDocumentFolderSegments(field?.documentFolderPath);
  const repositoryFolderSegments = repositoryDestination?.storageFolderSegments || [];
  const documentsCollection = collection(db, 'projects', destinationProjectId, 'documents');
  const versionedDocumentRef = documentVersioning
    ? doc(
        documentsCollection,
        documentDestinationMode === 'repository'
          ? `workflow-${slugifyStorageSegment(projectId, 'proyecto')}-${slugifyStorageSegment(task?.id || 'tarea', 'tarea')}-${documentKey}`
          : `workflow-${slugifyStorageSegment(task?.id || 'tarea', 'tarea')}-${documentKey}`,
      )
    : null;
  const existingSnapshot = versionedDocumentRef ? await getDoc(versionedDocumentRef) : null;
  const existingData = existingSnapshot?.exists() ? existingSnapshot.data() : null;
  const existingVersions = getExistingVersions(existingData);
  const currentVersion = existingVersions.reduce(
    (highest, version) => Math.max(highest, Number(version.version) || 0),
    Number(existingData?.currentVersion) || 0,
  );
  const nextVersion = documentVersioning ? currentVersion + 1 : 1;
  const storagePath = buildDocumentStoragePath({
    projectId: destinationProjectId,
    projectName: destinationProjectName,
    task: documentDestinationMode === 'task' ? task : null,
    tasks: documentDestinationMode === 'task' ? tasks : [],
    fileName: file.name,
    documentName: documentVersioning ? `${documentName}-v${nextVersion}` : `${documentName}-${file.name}`,
    folderSegments: documentDestinationMode === 'repository' ? repositoryFolderSegments : taskFolderSegments,
  });
  const storageFolder = storagePath.split('/').slice(0, -1).join('/');
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  const version: WorkflowDocumentVersion = {
    version: nextVersion,
    name: documentName,
    fileName: file.name,
    url,
    storagePath: storageRef.fullPath,
    storageFolder,
    fileSize: file.size,
    contentType: file.type || null,
    uploadedAt,
    uploadedBy: userId,
    stepIndex: stepIndex ?? null,
    stepLabel: stepLabel ?? null,
    fieldId: field?.id ?? null,
    fieldLabel,
  };
  const versions = [...existingVersions, version];
  const latestDocumentData = {
    projectId: destinationProjectId,
    sourceProjectId: projectId,
    sourceTaskId: task?.id || null,
    sourceTaskTitle: getTaskDisplayTitle(task),
    taskId: documentDestinationMode === 'task' ? task?.id || null : null,
    taskTitle: documentDestinationMode === 'task' ? getTaskDisplayTitle(task) : null,
    taskFolderSegments: documentDestinationMode === 'task' ? getTaskStorageFolderSegments(task, tasks) : [],
    scope: documentDestinationMode === 'repository' ? 'project' : 'task',
    parentFolderId: documentDestinationMode === 'repository' ? repositoryDestination?.folderId || null : null,
    projectFolderSegments: documentDestinationMode === 'repository' ? repositoryFolderSegments : [],
    name: documentName,
    type: 'workflow_form_document',
    documentSource: 'workflow_form',
    workflowStepIndex: stepIndex ?? null,
    workflowStepLabel: stepLabel ?? null,
    formFieldId: field?.id ?? null,
    formFieldLabel: fieldLabel,
    workflowDocumentKey: documentKey || null,
    workflowDocumentVersioning: documentVersioning,
    workflowDocumentFolderPath: documentDestinationMode === 'repository'
      ? (repositoryDestination?.folderNames || []).join('/')
      : taskFolderSegments.join('/'),
    documentFolderSegments: documentDestinationMode === 'repository'
      ? repositoryDestination?.folderNames || []
      : taskFolderSegments,
    documentDestinationMode,
    documentDestinationProjectId: destinationProjectId,
    documentDestinationProjectName: destinationProjectName,
    documentDestinationFolderId: repositoryDestination?.folderId || null,
    documentDestinationFolderPath: (repositoryDestination?.folderNames || []).join('/'),
    accessMode: documentDestinationMode === 'repository' && repositoryDestination?.folderId ? 'inherit' : 'all',
    allowedMemberIds: [],
    accessPolicyVersion: documentDestinationMode === 'repository' ? 'folder-inheritance-v1' : null,
    url,
    storagePath: storageRef.fullPath,
    storageFolder,
    uploadedBy: userId,
    uploadedAt: serverTimestamp(),
    fileName: file.name,
    fileSize: file.size,
    contentType: file.type || null,
    currentVersion: nextVersion,
    versionCount: versions.length,
    versions,
    providerPathVersion: 'structured-v2',
    updatedAt: serverTimestamp(),
  };

  let documentRef = versionedDocumentRef;
  if (versionedDocumentRef) {
    if (existingSnapshot?.exists()) {
      await updateDoc(versionedDocumentRef, latestDocumentData);
    } else {
      await setDoc(versionedDocumentRef, {
        ...latestDocumentData,
        createdAt: serverTimestamp(),
      });
    }
  } else {
    documentRef = await addDoc(documentsCollection, {
      ...latestDocumentData,
      createdAt: serverTimestamp(),
    });
  }

  if (!documentRef) throw new Error('No se pudo crear el registro documental.');

  return {
    kind: WORKFLOW_DOCUMENT_VALUE_KIND,
    documentId: documentRef.id,
    name: documentName,
    fileName: file.name,
    url,
    storagePath: storageRef.fullPath,
    storageFolder,
    fileSize: file.size,
    contentType: file.type || null,
    uploadedAt,
    uploadedBy: userId,
    stepIndex: stepIndex ?? null,
    stepLabel: stepLabel ?? null,
    fieldId: field?.id ?? null,
    fieldLabel,
    taskId: task?.id || null,
    taskTitle: getTaskDisplayTitle(task),
    projectId: destinationProjectId,
    sourceProjectId: projectId,
    destinationProjectId,
    destinationProjectName,
    destinationFolderId: repositoryDestination?.folderId || null,
    destinationFolderPath: (repositoryDestination?.folderNames || []).join('/'),
    documentDestinationMode,
    documentKey: documentKey || null,
    documentVersioning,
    documentFolderPath: documentDestinationMode === 'repository'
      ? (repositoryDestination?.folderNames || []).join('/')
      : taskFolderSegments.join('/'),
    documentFolderSegments: documentDestinationMode === 'repository'
      ? repositoryDestination?.folderNames || []
      : taskFolderSegments,
    version: nextVersion,
    versionCount: versions.length,
  };
}

export const collectWorkflowDocumentsFromHistory = (task: any) => {
  const docs: Array<WorkflowDocumentValue & Record<string, any>> = [];
  const steps = Array.isArray(task?.workflowSteps) ? task.workflowSteps : [];

  (task?.workflowHistory || []).forEach((entry: any) => {
    Object.entries(entry?.formData || {}).forEach(([fieldId, value]) => {
      const documentValues = isWorkflowDocumentValueArray(value)
        ? value
        : isWorkflowDocumentValue(value)
          ? [value]
          : [];
      if (documentValues.length === 0) return;
      const rawStepIndex = Number(entry?.stepIndex ?? documentValues[0]?.stepIndex);
      const stepIndex = Number.isFinite(rawStepIndex) ? rawStepIndex : null;
      const step = stepIndex !== null ? steps[stepIndex] : null;
      const field = step?.form?.fields?.find((item: any) => item.id === fieldId);

      documentValues.forEach((documentValue) => {
        docs.push({
          ...documentValue,
          fieldId,
          fieldLabel: field?.label || documentValue.fieldLabel || fieldId,
          stepIndex,
          stepLabel:
            entry.stepLabel ||
            documentValue.stepLabel ||
            step?.label ||
            (stepIndex !== null ? `Paso ${stepIndex + 1}` : 'Paso'),
          comment: entry.comment || null,
          action: entry.action || null,
          timestamp: entry.timestamp || documentValue.uploadedAt || null,
          userName: entry.userName || null,
          userEmail: entry.userEmail || null,
        });
      });
    });
  });

  const sortedDocs = docs.sort((a, b) => getTimeValue(b.timestamp) - getTimeValue(a.timestamp));
  const seenVersionedDocuments = new Set<string>();

  return sortedDocs.filter((document) => {
    if (!document.documentVersioning && !document.documentKey) return true;
    const logicalId = String(document.documentId || `${document.taskId || ''}:${document.documentKey || ''}`);
    if (seenVersionedDocuments.has(logicalId)) return false;
    seenVersionedDocuments.add(logicalId);
    return true;
  });
};
