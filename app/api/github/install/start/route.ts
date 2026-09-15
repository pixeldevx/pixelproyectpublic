import { workspaceErrorStatus } from '@/lib/workspaces/server';
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  createGithubState,
  ensureProjectAccess,
  getGithubPublicConfiguration,
  safeReturnTo,
} from "@/lib/github/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const projectId = String(body?.projectId || "").trim();
    if (!projectId) return NextResponse.json({ error: "Selecciona un proyecto." }, { status: 400 });

    const access = await ensureProjectAccess(request, projectId, { manage: true });
    if (access.error) return access.error;
    const configuration = getGithubPublicConfiguration();
    if (!configuration.appSlug || !configuration.appId || !configuration.privateKey || !configuration.stateSecret) {
      return NextResponse.json({ error: "La GitHub App todavía no está configurada por completo en Vercel." }, { status: 503 });
    }

    const state = await createGithubState(access.supabase, {
      purpose: "installation",
      userId: access.actor.id,
      email: access.actor.email,
      projectId,
      organizationId: access.project.organizationId || null,
      returnTo: safeReturnTo(body?.returnTo, `/projects/${projectId}?tab=scrum`),
    });
    return NextResponse.json({
      url: `https://github.com/apps/${encodeURIComponent(configuration.appSlug)}/installations/new?state=${encodeURIComponent(state)}`,
    });
  } catch (error: any) {
    console.error("GitHub installation start error:", error);
    return NextResponse.json({ error: error?.message || "No se pudo iniciar la instalación de GitHub." }, { status: workspaceErrorStatus(error) });
  }
}
