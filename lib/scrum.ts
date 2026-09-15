export const SOFTWARE_PROJECT_MODE = "software_scrum" as const;

export type ProjectMode = "general" | typeof SOFTWARE_PROJECT_MODE;
export type ScrumItemKind = "epic" | "story" | "bug" | "technical_task" | "spike";
export type ScrumExecutionMode = "manual" | "github";
export type ScrumLifecycleStatus = "planning" | "active" | "completed";
export type ScrumWorkStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "review"
  | "validation"
  | "done";

export const SCRUM_ITEM_KINDS: Array<{ value: ScrumItemKind; label: string }> = [
  { value: "epic", label: "Épica" },
  { value: "story", label: "Historia" },
  { value: "bug", label: "Error" },
  { value: "technical_task", label: "Tarea técnica" },
  { value: "spike", label: "Investigación" },
];

export const SCRUM_EXECUTION_MODES: Array<{
  value: ScrumExecutionMode;
  label: string;
  description: string;
}> = [
  {
    value: "manual",
    label: "Manual · Bandeja de entrada",
    description: "La persona actualiza las etapas desde Pixel, sin depender de ramas, commits ni pull requests.",
  },
  {
    value: "github",
    label: "GitHub · Automático",
    description: "Las ramas, commits y pull requests vinculados al código de la tarea aportan la evidencia y el avance técnico.",
  },
];

export const SCRUM_WORK_STATUSES: Array<{ value: ScrumWorkStatus; label: string }> = [
  { value: "backlog", label: "Backlog" },
  { value: "ready", label: "Listo" },
  { value: "in_progress", label: "En desarrollo" },
  { value: "review", label: "Revisión" },
  { value: "validation", label: "Validación" },
  { value: "done", label: "Terminado" },
];

export const SCRUM_POINT_SCALE = [1, 2, 3, 5, 8, 13, 21];

export const isSoftwareProject = (project: any) =>
  String(project?.projectMode || project?.type || "general") === SOFTWARE_PROJECT_MODE;

export const isScrumTask = (task: any) =>
  Boolean(task?.scrumItem || task?.scrumKind || task?.sprintId || task?.scrumStatus);

export const getScrumExecutionMode = (task: any): ScrumExecutionMode => {
  const explicitMode = String(task?.scrumExecutionMode || "").toLowerCase();
  if (explicitMode === "manual" || explicitMode === "github") {
    return explicitMode;
  }

  if (task?.githubAutomationEnabled === false || task?.workflowControl === "inbox_manual") {
    return "manual";
  }

  // Las historias creadas antes de introducir el modo híbrido pertenecían al
  // piloto GitHub. Mantenerlas allí evita cambiar su comportamiento sin aviso.
  return isScrumTask(task) ? "github" : "manual";
};

export const isManualScrumTask = (task: any) =>
  isScrumTask(task) && getScrumExecutionMode(task) === "manual";

export const isScrumInboxEligible = (task: any) => {
  if (!isScrumTask(task)) return true;
  if (task?.scrumKind === "epic") return false;
  const refinementStatus = String(task?.scrumRefinementStatus || "").toLowerCase();
  const isRefined = refinementStatus
    ? refinementStatus === "refined"
    : Boolean(task?.sprintId || task?.scrumEpicId);
  if (!isRefined) return false;
  return Boolean(task?.sprintId) || ["in_progress", "review", "validation"].includes(normalizeScrumStatus(task?.scrumStatus || task?.status));
};

export const normalizeScrumStatus = (value: any): ScrumWorkStatus => {
  const normalized = String(value || "").toLowerCase();
  if (SCRUM_WORK_STATUSES.some((status) => status.value === normalized)) {
    return normalized as ScrumWorkStatus;
  }
  if (["completed", "completed_late", "listo"].includes(normalized)) return "done";
  if (["in_progress", "en_curso", "trabajando", "reproceso"].includes(normalized)) return "in_progress";
  return "backlog";
};

export const mapScrumStatusToTaskStatus = (status: ScrumWorkStatus) => {
  if (status === "done") return "completed";
  if (["in_progress", "review", "validation"].includes(status)) return "in_progress";
  return "todo";
};

export const getScrumProgress = (status: ScrumWorkStatus, currentProgress = 0) => {
  if (status === "done") return 100;
  if (status === "validation") return Math.max(Number(currentProgress || 0), 85);
  if (status === "review") return Math.max(Number(currentProgress || 0), 65);
  if (status === "in_progress") return Math.max(Number(currentProgress || 0), 35);
  if (status === "ready") return Math.max(0, Math.min(Number(currentProgress || 0), 10));
  return 0;
};

export type ScrumScopeMetrics = {
  progress: number;
  totalItems: number;
  completedItems: number;
  totalPoints: number;
  completedPoints: number;
  blockedItems: number;
};

const clampPercentage = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export const getScrumScopeMetrics = (items: any[]): ScrumScopeMetrics => {
  const workItems = items.filter((item) => item?.scrumKind !== "epic");
  const totalItems = workItems.length;
  const completedItems = workItems.filter(
    (item) => normalizeScrumStatus(item?.scrumStatus || item?.status) === "done",
  ).length;
  const totalPoints = workItems.reduce((sum, item) => sum + Math.max(0, Number(item?.storyPoints || 0)), 0);
  const completedPoints = workItems
    .filter((item) => normalizeScrumStatus(item?.scrumStatus || item?.status) === "done")
    .reduce((sum, item) => sum + Math.max(0, Number(item?.storyPoints || 0)), 0);
  const blockedItems = workItems.filter((item) => item?.blocked || item?.status === "stuck").length;
  const weightedTotal = workItems.reduce(
    (sum, item) => sum + Math.max(1, Number(item?.storyPoints || 0)),
    0,
  );
  const weightedProgress = workItems.reduce((sum, item) => {
    const weight = Math.max(1, Number(item?.storyPoints || 0));
    const status = normalizeScrumStatus(item?.scrumStatus || item?.status);
    const storedProgress = Number(item?.progress);
    const progress = Number.isFinite(storedProgress)
      ? Math.max(getScrumProgress(status), clampPercentage(storedProgress))
      : getScrumProgress(status);
    return sum + weight * progress;
  }, 0);

  return {
    progress: weightedTotal > 0 ? clampPercentage(weightedProgress / weightedTotal) : 0,
    totalItems,
    completedItems,
    totalPoints,
    completedPoints,
    blockedItems,
  };
};

export const getScrumKindLabel = (kind: any) =>
  SCRUM_ITEM_KINDS.find((item) => item.value === kind)?.label || "Historia";

const DEFAULT_SCRUM_TASK_TYPE_LABELS: Record<Exclude<ScrumItemKind, "epic">, string> = {
  story: "Historia de usuario",
  bug: "Error",
  technical_task: "Tarea técnica",
  spike: "Investigación",
};

export const getScrumTaskTypeLabel = (item: any) => {
  const kind = String(item?.scrumKind || "story") as ScrumItemKind;
  if (kind === "epic") return "Épica";
  return String(item?.scrumTaskTypeLabel || "").trim()
    || DEFAULT_SCRUM_TASK_TYPE_LABELS[kind]
    || getScrumKindLabel(kind);
};

export const getScrumStatusLabel = (status: any) =>
  SCRUM_WORK_STATUSES.find((item) => item.value === normalizeScrumStatus(status))?.label || "Backlog";

export const toDateValue = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const getSprintStatus = (sprint: any): ScrumLifecycleStatus => {
  const status = String(sprint?.status || "planning").toLowerCase();
  if (status === "active" || status === "completed") return status;
  return "planning";
};

export const getSprintMetrics = (sprint: any, items: any[]): ScrumScopeMetrics => {
  if (getSprintStatus(sprint) !== "completed" || !sprint?.snapshot) {
    return getScrumScopeMetrics(items);
  }

  const totalItems = Number(sprint.snapshot.itemCount || 0);
  const completedItems = Number(sprint.snapshot.completedCount || 0);
  const totalPoints = Number(sprint.snapshot.committedPoints || 0);
  const completedPoints = Number(sprint.snapshot.completedPoints || 0);
  const progress = totalPoints > 0
    ? clampPercentage((completedPoints / totalPoints) * 100)
    : totalItems > 0
      ? clampPercentage((completedItems / totalItems) * 100)
      : 0;

  return {
    progress,
    totalItems,
    completedItems,
    totalPoints,
    completedPoints,
    blockedItems: 0,
  };
};

export const sortSprintsNewestFirst = (left: any, right: any) => {
  const leftDate = toDateValue(left?.startDate || left?.createdAt)?.getTime() || 0;
  const rightDate = toDateValue(right?.startDate || right?.createdAt)?.getTime() || 0;
  return rightDate - leftDate;
};
