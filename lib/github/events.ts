import {
  GITHUB_DOCUMENTS_TABLE,
  listDocuments,
  readDocument,
  writeDocument,
} from "@/lib/github/server";
import { getScrumExecutionMode, mapScrumStatusToTaskStatus, normalizeScrumStatus } from "@/lib/scrum";

export type GithubEvidenceRole = "main" | "required" | "complementary";

type IngestGithubEventOptions = {
  supabase: any;
  deliveryId: string;
  eventName: string;
  payload: any;
  source?: "webhook" | "repair";
};

const TASK_CODE_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-\d{1,8}\b/g;

const normalizeRepository = (payload: any) =>
  String(payload?.repository?.full_name || payload?.repo?.full_name || "").trim();

export const extractGithubTaskCodes = (eventName: string, payload: any) => {
  const values = [
    payload?.ref,
    payload?.pull_request?.title,
    payload?.pull_request?.body,
    payload?.pull_request?.head?.ref,
    payload?.check_run?.name,
    payload?.check_run?.pull_requests?.map((entry: any) => entry?.head?.ref).join(" "),
    payload?.workflow_run?.name,
    payload?.workflow_run?.head_branch,
    payload?.deployment?.ref,
    payload?.head_commit?.message,
    ...(payload?.commits || []).map((commit: any) => commit?.message),
  ];
  const result = new Set<string>();
  values.forEach((value) => {
    const matches = String(value || "").toUpperCase().match(TASK_CODE_PATTERN) || [];
    matches.forEach((match) => result.add(match));
  });
  if (eventName === "pull_request") {
    String(payload?.pull_request?.html_url || "")
      .toUpperCase()
      .match(TASK_CODE_PATTERN)
      ?.forEach((match) => result.add(match));
  }
  return [...result];
};

const getEventKind = (eventName: string) => {
  if (eventName === "pull_request") return "pull_request";
  if (eventName === "push") return "commit";
  if (eventName === "check_run") return "check";
  if (eventName === "workflow_run") return "workflow";
  if (eventName === "deployment_status") return "deployment";
  if (eventName === "create") return "branch";
  return eventName;
};

const normalizedStatus = (eventName: string, payload: any) => {
  if (eventName === "pull_request") {
    if (payload?.pull_request?.merged) return "merged";
    return payload?.pull_request?.state || payload?.action || "updated";
  }
  if (eventName === "check_run") return payload?.check_run?.conclusion || payload?.check_run?.status || payload?.action;
  if (eventName === "workflow_run") return payload?.workflow_run?.conclusion || payload?.workflow_run?.status || payload?.action;
  if (eventName === "deployment_status") return payload?.deployment_status?.state || payload?.action;
  return payload?.action || (eventName === "push" ? "published" : "created");
};

const buildEvidence = (eventName: string, payload: any) => {
  const pullRequest = payload?.pull_request;
  const checkRun = payload?.check_run;
  const workflowRun = payload?.workflow_run;
  const deployment = payload?.deployment;
  const deploymentStatus = payload?.deployment_status;
  const commits = (payload?.commits || []).slice(0, 100).map((commit: any) => ({
    sha: commit?.id,
    message: commit?.message,
    url: commit?.url,
    author: commit?.author?.username || commit?.author?.name || null,
    timestamp: commit?.timestamp || null,
  }));

  return {
    kind: getEventKind(eventName),
    action: payload?.action || null,
    status: normalizedStatus(eventName, payload),
    repositoryFullName: normalizeRepository(payload),
    repositoryUrl: payload?.repository?.html_url || null,
    sender: payload?.sender
      ? {
          id: payload.sender.id,
          login: payload.sender.login,
          avatarUrl: payload.sender.avatar_url,
          profileUrl: payload.sender.html_url,
        }
      : null,
    branch: eventName === "push"
      ? String(payload?.ref || "").replace(/^refs\/heads\//, "")
      : pullRequest?.head?.ref || workflowRun?.head_branch || deployment?.ref || payload?.ref || null,
    commitSha: payload?.after || pullRequest?.head?.sha || checkRun?.head_sha || workflowRun?.head_sha || deployment?.sha || null,
    commits,
    pullRequest: pullRequest
      ? {
          id: pullRequest.id,
          number: pullRequest.number,
          title: pullRequest.title,
          body: pullRequest.body || null,
          url: pullRequest.html_url,
          state: pullRequest.state,
          draft: Boolean(pullRequest.draft),
          merged: Boolean(pullRequest.merged),
          mergedAt: pullRequest.merged_at || null,
          headRef: pullRequest.head?.ref || null,
          headSha: pullRequest.head?.sha || null,
          baseRef: pullRequest.base?.ref || null,
          author: pullRequest.user?.login || null,
        }
      : null,
    check: checkRun
      ? {
          id: checkRun.id,
          name: checkRun.name,
          url: checkRun.html_url,
          status: checkRun.status,
          conclusion: checkRun.conclusion || null,
        }
      : workflowRun
        ? {
            id: workflowRun.id,
            name: workflowRun.name,
            url: workflowRun.html_url,
            status: workflowRun.status,
            conclusion: workflowRun.conclusion || null,
          }
        : null,
    deployment: deploymentStatus || deployment
      ? {
          id: deployment?.id || deploymentStatus?.id,
          environment: deployment?.environment || deploymentStatus?.environment || null,
          status: deploymentStatus?.state || null,
          url: deploymentStatus?.environment_url || deploymentStatus?.target_url || null,
        }
      : null,
    occurredAt:
      pullRequest?.updated_at ||
      checkRun?.completed_at ||
      checkRun?.started_at ||
      workflowRun?.updated_at ||
      deploymentStatus?.created_at ||
      payload?.head_commit?.timestamp ||
      new Date().toISOString(),
  };
};

const getProjectsForRepository = async (supabase: any, repositoryFullName: string) => {
  const { data, error } = await supabase
    .from(GITHUB_DOCUMENTS_TABLE)
    .select("doc_id,data")
    .eq("collection_path", "projects")
    .contains("data", { githubSettings: { repositoryFullNames: [repositoryFullName] } });
  if (!error && data) {
    return data.map((row: any) => ({ id: row.doc_id, ...(row.data || {}) }));
  }
  const projects = await listDocuments(supabase, "projects", 5000);
  return projects.filter((project: any) =>
    (project.githubSettings?.repositoryFullNames || []).includes(repositoryFullName),
  );
};

const findTasksByCodes = async (supabase: any, projectId: string, codes: string[]) => {
  const tasks = await listDocuments(supabase, `projects/${projectId}/tasks`, 5000);
  const codeSet = new Set(codes.map((code) => code.toUpperCase()));
  return tasks.filter(
    (task: any) =>
      getScrumExecutionMode(task) === "github" &&
      codeSet.has(String(task.scrumCode || "").toUpperCase()),
  );
};

const getPullRequestRole = async (supabase: any, projectId: string, taskId: string, evidence: any) => {
  if (evidence.kind !== "pull_request") return null;
  const events = await listDocuments(supabase, `projects/${projectId}/githubEvents`, 1000);
  const samePullRequest = events.find(
    (entry: any) =>
      entry.taskId === taskId &&
      entry.kind === "pull_request" &&
      entry.repositoryFullName === evidence.repositoryFullName &&
      Number(entry.pullRequest?.number) === Number(evidence.pullRequest?.number) &&
      entry.relationship,
  );
  if (samePullRequest) return samePullRequest.relationship as GithubEvidenceRole;
  const existingMain = events.find(
    (entry: any) => entry.taskId === taskId && entry.kind === "pull_request" && entry.relationship === "main",
  );
  return existingMain ? "complementary" : "main";
};

const updateTaskFromEvidence = async (
  supabase: any,
  projectId: string,
  task: any,
  evidence: any,
  relationship: GithubEvidenceRole | null,
) => {
  const currentStatus = normalizeScrumStatus(task.scrumStatus || task.status);
  const updates: Record<string, any> = {
    githubLastEvidenceAt: evidence.occurredAt,
    githubLastEvidenceKind: evidence.kind,
    githubRepositoryFullName: evidence.repositoryFullName,
  };

  if (["backlog", "ready"].includes(currentStatus) && ["branch", "commit", "pull_request"].includes(evidence.kind)) {
    updates.scrumStatus = "in_progress";
    updates.status = mapScrumStatusToTaskStatus("in_progress");
    updates.progress = Math.max(Number(task.progress || 0), 25);
  }
  if (evidence.kind === "pull_request") {
    updates.githubPullRequestCount = Math.max(Number(task.githubPullRequestCount || 0), 1);
    if (relationship === "main") {
      updates.githubMainPullRequest = {
        ...evidence.pullRequest,
        repositoryFullName: evidence.repositoryFullName,
        status: evidence.status,
      };
    } else if (
      task.githubMainPullRequest?.number === evidence.pullRequest?.number &&
      task.githubMainPullRequest?.repositoryFullName === evidence.repositoryFullName
    ) {
      updates.githubMainPullRequest = {
        ...task.githubMainPullRequest,
        ...evidence.pullRequest,
        status: evidence.status,
      };
    }
    if (currentStatus === "in_progress") {
      updates.scrumStatus = "review";
      updates.status = mapScrumStatusToTaskStatus("review");
      updates.progress = Math.max(Number(task.progress || 0), 70);
    }
  }
  await writeDocument(supabase, `projects/${projectId}/tasks`, task.id, updates, true);
};

export const ingestGithubEvent = async ({
  supabase,
  deliveryId,
  eventName,
  payload,
  source = "webhook",
}: IngestGithubEventOptions) => {
  const repositoryFullName = normalizeRepository(payload);
  if (!repositoryFullName) return { matchedProjects: 0, matchedTasks: 0, createdEvents: 0 };
  const codes = extractGithubTaskCodes(eventName, payload);
  if (codes.length === 0) return { matchedProjects: 0, matchedTasks: 0, createdEvents: 0 };

  const projects = await getProjectsForRepository(supabase, repositoryFullName);
  let matchedTasks = 0;
  let createdEvents = 0;
  const evidence = buildEvidence(eventName, payload);
  const githubSender = evidence.sender;
  const linkedPixelUser = githubSender?.id
    ? (await listDocuments(supabase, "users", 5000)).find(
        (user: any) =>
          Number(user.githubIdentity?.id) === Number(githubSender.id) ||
          String(user.githubIdentity?.login || "").toLowerCase() === String(githubSender.login || "").toLowerCase(),
      )
    : null;

  for (const project of projects) {
    const tasks = await findTasksByCodes(supabase, project.id, codes);
    for (const task of tasks) {
      matchedTasks += 1;
      const eventId = `${deliveryId}-${task.id}`.slice(0, 240);
      const existing = await readDocument(supabase, `projects/${project.id}/githubEvents`, eventId);
      const relationship = existing?.relationship || await getPullRequestRole(supabase, project.id, task.id, evidence);
      await writeDocument(
        supabase,
        `projects/${project.id}/githubEvents`,
        eventId,
        {
          deliveryId,
          eventName,
          source,
          projectId: project.id,
          taskId: task.id,
          taskCode: task.scrumCode,
          relationship,
          pixelActor: linkedPixelUser
            ? {
                id: linkedPixelUser.id,
                name: linkedPixelUser.name || linkedPixelUser.displayName || null,
                email: linkedPixelUser.email || null,
              }
            : null,
          ...evidence,
          receivedAt: existing?.receivedAt || new Date().toISOString(),
        },
        true,
      );
      if (!existing) createdEvents += 1;
      await updateTaskFromEvidence(supabase, project.id, task, evidence, relationship);
    }
  }

  return { matchedProjects: projects.length, matchedTasks, createdEvents };
};
