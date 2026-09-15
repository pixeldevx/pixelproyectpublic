import { NextRequest } from 'next/server';
import { platformFailure, platformJson, platformRpc, requirePlatformAdmin, requireUuid, supportReason } from '@/lib/platform/server';
import { scopeWorkspaceClient, WorkspaceAccessError } from '@/lib/workspaces/server';
import { handleWorkspaceInvite } from '@/lib/workspaces/invite';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { client, actor, token } = await requirePlatformAdmin(request);
    const workspaceId = requireUuid((await context.params).id);
    const payload = await request.clone().json();
    const reason = supportReason(payload.reason);
    const email = String(payload.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new WorkspaceAccessError('Correo no válido.', 400);
    const { data: workspace, error } = await client.from('app_workspaces').select('status,trial_ends_at').eq('id', workspaceId).maybeSingle();
    if (error || !workspace) throw new WorkspaceAccessError('Espacio no encontrado.', 404);
    if (workspace.status === 'suspended' || (workspace.status === 'trial' && Date.parse(workspace.trial_ends_at || '') <= Date.now())) {
      throw new WorkspaceAccessError('Reactiva el espacio o amplía su prueba antes de invitar.', 400);
    }
    await platformRpc(client, 'app_platform_log_access', { p_actor_id: actor.id, p_workspace_id: workspaceId,
      p_target_id: email, p_action: 'user.invite.request', p_reason: reason });
    // The selected scope is permitted only after global authentication. The same
    // invitation safeguards still reject accounts belonging to another workspace.
    const scoped = scopeWorkspaceClient(client, { workspaceId, user: actor, token, role: 'admin' });
    const response = await handleWorkspaceInvite(request, scoped);
    const result = await response.json();
    if (!response.ok) return platformJson(result, response.status);
    await platformRpc(client, 'app_platform_log_access', { p_actor_id: actor.id, p_workspace_id: workspaceId,
      p_target_id: result.userId, p_action: 'user.invite.complete', p_reason: reason });
    return platformJson({ ...result, ...(result.invitationUrl ? { actionLink: result.invitationUrl } : {}) });
  } catch (error) { return platformFailure(error); }
}
