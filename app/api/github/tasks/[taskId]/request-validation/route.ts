import { workspaceErrorStatus } from '@/lib/workspaces/server';
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ensureProjectAccess, listDocuments, readDocument, writeDocument } from "@/lib/github/server";
import { getScrumExecutionMode, mapScrumStatusToTaskStatus } from "@/lib/scrum";

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const body = await request.json();
    const projectId = String(body?.projectId || "").trim();
    if (!projectId) return NextResponse.json({ error: "Falta el proyecto." }, { status: 400 });
    const access = await ensureProjectAccess(request, projectId);
    if (access.error) return access.error;
    const task = await readDocument(access.supabase, `projects/${projectId}/tasks`, taskId);
    if (!task) return NextResponse.json({ error: "La historia no existe." }, { status: 404 });
    if (getScrumExecutionMode(task) !== "github") {
      return NextResponse.json(
        { error: "Esta tarea usa avance manual desde la Bandeja de entrada y no requiere validación GitHub." },
        { status: 409 },
      );
    }

    const events = await listDocuments(access.supabase, `projects/${projectId}/githubEvents`, 1000);
    const pullRequestMap = new Map<string, any>();
    events
      .filter((event: any) => event.taskId === taskId && event.kind === "pull_request")
      .sort((left: any, right: any) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime())
      .forEach((event: any) => {
        const key = `${event.repositoryFullName || ""}#${event.pullRequest?.number || event.id}`;
        if (!pullRequestMap.has(key)) pullRequestMap.set(key, event);
      });
    const pullRequests = [...pullRequestMap.values()];
    const main = pullRequests.find((event: any) => event.relationship === "main");
    if (!main) {
      return NextResponse.json({ error: "Define un pull request principal antes de solicitar validación." }, { status: 409 });
    }
    if (!main.pullRequest?.merged && main.status !== "merged") {
      return NextResponse.json({ error: "El pull request principal todavía no está integrado." }, { status: 409 });
    }
    const pendingRequired = pullRequests.filter(
      (event: any) => event.relationship === "required" && !event.pullRequest?.merged && event.status !== "merged",
    );
    if (pendingRequired.length > 0) {
      return NextResponse.json({ error: `Faltan ${pendingRequired.length} pull request(s) requerido(s) por integrar.` }, { status: 409 });
    }

    await writeDocument(access.supabase, `projects/${projectId}/tasks`, taskId, {
      scrumStatus: "validation",
      status: mapScrumStatusToTaskStatus("validation"),
      progress: Math.max(Number(task.progress || 0), 85),
      validationRequestedAt: new Date().toISOString(),
      validationRequestedBy: access.actor.id,
      validationRequestedByEmail: access.actor.email,
      validationEvidence: {
        mainPullRequest: main.pullRequest,
        requiredPullRequestIds: pullRequests.filter((event: any) => event.relationship === "required").map((event: any) => event.id),
      },
    });
    await writeDocument(
      access.supabase,
      `projects/${projectId}/githubEvents`,
      `validation-${taskId}-${Date.now()}`,
      {
        kind: "validation_request",
        eventName: "pixel_validation_request",
        source: "pixel",
        projectId,
        taskId,
        taskCode: task.scrumCode,
        status: "requested",
        occurredAt: new Date().toISOString(),
        requestedBy: access.actor.id,
        requestedByEmail: access.actor.email,
      },
      false,
    );
    return NextResponse.json({ ok: true, status: "validation" });
  } catch (error: any) {
    console.error("GitHub validation request error:", error);
    return NextResponse.json({ error: error?.message || "No se pudo solicitar la validación." }, { status: workspaceErrorStatus(error) });
  }
}
