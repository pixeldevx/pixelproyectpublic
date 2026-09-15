import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  consumeGithubState,
  createGithubAppJwt,
  getAppBaseUrl,
  getGithubCallbackClient,
  githubFetch,
  listInstallationRepositories,
  readDocument,
  safeReturnTo,
  writeDocument,
} from "@/lib/github/server";

export const dynamic = "force-dynamic";

const repositorySummary = (repository: any) => ({
  id: repository.id,
  name: repository.name,
  fullName: repository.full_name,
  private: Boolean(repository.private),
  defaultBranch: repository.default_branch || "main",
  url: repository.html_url,
  archived: Boolean(repository.archived),
});

export async function GET(request: NextRequest) {
  const baseUrl = getAppBaseUrl(request);
  try {
    const state = request.nextUrl.searchParams.get("state") || "";
    const installationId = request.nextUrl.searchParams.get("installation_id") || "";
    if (!installationId) throw new Error("GitHub no devolvió el identificador de instalación.");

    const supabase = await getGithubCallbackClient(state, "installation");
    const payload = await consumeGithubState(supabase, state, "installation");
    if (!payload.projectId) throw new Error("La autorización no contiene un proyecto de Pixel.");

    const installation = await githubFetch<any>(`/app/installations/${installationId}`, {
      token: createGithubAppJwt(),
    });
    const repositories = (await listInstallationRepositories(installationId)).map(repositorySummary);
    await writeDocument(supabase, "github_installations", installationId, {
      installationId: Number(installationId),
      account: {
        id: installation.account?.id,
        login: installation.account?.login,
        type: installation.account?.type,
        avatarUrl: installation.account?.avatar_url,
        profileUrl: installation.account?.html_url,
      },
      repositorySelection: installation.repository_selection,
      permissions: installation.permissions || {},
      events: installation.events || [],
      repositories,
      suspendedAt: installation.suspended_at || null,
      connectedBy: payload.userId,
      connectedByEmail: payload.email,
      connectedAt: new Date().toISOString(),
    });

    const project = await readDocument(supabase, "projects", payload.projectId);
    if (!project) throw new Error("El proyecto de Pixel ya no existe.");
    const availableNames = repositories.map((repository) => repository.fullName);
    const previousNames = Array.isArray(project.githubSettings?.repositoryFullNames)
      ? project.githubSettings.repositoryFullNames.filter((name: string) => availableNames.includes(name))
      : [];
    await writeDocument(supabase, "projects", payload.projectId, {
      githubSettings: {
        ...(project.githubSettings || {}),
        installationId: Number(installationId),
        accountLogin: installation.account?.login || null,
        repositoryFullNames: previousNames.length > 0 ? previousNames : availableNames,
        connectedAt: new Date().toISOString(),
        connectedBy: payload.userId,
      },
    });

    const returnTo = safeReturnTo(payload.returnTo, `/projects/${payload.projectId}?tab=scrum`);
    const redirectUrl = new URL(returnTo, baseUrl);
    redirectUrl.searchParams.set("github", "installed");
    return NextResponse.redirect(redirectUrl);
  } catch (error: any) {
    console.error("GitHub installation callback error:", error);
    const redirectUrl = new URL("/projects", baseUrl);
    redirectUrl.searchParams.set("github", "error");
    redirectUrl.searchParams.set("message", error?.message || "No se pudo completar la instalación.");
    return NextResponse.redirect(redirectUrl);
  }
}
