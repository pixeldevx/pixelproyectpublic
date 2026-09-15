import { NextRequest } from 'next/server';
import { allowedChanges, platformFailure, platformJson, platformRpc, requirePlatformAdmin, requireUuid, supportReason } from '@/lib/platform/server';
export const runtime = 'nodejs';
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { client, actor } = await requirePlatformAdmin(request);
    const payload = await request.json();
    return platformJson(await platformRpc(client, 'app_platform_update_user', {
      p_actor_id: actor.id, p_user_id: requireUuid((await context.params).id),
      p_changes: allowedChanges(payload, ['displayName','systemRole','organizationIds','suspended']), p_reason: supportReason(payload.reason),
    }));
  } catch (error) { return platformFailure(error); }
}
