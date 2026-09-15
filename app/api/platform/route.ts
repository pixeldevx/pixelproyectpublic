import { NextRequest } from 'next/server';
import { platformFailure, platformJson, platformRpc, requirePlatformAdmin, requireUuid } from '@/lib/platform/server';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const { client, actor } = await requirePlatformAdmin(request);
    const query = request.nextUrl.searchParams;
    return platformJson(await platformRpc(client, 'app_platform_overview', {
      p_actor_id: actor.id, p_view: query.get('view') || 'workspaces',
      p_page: Math.max(1, Math.min(100000, Math.floor(Number(query.get('page')) || 1))),
      p_query: (query.get('query') || '').slice(0, 150),
      p_workspace_id: query.get('workspaceId') ? requireUuid(query.get('workspaceId')) : null,
    }));
  } catch (error) { return platformFailure(error); }
}
