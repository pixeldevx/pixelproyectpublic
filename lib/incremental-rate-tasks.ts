import { collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from "@/lib/supabase/document-store";
import { db } from "@/lib/backend";
import { getCompletionStatusForTask, getTaskDateValue, isCompletedTaskStatus } from "@/lib/taskProgress";
import { normalizeDecimalInput } from "@/lib/rate-card-config";
import { updateParentTaskStatus } from "@/lib/taskUtils";

export type IncrementalRateBinding = {
  enabled?: boolean;
  rateCardId?: string | null;
  assigneeMode?: "any" | "fixed";
  assignedTo?: string | null;
  dateMode?: "any" | "range";
  startDate?: any;
  endDate?: any;
  activatedAt?: any;
};

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const endOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();

const getEntryDate = (entry: any) => {
  if (entry?.dateKey && typeof entry.dateKey === "string") {
    const date = getTaskDateValue(entry.dateKey);
    if (date) return date;
  }

  return (
    getTaskDateValue(entry?.createdAt) ||
    getTaskDateValue(entry?.timestamp) ||
    getTaskDateValue(entry?.date) ||
    null
  );
};

export const getIncrementalRateBinding = (task: any): IncrementalRateBinding | null => {
  const binding = task?.incrementalRateBinding || task?.rateDrivenIncrement || null;
  if (!binding?.enabled || !binding?.rateCardId) return null;

  return {
    enabled: true,
    rateCardId: binding.rateCardId,
    assigneeMode: binding.assigneeMode === "fixed" ? "fixed" : "any",
    assignedTo: binding.assignedTo || null,
    dateMode: binding.dateMode === "range" ? "range" : "any",
    startDate: binding.startDate || null,
    endDate: binding.endDate || null,
    activatedAt: binding.activatedAt || null,
  };
};

export const isRateDrivenIncrementalTask = (task: any) =>
  task?.type === "quantitative" && Boolean(getIncrementalRateBinding(task));

export const rateEntryMatchesIncrementalBinding = (
  entry: any,
  binding: IncrementalRateBinding,
) => {
  if (!binding.rateCardId || entry?.rateCardId !== binding.rateCardId) return false;

  if (binding.assigneeMode === "fixed" && binding.assignedTo) {
    if (entry?.assignedTo !== binding.assignedTo) return false;
  }

  if (binding.activatedAt) {
    const entryDate = getEntryDate(entry);
    const activatedAt = getTaskDateValue(binding.activatedAt);
    if (!entryDate || (activatedAt && entryDate.getTime() < activatedAt.getTime())) return false;
  }

  if (binding.dateMode === "range") {
    const entryDate = getEntryDate(entry);
    if (!entryDate) return false;

    const entryTime = entryDate.getTime();
    const startDate = getTaskDateValue(binding.startDate);
    const endDate = getTaskDateValue(binding.endDate);

    if (startDate && entryTime < startOfDay(startDate)) return false;
    if (endDate && entryTime > endOfDay(endDate)) return false;
  }

  return true;
};

export const calculateRateDrivenIncrementValue = (
  entries: any[],
  task: any,
) => {
  const binding = getIncrementalRateBinding(task);
  if (!binding) return Number(task?.currentValue || 0);

  return entries.reduce((total, entry) => {
    if (!rateEntryMatchesIncrementalBinding(entry, binding)) return total;
    return total + normalizeDecimalInput(entry?.units, 0);
  }, 0);
};

const getRateDrivenStatus = (task: any, currentValue: number, targetValue: number) => {
  if (targetValue > 0 && currentValue >= targetValue) {
    if (task?.requiresDocument && !task?.linkedDocumentId) return "in_progress";
    return getCompletionStatusForTask("completed", task);
  }

  if (isCompletedTaskStatus(task?.status)) return currentValue > 0 ? "in_progress" : "todo";
  if (task?.status === "stuck") return "stuck";
  return currentValue > 0 ? "in_progress" : "todo";
};

export const syncRateDrivenIncrementalTasksForRate = async ({
  projectId,
  rateCardId,
  tasks,
}: {
  projectId: string;
  rateCardId: string;
  tasks?: any[];
}) => {
  if (!projectId || !rateCardId) return { updated: 0 };

  const availableTasks =
    tasks ||
    (await getDocs(collection(db, "projects", projectId, "tasks"))).docs.map((taskDoc: any) => ({
      id: taskDoc.id,
      ...taskDoc.data(),
    }));

  const impactedTasks = availableTasks.filter((task) => {
    const delegatesIncrementToSubtasks =
      task?.type === "quantitative" &&
      (task?.incrementDelegatedToSubtasks || task?.isParentTask || Number(task?.totalSubtasks || 0) > 0);
    if (delegatesIncrementToSubtasks) return false;

    const binding = getIncrementalRateBinding(task);
    return Boolean(binding?.rateCardId === rateCardId);
  });

  if (impactedTasks.length === 0) return { updated: 0 };

  const entriesSnapshot = await getDocs(
    query(
      collection(db, "projects", projectId, "rateCardEntries"),
      where("rateCardId", "==", rateCardId),
    ),
  );
  const entries = entriesSnapshot.docs.map((entryDoc: any) => ({
    id: entryDoc.id,
    ...entryDoc.data(),
  }));

  let updated = 0;
  const parentTaskIdsToRefresh = new Set<string>();

  for (const task of impactedTasks) {
    const targetValue = Math.max(0, Number(task.indicatorValue || 0));
    const rawValue = calculateRateDrivenIncrementValue(entries, task);
    const currentValue =
      targetValue > 0
        ? Math.min(Math.max(rawValue, 0), targetValue)
        : Math.max(rawValue, 0);
    const progress =
      targetValue > 0 ? Math.min(100, Math.round((currentValue / targetValue) * 100)) : 0;
    const status = getRateDrivenStatus(task, currentValue, targetValue);
    const previousValue = Number(task.currentValue || 0);
    const previousProgress = Number(task.progress || 0);
    const shouldUpdate =
      Math.abs(previousValue - currentValue) > 0.000001 ||
      previousProgress !== progress ||
      (task.status || "todo") !== status;

    if (!shouldUpdate) continue;

    await updateDoc(doc(db, "projects", projectId, "tasks", task.id), {
      currentValue,
      progress,
      status,
      rateDrivenLastTotal: rawValue,
      rateDrivenLastSyncAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (task.parentTaskId) parentTaskIdsToRefresh.add(task.parentTaskId);
    updated += 1;
  }

  await Promise.all(Array.from(parentTaskIdsToRefresh).map((parentTaskId) => updateParentTaskStatus(projectId, parentTaskId)));

  return { updated };
};
