import { workspaceErrorStatus } from '@/lib/workspaces/server';
import { getWorkspaceClientForSystem } from "@/lib/workspaces/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ingestGithubEvent } from "@/lib/github/events";
import {
  listInstallationRepositories,
  readDocument,
  verifyGithubWebhook,
  writeDocument,
} from "@/lib/github/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supportedEvidenceEvents = new Set([
  "create",
  "push",
  "pull_request",
  "check_run",
  "workflow_run",
  "deployment_status",
]);

const summarizeRepository = (repository: any) => ({
  id: repository.id,
  name: repository.name,
  fullName: repository.full_name,
  private: Boolean(repository.private),
  defaultBranch: repository.default_branch || "main",
  url: repository.html_url,
  archived: Boolean(repository.archived),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256") || "";
    if (!verifyGithubWebhook(rawBody, signature)) {
      return NextResponse.json({ error: "Firma de webhook inválida." }, { status: 401 });
    }
    const deliveryId = request.headers.get("x-github-delivery") || "";
    const eventName = request.headers.get("x-github-event") || "";
    if (!deliveryId || !eventName) {
      return NextResponse.json({ error: "El webhook no incluye identificadores suficientes." }, { status: 400 });
    }
    const payload = JSON.parse(rawBody || "{}");
    const supabase = await getWorkspaceClientForSystem(process.env.GITHUB_AUTOMATION_WORKSPACE_ID || '');
    const existing = await readDocument(supabase, "github_webhook_deliveries", deliveryId);
    if (existing?.processedAt) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    let result: any = { matchedProjects: 0, matchedTasks: 0, createdEvents: 0 };
    if (supportedEvidenceEvents.has(eventName)) {
      result = await ingestGithubEvent({ supabase, deliveryId, eventName, payload, source: "webhook" });
    }

    if (["installation", "installation_repositories"].includes(eventName) && payload?.installation?.id) {
      const installationId = String(payload.installation.id);
      const repositories = (await listInstallationRepositories(installationId)).map(summarizeRepository);
      await writeDocument(supabase, "github_installations", installationId, {
        installationId: payload.installation.id,
        account: {
          id: payload.installation.account?.id,
          login: payload.installation.account?.login,
          type: payload.installation.account?.type,
          avatarUrl: payload.installation.account?.avatar_url,
          profileUrl: payload.installation.account?.html_url,
        },
        repositorySelection: payload.installation.repository_selection,
        repositories,
        suspendedAt: payload.installation.suspended_at || null,
        lastWebhookAt: new Date().toISOString(),
      });
    }

    await writeDocument(supabase, "github_webhook_deliveries", deliveryId, {
      deliveryId,
      eventName,
      installationId: payload?.installation?.id || null,
      repositoryFullName: payload?.repository?.full_name || null,
      result,
      processedAt: new Date().toISOString(),
    }, false);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("GitHub webhook error:", error);
    return NextResponse.json({ error: error?.message || "No se pudo procesar el webhook." }, { status: workspaceErrorStatus(error) });
  }
}
