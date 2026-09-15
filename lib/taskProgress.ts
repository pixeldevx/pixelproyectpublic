export const isCompletedTaskStatus = (status?: string | null) =>
  status === "completed" || status === "completed_late" || status === "listo";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const getTaskDateValue = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value === "string") {
    const dateOnlyMatch = value.match(DATE_ONLY_PATTERN);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const startOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export const endOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();

export const addLocalDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const getRemainingScheduleDays = (dueDateValue: any, pausedAt: Date = new Date()) => {
  const dueDate = getTaskDateValue(dueDateValue);
  if (!dueDate) return null;

  const remainingMs = endOfLocalDay(dueDate) - startOfLocalDay(pausedAt);
  return Math.max(0, Math.ceil(remainingMs / DAY_MS));
};

export const getResumedDueDate = (remainingDays: any, resumedAt: Date = new Date()) => {
  const days = Math.max(0, Number(remainingDays) || 0);
  if (days <= 0) return addLocalDays(resumedAt, 0);
  return addLocalDays(resumedAt, days - 1);
};

export const isCompletionAfterDueDate = (dueDateValue: any, completedAt: Date = new Date()) => {
  const dueDate = getTaskDateValue(dueDateValue);
  if (!dueDate) return false;
  return startOfLocalDay(completedAt) > startOfLocalDay(dueDate);
};

export const getCompletionStatusForSchedule = (
  nextStatus: string,
  dueDateValue: any,
  completedAt: Date = new Date(),
) => {
  if (nextStatus !== "completed") return nextStatus;
  return isCompletionAfterDueDate(dueDateValue, completedAt) ? "completed_late" : "completed";
};

export const getCompletionStatusForTask = (
  nextStatus: string,
  task: any,
  completedAt: Date = new Date(),
) => getCompletionStatusForSchedule(nextStatus, task?.endDate ?? task?.end, completedAt);

export const getProgressForTaskStatus = (
  nextStatus: string,
  currentProgress: number | null | undefined = 0,
) => {
  const progress = Number(currentProgress) || 0;

  if (nextStatus === "completed" || nextStatus === "completed_late" || nextStatus === "listo") {
    return 100;
  }

  if (nextStatus === "in_progress") {
    return progress >= 100 ? 50 : Math.max(progress, 10);
  }

  if (nextStatus === "stuck") {
    return progress >= 100 ? 50 : progress;
  }

  if (nextStatus === "todo" || nextStatus === "pending" || nextStatus === "not_started") {
    return 0;
  }

  return progress;
};
