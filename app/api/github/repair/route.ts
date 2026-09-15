import { workspaceErrorStatus } from '@/lib/workspaces/server';
import crypto from "node:crypto";
import { getWorkspaceClientForSystem } from "@/lib/workspaces/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { listDocuments } from "@/lib/github/server";
import { repairGithubProjectEvidence } from "@/lib/github/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const secureEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export async function GET(request: NextRequest) {
  try {
    const secret = String(process.env.CRON_SECRET || "");
    const authorization = request.headers.get("authorization") || "";
    if (!secret || !secureEqual(authorization, `Bearer ${secret}`)) {
      return NextResponse.json({ error: "Cron no autorizado." }, { status: 401 });
    }
    const supabase = await getWorkspaceClientForSystem(process.env.GITHUB_AUTOMATION_WORKSPACE_ID || '');
    const projects = (await listDocuments(supabase, "projects", 5000))
      .filter((project: any) =>
        project.githubSettings?.installationId &&
        Array.isArray(project.githubSettings?.repositoryFullNames) &&
        project.githubSettings.repositoryFullNames.length > 0,
      );
    const results: any[] = [];
    for (const project of projects.slice(0, 50)) {
      try {
        const result = await repairGithubProjectEvidence({
          supabase,
          project,
          perRepository: 30,
          maximumRepositories: 10,
        });
        results.push({ projectId: project.id, ok: true, ...result });
      } catch (error: any) {
        results.push({ projectId: project.id, ok: false, error: error?.message || "Error de sincronización" });
      }
    }
    return NextResponse.json({ ok: true, projects: results.length, results });
  } catch (error: any) {
    console.error("GitHub automatic repair error:", error);
    return NextResponse.json({ error: error?.message || "No se pudo ejecutar la reparación automática." }, { status: workspaceErrorStatus(error) });
  }
}
