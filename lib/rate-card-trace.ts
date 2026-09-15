import {
  doc,
  increment,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import {
  getStaticRateCardAssignee,
  getStaticRateCardSources,
  normalizeRateCardUnits,
} from '@/lib/rate-card-config';
import { getTaskTitle } from '@/lib/task-title';
import { getTaskDateValue, isCompletedTaskStatus } from '@/lib/taskProgress';

const EPSILON = 0.000001;

const normalizeTraceLookupText = (value: any) =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const hashTraceKey = (value: string) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
};

export const buildRateCardTraceKey = ({
  taskId,
  stepIndex,
  rateCardId,
  assignedTo,
  sourceKey,
  operation = 'charge',
}: {
  taskId?: string | null;
  stepIndex?: number | string | null;
  rateCardId?: string | null;
  assignedTo?: string | null;
  sourceKey?: string | null;
  operation?: 'charge' | 'reversal';
}) => [
  taskId || 'sin-tarea',
  stepIndex ?? 'task',
  rateCardId || 'sin-rate-card',
  assignedTo || 'sin-profesional',
  sourceKey || 'sin-origen',
  operation,
].join('::');

export const getRateCardTraceEntryId = (traceKey: string) => `trace_${hashTraceKey(traceKey)}`;

export const buildRateCardMovementKey = ({
  taskId,
  stepIndex,
  rateCardId,
  assignedTo,
  sourceKey,
}: {
  taskId?: string | null;
  stepIndex?: number | string | null;
  rateCardId?: string | null;
  assignedTo?: string | null;
  sourceKey?: string | null;
}) => [
  taskId || 'sin-tarea',
  stepIndex ?? 'task',
  rateCardId || 'sin-rate-card',
  assignedTo || 'sin-profesional',
  sourceKey || 'sin-origen',
].join('::');

export const getRateCardBusinessMovementKey = (entry: any) => {
  const normalizedTitle = normalizeTraceLookupText(entry?.taskTitle);
  const titleLooksHistoricalBalance =
    normalizedTitle === 'produccion historica sin detalle' ||
    normalizedTitle === 'reproceso historico sin detalle';
  const taskKey = entry?.externalWorkflowId || (titleLooksHistoricalBalance ? '' : normalizedTitle) || entry?.taskId;
  if (!taskKey) return '';

  return [
    taskKey,
    entry?.rateCardId || 'sin-rate-card',
    entry?.assignedTo || 'sin-profesional',
    entry?.isRework ? 'rework' : 'production',
  ].join('::');
};

const getMovementKeyFromTraceKey = (traceKey: any) => {
  if (typeof traceKey !== 'string') return '';
  const parts = traceKey.split('::');
  if (parts.length < 6) return '';
  return parts.slice(0, 5).join('::');
};

export const getRateCardPeriodKeys = (date = new Date()) => {
  const year = date.getFullYear();
  const dateKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const startOfYear = new Date(year, 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000) + 1;
  const weekKey = `${year}-W${String(Math.ceil(dayOfYear / 7)).padStart(2, '0')}`;

  return { dateKey, weekKey, monthKey };
};

export const parseRateCardTraceDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') return getTaskDateValue(value.toDate());
  if (typeof value?.toMillis === 'function') return getTaskDateValue(value.toMillis());
  if (typeof value?.seconds === 'number') return getTaskDateValue(value.seconds * 1000);
  return getTaskDateValue(value);
};

type RateCardActor = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
};

export const addTraceableRateCardMovementToBatch = (
  batch: ReturnType<typeof writeBatch>,
  params: {
    projectId: string;
    task: any;
    rateCardId: string;
    assignedTo?: string | null;
    units: number;
    source: string;
    rateCardSourceKey?: string | null;
    stepIndex?: number | null;
    stepName?: string | null;
    comment?: string | null;
    occurredAt?: Date | null;
    actor?: RateCardActor | null;
    isRework?: boolean;
    reversal?: boolean;
    updateAggregate?: boolean;
    completionMode?: string | null;
    extra?: Record<string, any>;
  },
) => {
  const absoluteUnits = normalizeRateCardUnits(params.units, 0);
  if (!params.rateCardId || absoluteUnits <= EPSILON) return null;

  const signedUnits = params.reversal ? -absoluteUnits : absoluteUnits;
  const assignedTo = params.assignedTo || null;
  const occurredAt = params.occurredAt && !Number.isNaN(params.occurredAt.getTime())
    ? params.occurredAt
    : new Date();

  if (params.updateAggregate !== false) {
    const rateCardRef = doc(db, 'projects', params.projectId, 'rateCards', params.rateCardId);
    const valueField = params.isRework ? 'reworkValue' : 'currentValue';
    const statsField = params.isRework ? 'userReworkStats' : 'userStats';
    const aggregateUpdate: Record<string, any> = {
      [valueField]: increment(signedUnits),
      updatedAt: serverTimestamp(),
    };

    if (assignedTo) {
      aggregateUpdate[`${statsField}.${assignedTo}`] = increment(signedUnits);
    }
    batch.update(rateCardRef, aggregateUpdate);
  }

  const stepIndex = typeof params.stepIndex === 'number' ? params.stepIndex : null;
  const overrideTraceKey = typeof params.extra?.traceKey === 'string' ? params.extra.traceKey : '';
  const traceKey = overrideTraceKey || buildRateCardTraceKey({
    taskId: params.task?.id || null,
    stepIndex,
    rateCardId: params.rateCardId,
    assignedTo,
    sourceKey: params.rateCardSourceKey || params.source,
    operation: params.reversal ? 'reversal' : 'charge',
  });
  const movementKey = buildRateCardMovementKey({
    taskId: params.task?.id || null,
    stepIndex,
    rateCardId: params.rateCardId,
    assignedTo,
    sourceKey: params.rateCardSourceKey || params.source,
  });
  const entryRef = doc(db, 'projects', params.projectId, 'rateCardEntries', getRateCardTraceEntryId(traceKey));

  const entryData = {
    projectId: params.projectId,
    taskId: params.task?.id || null,
    taskTitle: getTaskTitle(params.task, 'Tarea'),
    externalWorkflowId: params.task?.externalWorkflowId || null,
    parentTaskId: params.task?.parentTaskId || null,
    rateCardId: params.rateCardId,
    assignedTo,
    units: signedUnits,
    source: params.source,
    rateCardSourceKey: params.rateCardSourceKey || null,
    rateCardMovementKey: movementKey,
    stepIndex,
    stepName: params.stepName || null,
    comment: params.comment || null,
    isRework: Boolean(params.isRework),
    reversal: Boolean(params.reversal),
    completionMode: params.completionMode || null,
    ...getRateCardPeriodKeys(occurredAt),
    completedAt: Timestamp.fromDate(occurredAt),
    createdAt: Timestamp.fromDate(occurredAt),
    recordedAt: serverTimestamp(),
    createdBy: params.actor?.id || null,
    createdByEmail: params.actor?.email || null,
    createdByName: params.actor?.name || null,
    ...(params.extra || {}),
    traceKey,
  };

  batch.set(entryRef, entryData);
  return { id: entryRef.id, ...entryData };
};

export type HistoricalRateCardGap = {
  id: string;
  entryId?: string;
  assignedTo: string;
  units: number;
  isRework: boolean;
  source?: string;
  taskTitle?: string;
};

export type HistoricalRateCardRepairMatch = {
  taskId: string;
  taskTitle: string;
  externalWorkflowId: string | null;
  parentTaskId: string | null;
  assignedTo: string;
  units: number;
  stepIndex: number | null;
  stepName: string | null;
  rateCardSourceKeys: string[];
  occurredAt: Date;
  completionEvidence: 'step_completed_at' | 'workflow_history' | 'task_completed_at' | 'status_history' | 'task_updated_at';
  originalCompletedBy: string | null;
  traceKey: string;
};

export type HistoricalRateCardRepairPlan = {
  matches: HistoricalRateCardRepairMatch[];
  unresolved: HistoricalRateCardGap[];
  recoverableUnits: number;
  unresolvedUnits: number;
};

const getWorkflowHistoryDate = (task: any, stepIndex: number) => {
  const history = Array.isArray(task?.workflowHistory) ? task.workflowHistory : [];
  const entry = [...history].reverse().find((item: any) =>
    Number(item?.stepIndex) === stepIndex &&
    ['approve', 'approved', 'complete', 'completed'].includes(String(item?.action || '').toLowerCase())
  );
  return parseRateCardTraceDate(entry?.timestamp || entry?.createdAt || entry?.completedAt);
};

const getTaskCompletionEvidence = (task: any) => {
  const completedAt = parseRateCardTraceDate(task?.completedAt);
  if (completedAt) return { date: completedAt, evidence: 'task_completed_at' as const };

  const statusHistory = Array.isArray(task?.statusHistory) ? task.statusHistory : [];
  const completedHistory = [...statusHistory].reverse().find((item: any) =>
    isCompletedTaskStatus(item?.status || item?.newStatus || item?.to)
  );
  const historyDate = parseRateCardTraceDate(
    completedHistory?.timestamp || completedHistory?.createdAt || completedHistory?.completedAt,
  );
  if (historyDate) return { date: historyDate, evidence: 'status_history' as const };

  if (isCompletedTaskStatus(task?.status)) {
    const updatedAt = parseRateCardTraceDate(task?.updatedAt);
    if (updatedAt) return { date: updatedAt, evidence: 'task_updated_at' as const };
  }
  return null;
};

export type RateCardEntryDateResolution = {
  date: Date | null;
  dateKey: string;
  source: 'task_origin' | 'historical_inclusion' | 'manual_sanitation' | 'unresolved';
  evidence: string | null;
};

const normalizeHistoricalDateKey = (value: any) => {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

export const resolveHistoricalRateCardEntryDate = (
  entry: any,
  tasks: any[] = [],
): RateCardEntryDateResolution => {
  const sanitizedDateKey = normalizeHistoricalDateKey(entry?.sanitizedDateKey);
  if (sanitizedDateKey) {
    return {
      date: parseRateCardTraceDate(`${sanitizedDateKey}T12:00:00`),
      dateKey: sanitizedDateKey,
      source: 'manual_sanitation',
      evidence: 'sanitized_date_key',
    };
  }

  const taskIds = [entry?.taskId, entry?.parentTaskId].filter(Boolean);
  const task = taskIds
    .map(taskId => tasks.find(candidate => candidate?.id === taskId))
    .find(Boolean);

  if (task) {
    const stepIndex = typeof entry?.stepIndex === 'number' ? entry.stepIndex : null;
    const step = stepIndex !== null && Array.isArray(task?.workflowSteps)
      ? task.workflowSteps[stepIndex]
      : null;
    const stepDate = parseRateCardTraceDate(step?.completedAt);
    const workflowDate = stepIndex !== null ? getWorkflowHistoryDate(task, stepIndex) : null;
    const taskCompletion = getTaskCompletionEvidence(task);
    const taskDate = stepDate || workflowDate || taskCompletion?.date || null;

    if (taskDate) {
      return {
        date: taskDate,
        dateKey: getRateCardPeriodKeys(taskDate).dateKey,
        source: 'task_origin',
        evidence: stepDate
          ? 'step_completed_at'
          : workflowDate
            ? 'workflow_history'
            : taskCompletion?.evidence || 'task_completion',
      };
    }
  }

  const inclusionDate =
    parseRateCardTraceDate(entry?.createdAt) ||
    parseRateCardTraceDate(entry?.recordedAt) ||
    parseRateCardTraceDate(entry?.adjustedAt);

  if (inclusionDate) {
    return {
      date: inclusionDate,
      dateKey: getRateCardPeriodKeys(inclusionDate).dateKey,
      source: 'historical_inclusion',
      evidence: entry?.createdAt
        ? 'entry_created_at'
        : entry?.recordedAt
          ? 'entry_recorded_at'
          : 'entry_adjusted_at',
    };
  }

  const storedDateKey = normalizeHistoricalDateKey(entry?.dateKey || entry?.dayKey || entry?.reportDate);
  if (storedDateKey) {
    return {
      date: parseRateCardTraceDate(`${storedDateKey}T12:00:00`),
      dateKey: storedDateKey,
      source: 'historical_inclusion',
      evidence: 'stored_date_key',
    };
  }

  return {
    date: null,
    dateKey: '',
    source: 'unresolved',
    evidence: null,
  };
};

const resolveRepairAssignee = (
  source: any,
  step: any,
  task: any,
  gapUsers: Set<string>,
) => {
  const candidates = [
    getStaticRateCardAssignee(source, step?.assignedTo),
    source?.assignedTo,
    step?.completedBy,
    task?.assignedTo,
  ].filter((value, index, values): value is string =>
    typeof value === 'string' && value.length > 0 && value !== 'DYNAMIC' && values.indexOf(value) === index
  );

  return candidates.find(candidate => gapUsers.has(candidate)) || null;
};

export const buildHistoricalRateCardRepairPlan = ({
  rateCard,
  gaps,
  entries,
  tasks,
}: {
  rateCard: any;
  gaps: HistoricalRateCardGap[];
  entries: any[];
  tasks: any[];
}): HistoricalRateCardRepairPlan => {
  const productionGaps = gaps.filter(gap => !gap.isRework && gap.units > EPSILON);
  const gapUsers = new Set(productionGaps.map(gap => gap.assignedTo).filter(Boolean));
  const existingByOrigin = new Map<string, number>();
  const existingBusinessMovementKeys = new Set(
    entries
      .filter(entry => entry?.rateCardId === rateCard?.id && !entry?.isRework && !entry?.reversal)
      .map(getRateCardBusinessMovementKey)
      .filter(Boolean),
  );
  const existingTraceKeys = new Set(
    entries
      .map(entry => typeof entry?.traceKey === 'string' ? entry.traceKey : '')
      .filter(Boolean),
  );
  const existingMovementKeys = new Set(
    entries
      .map(entry => String(entry?.rateCardMovementKey || getMovementKeyFromTraceKey(entry?.traceKey) || ''))
      .filter(Boolean),
  );

  entries
    .filter(entry => entry?.rateCardId === rateCard?.id && !entry?.isRework)
    .forEach(entry => {
      const key = [
        entry.taskId || '',
        typeof entry.stepIndex === 'number' ? entry.stepIndex : 'task',
        entry.assignedTo || '',
      ].join('::');
      existingByOrigin.set(key, (existingByOrigin.get(key) || 0) + Number(entry.units || 0));
    });

  const groupedCandidates = new Map<string, Omit<HistoricalRateCardRepairMatch, 'units' | 'rateCardSourceKeys' | 'traceKey'> & {
    businessKey: string;
    expectedUnits: number;
    sourceKeys: string[];
  }>();

  (tasks || []).forEach(task => {
    const taskCompletion = getTaskCompletionEvidence(task);
    const steps = Array.isArray(task?.workflowSteps) ? task.workflowSteps : [];

    steps.forEach((step: any, stepIndex: number) => {
      if (step?.status !== 'listo') return;
      const sources = getStaticRateCardSources(step).filter(source => source.rateCardId === rateCard?.id);
      if (sources.length === 0) return;

      sources.forEach(source => {
        const units = normalizeRateCardUnits(source.unitsToAdd, 0);
        const assignedTo = resolveRepairAssignee(source, step, task, gapUsers);
        if (units <= EPSILON || !assignedTo) return;
        const businessKey = getRateCardBusinessMovementKey({
          taskId: task.id,
          externalWorkflowId: task.externalWorkflowId || null,
          taskTitle: getTaskTitle(task, 'Tarea'),
          rateCardId: rateCard?.id,
          assignedTo,
          isRework: false,
        });
        if (!businessKey || existingBusinessMovementKeys.has(businessKey)) return;

        const stepDate = parseRateCardTraceDate(step?.completedAt);
        const historyDate = getWorkflowHistoryDate(task, stepIndex);
        // Historical balances were posted when the workflow was finally
        // closed. Prefer that date so repaired reports keep the original
        // accounting cut-off instead of inventing a step date.
        const completion = taskCompletion || (stepDate
          ? { date: stepDate, evidence: 'step_completed_at' as const }
          : historyDate
            ? { date: historyDate, evidence: 'workflow_history' as const }
            : null);
        if (!completion) return;

        const current = groupedCandidates.get(businessKey);
        if (current) {
          current.sourceKeys.push(source.key);
          if (units > current.expectedUnits + EPSILON) {
            current.expectedUnits = units;
            current.stepIndex = stepIndex;
            current.stepName = step?.name || step?.title || `Paso ${stepIndex + 1}`;
            current.occurredAt = completion.date;
            current.completionEvidence = completion.evidence;
            current.originalCompletedBy = step?.completedBy || null;
          }
          return;
        }

        groupedCandidates.set(businessKey, {
          businessKey,
          taskId: task.id,
          taskTitle: getTaskTitle(task, 'Tarea'),
          externalWorkflowId: task.externalWorkflowId || null,
          parentTaskId: task.parentTaskId || null,
          assignedTo,
          stepIndex,
          stepName: step?.name || step?.title || `Paso ${stepIndex + 1}`,
          occurredAt: completion.date,
          completionEvidence: completion.evidence,
          originalCompletedBy: step?.completedBy || null,
          expectedUnits: units,
          sourceKeys: [source.key],
        });
      });
    });

    if (
      task?.isRateCardTask &&
      task?.rateCardId === rateCard?.id &&
      steps.length > 0 &&
      steps.every((step: any) => step?.status === 'listo') &&
      taskCompletion
    ) {
      const assignedTo = typeof task.assignedTo === 'string' && gapUsers.has(task.assignedTo)
        ? task.assignedTo
        : null;
      const units = normalizeRateCardUnits(task.unitsToAdd, 0);
      if (assignedTo && units > EPSILON) {
        const businessKey = getRateCardBusinessMovementKey({
          taskId: task.id,
          externalWorkflowId: task.externalWorkflowId || null,
          taskTitle: getTaskTitle(task, 'Tarea'),
          rateCardId: rateCard?.id,
          assignedTo,
          isRework: false,
        });
        if (!businessKey || existingBusinessMovementKeys.has(businessKey)) return;
        const current = groupedCandidates.get(businessKey);
        if (current && current.expectedUnits >= units - EPSILON) return;
        groupedCandidates.set(businessKey, {
          businessKey,
          taskId: task.id,
          taskTitle: getTaskTitle(task, 'Tarea'),
          externalWorkflowId: task.externalWorkflowId || null,
          parentTaskId: task.parentTaskId || null,
          assignedTo,
          stepIndex: null,
          stepName: null,
          occurredAt: taskCompletion.date,
          completionEvidence: taskCompletion.evidence,
          originalCompletedBy: task.completedBy || null,
          expectedUnits: units,
          sourceKeys: ['task:workflow-completion'],
        });
      }
    }
  });

  const remainingByUser = new Map<string, number>();
  productionGaps.forEach(gap => {
    remainingByUser.set(
      gap.assignedTo,
      (remainingByUser.get(gap.assignedTo) || 0) + gap.units,
    );
  });
  const matches: HistoricalRateCardRepairMatch[] = [];

  Array.from(groupedCandidates.values())
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
    .forEach(candidate => {
      if (existingBusinessMovementKeys.has(candidate.businessKey)) return;
      const originKey = [candidate.taskId, candidate.stepIndex ?? 'task', candidate.assignedTo].join('::');
      const missingUnits = candidate.expectedUnits - (existingByOrigin.get(originKey) || 0);
      const remainingGap = remainingByUser.get(candidate.assignedTo) || 0;
      if (missingUnits <= EPSILON || missingUnits - remainingGap > EPSILON) return;

      const sourceKeys = Array.from(new Set(candidate.sourceKeys)).sort();
      const traceKey = buildRateCardTraceKey({
        taskId: candidate.taskId,
        stepIndex: candidate.stepIndex,
        rateCardId: rateCard.id,
        assignedTo: candidate.assignedTo,
        sourceKey: sourceKeys.join('|'),
        operation: 'charge',
      });
      const movementKey = buildRateCardMovementKey({
        taskId: candidate.taskId,
        stepIndex: candidate.stepIndex,
        rateCardId: rateCard.id,
        assignedTo: candidate.assignedTo,
        sourceKey: sourceKeys.join('|'),
      });
      if (existingTraceKeys.has(traceKey) || existingMovementKeys.has(movementKey)) return;

      matches.push({
        taskId: candidate.taskId,
        taskTitle: candidate.taskTitle,
        externalWorkflowId: candidate.externalWorkflowId,
        parentTaskId: candidate.parentTaskId,
        assignedTo: candidate.assignedTo,
        units: missingUnits,
        stepIndex: candidate.stepIndex,
        stepName: candidate.stepName,
        occurredAt: candidate.occurredAt,
        completionEvidence: candidate.completionEvidence,
        originalCompletedBy: candidate.originalCompletedBy,
        rateCardSourceKeys: sourceKeys,
        traceKey,
      });
      existingBusinessMovementKeys.add(candidate.businessKey);
      remainingByUser.set(candidate.assignedTo, Math.max(0, remainingGap - missingUnits));
    });

  const unresolved = gaps.reduce<HistoricalRateCardGap[]>((rows, gap) => {
    if (gap.isRework) {
      rows.push(gap);
      return rows;
    }

    const remainingUnits = remainingByUser.get(gap.assignedTo) || 0;
    const unresolvedUnits = Math.min(gap.units, remainingUnits);
    if (unresolvedUnits > EPSILON) {
      rows.push({ ...gap, units: unresolvedUnits });
      remainingByUser.set(gap.assignedTo, Math.max(0, remainingUnits - unresolvedUnits));
    }
    return rows;
  }, []);

  return {
    matches,
    unresolved,
    recoverableUnits: matches.reduce((sum, match) => sum + match.units, 0),
    unresolvedUnits: unresolved.reduce((sum, gap) => sum + gap.units, 0),
  };
};
