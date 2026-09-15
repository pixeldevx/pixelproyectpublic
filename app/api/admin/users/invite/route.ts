import { NextRequest } from 'next/server';
import { getWorkspaceServerClient } from '@/lib/workspaces/server';
import { handleWorkspaceInvite } from '@/lib/workspaces/invite';
import { platformFailure } from '@/lib/platform/server';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try { return await handleWorkspaceInvite(request, await getWorkspaceServerClient(request)); }
  catch (error) { return platformFailure(error); }
}
