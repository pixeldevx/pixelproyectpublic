import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  canManageProjectGithub,
  ensureProjectAccess,
  getGithubPublicConfiguration,
  listDocuments,
  readDocument,
  writeDocument,
} from "@/lib/github/server";
import { getScrumExecutionMode } from "@/lib/scrum";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const access = await ensureProjectAccess(request, projectId);
    if (access.error) return access.error;
    const installationId = access.project.githubSettings?.installationId;
    const installation = installationId
      ? await readDocument(access.supabase, "github_installations", String(installationId))
      : null;
    const events = (await listDocuments(access.supabase, `projects/${projectId}/githubEvents`, 500))
      .sort((left: any, right: any) => new Date(right.occurredAt || right._updatedAt).getTime() - new Date(left.occurredAt || left._updatedAt).getTime());
    const tasks = (await listDocuments(access.supabase, `projects/${projectId}/tasks`, 5000))
      .filter((task: any) => (task.scrumItem || task.scrumCode) && getScrumExecutionMode(task) === "github")
      .map((task: any) => ({
        id: task.id,
        scrumCode: task.scrumCode,
        title: task.title || task.name,
        scrumStatus: task.scrumStatus,
        scrumExecutionMode: getScrumExecutionMode(task),
        githubMainPullRequest: task.githubMainPullRequest || null,
        githubLastEvidenceAt: task.githubLastEvidenceAt || null,
      }));
    return NextResponse.json({
      appConfiguration: getGithubPublicConfiguration(),
      canManage: canManageProjectGithub(access.actor, access.project),
      installation: installation
        ? {
            installationId: installation.installationId,
            account: installation.account,
            repositories: installation.repositories || [],
            suspendedAt: installation.suspendedAt || null,
            connectedAt: installation.connectedAt || null,
          }
        : null,
      selectedRepositories: access.project.githubSettings?.repositoryFullNames || [],
      githubSettings: access.project.githubSettings || {},
      userIdentity: access.actor.profile?.githubIdentity || null,
      events,
      tasks,
    });
  } catch (error: any) {
    console.error("GitHub project configuration GET error:", error);
    return NextResponse.json({ error: error?.message || "No se pudo cargar la integración de GitHub." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const access = await ensureProjectAccess(request, projectId, { manage: true });
    if (access.error) return access.error;
    const installationId = access.project.githubSettings?.installationId;
    if (!installationId) return NextResponse.json({ error: "Instala primero la GitHub App." }, { status: 409 });
    const installation = await readDocument(access.supabase, "github_installations", String(installationId));
    if (!installation) return NextResponse.json({ error: "La instalación de GitHub no está disponible." }, { status: 404 });

    const body = await request.json();
    const requested: string[] = Array.isArray(body?.repositoryFullNames)
      ? [...new Set<string>(body.repositoryFullNames.map((value: unknown) => String(value || "").trim()).filter(Boolean))]
      : [];
    const available = new Set((installation.repositories || []).map((repository: any) => repository.fullName));
    const invalid = requested.filter((name: string) => !available.has(name));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Repositorios no autorizados por la instalación: ${invalid.join(", ")}` }, { status: 400 });
    }
    await writeDocument(access.supabase, "projects", projectId, {
      githubSettings: {
        ...(access.project.githubSettings || {}),
        repositoryFullNames: requested,
        updatedBy: access.actor.id,
        updatedAt: new Date().toISOString(),
      },
    });
    return NextResponse.json({ ok: true, selectedRepositories: requested });
  } catch (error: any) {
    console.error("GitHub project configuration PATCH error:", error);
    return NextResponse.json({ error: error?.message || "No se pudo guardar la configuración de GitHub." }, { status: 500 });
  }
}
