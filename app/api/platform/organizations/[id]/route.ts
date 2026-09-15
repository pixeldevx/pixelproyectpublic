import { NextRequest } from 'next/server';
import { platformFailure, platformJson, platformRpc, requirePlatformAdmin, requireUuid, supportReason } from '@/lib/platform/server';
export const runtime = 'nodejs';
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { client, actor } = await requirePlatformAdmin(request);
    const payload = await request.json();
    return platformJson(await platformRpc(client, 'app_platform_update_organization', {
      p_actor_id: actor.id, p_workspace_id: requireUuid(payload.workspaceId), p_organization_id: (await context.params).id,
      p_name: typeof payload.name === 'string' ? payload.name : null, p_reason: supportReason(payload.reason),
    }));
  } catch (error) { return platformFailure(error); }
}
