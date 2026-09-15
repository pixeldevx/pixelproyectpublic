import { workspaceErrorStatus } from '@/lib/workspaces/server';
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { GithubEvidenceRole } from "@/lib/github/events";
import { ensureProjectAccess, readDocument, writeDocument } from "@/lib/github/server";

const validRoles = new Set<GithubEvidenceRole>(["main", "required", "complementary"]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; eventId: string }> },
) {
  try {
    const { projectId, eventId } = await context.params;
    const access = await ensureProjectAccess(request, projectId, { manage: true });
    if (access.error) return access.error;
    const event = await readDocument(access.supabase, `projects/${projectId}/githubEvents`, eventId);
    if (!event || event.kind !== "pull_request") {
      return NextResponse.json({ error: "La evidencia de pull request no existe." }, { status: 404 });
    }
    const body = await request.json();
    const relationship = String(body?.relationship || "") as GithubEvidenceRole;
    if (!validRoles.has(relationship)) return NextResponse.json({ error: "Clasificación no válida." }, { status: 400 });

    if (relationship === "main") {
      const { data, error } = await access.supabase
        .from("app_documents")
        .select("doc_id,data")
        .eq("collection_path", `projects/${projectId}/githubEvents`)
        .eq("data->>taskId", event.taskId)
        .eq("data->>kind", "pull_request");
      if (error) throw error;
      await Promise.all(
        (data || [])
          .filter((row: any) => row.doc_id !== eventId && row.data?.relationship === "main")
          .map((row: any) => writeDocument(
            access.supabase,
            `projects/${projectId}/githubEvents`,
            row.doc_id,
            { relationship: "complementary" },
            true,
          )),
      );
      const task = await readDocument(access.supabase, `projects/${projectId}/tasks`, event.taskId);
      if (task) {
        await writeDocument(access.supabase, `projects/${projectId}/tasks`, event.taskId, {
          githubMainPullRequest: {
            ...(event.pullRequest || {}),
            repositoryFullName: event.repositoryFullName,
            status: event.status,
          },
        });
      }
    }
    await writeDocument(access.supabase, `projects/${projectId}/githubEvents`, eventId, {
      relationship,
      classifiedBy: access.actor.id,
      classifiedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, relationship });
  } catch (error: any) {
    console.error("GitHub evidence classification error:", error);
    return NextResponse.json({ error: error?.message || "No se pudo clasificar el pull request." }, { status: workspaceErrorStatus(error) });
  }
}
