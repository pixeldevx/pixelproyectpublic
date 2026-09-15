import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { getBootstrapAdminEmailSet } from '@/lib/bootstrap-admins';

export class WorkspaceAccessError extends Error {
  constructor(message: string, public status = 403) { super(message); }
}

const TENANT_TABLES = new Set([
  'app_documents', 'project_spatial_layers', 'project_spatial_features',
  'project_spatial_annotations', 'user_reassignment_audit',
]);
const TENANT_RPCS = new Set([
  'app_apply_contractor_account_action',
  'app_update_contractor_account_approval_route',
  'app_reassign_contractor_account_approver',
]);

/** Raw access is reserved for this boundary and the independently verified global support API. */
export const createPlatformClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new WorkspaceAccessError('El servicio no está configurado.', 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};

export const requestAccessToken = (request: Request) => {
  const [scheme, token] = (request.headers.get('authorization') || '').split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token || '' : '';
};

export const isPlatformAdministrator = (user: Pick<User, 'email'>) =>
  getBootstrapAdminEmailSet().has(String(user.email || '').trim().toLowerCase());

export type WorkspaceServerContext = {
  workspaceId: string;
  user: User;
  role: string;
  token: string;
};

export const requireWorkspaceContext = async (request: Request): Promise<WorkspaceServerContext> => {
  const token = requestAccessToken(request);
  if (!token) throw new WorkspaceAccessError('Debes iniciar sesión.', 401);
  const platform = createPlatformClient();
  const { data: auth, error: authError } = await platform.auth.getUser(token);
  if (authError || !auth.user || !auth.user.email_confirmed_at) {
    throw new WorkspaceAccessError('La sesión no es válida o el correo no está confirmado.', 401);
  }
  return loadWorkspaceMembership(platform, auth.user, token);
};

const loadWorkspaceMembership = async (platform: any, user: User, token: string): Promise<WorkspaceServerContext> => {
  const { data: member, error: memberError } = await platform
    .from('app_workspace_members').select('workspace_id,role,suspended_at').eq('user_id', user.id).maybeSingle();
  if (memberError) throw new WorkspaceAccessError('No se pudo validar tu espacio de trabajo.', 503);
  if (!member) throw new WorkspaceAccessError('Completa la creación de tu espacio de trabajo.', 403);
  if (member.suspended_at) throw new WorkspaceAccessError('Tu cuenta está pausada. Contacta al soporte de Pixel.', 403);
  const { data: workspace, error: workspaceError } = await platform
    .from('app_workspaces').select('id,status,trial_ends_at').eq('id', member.workspace_id).maybeSingle();
  if (workspaceError) throw new WorkspaceAccessError('No se pudo validar tu espacio de trabajo.', 503);
  if (!workspace || !['trial', 'active'].includes(workspace.status)) {
    throw new WorkspaceAccessError('Este espacio de trabajo no está activo.', 403);
  }
  if (workspace.status === 'trial' && (!workspace.trial_ends_at || Date.parse(workspace.trial_ends_at) <= Date.now())) {
    throw new WorkspaceAccessError('El periodo de exploración de este espacio ha terminado.', 403);
  }
  return { workspaceId: workspace.id, role: member.role, user, token };
};

/**
 * Server handlers need protected collections. Every database operation gets an
 * immutable tenant scope, including writes, conflicts and RPC arguments. No
 * client payload, mutable profile role or caller-provided header chooses it.
 */
export const scopeWorkspaceClient = (platform: any, context: WorkspaceServerContext): any => {
  const stamp = (value: any): any => Array.isArray(value)
    ? value.map(stamp)
    : { ...value, tenant_id: context.workspaceId };
  const scopedFrom = (table: string) => {
    if (!TENANT_TABLES.has(table)) throw new WorkspaceAccessError('Operación fuera del espacio de trabajo.');
    const builder = platform.from(table);
    return {
      select: (...args: any[]) => builder.select(...args).eq('tenant_id', context.workspaceId),
      insert: (values: any, options?: any) => builder.insert(stamp(values), options),
      upsert: (values: any, options: any = {}) => builder.upsert(stamp(values), {
        ...options,
        ...(table === 'app_documents' ? { onConflict: 'tenant_id,collection_path,doc_id' } : {}),
      }),
      update: (values: any, options?: any) => builder.update(stamp(values), options).eq('tenant_id', context.workspaceId),
      delete: (options?: any) => builder.delete(options).eq('tenant_id', context.workspaceId),
    };
  };
  const requireManager = () => {
    if (!['owner', 'admin'].includes(context.role)) throw new WorkspaceAccessError('Solo el administrador del espacio puede gestionar su equipo.');
  };
  const requireMember = async (userId: string) => {
    requireManager();
    const { data, error } = await platform.from('app_workspace_members').select('user_id,role')
      .eq('workspace_id', context.workspaceId).eq('user_id', userId).maybeSingle();
    if (error || !data) throw new WorkspaceAccessError('La cuenta no pertenece a tu espacio de trabajo.');
    return data;
  };
  const scopedAdmin = {
    listUsers: async (options: { page?: number; perPage?: number } = {}) => {
      requireManager();
      const page = Math.max(1, Number(options.page) || 1);
      const perPage = Math.min(1000, Math.max(1, Number(options.perPage) || 50));
      const { data: members, error } = await platform.from('app_workspace_members').select('user_id')
        .eq('workspace_id', context.workspaceId).order('user_id').range((page - 1) * perPage, page * perPage - 1);
      if (error) return { data: { users: [] }, error };
      const results = await Promise.all((members || []).map((member: any) => platform.auth.admin.getUserById(member.user_id)));
      return { data: { users: results.filter((result: any) => result.data?.user).map((result: any) => result.data.user) }, error: null };
    },
    getUserById: async (id: string) => { await requireMember(id); return platform.auth.admin.getUserById(id); },
    setWorkspaceRole: async (id: string, systemRole: string) => {
      const member = await requireMember(id);
      if (member.role === 'owner') {
        if (systemRole !== 'admin') throw new WorkspaceAccessError('El propietario debe conservar su rol de administrador.', 400);
        return { data: member, error: null };
      }
      const role = ['admin', 'org_admin'].includes(systemRole) ? 'admin' : 'member';
      return platform.from('app_workspace_members').update({ role })
        .eq('workspace_id', context.workspaceId).eq('user_id', id);
    },
    updateUserById: async (id: string, attributes: any) => {
      await requireMember(id);
      // User metadata is a display profile; never accept security claims from a workspace owner.
      const { app_metadata: _claims, ...safeAttributes } = attributes;
      return platform.auth.admin.updateUserById(id, safeAttributes);
    },
    deleteUser: async (id: string) => {
      const member = await requireMember(id);
      if (member.role === 'owner') throw new WorkspaceAccessError('No puedes eliminar al propietario del espacio.');
      return platform.auth.admin.deleteUser(id);
    },
    generateLink: async (params: any) => {
      requireManager();
      const email = String(params.email || '').trim().toLowerCase();
      if (!email) throw new WorkspaceAccessError('El correo no es válido.', 400);
      let existing: any = null;
      for (let page = 1; ; page += 1) {
        const { data, error } = await platform.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return { data: null, error };
        existing = data.users.find((user: User) => String(user.email || '').toLowerCase() === email);
        if (existing || data.users.length < 1000) break;
      }
      if (existing) await requireMember(existing.id);
      if (!existing && params.type !== 'invite') throw new WorkspaceAccessError('La cuenta no pertenece a tu espacio de trabajo.');
      const invitationNonce = existing ? null : randomUUID();
      const linkParams = invitationNonce ? {
        ...params,
        options: { ...params.options, data: { ...params.options?.data, pixelWorkspaceInviteNonce: invitationNonce } },
      } : params;
      const result = await platform.auth.admin.generateLink(linkParams);
      if (!result.error && result.data?.user && !existing) {
        const invitedUser = result.data.user;
        if (!invitedUser.invited_at || invitedUser.email_confirmed_at || invitedUser.user_metadata?.workspaceName
          || invitedUser.user_metadata?.pixelWorkspaceInviteNonce !== invitationNonce) {
          throw new WorkspaceAccessError('Esta cuenta debe continuar con su propio registro.', 409);
        }
        const { error } = await platform.from('app_workspace_members').insert({
          workspace_id: context.workspaceId, user_id: invitedUser.id, role: 'member',
        });
        if (error) throw new WorkspaceAccessError('No se pudo incorporar la cuenta al espacio de trabajo.', 409);
      }
      return result;
    },
  };
  return {
    workspace: context,
    from: scopedFrom,
    rpc: (name: string, args: Record<string, unknown> = {}, options?: any) => {
      if (!TENANT_RPCS.has(name)) throw new WorkspaceAccessError('La operación no está habilitada en este espacio.');
      return platform.rpc(name, { ...args, p_tenant_id: context.workspaceId }, options);
    },
    auth: {
      getUser: (token?: string) => platform.auth.getUser(token || context.token),
      admin: scopedAdmin,
    },
  };
};

export const getWorkspaceServerClient = async (request: Request) => {
  const context = await requireWorkspaceContext(request);
  return scopeWorkspaceClient(createPlatformClient(), context);
};

/** Only use after verifying a server-signed OAuth state, never with browser input alone. */
export const getWorkspaceClientForVerifiedState = async (userId: string, workspaceId: string) => {
  const platform = createPlatformClient();
  const { data, error } = await platform.auth.admin.getUserById(userId);
  if (error || !data.user?.email_confirmed_at) throw new WorkspaceAccessError('La cuenta de la autorización ya no está disponible.');
  const context = await loadWorkspaceMembership(platform, data.user, '');
  if (context.workspaceId !== workspaceId) throw new WorkspaceAccessError('La autorización no corresponde al espacio de trabajo.');
  return scopeWorkspaceClient(platform, context);
};

/** Trusted scheduled jobs must select one explicit workspace before reading data. */
export const getWorkspaceClientForSystem = async (workspaceId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId || '')) throw new WorkspaceAccessError('Configura el espacio de trabajo de esta integración.', 503);
  const platform = createPlatformClient();
  const { data: owner, error } = await platform.from('app_workspace_members').select('user_id')
    .eq('workspace_id', workspaceId).eq('role', 'owner').maybeSingle();
  if (error || !owner) throw new WorkspaceAccessError('No existe un propietario activo para esta integración.', 503);
  return getWorkspaceClientForVerifiedState(owner.user_id, workspaceId);
};

export const workspaceErrorStatus = (error: unknown, fallback = 500) =>
  error instanceof WorkspaceAccessError ? error.status : fallback;
