"use client";

import React from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  ListChecks,
  Search,
  Target,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { isCompletedTaskStatus } from "@/lib/taskProgress";
import { getWorkflowTaskTypeLabel, isWorkflowTaskType } from "@/lib/workflow-routing";

type TaskStatusReportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tasks: any[];
  taskGroups?: any[];
  teamMembers?: any[];
};

type ReportView = "general" | "subtasks" | "task-report";
type ReportTaskFilter = "all" | "finished" | "open" | "overdue" | "dueSoon";

const STATUS_COLORS = {
  notStarted: "#94a3b8",
  inProgress: "#f59e0b",
  finished: "#10b981",
  overdue: "#dc2626",
  dueSoon: "#f97316",
  ok: "#14b8a6",
  noDate: "#cbd5e1",
  high: "#e2445c",
  medium: "#5559df",
  low: "#94a3b8",
};

const DEFAULT_TASK_GROUP_ID = "__ungrouped__";
const DEFAULT_TASK_GROUP_NAME = "Sin grupo";
const DAY_MS = 24 * 60 * 60 * 1000;

const getTaskTitle = (task: any) => task?.title || task?.name || "Tarea sin nombre";
const getTaskGroupId = (task: any) => task?.groupId || DEFAULT_TASK_GROUP_ID;

const getTaskDate = (value: any) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTaskTimestamp = (value: any) => {
  const date = getTaskDate(value);
  return date ? date.getTime() : 0;
};

const formatReportDate = (value: any) => {
  const date = getTaskDate(value);
  if (!date) return "Sin fecha";
  return date.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const REPORT_FILTER_LABELS: Record<ReportTaskFilter, string> = {
  all: "Todas",
  finished: "Finalizadas",
  open: "Abiertas",
  overdue: "Atrasadas",
  dueSoon: "Por vencer",
};

const sanitizeFilename = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "reporte";

const escapeCsvCell = (value: any) => {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[;"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const getTaskStatusLabel = (status?: string) => {
  switch (status) {
    case "completed":
    case "listo":
      return "Finalizada";
    case "completed_late":
      return "Finalizada con retraso";
    case "in_progress":
    case "en_curso":
      return "En curso";
    case "stuck":
    case "detenido":
      return "Estancada";
    case "rescheduled":
      return "Reprogramada";
    case "devuelto":
    case "reproceso":
      return "Devuelta";
    case "todo":
    case "pending":
    case "not_started":
    default:
      return "Pendiente";
  }
};

const getPriorityLabel = (priority?: string) => {
  if (priority === "high") return "Alta";
  if (priority === "low") return "Baja";
  return "Media";
};

const getScheduleStateLabel = (state: string) => {
  switch (state) {
    case "overdue":
      return "Atrasada";
    case "dueSoon":
      return "Por vencer";
    case "completedLate":
      return "Finalizada con retraso";
    case "done":
      return "Cumplida";
    case "paused":
      return "Pausada";
    case "noDate":
      return "Sin fecha";
    case "ok":
    default:
      return "A tiempo";
  }
};

const getStatusBucket = (task: any) => {
  const status = task?.status || "todo";
  if (isCompletedTaskStatus(status)) return "finished";
  if (status === "todo" || status === "pending" || status === "not_started") return "notStarted";
  return "inProgress";
};

const getScheduleState = (task: any) => {
  const status = task?.status || "todo";
  if (status === "completed_late") return "completedLate";
  if (isCompletedTaskStatus(status)) return "done";
  if (status === "stuck" || status === "detenido") return "paused";

  const endDate = getTaskDate(task?.endDate || task?.end);
  if (!endDate) return "noDate";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endOfDay = new Date(endDate);
  endOfDay.setHours(23, 59, 59, 999);

  if (endOfDay.getTime() < today.getTime()) return "overdue";
  return endOfDay.getTime() - Date.now() <= 2 * 24 * 60 * 60 * 1000 ? "dueSoon" : "ok";
};

const getPercent = (value: number, total: number) => {
  if (!total) return 0;
  return Math.round((value / total) * 100);
};

const getProgressAverage = (tasks: any[]) => {
  if (tasks.length === 0) return 0;
  const total = tasks.reduce((sum, task) => sum + Number(task.progress || 0), 0);
  return Math.round(total / tasks.length);
};

const getTaskOrder = (task: any) => {
  if (typeof task?.displayOrder === "number") return task.displayOrder;
  return getTaskTimestamp(task?.createdAt || task?.updatedAt);
};

const isWorkflowTask = (task: any) =>
  isWorkflowTaskType(task?.type) && Array.isArray(task.workflowSteps) && task.workflowSteps.length > 0;

const getWorkflowStepLabel = (task: any, index: number) =>
  task.workflowSteps?.[index]?.label || `Paso ${index + 1}`;

const getCurrentWorkflowStepIndex = (task: any) => {
  const steps = task.workflowSteps || [];
  if (steps.length === 0) return 0;
  if (isCompletedTaskStatus(task.status)) return steps.length - 1;

  const explicitIndex = Number(task.currentStepIndex);
  if (Number.isFinite(explicitIndex) && explicitIndex >= 0 && explicitIndex < steps.length) {
    return explicitIndex;
  }

  const firstOpenIndex = steps.findIndex((step: any) => step.status !== "listo");
  return firstOpenIndex >= 0 ? firstOpenIndex : steps.length - 1;
};

const getCurrentWorkflowStepSummary = (task: any) => {
  if (!isWorkflowTask(task)) return "No aplica";
  const index = getCurrentWorkflowStepIndex(task);
  const step = task.workflowSteps?.[index];
  const stepLabel = getWorkflowStepLabel(task, index);
  const stepStatus = getTaskStatusLabel(step?.status || task.status);
  return `Paso ${index + 1}: ${stepLabel} · ${stepStatus}`;
};

const getStepStatusBucket = (step: any) => {
  const status = step?.status || "not_started";
  if (status === "listo") return "approved";
  if (status === "en_curso" || status === "reproceso") return "active";
  if (status === "devuelto" || status === "detenido") return "blocked";
  return "pending";
};

const average = (values: number[]) => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const formatDuration = (milliseconds: number) => {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "Sin datos";
  const days = milliseconds / DAY_MS;
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
  return `${Math.round(days * 10) / 10} días`;
};

const getWorkflowHistoryDates = (task: any, predicate?: (entry: any) => boolean): Date[] =>
  (task.workflowHistory || [])
    .filter((entry: any) => !predicate || predicate(entry))
    .map((entry: any) => getTaskDate(entry.timestamp))
    .filter((date: Date | null): date is Date => Boolean(date));

const getWorkflowStartDate = (task: any) => {
  const explicitStarts = getWorkflowHistoryDates(task, (entry) => entry.action === "start");
  const historyDates = explicitStarts.length > 0 ? explicitStarts : getWorkflowHistoryDates(task);
  const stepStarts = (task.workflowSteps || [])
    .map((step: any) => getTaskDate(step.startedAt))
    .filter((date: Date | null): date is Date => Boolean(date));
  const candidates = [...historyDates, ...stepStarts];

  if (candidates.length > 0) {
    return new Date(Math.min(...candidates.map((date) => date.getTime())));
  }

  return getTaskDate(task.createdAt) || getTaskDate(task.startDate || task.start);
};

const getWorkflowCompletionDate = (task: any) => {
  if (!isCompletedTaskStatus(task.status)) return null;
  const lastStepIndex = Math.max((task.workflowSteps || []).length - 1, 0);
  const finalApprovals = getWorkflowHistoryDates(
    task,
    (entry) => entry.action === "approve" && Number(entry.stepIndex || 0) === lastStepIndex
  );

  if (finalApprovals.length > 0) {
    return new Date(Math.max(...finalApprovals.map((date) => date.getTime())));
  }

  return getTaskDate(task.completedAt) || getTaskDate(task.updatedAt);
};

const getTaskCompletionDate = (task: any) => {
  if (!isCompletedTaskStatus(task?.status)) return null;
  if (isWorkflowTask(task)) return getWorkflowCompletionDate(task);
  return getTaskDate(task.completedAt) || getTaskDate(task.updatedAt);
};

const getAssigneeName = (task: any, teamMembers: any[]) => {
  const assigneeId = task?.assignedTo || task?.assigneeId || task?.responsibleId;
  if (!assigneeId) return "Sin responsable";
  const member = teamMembers.find((item) =>
    item.id === assigneeId ||
    item.authUserId === assigneeId ||
    item.uid === assigneeId ||
    item.email === assigneeId
  );
  return member?.name || member?.displayName || task?.assigneeName || "Sin responsable";
};

export function TaskStatusReportModal({
  isOpen,
  onClose,
  tasks,
  taskGroups = [],
  teamMembers = [],
}: TaskStatusReportModalProps) {
  const [selectedRootIds, setSelectedRootIds] = React.useState<string[]>([]);
  const [selectedReportRootId, setSelectedReportRootId] = React.useState("");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [activeReportView, setActiveReportView] = React.useState<ReportView>("general");
  const [reportFilter, setReportFilter] = React.useState<ReportTaskFilter>("all");
  const [reportTimestamp, setReportTimestamp] = React.useState(0);

  const groupById = React.useMemo(
    () => {
      const map = new Map(taskGroups.map((group) => [group.id, group]));
      if (!map.has(DEFAULT_TASK_GROUP_ID)) {
        map.set(DEFAULT_TASK_GROUP_ID, { id: DEFAULT_TASK_GROUP_ID, name: DEFAULT_TASK_GROUP_NAME });
      }
      return map;
    },
    [taskGroups]
  );

  const rootTasks = React.useMemo(
    () =>
      tasks
        .filter((task) => !task.parentTaskId)
        .sort((left, right) => getTaskOrder(left) - getTaskOrder(right)),
    [tasks]
  );

  const childrenByParent = React.useMemo(() => {
    const map = new Map<string, any[]>();
    tasks.forEach((task) => {
      if (!task.parentTaskId) return;
      const current = map.get(task.parentTaskId) || [];
      current.push(task);
      map.set(task.parentTaskId, current);
    });

    map.forEach((children) => {
      children.sort((left, right) => getTaskOrder(left) - getTaskOrder(right));
    });

    return map;
  }, [tasks]);

  const collectTaskTree = React.useCallback(
    (rootId: string) => {
      const result: any[] = [];
      const pending = [rootId];
      const visited = new Set<string>();
      const tasksById = new Map(tasks.map((task) => [task.id, task]));

      while (pending.length > 0) {
        const currentId = pending.shift();
        if (!currentId || visited.has(currentId)) continue;

        const task = tasksById.get(currentId);
        if (!task) continue;

        visited.add(currentId);
        result.push(task);
        (childrenByParent.get(currentId) || []).forEach((child) => pending.push(child.id));
      }

      return result;
    },
    [childrenByParent, tasks]
  );

  React.useEffect(() => {
    if (!isOpen) return;
    setSelectedRootIds(rootTasks.map((task) => task.id));
    setSelectedReportRootId(rootTasks[0]?.id || "");
    setSearchTerm("");
    setActiveReportView("general");
    setReportFilter("all");
    setReportTimestamp(Date.now());
  }, [isOpen, rootTasks]);

  React.useEffect(() => {
    if (!isOpen || rootTasks.length === 0) return;
    if (selectedReportRootId && rootTasks.some((task) => task.id === selectedReportRootId)) return;
    setSelectedReportRootId(rootTasks[0].id);
  }, [isOpen, rootTasks, selectedReportRootId]);

  React.useEffect(() => {
    if (!isOpen) return;
    setReportFilter("all");
  }, [isOpen, selectedReportRootId]);

  if (!isOpen) return null;

  const visibleRootTasks = rootTasks.filter((task) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return true;
    const groupName = groupById.get(getTaskGroupId(task))?.name || "";
    return `${getTaskTitle(task)} ${task.description || ""} ${groupName}`.toLowerCase().includes(query);
  });

  const selectedRootTasks = rootTasks.filter((task) => selectedRootIds.includes(task.id));
  const scopedTasks = selectedRootTasks.flatMap((task) => collectTaskTree(task.id));
  const uniqueScopedTasks = Array.from(new Map(scopedTasks.map((task) => [task.id, task])).values());

  const statusCounts = uniqueScopedTasks.reduce(
    (acc, task) => {
      acc[getStatusBucket(task)] += 1;
      return acc;
    },
    { notStarted: 0, inProgress: 0, finished: 0 }
  );

  const scheduleCounts = uniqueScopedTasks.reduce(
    (acc, task) => {
      const state = getScheduleState(task);
      if (state === "overdue") acc.overdue += 1;
      if (state === "dueSoon") acc.dueSoon += 1;
      if (state === "ok" || state === "done") acc.ok += 1;
      if (state === "completedLate") acc.completedLate += 1;
      if (state === "noDate") acc.noDate += 1;
      return acc;
    },
    { overdue: 0, dueSoon: 0, ok: 0, completedLate: 0, noDate: 0 }
  );

  const priorityCounts = uniqueScopedTasks.reduce(
    (acc, task) => {
      const priority = task.priority || "medium";
      if (priority === "high") acc.high += 1;
      else if (priority === "low") acc.low += 1;
      else acc.medium += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 }
  );

  const attentionCount = uniqueScopedTasks.filter((task) =>
    ["stuck", "detenido", "devuelto", "reproceso"].includes(task.status || "")
  ).length;
  const highPriorityOpenCount = uniqueScopedTasks.filter(
    (task) => (task.priority || "medium") === "high" && !isCompletedTaskStatus(task.status)
  ).length;
  const totalTasks = uniqueScopedTasks.length;
  const completionRate = getPercent(statusCounts.finished, totalTasks);
  const averageProgress = getProgressAverage(uniqueScopedTasks);
  const workflowStepCount = uniqueScopedTasks.reduce(
    (sum, task) => sum + (Array.isArray(task.workflowSteps) ? task.workflowSteps.length : 0),
    0
  );

  const statusData = [
    { name: "No iniciadas", value: statusCounts.notStarted, color: STATUS_COLORS.notStarted },
    { name: "Iniciadas", value: statusCounts.inProgress, color: STATUS_COLORS.inProgress },
    { name: "Finalizadas", value: statusCounts.finished, color: STATUS_COLORS.finished },
  ];

  const scheduleData = [
    { name: "Atrasadas", value: scheduleCounts.overdue, color: STATUS_COLORS.overdue },
    { name: "Por vencer", value: scheduleCounts.dueSoon, color: STATUS_COLORS.dueSoon },
    { name: "En fecha", value: scheduleCounts.ok, color: STATUS_COLORS.ok },
    { name: "Con retraso", value: scheduleCounts.completedLate, color: "#ea580c" },
    { name: "Sin fecha", value: scheduleCounts.noDate, color: STATUS_COLORS.noDate },
  ].filter((item) => item.value > 0);

  const priorityData = [
    { name: "Alta", value: priorityCounts.high, color: STATUS_COLORS.high },
    { name: "Media", value: priorityCounts.medium, color: STATUS_COLORS.medium },
    { name: "Baja", value: priorityCounts.low, color: STATUS_COLORS.low },
  ];

  const breakdown = selectedRootTasks.map((rootTask) => {
    const scope = collectTaskTree(rootTask.id);
    const total = scope.length;
    const finished = scope.filter((task) => isCompletedTaskStatus(task.status)).length;
    const inProgress = scope.filter((task) => getStatusBucket(task) === "inProgress").length;
    const notStarted = scope.filter((task) => getStatusBucket(task) === "notStarted").length;
    const overdue = scope.filter((task) => getScheduleState(task) === "overdue").length;
    const dueSoon = scope.filter((task) => getScheduleState(task) === "dueSoon").length;

    return {
      id: rootTask.id,
      title: getTaskTitle(rootTask),
      groupName: groupById.get(getTaskGroupId(rootTask))?.name || DEFAULT_TASK_GROUP_NAME,
      total,
      notStarted,
      inProgress,
      finished,
      overdue,
      dueSoon,
      progress: getProgressAverage(scope),
      completion: getPercent(finished, total),
    };
  });

  const workflowGroups = selectedRootTasks
    .map((rootTask) => {
      const scope = collectTaskTree(rootTask.id);
      const childWorkflowTasks = scope.filter((task) => task.id !== rootTask.id && isWorkflowTask(task));
      const workflowTasks = childWorkflowTasks.length > 0 ? childWorkflowTasks : isWorkflowTask(rootTask) ? [rootTask] : [];

      return {
        rootTask,
        workflowTasks,
      };
    })
    .filter((group) => group.workflowTasks.length > 0);

  const workflowTasksForDetail = workflowGroups.flatMap((group) =>
    group.workflowTasks.map((task) => ({
      task,
      rootTask: group.rootTask,
    }))
  );
  const completedWorkflowTasks = workflowTasksForDetail.filter(({ task }) => isCompletedTaskStatus(task.status));
  const openWorkflowTasks = workflowTasksForDetail.filter(({ task }) => !isCompletedTaskStatus(task.status));
  const completedDurations = completedWorkflowTasks
    .map(({ task }) => {
      const startDate = getWorkflowStartDate(task);
      const completionDate = getWorkflowCompletionDate(task);
      if (!startDate || !completionDate) return 0;
      return Math.max(0, completionDate.getTime() - startDate.getTime());
    })
    .filter((duration) => duration > 0);
  const openAges = openWorkflowTasks
    .map(({ task }) => {
      const startDate = getWorkflowStartDate(task);
      if (!startDate || !reportTimestamp) return 0;
      return Math.max(0, reportTimestamp - startDate.getTime());
    })
    .filter((duration) => duration > 0);

  const currentStepMap = new Map<string, any>();
  openWorkflowTasks.forEach(({ task }) => {
    const stepIndex = getCurrentWorkflowStepIndex(task);
    const currentStep = task.workflowSteps?.[stepIndex] || {};
    const key = `${stepIndex}-${getWorkflowStepLabel(task, stepIndex)}`;
    const current = currentStepMap.get(key) || {
      key,
      index: stepIndex,
      name: `Paso ${stepIndex + 1}`,
      label: getWorkflowStepLabel(task, stepIndex),
      value: 0,
      active: 0,
      blocked: 0,
      pending: 0,
      overdue: 0,
      dueSoon: 0,
    };
    const statusBucket = getStepStatusBucket(currentStep);

    current.value += 1;
    if (statusBucket === "active") current.active += 1;
    if (statusBucket === "blocked") current.blocked += 1;
    if (statusBucket === "pending") current.pending += 1;
    if (getScheduleState(task) === "overdue") current.overdue += 1;
    if (getScheduleState(task) === "dueSoon") current.dueSoon += 1;
    currentStepMap.set(key, current);
  });
  const currentStepDistribution = Array.from(currentStepMap.values()).sort((left, right) => left.index - right.index);

  const workflowStepHealthMap = new Map<string, any>();
  workflowTasksForDetail.forEach(({ task }) => {
    (task.workflowSteps || []).forEach((step: any, index: number) => {
      const key = `${index}-${step.label || `Paso ${index + 1}`}`;
      const current = workflowStepHealthMap.get(key) || {
        key,
        index,
        name: `Paso ${index + 1}`,
        label: step.label || `Paso ${index + 1}`,
        total: 0,
        approved: 0,
        active: 0,
        blocked: 0,
        pending: 0,
      };
      const statusBucket = getStepStatusBucket(step);

      current.total += 1;
      if (statusBucket === "approved") current.approved += 1;
      if (statusBucket === "active") current.active += 1;
      if (statusBucket === "blocked") current.blocked += 1;
      if (statusBucket === "pending") current.pending += 1;
      workflowStepHealthMap.set(key, current);
    });
  });
  const workflowStepHealth = Array.from(workflowStepHealthMap.values())
    .map((row) => ({
      ...row,
      completion: getPercent(row.approved, row.total),
    }))
    .sort((left, right) => left.index - right.index);

  const workflowDetailBreakdown = workflowGroups.map(({ rootTask, workflowTasks }) => {
    const total = workflowTasks.length;
    const completed = workflowTasks.filter((task) => isCompletedTaskStatus(task.status)).length;
    const open = total - completed;
    const overdue = workflowTasks.filter((task) => getScheduleState(task) === "overdue").length;
    const dueSoon = workflowTasks.filter((task) => getScheduleState(task) === "dueSoon").length;
    const localCurrentStepMap = new Map<string, number>();
    workflowTasks
      .filter((task) => !isCompletedTaskStatus(task.status))
      .forEach((task) => {
        const index = getCurrentWorkflowStepIndex(task);
        const label = `Paso ${index + 1}`;
        localCurrentStepMap.set(label, (localCurrentStepMap.get(label) || 0) + 1);
      });
    const bottleneck = Array.from(localCurrentStepMap.entries()).sort((left, right) => right[1] - left[1])[0];
    const localDurations = workflowTasks
      .filter((task) => isCompletedTaskStatus(task.status))
      .map((task) => {
        const startDate = getWorkflowStartDate(task);
        const completionDate = getWorkflowCompletionDate(task);
        if (!startDate || !completionDate) return 0;
        return Math.max(0, completionDate.getTime() - startDate.getTime());
      })
      .filter((duration) => duration > 0);

    return {
      id: rootTask.id,
      title: getTaskTitle(rootTask),
      total,
      completed,
      open,
      overdue,
      dueSoon,
      completion: getPercent(completed, total),
      progress: getProgressAverage(workflowTasks),
      bottleneck: bottleneck ? `${bottleneck[0]} (${bottleneck[1]})` : "Sin bloqueos",
      averageDuration: formatDuration(average(localDurations)),
    };
  });

  const workflowTotal = workflowTasksForDetail.length;
  const workflowCompletionRate = getPercent(completedWorkflowTasks.length, workflowTotal);
  const workflowOverdueCount = workflowTasksForDetail.filter(({ task }) => getScheduleState(task) === "overdue").length;
  const workflowDueSoonCount = workflowTasksForDetail.filter(({ task }) => getScheduleState(task) === "dueSoon").length;
  const topCurrentStep = currentStepDistribution.length > 0
    ? [...currentStepDistribution].sort((left, right) => right.value - left.value)[0]
    : null;
  const workflowDetailKpis = [
    {
      label: "Workflows analizados",
      value: workflowTotal,
      detail: `${workflowGroups.length} tarea matriz`,
      icon: ListChecks,
      tone: "bg-indigo-50 text-indigo-700",
    },
    {
      label: "Finalizados",
      value: completedWorkflowTasks.length,
      detail: `${workflowCompletionRate}% completado`,
      icon: CheckCircle2,
      tone: "bg-emerald-50 text-emerald-700",
    },
    {
      label: "Abiertos",
      value: openWorkflowTasks.length,
      detail: topCurrentStep ? `Mayor carga: ${topCurrentStep.name}` : "Sin pasos activos",
      icon: Activity,
      tone: "bg-amber-50 text-amber-700",
    },
    {
      label: "Promedio finalizado",
      value: formatDuration(average(completedDurations)),
      detail: `${completedDurations.length} workflows con cierre`,
      icon: Clock3,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      label: "Edad promedio abiertos",
      value: formatDuration(average(openAges)),
      detail: `${openAges.length} workflows en curso`,
      icon: Target,
      tone: "bg-slate-100 text-slate-700",
    },
    {
      label: "Alertas workflow",
      value: workflowOverdueCount + workflowDueSoonCount,
      detail: `${workflowOverdueCount} vencidos · ${workflowDueSoonCount} por vencer`,
      icon: AlertTriangle,
      tone: "bg-red-50 text-red-700",
    },
  ];

  const selectedReportRootTask =
    rootTasks.find((task) => task.id === selectedReportRootId) ||
    selectedRootTasks[0] ||
    rootTasks[0] ||
    null;
  const reportTaskTree = selectedReportRootTask ? collectTaskTree(selectedReportRootTask.id) : [];
  const reportSubtasks = reportTaskTree.filter((task) => task.id !== selectedReportRootTask?.id);
  const finishedReportSubtasks = reportSubtasks
    .filter((task) => isCompletedTaskStatus(task.status))
    .sort((left, right) => {
      const rightCompletion = getTaskTimestamp(getTaskCompletionDate(right));
      const leftCompletion = getTaskTimestamp(getTaskCompletionDate(left));
      if (rightCompletion !== leftCompletion) return rightCompletion - leftCompletion;
      return getTaskOrder(left) - getTaskOrder(right);
    });
  const openReportSubtasks = reportSubtasks.filter((task) => !isCompletedTaskStatus(task.status));
  const overdueReportSubtasks = openReportSubtasks.filter((task) => getScheduleState(task) === "overdue");
  const dueSoonReportSubtasks = openReportSubtasks.filter((task) => getScheduleState(task) === "dueSoon");
  const filteredReportSubtasks = reportSubtasks.filter((task) => {
    if (reportFilter === "finished") return isCompletedTaskStatus(task.status);
    if (reportFilter === "open") return !isCompletedTaskStatus(task.status);
    if (reportFilter === "overdue") return getScheduleState(task) === "overdue";
    if (reportFilter === "dueSoon") return getScheduleState(task) === "dueSoon";
    return true;
  });
  const sortedFilteredReportSubtasks = filteredReportSubtasks
    .slice()
    .sort((left, right) => {
      if (reportFilter === "finished") {
        const rightCompletion = getTaskTimestamp(getTaskCompletionDate(right));
        const leftCompletion = getTaskTimestamp(getTaskCompletionDate(left));
        if (rightCompletion !== leftCompletion) return rightCompletion - leftCompletion;
      }

      const leftEnd = getTaskTimestamp(left.endDate || left.end) || Number.MAX_SAFE_INTEGER;
      const rightEnd = getTaskTimestamp(right.endDate || right.end) || Number.MAX_SAFE_INTEGER;
      if (leftEnd !== rightEnd) return leftEnd - rightEnd;
      return getTaskOrder(left) - getTaskOrder(right);
    });
  const reportCompletionRate = getPercent(finishedReportSubtasks.length, reportSubtasks.length);
  const reportAverageProgress = getProgressAverage(reportSubtasks);
  const reportGroupName = selectedReportRootTask
    ? groupById.get(getTaskGroupId(selectedReportRootTask))?.name || DEFAULT_TASK_GROUP_NAME
    : DEFAULT_TASK_GROUP_NAME;
  const reportKpis: {
    label: string;
    value: string | number;
    detail: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
    filter: ReportTaskFilter;
  }[] = [
    {
      label: "Todas",
      value: reportSubtasks.length,
      detail: `${reportTaskTree.length} registros en el árbol`,
      icon: ListChecks,
      tone: "bg-indigo-50 text-indigo-700",
      filter: "all",
    },
    {
      label: "Finalizadas",
      value: finishedReportSubtasks.length,
      detail: `${reportCompletionRate}% del alcance`,
      icon: CheckCircle2,
      tone: "bg-emerald-50 text-emerald-700",
      filter: "finished",
    },
    {
      label: "Abiertas",
      value: openReportSubtasks.length,
      detail: `${overdueReportSubtasks.length} vencidas · ${dueSoonReportSubtasks.length} por vencer`,
      icon: AlertTriangle,
      tone: overdueReportSubtasks.length > 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700",
      filter: "open",
    },
    {
      label: "Atrasadas",
      value: overdueReportSubtasks.length,
      detail: "Requieren gestión inmediata",
      icon: Clock3,
      tone: "bg-red-50 text-red-700",
      filter: "overdue",
    },
    {
      label: "Por vencer",
      value: dueSoonReportSubtasks.length,
      detail: "Cierre próximo",
      icon: Target,
      tone: "bg-orange-50 text-orange-700",
      filter: "dueSoon",
    },
  ];

  const downloadTaskReport = () => {
    if (!selectedReportRootTask || sortedFilteredReportSubtasks.length === 0) return;

    const headers = [
      "Tarea matriz",
      "Grupo",
      "Filtro",
      "Subtarea",
      "Tipo",
      "Responsable",
      "Estado",
      "Paso actual",
      "Prioridad",
      "Cronograma inicio",
      "Cronograma fin",
      "Estado cronograma",
      "Fecha cierre",
      "Duracion",
      "Avance",
    ];

    const rows = sortedFilteredReportSubtasks.map((task) => {
      const startDate = getWorkflowStartDate(task) || getTaskDate(task.startDate || task.start || task.createdAt);
      const completionDate = getTaskCompletionDate(task);
      const referenceDate = completionDate || (reportTimestamp ? new Date(reportTimestamp) : null);
      const duration = startDate && referenceDate
        ? formatDuration(Math.max(0, referenceDate.getTime() - startDate.getTime()))
        : "Sin datos";

      return [
        getTaskTitle(selectedReportRootTask),
        reportGroupName,
        REPORT_FILTER_LABELS[reportFilter],
        getTaskTitle(task),
        isWorkflowTaskType(task.type) ? getWorkflowTaskTypeLabel(task.type) : "Tarea",
        getAssigneeName(task, teamMembers),
        getTaskStatusLabel(task.status),
        getCurrentWorkflowStepSummary(task),
        getPriorityLabel(task.priority),
        formatReportDate(task.startDate || task.start),
        formatReportDate(task.endDate || task.end),
        getScheduleStateLabel(getScheduleState(task)),
        formatReportDate(completionDate),
        duration,
        `${Number(task.progress || 0)}%`,
      ];
    });

    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsvCell).join(";"))
      .join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `${sanitizeFilename(getTaskTitle(selectedReportRootTask))}-${sanitizeFilename(REPORT_FILTER_LABELS[reportFilter])}-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const toggleRootTask = (taskId: string) => {
    setSelectedRootIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId]
    );
  };

  const allVisibleSelected =
    visibleRootTasks.length > 0 && visibleRootTasks.every((task) => selectedRootIds.includes(task.id));

  const toggleVisibleTasks = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(visibleRootTasks.map((task) => task.id));
      setSelectedRootIds((current) => current.filter((id) => !visibleIds.has(id)));
      return;
    }

    setSelectedRootIds((current) => Array.from(new Set([...current, ...visibleRootTasks.map((task) => task.id)])));
  };

  const kpis = [
    {
      label: "Tareas analizadas",
      value: totalTasks,
      detail: `${selectedRootTasks.length} matriz`,
      icon: ListChecks,
      tone: "bg-indigo-50 text-indigo-700",
    },
    {
      label: "Finalización",
      value: `${completionRate}%`,
      detail: `${statusCounts.finished} finalizadas`,
      icon: CheckCircle2,
      tone: "bg-emerald-50 text-emerald-700",
    },
    {
      label: "Avance promedio",
      value: `${averageProgress}%`,
      detail: `${workflowStepCount} pasos de workflow`,
      icon: Activity,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      label: "No iniciadas",
      value: statusCounts.notStarted,
      detail: `${getPercent(statusCounts.notStarted, totalTasks)}% del alcance`,
      icon: Clock3,
      tone: "bg-slate-100 text-slate-700",
    },
    {
      label: "Alta prioridad abiertas",
      value: highPriorityOpenCount,
      detail: `${priorityCounts.high} alta prioridad`,
      icon: Target,
      tone: "bg-red-50 text-red-700",
    },
    {
      label: "Alertas",
      value: scheduleCounts.overdue + scheduleCounts.dueSoon + attentionCount,
      detail: `${scheduleCounts.overdue} vencidas · ${attentionCount} atención`,
      icon: AlertTriangle,
      tone: "bg-orange-50 text-orange-700",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="flex h-[94vh] w-[min(98vw,1900px)] max-w-none flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-indigo-600" />
              <h2 className="truncate text-xl font-black text-slate-900">Indicadores de tareas</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Estado, avance y vencimientos del alcance seleccionado.
            </p>
            <div className="mt-3 inline-flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setActiveReportView("general")}
                className={`rounded-lg px-3 py-1.5 text-xs font-black transition-colors ${
                  activeReportView === "general"
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Vista general
              </button>
              <button
                type="button"
                onClick={() => setActiveReportView("subtasks")}
                className={`rounded-lg px-3 py-1.5 text-xs font-black transition-colors ${
                  activeReportView === "subtasks"
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Detalle subtareas
              </button>
              <button
                type="button"
                onClick={() => setActiveReportView("task-report")}
                className={`rounded-lg px-3 py-1.5 text-xs font-black transition-colors ${
                  activeReportView === "task-report"
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Reporte por tarea
              </button>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar reporte">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-slate-100 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-black text-slate-900">Tareas matriz</p>
                <p className="text-xs text-slate-500">{selectedRootIds.length} seleccionadas</p>
              </div>
              <button
                type="button"
                onClick={toggleVisibleTasks}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-700"
              >
                {allVisibleSelected ? "Quitar visibles" : "Marcar visibles"}
              </button>
            </div>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar tarea..."
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
              {visibleRootTasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white p-5 text-center text-sm font-semibold text-slate-500">
                  No hay tareas para mostrar.
                </div>
              ) : (
                visibleRootTasks.map((task) => {
                  const selected = selectedRootIds.includes(task.id);
                  const childCount = collectTaskTree(task.id).length - 1;
                  const group = groupById.get(getTaskGroupId(task));

                  return (
                    <label
                      key={task.id}
                      className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${
                        selected
                          ? "border-indigo-200 bg-white shadow-sm"
                          : "border-slate-200 bg-white/70 hover:bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleRootTask(task.id)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-800">{getTaskTitle(task)}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {group && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{group.name}</span>
                          )}
                          <span>{childCount} dependientes</span>
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto bg-slate-50 p-4">
            {totalTasks === 0 ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
                <BarChart3 className="mb-3 h-10 w-10 text-slate-300" />
                <p className="text-base font-bold text-slate-700">Selecciona al menos una tarea matriz.</p>
              </div>
            ) : activeReportView === "general" ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {kpis.map((kpi) => {
                    const Icon = kpi.icon;

                    return (
                      <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{kpi.label}</p>
                            <p className="mt-2 text-2xl font-black text-slate-900">{kpi.value}</p>
                            <p className="mt-1 text-xs font-medium text-slate-500">{kpi.detail}</p>
                          </div>
                          <span className={`rounded-xl p-2 ${kpi.tone}`}>
                            <Icon className="h-5 w-5" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid gap-4 xl:grid-cols-[1fr_0.95fr]">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-black text-slate-900">Estados principales</h3>
                      <span className="text-xs font-bold text-slate-400">{totalTasks} tareas</span>
                    </div>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={statusData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                          <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                          <Tooltip cursor={{ fill: "#f8fafc" }} />
                          <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                            {statusData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-black text-slate-900">Cronograma</h3>
                      <span className="text-xs font-bold text-slate-400">vencimientos</span>
                    </div>
                    <div className="h-64">
                      {scheduleData.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-400">
                          Sin datos de cronograma.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={scheduleData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3}>
                              {scheduleData.map((entry) => (
                                <Cell key={entry.name} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip />
                            <Legend verticalAlign="bottom" height={34} iconType="circle" />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-sm font-black text-slate-900">Prioridad</h3>
                    <div className="space-y-3">
                      {priorityData.map((item) => (
                        <div key={item.name}>
                          <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600">
                            <span>{item.name}</span>
                            <span>{item.value}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${getPercent(item.value, totalTasks)}%`,
                                backgroundColor: item.color,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-sm font-black text-slate-900">Desglose por tarea matriz</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[680px] text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
                            <th className="py-2 pr-3">Tarea</th>
                            <th className="px-3 py-2 text-right">Total</th>
                            <th className="px-3 py-2 text-right">No iniciadas</th>
                            <th className="px-3 py-2 text-right">Iniciadas</th>
                            <th className="px-3 py-2 text-right">Finalizadas</th>
                            <th className="px-3 py-2 text-right">Alertas</th>
                            <th className="px-3 py-2 text-right">Avance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdown.map((row) => (
                            <tr key={row.id} className="border-b border-slate-50 last:border-0">
                              <td className="max-w-[260px] py-2 pr-3">
                                <p className="truncate font-bold text-slate-800">{row.title}</p>
                                <p className="truncate text-[10px] font-medium text-slate-400">{row.groupName}</p>
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-slate-700">{row.total}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{row.notStarted}</td>
                              <td className="px-3 py-2 text-right text-amber-600">{row.inProgress}</td>
                              <td className="px-3 py-2 text-right text-emerald-600">{row.finished}</td>
                              <td className="px-3 py-2 text-right text-red-600">{row.overdue + row.dueSoon}</td>
                              <td className="px-3 py-2 text-right">
                                <span className="font-black text-slate-800">{row.progress}%</span>
                                <span className="ml-1 text-slate-400">({row.completion}% fin.)</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            ) : activeReportView === "subtasks" ? (
              <div className="space-y-4">
                {workflowTotal === 0 ? (
                  <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
                    <Activity className="mb-3 h-10 w-10 text-slate-300" />
                    <p className="text-base font-bold text-slate-700">No hay workflows con subtareas en la selección.</p>
                    <p className="mt-1 max-w-md text-sm text-slate-500">
                      Selecciona una tarea matriz que tenga iteraciones de workflow para ver la estadística interna por paso.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {workflowDetailKpis.map((kpi) => {
                        const Icon = kpi.icon;

                        return (
                          <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{kpi.label}</p>
                                <p className="mt-2 text-2xl font-black text-slate-900">{kpi.value}</p>
                                <p className="mt-1 text-xs font-medium text-slate-500">{kpi.detail}</p>
                              </div>
                              <span className={`rounded-xl p-2 ${kpi.tone}`}>
                                <Icon className="h-5 w-5" />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-black text-slate-900">No finalizadas por paso actual</h3>
                            <p className="text-xs text-slate-500">Dónde está represado el flujo seleccionado.</p>
                          </div>
                          <span className="text-xs font-bold text-slate-400">{openWorkflowTasks.length} abiertas</span>
                        </div>
                        <div className="h-64">
                          {currentStepDistribution.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-400">
                              No hay workflows abiertos.
                            </div>
                          ) : (
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={currentStepDistribution}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                                <Tooltip
                                  cursor={{ fill: "#f8fafc" }}
                                  formatter={(value, name) => [value, name === "value" ? "Workflows" : name]}
                                  labelFormatter={(_, payload) => payload?.[0]?.payload?.label || "Paso"}
                                />
                                <Bar dataKey="value" fill="#5559df" radius={[8, 8, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-black text-slate-900">Salud de pasos internos</h3>
                            <p className="text-xs text-slate-500">Estado acumulado de cada paso del workflow.</p>
                          </div>
                          <span className="text-xs font-bold text-slate-400">{workflowStepHealth.length} pasos</span>
                        </div>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={workflowStepHealth}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                              <Tooltip
                                cursor={{ fill: "#f8fafc" }}
                                labelFormatter={(_, payload) => payload?.[0]?.payload?.label || "Paso"}
                              />
                              <Legend verticalAlign="bottom" height={34} iconType="circle" />
                              <Bar dataKey="approved" name="Listo" stackId="steps" fill="#10b981" radius={[6, 6, 0, 0]} />
                              <Bar dataKey="active" name="En curso" stackId="steps" fill="#f59e0b" />
                              <Bar dataKey="blocked" name="Bloqueado" stackId="steps" fill="#dc2626" />
                              <Bar dataKey="pending" name="Pendiente" stackId="steps" fill="#cbd5e1" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <h3 className="mb-3 text-sm font-black text-slate-900">Carga por paso activo</h3>
                        <div className="space-y-3">
                          {currentStepDistribution.length === 0 ? (
                            <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                              Todos los workflows seleccionados están finalizados.
                            </p>
                          ) : (
                            currentStepDistribution.map((row) => (
                              <div key={row.key} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-black text-slate-800">
                                      {row.name}: {row.label}
                                    </p>
                                    <p className="mt-1 text-xs font-medium text-slate-500">
                                      {row.active} en curso · {row.blocked} bloqueadas · {row.pending} pendientes
                                    </p>
                                  </div>
                                  <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-black text-indigo-700">
                                    {row.value}
                                  </span>
                                </div>
                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                                  <div
                                    className="h-full rounded-full bg-indigo-500"
                                    style={{ width: `${getPercent(row.value, openWorkflowTasks.length)}%` }}
                                  />
                                </div>
                                {(row.overdue > 0 || row.dueSoon > 0) && (
                                  <p className="mt-2 text-[11px] font-bold text-orange-600">
                                    {row.overdue} vencidas · {row.dueSoon} por vencer
                                  </p>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <h3 className="mb-3 text-sm font-black text-slate-900">Detalle por tarea matriz</h3>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[760px] text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
                                <th className="py-2 pr-3">Workflow matriz</th>
                                <th className="px-3 py-2 text-right">Total</th>
                                <th className="px-3 py-2 text-right">Finalizados</th>
                                <th className="px-3 py-2 text-right">Abiertos</th>
                                <th className="px-3 py-2 text-right">Mayor carga</th>
                                <th className="px-3 py-2 text-right">Tiempo prom.</th>
                                <th className="px-3 py-2 text-right">Avance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {workflowDetailBreakdown.map((row) => (
                                <tr key={row.id} className="border-b border-slate-50 last:border-0">
                                  <td className="max-w-[260px] py-2 pr-3">
                                    <p className="truncate font-bold text-slate-800">{row.title}</p>
                                    <p className="truncate text-[10px] font-medium text-slate-400">
                                      {row.overdue} vencidos · {row.dueSoon} por vencer
                                    </p>
                                  </td>
                                  <td className="px-3 py-2 text-right font-bold text-slate-700">{row.total}</td>
                                  <td className="px-3 py-2 text-right text-emerald-600">{row.completed}</td>
                                  <td className="px-3 py-2 text-right text-amber-600">{row.open}</td>
                                  <td className="px-3 py-2 text-right text-slate-600">{row.bottleneck}</td>
                                  <td className="px-3 py-2 text-right text-slate-600">{row.averageDuration}</td>
                                  <td className="px-3 py-2 text-right">
                                    <span className="font-black text-slate-800">{row.progress}%</span>
                                    <span className="ml-1 text-slate-400">({row.completion}% fin.)</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <h3 className="mb-3 text-sm font-black text-slate-900">Matriz de pasos internos</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
                              <th className="py-2 pr-3">Paso</th>
                              <th className="px-3 py-2 text-right">Instancias</th>
                              <th className="px-3 py-2 text-right">Listo</th>
                              <th className="px-3 py-2 text-right">En curso</th>
                              <th className="px-3 py-2 text-right">Bloqueado</th>
                              <th className="px-3 py-2 text-right">Pendiente</th>
                              <th className="px-3 py-2 text-right">% listo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {workflowStepHealth.map((row) => (
                              <tr key={row.key} className="border-b border-slate-50 last:border-0">
                                <td className="max-w-[320px] py-2 pr-3">
                                  <p className="truncate font-bold text-slate-800">
                                    {row.name}: {row.label}
                                  </p>
                                </td>
                                <td className="px-3 py-2 text-right font-bold text-slate-700">{row.total}</td>
                                <td className="px-3 py-2 text-right text-emerald-600">{row.approved}</td>
                                <td className="px-3 py-2 text-right text-amber-600">{row.active}</td>
                                <td className="px-3 py-2 text-right text-red-600">{row.blocked}</td>
                                <td className="px-3 py-2 text-right text-slate-500">{row.pending}</td>
                                <td className="px-3 py-2 text-right">
                                  <span className="font-black text-slate-800">{row.completion}%</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px_auto] 2xl:items-end">
                    <div className="min-w-0">
                      <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-indigo-700">
                        <ClipboardList className="h-4 w-4" />
                        Reporte anclado a indicadores
                      </div>
                      <h3 className="truncate text-2xl font-black text-slate-950">
                        {selectedReportRootTask ? getTaskTitle(selectedReportRootTask) : "Selecciona una tarea"}
                      </h3>
                      <p className="mt-1 text-sm font-medium text-slate-500">
                        {reportGroupName} · {getTaskStatusLabel(selectedReportRootTask?.status)} · {reportSubtasks.length} subtareas dependientes
                      </p>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                        Tarea para reportar
                      </span>
                      <select
                        value={selectedReportRootTask?.id || selectedReportRootId}
                        onChange={(event) => setSelectedReportRootId(event.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      >
                        {rootTasks.map((task) => (
                          <option key={task.id} value={task.id}>
                            {getTaskTitle(task)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      type="button"
                      onClick={downloadTaskReport}
                      disabled={!selectedReportRootTask || sortedFilteredReportSubtasks.length === 0}
                      className="h-11 gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Download className="h-4 w-4" />
                      Descargar CSV
                    </Button>
                  </div>
                </div>

                {!selectedReportRootTask ? (
                  <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
                    <ClipboardList className="mb-3 h-10 w-10 text-slate-300" />
                    <p className="text-base font-bold text-slate-700">No hay tareas disponibles para reportar.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                      {reportKpis.map((kpi) => {
                        const Icon = kpi.icon;
                        const active = reportFilter === kpi.filter;

                        return (
                          <button
                            key={kpi.label}
                            type="button"
                            onClick={() => setReportFilter(kpi.filter)}
                            className={`rounded-xl border p-4 text-left shadow-sm transition-all ${
                              active
                                ? "border-indigo-300 bg-indigo-50 ring-2 ring-indigo-500/10"
                                : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{kpi.label}</p>
                                <p className="mt-2 text-2xl font-black text-slate-900">{kpi.value}</p>
                                <p className="mt-1 text-xs font-medium text-slate-500">{kpi.detail}</p>
                              </div>
                              <span className={`rounded-xl p-2 ${kpi.tone}`}>
                                <Icon className="h-5 w-5" />
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid gap-4 2xl:grid-cols-[minmax(820px,1fr)_360px]">
                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-black text-slate-900">Subtareas del reporte</h3>
                            <p className="text-xs text-slate-500">
                              Filtro activo: {REPORT_FILTER_LABELS[reportFilter].toLowerCase()}.
                            </p>
                          </div>
                          <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">
                            {sortedFilteredReportSubtasks.length} visibles
                          </span>
                        </div>

                        {sortedFilteredReportSubtasks.length === 0 ? (
                          <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center text-sm font-semibold text-slate-500">
                            No hay subtareas para el filtro seleccionado.
                          </div>
                        ) : (
                          <div className="max-h-[56vh] overflow-auto rounded-xl border border-slate-100">
                            <table className="w-full min-w-[1240px] text-left text-xs">
                              <thead className="sticky top-0 z-10 bg-white">
                                <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
                                  <th className="py-2 pr-3">Subtarea</th>
                                  <th className="px-3 py-2">Responsable</th>
                                  <th className="px-3 py-2">Estado</th>
                                  <th className="px-3 py-2">Paso actual</th>
                                  <th className="px-3 py-2">Condición</th>
                                  <th className="px-3 py-2">Cronograma</th>
                                  <th className="px-3 py-2">Cierre / edad</th>
                                  <th className="px-3 py-2 text-right">Avance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sortedFilteredReportSubtasks.map((task) => {
                                  const startDate = getWorkflowStartDate(task) || getTaskDate(task.startDate || task.start || task.createdAt);
                                  const completionDate = getTaskCompletionDate(task);
                                  const referenceDate = completionDate || (reportTimestamp ? new Date(reportTimestamp) : null);
                                  const duration = startDate && referenceDate
                                    ? formatDuration(Math.max(0, referenceDate.getTime() - startDate.getTime()))
                                    : "Sin datos";
                                  const scheduleState = getScheduleState(task);
                                  const scheduleClass =
                                    scheduleState === "overdue"
                                      ? "bg-red-50 text-red-700"
                                      : scheduleState === "dueSoon"
                                      ? "bg-orange-50 text-orange-700"
                                      : scheduleState === "completedLate"
                                      ? "bg-orange-50 text-orange-700"
                                      : scheduleState === "done"
                                      ? "bg-emerald-50 text-emerald-700"
                                      : "bg-slate-100 text-slate-600";
                                  const statusClass = isCompletedTaskStatus(task.status)
                                    ? task.status === "completed_late"
                                      ? "bg-orange-50 text-orange-700"
                                      : "bg-emerald-50 text-emerald-700"
                                    : task.status === "stuck" || task.status === "detenido"
                                    ? "bg-red-50 text-red-700"
                                    : task.status === "in_progress" || task.status === "en_curso"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-slate-100 text-slate-600";

                                  return (
                                    <tr key={task.id} className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/40">
                                      <td className="max-w-[260px] py-2 pr-3">
                                        <p className="truncate font-bold text-slate-800">{getTaskTitle(task)}</p>
                                        <p className="truncate text-[10px] font-medium text-slate-400">
                                          {isWorkflowTaskType(task.type) ? getWorkflowTaskTypeLabel(task.type) : "Tarea"} · {getPriorityLabel(task.priority)}
                                        </p>
                                      </td>
                                      <td className="px-3 py-2 font-semibold text-slate-600">
                                        {getAssigneeName(task, teamMembers)}
                                      </td>
                                      <td className="px-3 py-2">
                                        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${statusClass}`}>
                                          {getTaskStatusLabel(task.status)}
                                        </span>
                                      </td>
                                      <td className="max-w-[220px] px-3 py-2">
                                        <p className="truncate font-bold text-slate-700" title={getCurrentWorkflowStepSummary(task)}>
                                          {getCurrentWorkflowStepSummary(task)}
                                        </p>
                                      </td>
                                      <td className="px-3 py-2">
                                        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${scheduleClass}`}>
                                          {getScheduleStateLabel(scheduleState)}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-slate-500">
                                        {formatReportDate(task.startDate || task.start)} - {formatReportDate(task.endDate || task.end)}
                                      </td>
                                      <td className="px-3 py-2 text-slate-500">
                                        {completionDate ? formatReportDate(completionDate) : "Pendiente"}
                                        <span className="ml-1 text-slate-400">({duration})</span>
                                      </td>
                                      <td className="px-3 py-2 text-right font-black text-slate-800">
                                        {Number(task.progress || 0)}%
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <h3 className="text-sm font-black text-slate-900">Lectura ejecutiva</h3>
                          <div className="mt-4 space-y-3">
                            <div>
                              <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600">
                                <span>Finalización de subtareas</span>
                                <span>{reportCompletionRate}%</span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full bg-emerald-500"
                                  style={{ width: `${reportCompletionRate}%` }}
                                />
                              </div>
                            </div>
                            <div>
                              <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600">
                                <span>Avance promedio</span>
                                <span>{reportAverageProgress}%</span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full bg-indigo-500"
                                  style={{ width: `${reportAverageProgress}%` }}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                            <button
                              type="button"
                              onClick={() => setReportFilter("overdue")}
                              className={`rounded-lg p-3 transition ${
                                reportFilter === "overdue" ? "bg-red-100 ring-2 ring-red-500/20" : "bg-red-50 hover:bg-red-100"
                              }`}
                            >
                              <p className="text-lg font-black text-red-700">{overdueReportSubtasks.length}</p>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-red-500">Atrasadas</p>
                            </button>
                            <button
                              type="button"
                              onClick={() => setReportFilter("dueSoon")}
                              className={`rounded-lg p-3 transition ${
                                reportFilter === "dueSoon" ? "bg-orange-100 ring-2 ring-orange-500/20" : "bg-orange-50 hover:bg-orange-100"
                              }`}
                            >
                              <p className="text-lg font-black text-orange-700">{dueSoonReportSubtasks.length}</p>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-orange-500">Por vencer</p>
                            </button>
                            <button
                              type="button"
                              onClick={() => setReportFilter("open")}
                              className={`rounded-lg p-3 transition ${
                                reportFilter === "open" ? "bg-slate-200 ring-2 ring-slate-500/15" : "bg-slate-100 hover:bg-slate-200"
                              }`}
                            >
                              <p className="text-lg font-black text-slate-700">{openReportSubtasks.length}</p>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Abiertas</p>
                            </button>
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-sm font-black text-slate-900">Subtareas abiertas</h3>
                            <span className="text-xs font-bold text-slate-400">{openReportSubtasks.length}</span>
                          </div>
                          <div className="max-h-[305px] space-y-2 overflow-y-auto pr-1">
                            {openReportSubtasks.length === 0 ? (
                              <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                                Todo el árbol de subtareas está finalizado.
                              </p>
                            ) : (
                              openReportSubtasks
                                .slice()
                                .sort((left, right) => getTaskTimestamp(left.endDate || left.end) - getTaskTimestamp(right.endDate || right.end))
                                .map((task) => {
                                  const scheduleState = getScheduleState(task);
                                  const scheduleClass =
                                    scheduleState === "overdue"
                                      ? "bg-red-50 text-red-700"
                                      : scheduleState === "dueSoon"
                                      ? "bg-orange-50 text-orange-700"
                                      : "bg-slate-100 text-slate-600";

                                  return (
                                    <div key={task.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <p className="truncate text-sm font-black text-slate-800">{getTaskTitle(task)}</p>
                                          <p className="mt-1 text-xs font-medium text-slate-500">
                                            {getAssigneeName(task, teamMembers)} · vence {formatReportDate(task.endDate || task.end)}
                                          </p>
                                        </div>
                                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${scheduleClass}`}>
                                          {getScheduleStateLabel(scheduleState)}
                                        </span>
                                      </div>
                                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
                                        <div
                                          className="h-full rounded-full bg-indigo-500"
                                          style={{ width: `${Math.min(Number(task.progress || 0), 100)}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
