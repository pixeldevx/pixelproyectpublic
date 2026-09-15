import { createClient } from '@supabase/supabase-js';
import { normalizeStorageKey, type DocumentStorageProvider } from './paths';
import { canLoadProjectForUser } from '@/lib/project-access';
import { getOrganizationIds } from '@/lib/organizations';
import { normalizeRolePermissions, resolveRolePermissions, type PermissionKey } from '@/lib/permissions';

const DOCUMENTS_TABLE = 'app_documents';
const CONFIG_COLLECTION = 'app_config';
const CONFIG_DOC_ID = 'document_storage';

export type DocumentStorageSettings = {
  provider: DocumentStorageProvider;
  s3Bucket: string;
  s3Region: string;
  s3Prefix: string;
  maxFileSizeMb: number | null;
  allowedContentTypes: string[];
  updatedAt?: string;
  updatedBy?: string;
  updatedByEmail?: string;
};

export type S3RuntimeConfig = {
  bucket: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type StorageConfigStatus = {
  provider: DocumentStorageProvider;
  settings: DocumentStorageSettings;
  s3Ready: boolean;
  missingS3Variables: string[];
  publicBaseUrl: string;
};

const normalizeProvider = (value: unknown): DocumentStorageProvider =>
  String(value || '').toLowerCase() === 's3' ? 's3' : 'supabase';

const numberOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const splitContentTypes = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const getServerSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

export const getBearerToken = (request: Request) => {
  const header = request.headers.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
};

export const getAuthenticatedUser = async (request: Request) => {
  const token = getBearerToken(request);
  const supabase = getServerSupabaseClient();

  if (!token || !supabase) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
};

export const getDocumentStorageSettings = async (): Promise<DocumentStorageSettings> => {
  const envProvider = normalizeProvider(process.env.DOCUMENT_STORAGE_PROVIDER);
  const defaults: DocumentStorageSettings = {
    provider: envProvider,
    s3Bucket: process.env.AWS_S3_BUCKET || '',
    s3Region: process.env.AWS_REGION || '',
    s3Prefix: normalizeStorageKey(process.env.AWS_S3_PREFIX || 'pixel-project'),
    maxFileSizeMb: numberOrNull(process.env.DOCUMENT_STORAGE_MAX_FILE_SIZE_MB),
    allowedContentTypes: splitContentTypes(process.env.DOCUMENT_STORAGE_ALLOWED_TYPES),
  };

  const supabase = getServerSupabaseClient();
  if (!supabase) return defaults;

  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('data')
    .eq('collection_path', CONFIG_COLLECTION)
    .eq('doc_id', CONFIG_DOC_ID)
    .maybeSingle();

  if (error || !data?.data) return defaults;

  const saved = data.data as Record<string, any>;
  return {
    provider: normalizeProvider(saved.provider || defaults.provider),
    s3Bucket: String(saved.s3Bucket || defaults.s3Bucket || '').trim(),
    s3Region: String(saved.s3Region || defaults.s3Region || '').trim(),
    s3Prefix: normalizeStorageKey(saved.s3Prefix || defaults.s3Prefix || ''),
    maxFileSizeMb: numberOrNull(saved.maxFileSizeMb) ?? defaults.maxFileSizeMb,
    allowedContentTypes: splitContentTypes(saved.allowedContentTypes).length
      ? splitContentTypes(saved.allowedContentTypes)
      : defaults.allowedContentTypes,
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy,
    updatedByEmail: saved.updatedByEmail,
  };
};

export const getStorageConfigStatus = async (): Promise<StorageConfigStatus> => {
  const settings = await getDocumentStorageSettings();
  const requiredS3Variables: Array<[string, string | undefined]> = [
    ['AWS_ACCESS_KEY_ID', process.env.AWS_ACCESS_KEY_ID],
    ['AWS_SECRET_ACCESS_KEY', process.env.AWS_SECRET_ACCESS_KEY],
    ['AWS_REGION', settings.s3Region || process.env.AWS_REGION],
    ['AWS_S3_BUCKET', settings.s3Bucket || process.env.AWS_S3_BUCKET],
  ];
  const missingS3Variables = requiredS3Variables
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    provider: settings.provider,
    settings,
    s3Ready: missingS3Variables.length === 0,
    missingS3Variables,
    publicBaseUrl: process.env.AWS_S3_PUBLIC_BASE_URL || '',
  };
};

export const getS3RuntimeConfig = async (): Promise<S3RuntimeConfig> => {
  const status = await getStorageConfigStatus();

  if (!status.s3Ready) {
    throw new Error(`Faltan variables para Amazon S3: ${status.missingS3Variables.join(', ')}`);
  }

  return {
    bucket: status.settings.s3Bucket || process.env.AWS_S3_BUCKET || '',
    region: status.settings.s3Region || process.env.AWS_REGION || '',
    prefix: normalizeStorageKey(status.settings.s3Prefix || process.env.AWS_S3_PREFIX || ''),
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  };
};

export const buildS3ObjectKey = (prefix: string, path: string) => {
  const cleanPath = normalizeStorageKey(path);
  const cleanPrefix = normalizeStorageKey(prefix);
  return cleanPrefix ? `${cleanPrefix}/${cleanPath}` : cleanPath;
};

const matchesAuthenticatedUser = (record: any, user: any) => {
  const userId = String(user?.id || '');
  const email = String(user?.email || '').toLowerCase();
  return Boolean(
    (userId && [record?.id, record?.uid, record?.authUserId].filter(Boolean).map(String).includes(userId)) ||
    (email && String(record?.email || '').toLowerCase() === email)
  );
};

const getProjectIdFromStorageKey = async (storageKey: string) => {
  const cleanKey = normalizeStorageKey(storageKey);
  const projectSegment = cleanKey.split('/').find((segment, index, all) => all[index - 1] === 'projects') || '';
  const shortProjectId = projectSegment.split('--').pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || '';
  if (!shortProjectId) return '';

  const supabase = getServerSupabaseClient();
  if (!supabase) return '';
  const { data } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('doc_id')
    .eq('collection_path', 'projects');

  return (data || []).find((row: any) =>
    String(row.doc_id || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().startsWith(shortProjectId)
  )?.doc_id || '';
};

const getDocumentStorageRecord = async (storagePath: string) => {
  const supabase = getServerSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path,doc_id,data')
    .like('collection_path', 'projects/%/documents')
    .eq('data->>storagePath', storagePath)
    .maybeSingle();
  if (data) return data;

  const projectId = await getProjectIdFromStorageKey(storagePath);
  if (!projectId) return null;
  const { data: projectDocuments } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path,doc_id,data')
    .eq('collection_path', `projects/${projectId}/documents`);

  return (projectDocuments || []).find((row: any) =>
    Array.isArray(row.data?.versions) &&
    row.data.versions.some((version: any) => String(version?.storagePath || '') === storagePath)
  ) || null;
};

export const isDocumentStoragePathRestricted = async (storagePath: string) => {
  const document = await getDocumentStorageRecord(storagePath);
  const supabase = getServerSupabaseClient();
  if (!document || !supabase) return false;
  if (document.data?.accessMode === 'restricted') return true;

  const { data: rows } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('doc_id,data')
    .eq('collection_path', document.collection_path);
  const folders = new Map(
    (rows || [])
      .filter((row: any) => row.data?.itemKind === 'folder')
      .map((row: any) => [String(row.doc_id), row.data])
  );
  const visited = new Set<string>();
  let parentId = String(document.data?.parentFolderId || '');
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = folders.get(parentId);
    if (!parent) break;
    if (parent.accessMode === 'restricted') return true;
    parentId = String(parent.parentFolderId || '');
  }
  return false;
};

const canAccessDocumentRecord = ({
  document,
  documents,
  candidateIds,
  canManageAccess,
}: {
  document: any;
  documents: any[];
  candidateIds: Set<string>;
  canManageAccess: boolean;
}) => {
  if (canManageAccess) return true;
  const folders = new Map(
    documents
      .filter((item) => item?.data?.itemKind === 'folder')
      .map((item) => [String(item.doc_id), item.data])
  );
  const chain = [document.data];
  const visited = new Set<string>();
  let parentId = String(document.data?.parentFolderId || '');

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = folders.get(parentId);
    if (!parent) break;
    chain.push(parent);
    parentId = String(parent.parentFolderId || '');
  }

  return chain.every((item, index) => {
    if (item?.accessMode !== 'restricted') return true;
    if (index === 0 && item?.uploadedBy && candidateIds.has(String(item.uploadedBy))) return true;
    const allowed = new Set((Array.isArray(item?.allowedMemberIds) ? item.allowedMemberIds : []).map(String));
    return Array.from(candidateIds).some((candidate) => allowed.has(candidate));
  });
};

export const authorizeProjectStorageAction = async ({
  request,
  storagePath,
  storageKey,
  permission,
}: {
  request: Request;
  storagePath?: string;
  storageKey?: string;
  permission: Extract<PermissionKey, 'documentView' | 'documentUpload' | 'documentDelete'>;
}) => {
  const user = await getAuthenticatedUser(request);
  const supabase = getServerSupabaseClient();
  if (!user || !supabase) return { ok: false as const, status: 401, error: 'Debes iniciar sesión para acceder a documentos.' };

  const documentRecord = storagePath ? await getDocumentStorageRecord(storagePath) : null;
  const projectId = documentRecord
    ? String(documentRecord.collection_path).split('/')[1] || ''
    : await getProjectIdFromStorageKey(storageKey || storagePath || '');
  if (!projectId) return { ok: false as const, status: 403, error: 'No se pudo vincular el archivo con un proyecto autorizado.' };

  const [{ data: peopleRows }, { data: projectRow }, { data: permissionsRow }] = await Promise.all([
    supabase.from(DOCUMENTS_TABLE).select('collection_path,doc_id,data').in('collection_path', ['users', 'team_members']),
    supabase.from(DOCUMENTS_TABLE).select('doc_id,data').eq('collection_path', 'projects').eq('doc_id', projectId).maybeSingle(),
    supabase.from(DOCUMENTS_TABLE).select('data').eq('collection_path', 'settings').eq('doc_id', 'rolePermissions').maybeSingle(),
  ]);
  if (!projectRow?.data) return { ok: false as const, status: 404, error: 'El proyecto asociado ya no existe.' };

  const people = (peopleRows || []).map((row: any) => ({ id: row.doc_id, ...row.data }));
  const profiles = people.filter((record: any) => matchesAuthenticatedUser(record, user));
  const primaryProfile = profiles.find((record: any) => record.role || record.systemRole) || profiles[0] || {};
  const role = String(primaryProfile.role || primaryProfile.systemRole || 'user');
  const candidateIds = new Set<string>([
    String(user.id),
    String(user.email || ''),
    String(user.email || '').toLowerCase(),
    ...profiles.flatMap((record: any) => [record.id, record.uid, record.authUserId, record.email, String(record.email || '').toLowerCase()]),
  ].filter(Boolean).map(String));
  const organizationIds = Array.from(new Set(profiles.flatMap((record: any) => getOrganizationIds(record))));
  const canLoadProject = canLoadProjectForUser(projectRow.data, {
    assignedIds: Array.from(candidateIds),
    managedOrganizationIds: organizationIds,
    userId: user.id,
    userRole: role,
  });
  if (!canLoadProject) return { ok: false as const, status: 403, error: 'No tienes acceso a este proyecto.' };

  const settings = normalizeRolePermissions(permissionsRow?.data || null);
  const permissions = resolveRolePermissions(settings, role);
  if (!permissions[permission]) return { ok: false as const, status: 403, error: 'Tu rol no permite esta operación documental.' };

  if (documentRecord && permission === 'documentView') {
    const { data: documentRows } = await supabase
      .from(DOCUMENTS_TABLE)
      .select('doc_id,data')
      .eq('collection_path', documentRecord.collection_path);
    if (!canAccessDocumentRecord({
      document: documentRecord,
      documents: documentRows || [],
      candidateIds,
      canManageAccess: Boolean(permissions.documentManageAccess),
    })) {
      return { ok: false as const, status: 403, error: 'No estás autorizado para abrir esta carpeta o documento.' };
    }
  }

  if (!documentRecord && permission !== 'documentUpload') {
    return { ok: false as const, status: 404, error: 'El archivo no está indexado en el gestor documental.' };
  }

  return { ok: true as const, user, projectId, documentRecord, permissions, candidateIds };
};
