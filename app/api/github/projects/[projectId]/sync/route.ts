import { workspaceErrorStatus } from '@/lib/workspaces/server';
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ensureProjectAccess } from "@/lib/github/server";
import { repairGithubProjectEvidence } from "@/lib/github/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const access = await ensureProjectAccess(request, projectId, { manage: true });
    if (access.error) return access.error;
    const result = await repairGithubProjectEvidence({
      supabase: access.supabase,
      project: access.project,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("GitHub repair sync error:", error);
    return NextResponse.json({ error: error?.message || "No se pudo reconstruir la evidencia de GitHub." }, { status: workspaceErrorStatus(error) });
  }
}
