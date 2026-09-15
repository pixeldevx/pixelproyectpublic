// This value scopes UI requests and caches; database RLS remains authoritative.
let workspaceId: string | null = null;

export function setClientWorkspace(id: string | null) {
  workspaceId = id;
}

export function getClientWorkspace() {
  return workspaceId;
}

export function requireClientWorkspace() {
  if (!workspaceId) throw new Error('Tu espacio de trabajo aún se está preparando.');
  return workspaceId;
}

export function workspaceStoragePath(path: string) {
  const clean = path.replace(/^\/+/, '');
  if (clean.startsWith('workspaces/')) return clean;
  return `workspaces/${requireClientWorkspace()}/${clean}`;
}
