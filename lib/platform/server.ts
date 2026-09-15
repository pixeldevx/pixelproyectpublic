import { NextResponse } from 'next/server';
import { createPlatformClient, isPlatformAdministrator, requestAccessToken, WorkspaceAccessError } from '@/lib/workspaces/server';

export const platformJson = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Authorization' },
});

export async function requirePlatformAdmin(request: Request) {
  const token = requestAccessToken(request);
  if (!token) throw new WorkspaceAccessError('Debes iniciar sesión.', 401);
  const client = createPlatformClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.email_confirmed_at) throw new WorkspaceAccessError('Sesión no válida.', 401);
  if (!isPlatformAdministrator(data.user)) throw new WorkspaceAccessError('Solo el administrador global puede acceder a soporte.');
  // Require the immutable original owner as well as the private email allowlist.
  const { data: membership, error: membershipError } = await client.from('app_workspace_members')
    .select('workspace_id,role,suspended_at').eq('user_id', data.user.id).maybeSingle();
  if (membershipError) throw new WorkspaceAccessError('No se pudo verificar el acceso global.', 503);
  if (!membership || membership.role !== 'owner' || membership.suspended_at) throw new WorkspaceAccessError('Acceso global no autorizado.');
  const { data: workspace, error: workspaceError } = await client.from('app_workspaces').select('owner_id,legacy_storage')
    .eq('id', membership.workspace_id).maybeSingle();
  if (workspaceError) throw new WorkspaceAccessError('No se pudo verificar el acceso global.', 503);
  if (!workspace?.legacy_storage || workspace.owner_id !== data.user.id) throw new WorkspaceAccessError('Acceso global no autorizado.');
  return { client, actor: data.user, token };
}

export function requireUuid(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new WorkspaceAccessError('Identificador no válido.', 400);
  }
  return value;
}
export function supportReason(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 5 || value.trim().length > 500) throw new WorkspaceAccessError('Indica un motivo de 5 a 500 caracteres.', 400);
  return value.trim();
}
export function allowedChanges(payload: unknown, allowed: string[]) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new WorkspaceAccessError('Datos no válidos.', 400);
  const result = Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.includes(key)));
  if (!Object.keys(result).length) throw new WorkspaceAccessError('No hay cambios para guardar.', 400);
  return result;
}
export async function platformRpc(client: any, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : ['22023','22007','22008','22P02','23514'].includes(error.code) ? 400 : 500;
    throw new WorkspaceAccessError(status === 500 ? 'No se pudo completar la operación de soporte.' : error.message, status);
  }
  return data;
}
export const platformFailure = (error: unknown) => platformJson({
  error: error instanceof WorkspaceAccessError ? error.message : 'No se pudo completar la operación de soporte.',
}, error instanceof WorkspaceAccessError ? error.status : 500);
