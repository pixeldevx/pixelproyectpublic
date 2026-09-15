import { NextRequest } from 'next/server';
import { allowedChanges, platformFailure, platformJson, platformRpc, requirePlatformAdmin, requireUuid, supportReason } from '@/lib/platform/server';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    const { client, actor } = await requirePlatformAdmin(request);
    return platformJson(await platformRpc(client, 'app_platform_workspace', { p_actor_id: actor.id, p_workspace_id: requireUuid((await context.params).id) }));
  } catch (error) { return platformFailure(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { client, actor } = await requirePlatformAdmin(request);
    const payload = await request.json();
    return platformJson(await platformRpc(client, 'app_platform_update_workspace', {
      p_actor_id: actor.id, p_workspace_id: requireUuid((await context.params).id),
      p_changes: allowedChanges(payload, ['name','status','trialEndsAt']), p_reason: supportReason(payload.reason),
    }));
  } catch (error) { return platformFailure(error); }
}
