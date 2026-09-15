import { ingestGithubEvent } from "@/lib/github/events";
import {
  getInstallationToken,
  githubFetch,
  readDocument,
  writeDocument,
} from "@/lib/github/server";

type RepairGithubProjectOptions = {
  supabase: any;
  project: any;
  perRepository?: number;
  maximumRepositories?: number;
};
export const repairGithubProjectEvidence = async ({
  supabase,
  project,
  perRepository = 100,
  maximumRepositories = 20,
}: RepairGithubProjectOptions) => {
  const installationId = project.githubSettings?.installationId;
  if (!installationId) throw new Error("El proyecto no tiene una GitHub App instalada.");
  const installation = await readDocument(supabase, "github_installations", String(installationId));
  if (!installation || installation.suspendedAt) throw new Error("La instalación de GitHub no está activa.");

  const token = await getInstallationToken(installationId);
  const selected: string[] = Array.isArray(project.githubSettings?.repositoryFullNames)
    ? project.githubSettings.repositoryFullNames
    : [];
  const repositoryMap = new Map<string, any>(
    (installation.repositories || []).map((repository: any) => [repository.fullName, repository]),
  );
  let processed = 0;
  let createdEvents = 0;
  let matchedTasks = 0;
  const limit = Math.max(1, Math.min(100, perRepository));

  for (const fullName of selected.slice(0, maximumRepositories)) {
    const repository: any = repositoryMap.get(fullName) || { fullName, url: `https://github.com/${fullName}` };
    const pulls = await githubFetch<any[]>(`/repos/${fullName}/pulls?state=all&sort=updated&direction=desc&per_page=${limit}`, { token });
    for (const pullRequest of pulls) {
      const result = await ingestGithubEvent({
        supabase,
        deliveryId: `repair-pr-${repository.id || fullName}-${pullRequest.number}-${pullRequest.updated_at}`,
        eventName: "pull_request",
        source: "repair",
        payload: {
          action: pullRequest.merged_at ? "closed" : "synchronize",
          sender: pullRequest.user,
          repository: {
            id: repository.id,
            full_name: fullName,
            html_url: repository.url || `https://github.com/${fullName}`,
          },
          pull_request: { ...pullRequest, merged: Boolean(pullRequest.merged_at) },
        },
      });
      processed += 1;
      createdEvents += result.createdEvents;
      matchedTasks += result.matchedTasks;
    }

    const commits = await githubFetch<any[]>(`/repos/${fullName}/commits?per_page=${limit}`, { token });
    for (const commit of commits) {
      const result = await ingestGithubEvent({
        supabase,
        deliveryId: `repair-commit-${repository.id || fullName}-${commit.sha}`,
        eventName: "push",
        source: "repair",
        payload: {
          sender: commit.author,
          repository: {
            id: repository.id,
            full_name: fullName,
            html_url: repository.url || `https://github.com/${fullName}`,
          },
          after: commit.sha,
          head_commit: {
            id: commit.sha,
            message: commit.commit?.message,
            timestamp: commit.commit?.author?.date,
            url: commit.html_url,
            author: commit.author,
          },
          commits: [{
            id: commit.sha,
            message: commit.commit?.message,
            timestamp: commit.commit?.author?.date,
            url: commit.html_url,
            author: commit.author,
          }],
        },
      });
      processed += 1;
      createdEvents += result.createdEvents;
      matchedTasks += result.matchedTasks;
    }
  }

  await writeDocument(supabase, "projects", project.id, {
    githubSettings: {
      ...(project.githubSettings || {}),
      lastRepairAt: new Date().toISOString(),
      lastRepairResult: { processed, createdEvents, matchedTasks },
    },
  });
  return { repositories: selected.length, processed, createdEvents, matchedTasks };
};
