type TaskLike = {
  id?: string;
  title?: string;
  name?: string;
  parentTaskId?: string | null;
  externalWorkflowId?: string | null;
};

type BuildDocumentStoragePathOptions = {
  projectId: string;
  projectName?: string | null;
  task?: TaskLike | null;
  tasks?: TaskLike[];
  fileName: string;
  documentName?: string | null;
  date?: Date;
  folderName?: string;
  folderSegments?: string[];
};

const normalizeText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export const slugifyStorageSegment = (value: unknown, fallback = 'archivo') =>
  normalizeText(value) || fallback;

const shortId = (value: unknown) => {
  const clean = String(value || '').replace(/[^a-zA-Z0-9]/g, '');
  return clean.slice(0, 8).toLowerCase() || 'sin-id';
};

const getExtension = (fileName: string) => {
  const cleanName = String(fileName || '').split('?')[0];
  const lastDot = cleanName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === cleanName.length - 1) return '';
  return cleanName.slice(lastDot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
};

const getBaseName = (fileName: string) => {
  const cleanName = String(fileName || 'archivo').split('?')[0];
  const lastDot = cleanName.lastIndexOf('.');
  return lastDot > 0 ? cleanName.slice(0, lastDot) : cleanName;
};

const getTaskName = (task?: TaskLike | null) =>
  task?.externalWorkflowId || task?.title || task?.name || task?.id || 'tarea';

const formatDatePrefix = (date: Date) =>
  date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'z');

export const getDocumentFileName = (fileName: string, documentName?: string | null, date = new Date()) => {
  const extension = getExtension(fileName);
  const name = slugifyStorageSegment(documentName || getBaseName(fileName), 'documento');
  return `${formatDatePrefix(date)}-${name}${extension ? `.${extension}` : ''}`;
};

export const getTaskStorageFolderSegments = (task: TaskLike | null | undefined, tasks: TaskLike[] = []) => {
  if (!task?.id) return [];

  const byId = new Map(tasks.filter((item) => item?.id).map((item) => [item.id as string, item]));
  const chain: TaskLike[] = [];
  const visited = new Set<string>();
  let current: TaskLike | undefined = task;

  while (current?.id && !visited.has(current.id)) {
    visited.add(current.id);
    chain.unshift(current);
    current = current.parentTaskId ? byId.get(current.parentTaskId) : undefined;
  }

  return chain.map((item) => `${slugifyStorageSegment(getTaskName(item), 'tarea')}--${shortId(item.id)}`);
};

export const isDocumentFolder = (document: any) =>
  document?.itemKind === 'folder' || document?.kind === 'folder' || document?.isFolder === true;

export const getDocumentFolderStorageSegments = (folderId: string | null | undefined, folders: any[] = []) => {
  if (!folderId) return [];

  const byId = new Map(folders.filter((item) => item?.id).map((item) => [item.id as string, item]));
  const chain: any[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);

  while (current?.id && !visited.has(current.id)) {
    visited.add(current.id);
    chain.unshift(current);
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }

  return chain.map((item) => `${slugifyStorageSegment(item.name || 'carpeta', 'carpeta')}--${shortId(item.id)}`);
};

export const buildDocumentStoragePath = ({
  projectId,
  projectName,
  task,
  tasks = [],
  fileName,
  documentName,
  date = new Date(),
  folderName,
  folderSegments = [],
}: BuildDocumentStoragePathOptions) => {
  const projectFolder = `${slugifyStorageSegment(projectName || projectId, 'proyecto')}--${shortId(projectId)}`;
  const fileSegment = getDocumentFileName(fileName, documentName, date);
  const storageFolderSegments = task?.id
    ? [
        'tareas',
        ...getTaskStorageFolderSegments(task, tasks),
        ...folderSegments.map((segment) => slugifyStorageSegment(segment, 'carpeta')),
      ]
    : [
        slugifyStorageSegment(folderName || 'documentacion-del-proyecto', 'documentacion-del-proyecto'),
        ...folderSegments.map((segment) => slugifyStorageSegment(segment, 'carpeta')),
      ];

  return ['projects', projectFolder, ...storageFolderSegments, fileSegment].filter(Boolean).join('/');
};

export const getDocumentAccessMode = (document: any): 'all' | 'restricted' | 'inherit' => {
  if (document?.accessMode === 'restricted') return 'restricted';
  if (document?.accessMode === 'inherit') return 'inherit';
  return 'all';
};

export const getDocumentAllowedMemberIds = (document: any): string[] =>
  Array.isArray(document?.allowedMemberIds) ? document.allowedMemberIds.filter(Boolean) : [];

export const findMemberForUser = (teamMembers: any[] = [], user: any) => {
  const email = String(user?.email || '').toLowerCase();
  const uid = user?.uid || user?.id || '';

  return teamMembers.find((member) => {
    const memberEmail = String(member?.email || '').toLowerCase();
    return (
      (uid && [member?.id, member?.uid, member?.authUserId].includes(uid)) ||
      (email && memberEmail === email)
    );
  });
};

export const canUserAccessDocument = ({
  document,
  documents = [],
  currentUser,
  teamMembers = [],
  canManageAccess = false,
}: {
  document: any;
  documents?: any[];
  currentUser: any;
  teamMembers?: any[];
  canManageAccess?: boolean;
}) => {
  if (!document) return false;
  if (canManageAccess) return true;
  const viewerMember = findMemberForUser(teamMembers, currentUser);
  const candidates = new Set([
    currentUser?.uid,
    currentUser?.id,
    currentUser?.email,
    viewerMember?.id,
    viewerMember?.uid,
    viewerMember?.authUserId,
    viewerMember?.email,
  ].filter(Boolean).map(String));

  const folderById = new Map(
    documents
      .filter((item) => isDocumentFolder(item) && item?.id)
      .map((item) => [String(item.id), item])
  );
  const accessChain: any[] = [document];
  const visited = new Set<string>();
  let parentFolderId = document.parentFolderId ? String(document.parentFolderId) : '';

  while (parentFolderId && !visited.has(parentFolderId)) {
    visited.add(parentFolderId);
    const parent = folderById.get(parentFolderId);
    if (!parent) break;
    accessChain.push(parent);
    parentFolderId = parent.parentFolderId ? String(parent.parentFolderId) : '';
  }

  return accessChain.every((item, index) => {
    if (getDocumentAccessMode(item) !== 'restricted') return true;
    if (index === 0 && item.uploadedBy && candidates.has(String(item.uploadedBy))) return true;

    const allowedMemberIds = new Set(getDocumentAllowedMemberIds(item).map(String));
    return Array.from(candidates).some((value) => allowedMemberIds.has(value));
  });
};

export const getProjectTeamMembers = (project: any, teamMembers: any[] = []) => {
  const assignedIds = new Set((project?.assignedTeamMembers || []).filter(Boolean));
  if (assignedIds.size === 0) return teamMembers;
  return teamMembers.filter((member) => assignedIds.has(member?.id));
};
