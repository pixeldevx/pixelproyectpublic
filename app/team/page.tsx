"use client"

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { differenceInCalendarDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock,
  Edit2,
  Eye,
  Layers3,
  Mail,
  Medal,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  TimerReset,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { collection, doc, onSnapshot, query, updateDoc } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { belongsToAnyOrganization, organizationNameFor } from '@/lib/organizations';
import { formatRateCardUnits, formatRateCardValue, isCurrencyRateCard, normalizeRateCardValueType } from '@/lib/rate-card-config';
import { isWorkflowTaskType } from '@/lib/workflow-routing';

type TeamTask = {
  id: string;
  projectId: string;
  projectName?: string;
  title?: string;
  name?: string;
  type?: string;
  status?: string;
  priority?: string;
  progress?: number;
  assignedTo?: string;
  assignedUsers?: string[];
  assignedTeamMembers?: string[];
  workflowSteps?: any[];
  currentStepIndex?: number;
  startDate?: any;
  start?: any;
  endDate?: any;
  end?: any;
  dueDate?: any;
  createdAt?: any;
  updatedAt?: any;
  completedAt?: any;
  externalWorkflowId?: string;
  workflowHistory?: any[];
  performanceHistory?: PerformanceItem[];
  completedBy?: string;
  completedByMemberId?: string;
};

type RateCardEntry = {
  id: string;
  projectId: string;
  taskId?: string;
  taskTitle?: string;
  rateCardId?: string;
  assignedTo?: string;
  units?: number;
  source?: string;
  isRework?: boolean;
  reversal?: boolean;
  dateKey?: string;
  createdAt?: any;
};

type RateCardDefinition = {
  id: string;
  projectId: string;
  name?: string;
  indicator?: string;
  rate?: number;
  rateType?: string;
  valueType?: string;
  unitLabel?: string;
  currency?: string;
};

type QualityEvent = {
  id: string;
  projectId: string;
  projectName?: string;
  taskId?: string;
  taskTitle?: string;
  stepLabel?: string;
  result?: string;
  professionalId?: string;
  reviewerId?: string;
  causeLabel?: string;
  comment?: string;
  createdAt?: any;
  createdBy?: string;
  createdByEmail?: string;
};

type PerformanceItem = {
  id: string;
  type: 'task' | 'workflow_step';
  source?: string;
  projectId: string;
  projectName?: string | null;
  organizationId?: string | null;
  taskId?: string;
  taskTitle?: string;
  externalWorkflowId?: string | null;
  municipality?: string | null;
  stepIndex?: number | null;
  stepLabel?: string | null;
  status?: string;
  action?: string;
  outcome?: string;
  assigneeId?: string | null;
  userId?: string | null;
  memberId?: string | null;
  userIds?: string[];
  userName?: string | null;
  startedAt?: any;
  plannedStartAt?: any;
  plannedEndAt?: any;
  completedAt?: any;
  durationDays?: number | null;
  delayDays?: number;
  completedLate?: boolean;
  dateKey?: string;
  monthKey?: string;
  weekKey?: string;
};

type OperationalTask = {
  id: string;
  task: TeamTask;
  inHand: boolean;
  stepLabel: string | null;
  status: string;
  statusBucket: 'pending' | 'active' | 'blocked';
  progress: number;
  dueDate: any;
  scheduleState: 'paused' | 'noDate' | 'overdue' | 'dueSoon' | 'onTime';
};

type MemberMetric = {
  member: any;
  organizationLabel: string;
  operationalTasks: OperationalTask[];
  relatedTasks: TeamTask[];
  completedWorkItems: PerformanceItem[];
  openTasks: number;
  inHandTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  completedLate: number;
  overdueTasks: number;
  dueSoonTasks: number;
  laggingTasks: number;
  blockedTasks: number;
  averageProgress: number;
  averageDays: number | null;
  rateUnits: number;
  rateValue: number;
  reworkUnits: number;
  qualityAccepted: number;
  qualityRejected: number;
  qualityReviewed: number;
  qualityScore: number | null;
  reviewerCount: number;
  qualityEvents: QualityEvent[];
  reviewEvents: QualityEvent[];
  riskScore: number;
  latestActivity: number;
  rateSummaries: Array<{
    key: string;
    name: string;
    indicator?: string;
    units: number;
    value: number;
    reworkUnits: number;
    currency: string;
    rateType: string;
    unitLabel?: string;
  }>;
};

type SortMode = 'risk' | 'quality' | 'rates' | 'workload' | 'completed' | 'active';
type WorkStatusFilter = 'all' | 'open' | 'in_hand' | 'pending' | 'active' | 'overdue' | 'blocked' | 'completed';

const ACCESS_ROLES = new Set(['admin', 'org_admin', 'manager', 'coordinador']);
const PEOPLE_MANAGEMENT_ROLES = new Set(['admin', 'org_admin']);
const COMPLETED_STATUSES = new Set(['completed', 'completed_late', 'listo']);
const ACTIVE_STATUSES = new Set(['in_progress', 'en_curso', 'trabajando', 'reproceso']);
const BLOCKED_STATUSES = new Set(['stuck', 'detenido', 'blocked', 'devuelto']);
const PENDING_STATUSES = new Set(['todo', 'pending', 'not_started', 'no_iniciado']);

const compactNumber = (value: number) => new Intl.NumberFormat('es-CO').format(value);
const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(value || 0));

const getDate = (value: any): Date | null => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTime = (value: any) => getDate(value)?.getTime() || 0;

const formatShortDate = (value: any) => {
  const date = getDate(value);
  return date ? format(date, 'd MMM', { locale: es }) : 'Sin fecha';
};

const getProjectIdFromSnapshot = (snapshotDoc: any, data: any) => {
  if (data?.projectId) return data.projectId;
  const path = snapshotDoc?.ref?.path || '';
  const segments = path.split('/');
  const projectIndex = segments.indexOf('projects');
  return projectIndex >= 0 ? segments[projectIndex + 1] || '' : '';
};

const getStatusBucket = (status?: string) => {
  const normalized = String(status || 'todo').toLowerCase();
  if (normalized === 'completed_late') return 'completedLate';
  if (COMPLETED_STATUSES.has(normalized)) return 'completed';
  if (BLOCKED_STATUSES.has(normalized)) return 'blocked';
  if (ACTIVE_STATUSES.has(normalized)) return 'active';
  if (PENDING_STATUSES.has(normalized)) return 'pending';
  return 'pending';
};

const isCompletedTask = (task: TeamTask) => COMPLETED_STATUSES.has(String(task.status || '').toLowerCase());

const isCompletedWorkflowStep = (step: any) => COMPLETED_STATUSES.has(String(step?.status || '').toLowerCase());

const getCurrentWorkflowStepIndex = (task: TeamTask) => {
  const steps = Array.isArray(task.workflowSteps) ? task.workflowSteps : [];
  if (steps.length === 0) return 0;

  const explicitIndex = Number(task.currentStepIndex);
  if (Number.isFinite(explicitIndex) && explicitIndex >= 0 && explicitIndex < steps.length) {
    return explicitIndex;
  }

  const firstOpenIndex = steps.findIndex((step) => !isCompletedWorkflowStep(step));
  return firstOpenIndex >= 0 ? firstOpenIndex : steps.length - 1;
};

const getWorkflowStepProgress = (step: any) => {
  const status = String(step?.status || 'not_started').toLowerCase();
  if (COMPLETED_STATUSES.has(status)) return 100;
  if (ACTIVE_STATUSES.has(status)) return 50;
  return 0;
};

const getTaskTitle = (task: TeamTask) => {
  const title = task.title || task.name || 'Tarea sin nombre';
  if (task.externalWorkflowId && !String(title).includes(task.externalWorkflowId)) {
    return `[${task.externalWorkflowId}] ${title}`;
  }
  return title;
};

const getTaskDeepLink = (projectId: string, taskId?: string, focus = 'comments') =>
  taskId ? `/projects/${projectId}?tab=tasks&taskId=${encodeURIComponent(taskId)}&focus=${focus}` : `/projects/${projectId}?tab=tasks`;

const getQualityDeepLink = (event: QualityEvent) =>
  event.taskId
    ? getTaskDeepLink(event.projectId, event.taskId, 'comments')
    : `/quality?projectId=${encodeURIComponent(event.projectId)}&eventId=${encodeURIComponent(event.id)}`;

const getStatusLabel = (status?: string) => {
  const bucket = getStatusBucket(status);
  if (bucket === 'completedLate') return 'Finalizada tarde';
  if (bucket === 'completed') return 'Finalizada';
  if (bucket === 'blocked') return 'Bloqueada';
  if (bucket === 'active') return 'En curso';
  return 'Pendiente';
};

const getStatusClass = (status?: string) => {
  const bucket = getStatusBucket(status);
  if (bucket === 'completedLate') return 'bg-orange-50 text-orange-700 ring-orange-100';
  if (bucket === 'completed') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (bucket === 'blocked') return 'bg-red-50 text-red-700 ring-red-100';
  if (bucket === 'active') return 'bg-amber-50 text-amber-700 ring-amber-100';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
};

const getMemberIdentifiers = (member: any) => {
  const ids = new Set<string>();
  [member?.id, member?.authUserId, member?.uid].forEach((value) => {
    if (value) ids.add(String(value));
  });
  if (member?.email) ids.add(String(member.email).toLowerCase());
  return ids;
};

const matchesMember = (member: any, value?: string | null) => {
  if (!value) return false;
  const normalized = String(value).toLowerCase();
  const identifiers = getMemberIdentifiers(member);
  return identifiers.has(String(value)) || identifiers.has(normalized);
};

const roundDayValue = (value: number) => Math.round(value * 10) / 10;

const getDurationDaysBetween = (startedAt: any, completedAt: any) => {
  const startDate = getDate(startedAt);
  const endDate = getDate(completedAt);
  if (!startDate || !endDate) return null;
  return roundDayValue(Math.max(0, (endDate.getTime() - startDate.getTime()) / 86400000));
};

const getDelayDaysFromPlannedEnd = (plannedEnd: any, completedAt: any) => {
  const plannedEndDate = getDate(plannedEnd);
  const completionDate = getDate(completedAt);
  if (!plannedEndDate || !completionDate) return 0;
  const plannedDay = new Date(plannedEndDate.getFullYear(), plannedEndDate.getMonth(), plannedEndDate.getDate()).getTime();
  const completedDay = new Date(completionDate.getFullYear(), completionDate.getMonth(), completionDate.getDate()).getTime();
  const delay = completedDay - plannedDay;
  return delay > 0 ? Math.ceil(delay / 86400000) : 0;
};

const normalizePerformanceItem = (task: TeamTask, item: any, index: number): PerformanceItem => {
  const completedAt = item.completedAt || item.timestamp || task.completedAt || task.updatedAt;
  const startedAt = item.startedAt || item.plannedStartAt || task.startDate || task.start || task.createdAt;
  const plannedEndAt = item.plannedEndAt || task.endDate || task.end || task.dueDate;
  const durationDays = typeof item.durationDays === 'number'
    ? item.durationDays
    : getDurationDaysBetween(startedAt, completedAt);
  const delayDays = typeof item.delayDays === 'number'
    ? item.delayDays
    : getDelayDaysFromPlannedEnd(plannedEndAt, completedAt);

  return {
    id: String(item.id || `${task.projectId}-${task.id}-performance-${index}`),
    type: item.type === 'workflow_step' ? 'workflow_step' : 'task',
    source: item.source,
    projectId: item.projectId || task.projectId,
    projectName: item.projectName || task.projectName || null,
    organizationId: item.organizationId || null,
    taskId: item.taskId || task.id,
    taskTitle: item.taskTitle || getTaskTitle(task),
    externalWorkflowId: item.externalWorkflowId || task.externalWorkflowId || null,
    municipality: item.municipality || null,
    stepIndex: typeof item.stepIndex === 'number' ? item.stepIndex : null,
    stepLabel: item.stepLabel || null,
    status: item.status,
    action: item.action,
    outcome: item.outcome || (item.action === 'return' ? 'returned' : 'completed'),
    assigneeId: item.assigneeId || null,
    userId: item.userId || null,
    memberId: item.memberId || null,
    userIds: Array.isArray(item.userIds) ? item.userIds : [],
    userName: item.userName || null,
    startedAt,
    plannedStartAt: item.plannedStartAt || task.startDate || task.start || task.createdAt,
    plannedEndAt,
    completedAt,
    durationDays,
    delayDays,
    completedLate: Boolean(item.completedLate || delayDays > 0),
    dateKey: item.dateKey,
    monthKey: item.monthKey,
    weekKey: item.weekKey,
  };
};

const buildStepPerformanceFallback = (task: TeamTask, step: any, index: number): PerformanceItem | null => {
  const completedAt = step?.completedAt || step?.finishedAt || step?.updatedAt || task.completedAt || task.updatedAt;
  if (!isCompletedWorkflowStep(step) || !completedAt) return null;

  return normalizePerformanceItem(
    task,
    {
      id: `${task.projectId}-${task.id}-step-${index}-${getTime(completedAt) || index}`,
      type: 'workflow_step',
      source: 'workflow_step_fallback',
      stepIndex: index,
      stepLabel: step?.label || `Paso ${index + 1}`,
      assigneeId: step?.assignedTo || step?.completedBy || null,
      userId: step?.completedBy || null,
      memberId: step?.completedByMemberId || null,
      userIds: Array.isArray(step?.completedByIds) ? step.completedByIds : [],
      startedAt: step?.startedAt || step?.restartedAt || task.startDate || task.start || task.createdAt,
      plannedStartAt: step?.plannedStartAt || step?.plannedStartDate || step?.startDate || task.startDate || task.start,
      plannedEndAt: step?.plannedEndAt || step?.plannedEndDate || step?.endDate || task.endDate || task.end || task.dueDate,
      completedAt,
      durationDays: typeof step?.durationDays === 'number' ? step.durationDays : undefined,
      delayDays: typeof step?.delayDays === 'number' ? step.delayDays : undefined,
      completedLate: Boolean(step?.completedLate),
      outcome: step?.status === 'devuelto' ? 'returned' : 'completed',
    },
    index
  );
};

const buildTaskPerformanceFallback = (task: TeamTask): PerformanceItem | null => {
  if (!isCompletedTask(task)) return null;
  if (isWorkflowTaskType(task.type) && Array.isArray(task.workflowSteps) && task.workflowSteps.length > 0) return null;

  return normalizePerformanceItem(
    task,
    {
      id: `${task.projectId}-${task.id}-task-fallback`,
      type: 'task',
      source: 'task_status_fallback',
      status: task.status,
      assigneeId: task.assignedTo || null,
      userId: task.completedBy || null,
      memberId: task.completedByMemberId || null,
      startedAt: task.startDate || task.start || task.createdAt,
      plannedEndAt: task.endDate || task.end || task.dueDate,
      completedAt: task.completedAt || task.updatedAt,
      outcome: 'completed',
    },
    0
  );
};

const getPerformanceItemsForTask = (task: TeamTask) => {
  const seen = new Set<string>();
  const items: PerformanceItem[] = [];

  (Array.isArray(task.performanceHistory) ? task.performanceHistory : []).forEach((item, index) => {
    const normalized = normalizePerformanceItem(task, item, index);
    if (!normalized.completedAt || seen.has(normalized.id)) return;
    seen.add(normalized.id);
    items.push(normalized);
  });

  if (Array.isArray(task.workflowSteps)) {
    task.workflowSteps.forEach((step, index) => {
      const item = buildStepPerformanceFallback(task, step, index);
      if (!item || seen.has(item.id)) return;
      const hasStoredStep = items.some(
        (stored) => stored.type === 'workflow_step' && stored.taskId === task.id && stored.stepIndex === index
      );
      if (hasStoredStep) return;
      seen.add(item.id);
      items.push(item);
    });
  }

  const taskFallback = buildTaskPerformanceFallback(task);
  if (taskFallback && !seen.has(taskFallback.id)) {
    items.push(taskFallback);
  }

  return items.sort((left, right) => getTime(right.completedAt) - getTime(left.completedAt));
};

const performanceItemMatchesMember = (item: PerformanceItem, member: any) => {
  if (matchesMember(member, item.assigneeId)) return true;
  if (matchesMember(member, item.memberId)) return true;
  if (matchesMember(member, item.userId)) return true;
  return Array.isArray(item.userIds) && item.userIds.some((id) => matchesMember(member, id));
};

const isTaskDirectlyAssignedToMember = (task: TeamTask, member: any) => {
  if (matchesMember(member, task.assignedTo)) return true;
  if (Array.isArray(task.assignedUsers) && task.assignedUsers.some((id) => matchesMember(member, id))) return true;
  if (Array.isArray(task.assignedTeamMembers) && task.assignedTeamMembers.some((id) => matchesMember(member, id))) return true;
  return false;
};

const isTaskCurrentlyAssignedToMember = (task: TeamTask, member: any) => {
  if (isCompletedTask(task)) return false;
  const steps = Array.isArray(task.workflowSteps) ? task.workflowSteps : [];
  if (isWorkflowTaskType(task.type) && steps.length > 0) {
    const currentStep = steps[getCurrentWorkflowStepIndex(task)];
    if (currentStep?.assignedTo) {
      return !isCompletedWorkflowStep(currentStep) && matchesMember(member, currentStep.assignedTo);
    }
  }
  return isTaskDirectlyAssignedToMember(task, member);
};

const isTaskRelatedToMember = (task: TeamTask, member: any) => {
  if (isTaskCurrentlyAssignedToMember(task, member)) return true;
  if (Array.isArray(task.workflowSteps) && task.workflowSteps.some((step) => matchesMember(member, step.assignedTo))) return true;
  return isTaskDirectlyAssignedToMember(task, member);
};

const getMemberOperationalTask = (task: TeamTask, member: any): OperationalTask | null => {
  if (isCompletedTask(task)) return null;
  const steps = Array.isArray(task.workflowSteps) ? task.workflowSteps : [];
  let step: any = null;
  let inHand = false;

  if (isWorkflowTaskType(task.type) && steps.length > 0) {
    const currentStepIndex = getCurrentWorkflowStepIndex(task);
    const currentStep = steps[currentStepIndex];
    if (currentStep?.assignedTo && !isCompletedWorkflowStep(currentStep) && matchesMember(member, currentStep.assignedTo)) {
      step = currentStep;
      inHand = true;
    } else {
      const futureAssignedIndex = steps.findIndex(
        (candidate, index) =>
          index >= currentStepIndex &&
          !isCompletedWorkflowStep(candidate) &&
          matchesMember(member, candidate?.assignedTo)
      );
      if (futureAssignedIndex >= 0) step = steps[futureAssignedIndex];
    }
  }

  if (!step && isTaskDirectlyAssignedToMember(task, member)) {
    if (isWorkflowTaskType(task.type) && steps.some((candidate) => candidate?.assignedTo && !isCompletedWorkflowStep(candidate))) {
      return null;
    }
    inHand = true;
  }

  if (!step && !inHand) return null;

  const rawStatus = String(step?.status || (inHand ? task.status : 'pending') || 'pending').toLowerCase();
  const rawBucket = getStatusBucket(rawStatus);
  const statusBucket: OperationalTask['statusBucket'] =
    rawBucket === 'active' ? 'active' : rawBucket === 'blocked' ? 'blocked' : 'pending';
  const dueDate =
    step?.plannedEndAt ||
    step?.plannedEndDate ||
    step?.endDate ||
    step?.dueDate ||
    task.endDate ||
    task.end ||
    task.dueDate;
  const due = getDate(dueDate);
  const days = due ? differenceInCalendarDays(due, new Date()) : null;
  const scheduleState: OperationalTask['scheduleState'] =
    statusBucket === 'blocked'
      ? 'paused'
      : days == null
        ? 'noDate'
        : days < 0
          ? 'overdue'
          : days <= 3
            ? 'dueSoon'
            : 'onTime';
  const progressValue = step && Number.isFinite(Number(step.progress))
    ? Number(step.progress)
    : step
      ? getWorkflowStepProgress(step)
      : Number(task.progress || 0);

  return {
    id: `${task.projectId}-${task.id}`,
    task,
    inHand,
    stepLabel: step?.label || step?.name || null,
    status: rawStatus,
    statusBucket,
    progress: Math.min(100, Math.max(0, progressValue)),
    dueDate,
    scheduleState,
  };
};

const isTaskLagging = (task: TeamTask) => {
  if (isCompletedTask(task)) return false;
  const startDate = getDate(task.startDate || task.start || task.createdAt);
  const endDate = getDate(task.endDate || task.end || task.dueDate);
  if (!startDate || !endDate) return false;

  const total = endDate.getTime() - startDate.getTime();
  if (total <= 0) return false;

  const elapsed = ((Date.now() - startDate.getTime()) / total) * 100;
  const progress = Number(task.progress || 0);
  return elapsed > 55 && elapsed - progress > 25;
};

const getAverageDays = (tasks: TeamTask[]) => {
  const durations = tasks
    .filter(isCompletedTask)
    .map((task) => {
      const startDate = getDate(task.startDate || task.start || task.createdAt);
      const endDate = getDate(task.completedAt || task.updatedAt);
      if (!startDate || !endDate) return null;
      return Math.max(0.25, (endDate.getTime() - startDate.getTime()) / 86400000);
    })
    .filter((value): value is number => typeof value === 'number');

  if (durations.length === 0) return null;
  return Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10;
};

const getAveragePerformanceDays = (items: PerformanceItem[]) => {
  const durations = items
    .map((item) => (typeof item.durationDays === 'number' ? item.durationDays : getDurationDaysBetween(item.startedAt, item.completedAt)))
    .filter((value): value is number => typeof value === 'number');

  if (durations.length === 0) return null;
  return roundDayValue(durations.reduce((sum, value) => sum + value, 0) / durations.length);
};

const getQualityTone = (score: number | null) => {
  if (score == null) return 'bg-slate-100 text-slate-600 ring-slate-200';
  if (score >= 90) return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (score >= 75) return 'bg-indigo-50 text-indigo-700 ring-indigo-100';
  if (score >= 60) return 'bg-amber-50 text-amber-700 ring-amber-100';
  return 'bg-red-50 text-red-700 ring-red-100';
};

const getRiskTone = (metric: MemberMetric) => {
  if (metric.overdueTasks > 0 || metric.blockedTasks > 0) {
    return {
      label: 'Crítico',
      className: 'bg-red-50 text-red-700 ring-red-100',
      rail: 'bg-red-500',
    };
  }
  if (metric.dueSoonTasks > 0 || metric.laggingTasks > 0) {
    return {
      label: 'Vigilancia',
      className: 'bg-orange-50 text-orange-700 ring-orange-100',
      rail: 'bg-orange-500',
    };
  }
  return {
    label: 'Controlado',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    rail: 'bg-emerald-500',
  };
};

const getRiskLevel = (metric: MemberMetric) => {
  if (metric.overdueTasks > 0 || metric.blockedTasks > 0) return 3;
  if (metric.dueSoonTasks > 0 || metric.laggingTasks > 0) return 2;
  if (metric.riskScore > 0) return 1;
  return 0;
};

const getRiskRowClass = (metric: MemberMetric) => {
  const level = getRiskLevel(metric);
  if (level === 3) return 'border-l-red-500 hover:bg-red-50 focus-within:bg-red-50 hover:ring-1 hover:ring-red-100';
  if (level === 2) return 'border-l-orange-400 hover:bg-orange-50 focus-within:bg-orange-50 hover:ring-1 hover:ring-orange-100';
  return 'border-l-emerald-400 hover:bg-emerald-50 focus-within:bg-emerald-50 hover:ring-1 hover:ring-emerald-100';
};

const compareRiskMetrics = (left: MemberMetric, right: MemberMetric) => {
  return (
    getRiskLevel(right) - getRiskLevel(left) ||
    right.overdueTasks - left.overdueTasks ||
    right.blockedTasks - left.blockedTasks ||
    right.dueSoonTasks - left.dueSoonTasks ||
    right.laggingTasks - left.laggingTasks ||
    right.riskScore - left.riskScore ||
    right.openTasks - left.openTasks
  );
};

const WORK_STATUS_OPTIONS: Array<{ value: WorkStatusFilter; label: string }> = [
  { value: 'all', label: 'Todo' },
  { value: 'open', label: 'Abiertas' },
  { value: 'in_hand', label: 'En poder' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'active', label: 'En curso' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'blocked', label: 'Bloqueadas' },
  { value: 'completed', label: 'Finalizadas' },
];

const getWorkStatusCount = (metric: MemberMetric, filter: WorkStatusFilter) => {
  if (filter === 'open') return metric.openTasks;
  if (filter === 'in_hand') return metric.inHandTasks;
  if (filter === 'pending') return metric.pendingTasks;
  if (filter === 'active') return metric.inProgressTasks;
  if (filter === 'overdue') return metric.overdueTasks;
  if (filter === 'blocked') return metric.blockedTasks;
  if (filter === 'completed') return metric.completedTasks;
  return metric.openTasks + metric.completedTasks;
};

function Avatar({ member, size = 'md' }: { member: any; size?: 'md' | 'lg' }) {
  const dimensions = size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm';
  const label = member?.name || member?.email || 'Usuario';

  return (
    <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-100 font-black text-indigo-700 ring-2 ring-white ${dimensions}`}>
      {member?.photoURL ? (
        <Image src={member.photoURL} alt={label} fill className="object-cover" referrerPolicy="no-referrer" />
      ) : (
        label.charAt(0).toUpperCase()
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  tone: 'indigo' | 'emerald' | 'orange' | 'red' | 'cyan';
}) {
  const toneClass = {
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    orange: 'bg-orange-50 text-orange-700 ring-orange-100',
    red: 'bg-red-50 text-red-700 ring-red-100',
    cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-sm font-medium text-slate-500">{detail}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ${toneClass}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<string, TeamTask[]>>({});
  const [rateCardsByProject, setRateCardsByProject] = useState<Record<string, RateCardDefinition[]>>({});
  const [rateEntriesByProject, setRateEntriesByProject] = useState<Record<string, RateCardEntry[]>>({});
  const [qualityEventsByProject, setQualityEventsByProject] = useState<Record<string, QualityEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('all');
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [workStatusFilter, setWorkStatusFilter] = useState<WorkStatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('risk');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [completedWorkFilter, setCompletedWorkFilter] = useState<'all' | 'task' | 'workflow_step'>('task');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRoleId, setMemberRoleId] = useState('');

  const managedOrganizationIds = useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );
  const canAccessPerformance = ACCESS_ROLES.has(userRole || '');
  const canManagePeople = PEOPLE_MANAGEMENT_ROLES.has(userRole || '');
  const canSeeAllOrganizations = userRole === 'admin' && managedOrganizationIds.length === 0;

  const isWithinScope = useCallback(
    (value: any) => canSeeAllOrganizations || (managedOrganizationIds.length > 0 && belongsToAnyOrganization(value, managedOrganizationIds)),
    [canSeeAllOrganizations, managedOrganizationIds]
  );

  const visibleOrganizations = useMemo(() => {
    if (canSeeAllOrganizations) return organizations;
    return organizations.filter((organization) => managedOrganizationIds.includes(organization.id));
  }, [canSeeAllOrganizations, managedOrganizationIds, organizations]);

  useEffect(() => {
    if (!user || !canAccessPerformance) {
      return;
    }

    const unsubscribeOrganizations = onSnapshot(
      query(collection(db, 'organizations')),
      (snapshot) => {
        setOrganizations(snapshot.docs.map((orgDoc) => ({ id: orgDoc.id, ...orgDoc.data() })));
      },
      (error) => {
        console.error('Error fetching organizations:', error);
      }
    );

    const unsubscribeRoles = onSnapshot(
      query(collection(db, 'roles')),
      (snapshot) => {
        const rolesData = snapshot.docs
          .map((roleDoc) => ({ id: roleDoc.id, ...roleDoc.data() }))
          .filter((role) => userRole === 'admin' || role.isDefault || isWithinScope(role));
        setRoles(rolesData);
      },
      (error) => {
        console.error('Error fetching roles:', error);
      }
    );

    const unsubscribeTeam = onSnapshot(
      query(collection(db, 'team_members')),
      (snapshot) => {
        const teamData = snapshot.docs
          .map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() }))
          .filter((member) => isWithinScope(member));
        teamData.sort((left, right) => String(left.name || left.email || '').localeCompare(String(right.name || right.email || '')));
        setTeamMembers(teamData);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching team members:', error);
        setLoading(false);
      }
    );

    const unsubscribeProjects = onSnapshot(
      query(collection(db, 'projects')),
      (snapshot) => {
        const projectsData = snapshot.docs
          .map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }))
          .filter((project) => isWithinScope(project));
        projectsData.sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
        setProjects(projectsData);
      },
      (error) => {
        console.error('Error fetching team performance projects:', error);
      }
    );

    return () => {
      unsubscribeOrganizations();
      unsubscribeRoles();
      unsubscribeTeam();
      unsubscribeProjects();
    };
  }, [canAccessPerformance, isWithinScope, user, userRole]);

  useEffect(() => {
    if (!user || !canAccessPerformance || projects.length === 0) {
      return;
    }

    const unsubscribes = projects.flatMap((project) => {
      const projectId = project.id;
      const projectName = project.name || 'Proyecto';

      return [
        onSnapshot(
          query(collection(db, 'projects', projectId, 'tasks')),
          (snapshot) => {
            const tasks = snapshot.docs.map((taskDoc) => ({
              id: taskDoc.id,
              projectId,
              projectName,
              ...taskDoc.data(),
            } as TeamTask));
            setTasksByProject((current) => ({ ...current, [projectId]: tasks }));
          },
          (error) => console.error(`Error loading tasks for ${projectId}:`, error)
        ),
        onSnapshot(
          query(collection(db, 'projects', projectId, 'rateCards')),
          (snapshot) => {
            const rateCards = snapshot.docs.map((rateCardDoc) => ({
              id: rateCardDoc.id,
              projectId,
              ...rateCardDoc.data(),
            } as RateCardDefinition));
            setRateCardsByProject((current) => ({ ...current, [projectId]: rateCards }));
          },
          (error) => console.error(`Error loading rate cards for ${projectId}:`, error)
        ),
        onSnapshot(
          query(collection(db, 'projects', projectId, 'rateCardEntries')),
          (snapshot) => {
            const entries = snapshot.docs.map((entryDoc) => {
              const data = entryDoc.data();
              return {
                id: entryDoc.id,
                projectId: getProjectIdFromSnapshot(entryDoc, data) || projectId,
                ...data,
              } as RateCardEntry;
            });
            setRateEntriesByProject((current) => ({ ...current, [projectId]: entries }));
          },
          (error) => console.error(`Error loading rate card entries for ${projectId}:`, error)
        ),
        onSnapshot(
          query(collection(db, 'projects', projectId, 'qualityEvents')),
          (snapshot) => {
            const events = snapshot.docs.map((eventDoc) => {
              const data = eventDoc.data();
              return {
                id: eventDoc.id,
                projectId: getProjectIdFromSnapshot(eventDoc, data) || projectId,
                projectName,
                ...data,
              } as QualityEvent;
            });
            setQualityEventsByProject((current) => ({ ...current, [projectId]: events }));
          },
          (error) => console.error(`Error loading quality events for ${projectId}:`, error)
        ),
      ];
    });

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [canAccessPerformance, projects, user]);

  const organizationProjects = useMemo(() => {
    if (selectedOrganizationId === 'all') return projects;
    return projects.filter((project) => belongsToAnyOrganization(project, [selectedOrganizationId]));
  }, [projects, selectedOrganizationId]);

  const activeSelectedProjectId = useMemo(
    () => selectedProjectId === 'all' || organizationProjects.some((project) => project.id === selectedProjectId)
      ? selectedProjectId
      : 'all',
    [organizationProjects, selectedProjectId]
  );

  const scopedProjects = useMemo(
    () => activeSelectedProjectId === 'all'
      ? organizationProjects
      : organizationProjects.filter((project) => project.id === activeSelectedProjectId),
    [activeSelectedProjectId, organizationProjects]
  );

  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((project) => project.id)), [scopedProjects]);

  const scopedTeamMembers = useMemo(() => {
    if (selectedOrganizationId === 'all') return teamMembers;
    return teamMembers.filter((member) => belongsToAnyOrganization(member, [selectedOrganizationId]));
  }, [selectedOrganizationId, teamMembers]);

  const allTasks = useMemo(
    () => scopedProjects.flatMap((project) => tasksByProject[project.id] || []),
    [scopedProjects, tasksByProject]
  );
  const allRateCards = useMemo(
    () => scopedProjects.flatMap((project) => rateCardsByProject[project.id] || []),
    [rateCardsByProject, scopedProjects]
  );
  const allRateEntries = useMemo(
    () => scopedProjects.flatMap((project) => rateEntriesByProject[project.id] || []),
    [rateEntriesByProject, scopedProjects]
  );
  const allQualityEvents = useMemo(
    () => scopedProjects.flatMap((project) => qualityEventsByProject[project.id] || []),
    [qualityEventsByProject, scopedProjects]
  );
  const allPerformanceItems = useMemo(
    () => allTasks.flatMap((task) => getPerformanceItemsForTask(task)),
    [allTasks]
  );

  const rateCardByKey = useMemo(() => {
    return new Map(allRateCards.map((rateCard) => [`${rateCard.projectId}::${rateCard.id}`, rateCard]));
  }, [allRateCards]);

  const memberMetrics = useMemo<MemberMetric[]>(() => {
    return scopedTeamMembers.map((member) => {
      const operationalTasks = allTasks
        .map((task) => getMemberOperationalTask(task, member))
        .filter((row): row is OperationalTask => Boolean(row))
        .sort((left, right) => {
          const weight: Record<OperationalTask['scheduleState'], number> = {
            overdue: 0,
            paused: 1,
            dueSoon: 2,
            onTime: 3,
            noDate: 4,
          };
          return weight[left.scheduleState] - weight[right.scheduleState] || getTime(left.dueDate) - getTime(right.dueDate);
        });
      const currentOperationalTasks = operationalTasks.filter((row) => row.inHand);
      const relatedTasks = allTasks.filter((task) => isTaskRelatedToMember(task, member));
      const inHandTasks = currentOperationalTasks.length;
      const pendingTasks = operationalTasks.filter((row) => !row.inHand || row.statusBucket === 'pending').length;
      const inProgressTasks = currentOperationalTasks.filter((row) => row.statusBucket === 'active').length;
      const overdueTasks = currentOperationalTasks.filter((row) => row.scheduleState === 'overdue').length;
      const dueSoonTasks = currentOperationalTasks.filter((row) => row.scheduleState === 'dueSoon').length;
      const laggingTasks = currentOperationalTasks.filter((row) => isTaskLagging(row.task)).length;
      const blockedTasks = currentOperationalTasks.filter((row) => row.statusBucket === 'blocked').length;
      const completedWorkItems = allPerformanceItems
        .filter((item) => scopedProjectIds.has(item.projectId) && performanceItemMatchesMember(item, member))
        .sort((left, right) => getTime(right.completedAt) - getTime(left.completedAt));
      const completedTaskItems = completedWorkItems.filter((item) => item.type === 'task');
      const completedTaskKeys = new Set(completedTaskItems.map((item) => `${item.projectId}:${item.taskId || item.id}`));
      const completedLateKeys = new Set(
        completedTaskItems
          .filter((item) => Number(item.delayDays || 0) > 0 || item.completedLate)
          .map((item) => `${item.projectId}:${item.taskId || item.id}`)
      );
      const completedTasks = completedTaskKeys.size;
      const completedLate = completedLateKeys.size;
      const openProgressValues = operationalTasks.map((row) => row.progress);
      const averageProgress = openProgressValues.length
        ? Math.round(openProgressValues.reduce((sum, progress) => sum + progress, 0) / openProgressValues.length)
        : 0;

      const memberRateEntries = allRateEntries.filter((entry) => matchesMember(member, entry.assignedTo));
      const rateSummaryMap = new Map<string, MemberMetric['rateSummaries'][number]>();
      let rateUnits = 0;
      let rateValue = 0;
      let reworkUnits = 0;

      memberRateEntries.forEach((entry) => {
        if (!scopedProjectIds.has(entry.projectId)) return;
        const units = Number(entry.units || 0);
        const rateCard = rateCardByKey.get(`${entry.projectId}::${entry.rateCardId}`);
        const value = units * Number(rateCard?.rate || 0);
        const monetaryRateCard = isCurrencyRateCard(rateCard);
        const key = `${entry.projectId}::${entry.rateCardId || 'unknown'}`;
        const current = rateSummaryMap.get(key) || {
          key,
          name: rateCard?.name || 'Rate card sin nombre',
          indicator: rateCard?.indicator,
          units: 0,
          value: 0,
          reworkUnits: 0,
          currency: rateCard?.currency || 'USD',
          rateType: normalizeRateCardValueType(rateCard?.rateType || rateCard?.valueType),
          unitLabel: rateCard?.unitLabel,
        };

        current.units += units;
        current.value += value;
        if (entry.isRework) current.reworkUnits += Math.abs(units);
        rateSummaryMap.set(key, current);
        rateUnits += units;
        if (monetaryRateCard) rateValue += value;
        if (entry.isRework) reworkUnits += Math.abs(units);
      });

      const professionalQualityEvents = allQualityEvents.filter((event) => matchesMember(member, event.professionalId));
      const reviewerQualityEvents = allQualityEvents.filter((event) => matchesMember(member, event.reviewerId) || matchesMember(member, event.createdBy));
      const qualityAccepted = professionalQualityEvents.filter((event) => event.result === 'accepted').length;
      const qualityRejected = professionalQualityEvents.filter((event) => event.result === 'rejected').length;
      const qualityReviewed = qualityAccepted + qualityRejected;
      const qualityScore = qualityReviewed > 0 ? Math.round((qualityAccepted / qualityReviewed) * 100) : null;
      const latestActivity = Math.max(
        ...relatedTasks.map((task) => getTime(task.updatedAt || task.createdAt)),
        ...completedWorkItems.map((item) => getTime(item.completedAt)),
        ...memberRateEntries.map((entry) => getTime(entry.createdAt || entry.dateKey)),
        ...professionalQualityEvents.map((event) => getTime(event.createdAt)),
        0
      );
      return {
        member,
        organizationLabel: organizationNameFor(member, organizations),
        operationalTasks,
        relatedTasks,
        completedWorkItems,
        openTasks: operationalTasks.length,
        inHandTasks,
        pendingTasks,
        inProgressTasks,
        completedTasks,
        completedLate,
        overdueTasks,
        dueSoonTasks,
        laggingTasks,
        blockedTasks,
        averageProgress,
        averageDays: getAveragePerformanceDays(completedWorkItems) ?? getAverageDays(relatedTasks),
        rateUnits,
        rateValue,
        reworkUnits,
        qualityAccepted,
        qualityRejected,
        qualityReviewed,
        qualityScore,
        reviewerCount: reviewerQualityEvents.length,
        qualityEvents: professionalQualityEvents
          .sort((left, right) => getTime(right.createdAt) - getTime(left.createdAt))
          .slice(0, 8),
        reviewEvents: reviewerQualityEvents
          .sort((left, right) => getTime(right.createdAt) - getTime(left.createdAt))
          .slice(0, 8),
        riskScore: overdueTasks * 5 + blockedTasks * 4 + laggingTasks * 2 + dueSoonTasks,
        latestActivity,
        rateSummaries: Array.from(rateSummaryMap.values()).sort((left, right) => Math.abs(right.value) - Math.abs(left.value)),
      };
    });
  }, [allPerformanceItems, allQualityEvents, allRateEntries, allTasks, organizations, rateCardByKey, scopedProjectIds, scopedTeamMembers]);

  const filteredMetrics = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const filtered = memberMetrics.filter((metric) => {
      const matchesSearch = !search || [metric.member.name, metric.member.email, metric.member.roleName, metric.organizationLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
      const hasProjectActivity = activeSelectedProjectId === 'all' ||
        getWorkStatusCount(metric, 'all') > 0 ||
        metric.completedWorkItems.length > 0 ||
        metric.rateUnits !== 0 ||
        metric.qualityReviewed > 0;
      return hasProjectActivity && matchesSearch && (workStatusFilter === 'all' || getWorkStatusCount(metric, workStatusFilter) > 0);
    });

    return [...filtered].sort((left, right) => {
      if (sortMode === 'quality') return (right.qualityScore ?? -1) - (left.qualityScore ?? -1) || right.qualityReviewed - left.qualityReviewed;
      if (sortMode === 'rates') return Math.abs(right.rateValue) - Math.abs(left.rateValue);
      if (sortMode === 'workload') return right.openTasks - left.openTasks || right.overdueTasks - left.overdueTasks;
      if (sortMode === 'completed') return right.completedTasks - left.completedTasks || right.latestActivity - left.latestActivity;
      if (sortMode === 'active') return right.inProgressTasks - left.inProgressTasks || right.inHandTasks - left.inHandTasks;
      return compareRiskMetrics(left, right);
    });
  }, [activeSelectedProjectId, memberMetrics, searchTerm, sortMode, workStatusFilter]);

  const selectedMetric = useMemo(
    () => memberMetrics.find((metric) => metric.member.id === selectedMemberId) || null,
    [memberMetrics, selectedMemberId]
  );

  const selectedQualityActivity = useMemo(() => {
    if (!selectedMetric) return [];
    const seen = new Set<string>();
    return [...selectedMetric.qualityEvents, ...selectedMetric.reviewEvents]
      .filter((event) => {
        const key = `${event.projectId}-${event.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => getTime(right.createdAt) - getTime(left.createdAt))
      .slice(0, 8);
  }, [selectedMetric]);

  const selectedCompletedWorkItems = useMemo(() => {
    if (!selectedMetric) return [];
    return selectedMetric.completedWorkItems
      .filter((item) => completedWorkFilter === 'all' || item.type === completedWorkFilter)
      .slice(0, 50);
  }, [completedWorkFilter, selectedMetric]);

  const selectedOperationalTasks = useMemo(() => {
    if (!selectedMetric || workStatusFilter === 'completed') return [];
    return selectedMetric.operationalTasks.filter((row) => {
      if (workStatusFilter === 'all' || workStatusFilter === 'open') return true;
      if (workStatusFilter === 'in_hand') return row.inHand;
      if (workStatusFilter === 'pending') return !row.inHand || row.statusBucket === 'pending';
      if (workStatusFilter === 'active') return row.inHand && row.statusBucket === 'active';
      if (workStatusFilter === 'overdue') return row.inHand && row.scheduleState === 'overdue';
      if (workStatusFilter === 'blocked') return row.inHand && row.statusBucket === 'blocked';
      return true;
    });
  }, [selectedMetric, workStatusFilter]);

  const portfolioStats = useMemo(() => {
    const totalOpen = memberMetrics.reduce((sum, metric) => sum + metric.openTasks, 0);
    const totalInHand = memberMetrics.reduce((sum, metric) => sum + metric.inHandTasks, 0);
    const totalPending = memberMetrics.reduce((sum, metric) => sum + metric.pendingTasks, 0);
    const totalActive = memberMetrics.reduce((sum, metric) => sum + metric.inProgressTasks, 0);
    const totalOverdue = memberMetrics.reduce((sum, metric) => sum + metric.overdueTasks, 0);
    const totalCompleted = memberMetrics.reduce((sum, metric) => sum + metric.completedTasks, 0);
    const totalCompletedLate = memberMetrics.reduce((sum, metric) => sum + metric.completedLate, 0);

    return {
      totalOpen,
      totalInHand,
      totalPending,
      totalActive,
      totalOverdue,
      totalCompleted,
      totalCompletedLate,
    };
  }, [memberMetrics]);

  const handleOpenModal = (member?: any) => {
    if (!member || !canManagePeople) return;
    setEditingMember(member);
    setMemberName(member.name || '');
    setMemberEmail(member.email || '');
    setMemberRoleId(member.roleId || '');
    setIsModalOpen(true);
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberName.trim() || !memberEmail.trim() || !memberRoleId) return;

    const selectedRole = roles.find((role) => role.id === memberRoleId);
    if (!selectedRole || !editingMember) return;

    try {
      await updateDoc(doc(db, 'team_members', editingMember.id), {
        name: memberName.trim(),
        email: memberEmail.toLowerCase().trim(),
        roleId: memberRoleId,
        roleName: selectedRole.name,
      });
      toast.success('Profesional actualizado exitosamente.');
      setIsModalOpen(false);
      setEditingMember(null);
    } catch (error) {
      console.error('Error saving team member:', error);
      toast.error('Error al guardar el profesional.');
    }
  };

  if (!canAccessPerformance) {
    return (
      <DashboardLayout>
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-12 w-12 text-slate-300" />
          <h1 className="mt-4 text-2xl font-black text-slate-950">Acceso restringido</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium text-slate-500">
            Este tablero de rendimiento está disponible para coordinadores, gerentes y administradores de la organización.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded bg-indigo-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-indigo-700 ring-1 ring-indigo-100">
                <Sparkles size={14} />
                Inteligencia de equipo
              </div>
              <h1 className="text-3xl font-black tracking-tight text-slate-950">Rendimiento por profesional</h1>
              <p className="mt-2 text-base font-medium text-slate-500">
                Consulta qué tiene cada persona en su poder, qué está pendiente, vencido o finalizado y abre la tarea que origina cada indicador.
              </p>
            </div>
            {userRole === 'admin' && (
              <Link href="/settings">
                <Button className="h-12 shrink-0 bg-indigo-600 px-5 font-black text-white hover:bg-indigo-700">
                  <UserPlus className="h-4 w-4" />
                  Invitar Usuario
                </Button>
              </Link>
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard
            label="Profesionales"
            value={compactNumber(memberMetrics.length)}
            detail={`${compactNumber(scopedProjects.length)} proyectos en alcance`}
            icon={<Users size={20} />}
            tone="indigo"
          />
          <SummaryCard
            label="Trabajo abierto"
            value={compactNumber(portfolioStats.totalOpen)}
            detail={`${compactNumber(portfolioStats.totalPending)} pendiente`}
            icon={<Target size={20} />}
            tone="cyan"
          />
          <SummaryCard
            label="En poder"
            value={compactNumber(portfolioStats.totalInHand)}
            detail={`${compactNumber(portfolioStats.totalActive)} en curso`}
            icon={<BriefcaseBusiness size={20} />}
            tone="indigo"
          />
          <SummaryCard
            label="Vencidas"
            value={compactNumber(portfolioStats.totalOverdue)}
            detail="Actualmente en poder del equipo"
            icon={<AlertTriangle size={20} />}
            tone={portfolioStats.totalOverdue > 0 ? 'red' : 'emerald'}
          />
          <SummaryCard
            label="Finalizadas"
            value={compactNumber(portfolioStats.totalCompleted)}
            detail={`${compactNumber(portfolioStats.totalCompletedLate)} fuera de plazo`}
            icon={<CheckCircle2 size={20} />}
            tone="emerald"
          />
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedOrganizationId('all');
                  setSelectedProjectId('all');
                }}
                className={`inline-flex h-9 items-center gap-2 rounded border px-3 text-xs font-black uppercase tracking-[0.12em] transition ${
                  selectedOrganizationId === 'all'
                    ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50'
                }`}
              >
                Todas
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${selectedOrganizationId === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {teamMembers.length}
                </span>
              </button>
              {visibleOrganizations.map((organization) => {
                const orgMemberCount = teamMembers.filter((member) => belongsToAnyOrganization(member, [organization.id])).length;
                return (
                  <button
                    key={organization.id}
                    type="button"
                    onClick={() => {
                      setSelectedOrganizationId(organization.id);
                      setSelectedProjectId('all');
                    }}
                    className={`inline-flex h-9 items-center gap-2 rounded border px-3 text-xs font-black uppercase tracking-[0.12em] transition ${
                      selectedOrganizationId === organization.id
                        ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50'
                    }`}
                  >
                    {organization.name || 'Organización'}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${selectedOrganizationId === organization.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {orgMemberCount}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-2 md:grid-cols-[minmax(220px,0.8fr)_minmax(260px,1.2fr)_minmax(190px,0.7fr)]">
              <select
                value={activeSelectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              >
                <option value="all">Todos los proyectos ({organizationProjects.length})</option>
                {organizationProjects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name || 'Proyecto sin nombre'}</option>
                ))}
              </select>
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  placeholder="Buscar persona, correo o cargo..."
                />
              </div>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              >
                <option value="risk">Orden: mayor riesgo</option>
                <option value="workload">Orden: mayor carga</option>
                <option value="active">Orden: más en curso</option>
                <option value="completed">Orden: más finalizadas</option>
                <option value="quality">Orden: mejor calidad</option>
                <option value="rates">Orden: mayor producción</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {WORK_STATUS_OPTIONS.map((option) => {
                const count = memberMetrics.reduce((sum, metric) => sum + getWorkStatusCount(metric, option.value), 0);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setWorkStatusFilter(option.value)}
                    className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-black transition ${
                      workStatusFilter === option.value
                        ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-200 hover:bg-indigo-50'
                    }`}
                  >
                    {option.label}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${workStatusFilter === option.value ? 'bg-white/20 text-white' : 'bg-white text-slate-500'}`}>
                      {compactNumber(count)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-black tracking-tight text-slate-950">Profesionales</h2>
                <p className="text-sm font-medium text-slate-500">Vista comparativa de productividad, calidad y alertas por persona.</p>
              </div>
              <span className="rounded bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                {compactNumber(filteredMetrics.length)} visibles
              </span>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-14">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
            </div>
          ) : filteredMetrics.length === 0 ? (
            <div className="py-14 text-center">
              <Users className="mx-auto h-12 w-12 text-slate-300" />
              <h3 className="mt-3 text-lg font-black text-slate-950">No hay profesionales para mostrar</h3>
              <p className="mt-1 text-sm font-medium text-slate-500">Ajusta la búsqueda o revisa las organizaciones asignadas.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredMetrics.map((metric) => {
                const risk = getRiskTone(metric);
                const openMemberDetail = (filter: WorkStatusFilter) => {
                  setWorkStatusFilter(filter);
                  if (filter === 'completed') setCompletedWorkFilter('task');
                  setSelectedMemberId(metric.member.id);
                };
                return (
                  <div
                    key={metric.member.id}
                    onClick={() => setSelectedMemberId(metric.member.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedMemberId(metric.member.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`group grid cursor-pointer gap-3 border-l-4 px-5 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm focus-within:-translate-y-0.5 focus-within:shadow-sm lg:grid-cols-2 2xl:grid-cols-[minmax(250px,1.5fr)_repeat(6,minmax(86px,0.62fr))_auto] 2xl:items-center ${getRiskRowClass(metric)}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="transition duration-200 group-hover:scale-105 group-hover:drop-shadow-sm">
                        <Avatar member={metric.member} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-base font-black text-slate-950 transition-colors group-hover:text-indigo-700">{metric.member.name || metric.member.email || 'Usuario'}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Mail size={13} />
                            {metric.member.email || 'Sin correo'}
                          </span>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
                            {metric.member.roleName || 'Sin rol'}
                          </span>
                          <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${risk.className}`}>
                            {risk.label}
                          </span>
                        </div>
                      </div>
                    </div>

                    {[
                      { label: 'En poder', value: metric.inHandTasks, filter: 'in_hand' as WorkStatusFilter, tone: 'text-indigo-700' },
                      { label: 'Pendientes', value: metric.pendingTasks, filter: 'pending' as WorkStatusFilter, tone: 'text-slate-950' },
                      { label: 'En curso', value: metric.inProgressTasks, filter: 'active' as WorkStatusFilter, tone: 'text-cyan-700' },
                      { label: 'Vencidas', value: metric.overdueTasks, filter: 'overdue' as WorkStatusFilter, tone: metric.overdueTasks > 0 ? 'text-red-700' : 'text-emerald-700' },
                      { label: 'Finalizadas', value: metric.completedTasks, filter: 'completed' as WorkStatusFilter, tone: 'text-emerald-700' },
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openMemberDetail(item.filter);
                        }}
                        className="rounded-md border border-slate-100 bg-white/70 p-2 text-left transition hover:border-indigo-200 hover:bg-white hover:shadow-sm"
                      >
                        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{item.label}</p>
                        <p className={`mt-1 text-xl font-black ${item.tone}`}>{item.value}</p>
                      </button>
                    ))}

                    <div className="rounded-md border border-slate-100 bg-white/70 p-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Calidad</p>
                      <span className={`mt-1 inline-flex rounded px-2 py-1 text-sm font-black ring-1 ${getQualityTone(metric.qualityScore)}`}>
                        {metric.qualityScore == null ? 'Sin dato' : `${metric.qualityScore}%`}
                      </span>
                      <p className="mt-1 text-[11px] font-bold text-slate-500">{metric.qualityReviewed} revisiones</p>
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedMemberId(metric.member.id);
                        }}
                        className="h-9 border-slate-200 text-slate-600 transition-colors group-hover:border-indigo-200 group-hover:bg-white hover:bg-white"
                      >
                        <Eye size={14} />
                        Detalle
                      </Button>
                      {canManagePeople && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenModal(metric.member);
                          }}
                          className="rounded-md p-2 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                          title="Editar profesional"
                        >
                          <Edit2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {selectedMetric && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div className="flex min-w-0 items-center gap-4">
                <Avatar member={selectedMetric.member} size="lg" />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">Ficha de desempeño</p>
                  <h3 className="truncate text-2xl font-black tracking-tight text-slate-950">{selectedMetric.member.name || selectedMetric.member.email}</h3>
                  <p className="mt-1 text-sm font-bold text-slate-500">{selectedMetric.member.roleName || 'Sin rol'} · {selectedMetric.organizationLabel}</p>
                </div>
              </div>
              <button onClick={() => setSelectedMemberId(null)} className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <X size={22} />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard label="En poder" value={selectedMetric.inHandTasks} detail={`${selectedMetric.inProgressTasks} en curso`} icon={<BriefcaseBusiness size={20} />} tone="indigo" />
                <SummaryCard label="Pendientes" value={selectedMetric.pendingTasks} detail={`${selectedMetric.openTasks} abiertas en total`} icon={<Clock size={20} />} tone="orange" />
                <SummaryCard label="Vencidas" value={selectedMetric.overdueTasks} detail="En poder actualmente" icon={<AlertTriangle size={20} />} tone={selectedMetric.overdueTasks > 0 ? 'red' : 'emerald'} />
                <SummaryCard label="Finalizadas" value={selectedMetric.completedTasks} detail={`${selectedMetric.completedLate} fuera de plazo`} icon={<CheckCircle2 size={20} />} tone="emerald" />
              </div>

              <div className="mt-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                {WORK_STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setWorkStatusFilter(option.value)}
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-black transition ${
                      workStatusFilter === option.value
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700'
                    }`}
                  >
                    {option.label}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${workStatusFilter === option.value ? 'bg-white/20' : 'bg-slate-100'}`}>
                      {getWorkStatusCount(selectedMetric, option.value)}
                    </span>
                  </button>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-5">
                  {workStatusFilter !== 'completed' && <section className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="flex items-center gap-2 text-lg font-black text-slate-950">
                            <BriefcaseBusiness size={18} className="text-indigo-600" />
                            Trabajo actual
                          </h4>
                          <p className="mt-1 text-sm font-medium text-slate-500">Tareas en su poder o programadas para esta persona.</p>
                        </div>
                        <span className="rounded bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">
                          {selectedOperationalTasks.length} visibles
                        </span>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {selectedOperationalTasks.length === 0 ? (
                        <div className="p-6 text-center text-sm font-medium text-slate-500">No hay tareas abiertas para este filtro.</div>
                      ) : (
                        selectedOperationalTasks.map((row) => {
                          const { task, scheduleState: schedule } = row;
                          const scheduleClass =
                            schedule === 'overdue'
                              ? 'bg-red-50 text-red-700 ring-red-100'
                              : schedule === 'dueSoon'
                                ? 'bg-orange-50 text-orange-700 ring-orange-100'
                                : schedule === 'paused'
                                  ? 'bg-red-50 text-red-700 ring-red-100'
                                  : row.inHand
                                    ? 'bg-indigo-50 text-indigo-700 ring-indigo-100'
                                    : 'bg-slate-100 text-slate-700 ring-slate-200';
                          return (
                            <div key={row.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
                              <div className="min-w-0">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${scheduleClass}`}>
                                    {schedule === 'overdue' ? 'Vencida' : schedule === 'dueSoon' ? 'Por vencer' : schedule === 'paused' ? 'Bloqueada' : row.inHand ? 'En poder' : 'Programada'}
                                  </span>
                                  <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${getStatusClass(row.status)}`}>
                                    {getStatusLabel(row.status)}
                                  </span>
                                  {row.stepLabel && <span className="text-[11px] font-black text-slate-500">{row.stepLabel}</span>}
                                </div>
                                <p className="truncate text-sm font-black text-slate-950">{getTaskTitle(task)}</p>
                                <p className="text-xs font-bold text-slate-500">{task.projectName || 'Proyecto'} · Cierre {formatShortDate(row.dueDate)}</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="w-32">
                                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                    <div className="h-full rounded-full bg-indigo-600" style={{ width: `${row.progress}%` }} />
                                  </div>
                                  <p className="mt-1 text-right text-xs font-black text-slate-500">{row.progress}%</p>
                                </div>
                                <Link href={getTaskDeepLink(task.projectId, task.id)}>
                                  <Button variant="outline" size="sm" className="h-9 border-slate-200 text-slate-600">
                                    Abrir
                                    <ArrowRight size={14} />
                                  </Button>
                                </Link>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>}

                  {(workStatusFilter === 'all' || workStatusFilter === 'completed') && <section className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="flex items-center gap-2 text-lg font-black text-slate-950">
                            <CheckCircle2 size={18} className="text-emerald-600" />
                            Tareas y pasos realizados
                          </h4>
                          <p className="mt-1 text-sm font-medium text-slate-500">Historial de entregas con duración real y retraso atribuido.</p>
                        </div>
                        <div className="flex rounded-md bg-slate-100 p-1 text-xs font-black">
                          {[
                            ['all', 'Todo'],
                            ['task', 'Tareas'],
                            ['workflow_step', 'Pasos'],
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setCompletedWorkFilter(value as 'all' | 'task' | 'workflow_step')}
                              className={`rounded px-3 py-1.5 transition ${
                                completedWorkFilter === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {selectedCompletedWorkItems.length === 0 ? (
                        <div className="p-6 text-center text-sm font-medium text-slate-500">Aún no hay entregas registradas para este filtro.</div>
                      ) : (
                        selectedCompletedWorkItems.map((item) => {
                          const delayDays = Number(item.delayDays || 0);
                          return (
                            <Link
                              key={item.id}
                              href={getTaskDeepLink(item.projectId, item.taskId)}
                              className="grid gap-3 p-4 transition hover:bg-slate-50 md:grid-cols-[1fr_auto] md:items-center"
                            >
                              <div className="min-w-0">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${
                                    item.type === 'workflow_step'
                                      ? 'bg-indigo-50 text-indigo-700 ring-indigo-100'
                                      : 'bg-cyan-50 text-cyan-700 ring-cyan-100'
                                  }`}>
                                    {item.type === 'workflow_step' ? 'Paso workflow' : 'Tarea'}
                                  </span>
                                  <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${
                                    delayDays > 0 ? 'bg-orange-50 text-orange-700 ring-orange-100' : 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                                  }`}>
                                    {delayDays > 0 ? `${delayDays} d tarde` : 'A tiempo'}
                                  </span>
                                  {item.outcome === 'returned' && (
                                    <span className="rounded bg-red-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-700 ring-1 ring-red-100">
                                      Devuelto
                                    </span>
                                  )}
                                </div>
                                <p className="truncate text-sm font-black text-slate-950">
                                  {item.type === 'workflow_step' ? `${item.stepLabel || 'Paso'} · ${item.taskTitle || 'Tarea'}` : item.taskTitle || 'Tarea'}
                                </p>
                                <p className="text-xs font-bold text-slate-500">
                                  {item.projectName || 'Proyecto'}
                                  {item.municipality ? ` · ${item.municipality}` : ''}
                                  {' · '}
                                  Finalizó {formatShortDate(item.completedAt)}
                                </p>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-right text-xs font-black text-slate-600">
                                <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                                  <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Duración</p>
                                  <p className="mt-1 text-sm text-slate-950">{item.durationDays == null ? '--' : `${item.durationDays} d`}</p>
                                </div>
                                <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                                  <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Retraso</p>
                                  <p className={`mt-1 text-sm ${delayDays > 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{delayDays} d</p>
                                </div>
                              </div>
                            </Link>
                          );
                        })
                      )}
                    </div>
                  </section>}
                </div>

                <div className="space-y-5">
                  <section className="rounded-lg border border-slate-200 bg-white p-4">
                    <h4 className="flex items-center gap-2 text-lg font-black text-slate-950">
                      <Medal size={18} className="text-indigo-600" />
                      Calidad y revisión
                    </h4>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <Link
                        href={`/quality?memberId=${encodeURIComponent(selectedMetric.member.id)}&result=accepted`}
                        className="rounded-md bg-emerald-50 p-3 ring-1 ring-emerald-100 transition hover:-translate-y-0.5 hover:shadow-sm"
                      >
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">Aceptadas</p>
                        <p className="mt-1 text-xl font-black text-emerald-700">{selectedMetric.qualityAccepted}</p>
                      </Link>
                      <Link
                        href={`/quality?memberId=${encodeURIComponent(selectedMetric.member.id)}&result=rejected`}
                        className="rounded-md bg-red-50 p-3 ring-1 ring-red-100 transition hover:-translate-y-0.5 hover:shadow-sm"
                      >
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-red-700">Devueltas</p>
                        <p className="mt-1 text-xl font-black text-red-700">{selectedMetric.qualityRejected}</p>
                      </Link>
                      <Link
                        href={`/quality?reviewerId=${encodeURIComponent(selectedMetric.member.id)}`}
                        className="rounded-md bg-indigo-50 p-3 ring-1 ring-indigo-100 transition hover:-translate-y-0.5 hover:shadow-sm"
                      >
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-700">Revisó</p>
                        <p className="mt-1 text-xl font-black text-indigo-700">{selectedMetric.reviewerCount}</p>
                      </Link>
                    </div>
                    <div className="mt-4 space-y-2">
                      {selectedQualityActivity.length === 0 ? (
                        <p className="rounded-md bg-slate-50 p-3 text-xs font-bold text-slate-500">Sin eventos de calidad para abrir.</p>
                      ) : (
                        selectedQualityActivity.map((event) => (
                          <Link
                            key={`${event.projectId}-${event.id}`}
                            href={getQualityDeepLink(event)}
                            className={`block rounded-md border p-3 transition hover:-translate-y-0.5 hover:shadow-sm ${
                              event.result === 'accepted'
                                ? 'border-emerald-100 bg-emerald-50/60 hover:border-emerald-200'
                                : 'border-red-100 bg-red-50/60 hover:border-red-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                                event.result === 'accepted' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                              }`}>
                                {event.result === 'accepted' ? 'Tarea aceptada' : 'Devolución'}
                              </span>
                              <ArrowRight size={14} className={event.result === 'accepted' ? 'text-emerald-700' : 'text-red-700'} />
                            </div>
                            <p className="mt-2 line-clamp-1 text-xs font-black text-slate-900">{event.taskTitle || 'Tarea sin nombre'}</p>
                            <p className="mt-1 text-[11px] font-bold text-slate-500">
                              {event.projectName || 'Proyecto'} · {event.stepLabel || 'Control de calidad'}
                            </p>
                          </Link>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="rounded-lg border border-slate-200 bg-white p-4">
                    <h4 className="flex items-center gap-2 text-lg font-black text-slate-950">
                      <Layers3 size={18} className="text-indigo-600" />
                      Rate cards asociados
                    </h4>
                    <div className="mt-3 space-y-2">
                      {selectedMetric.rateSummaries.length === 0 ? (
                        <p className="rounded-md bg-slate-50 p-4 text-sm font-medium text-slate-500">Sin movimientos de rate cards.</p>
                      ) : (
                        selectedMetric.rateSummaries.slice(0, 6).map((row) => (
                          <div key={row.key} className="rounded-md border border-slate-100 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="min-w-0 truncate text-sm font-black text-slate-900">{row.name}</p>
                              <span className="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
                                {row.rateType === 'unit' ? row.unitLabel || 'unidades' : row.currency}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-between text-xs font-bold text-slate-500">
                              <span>{formatRateCardUnits(row.units, row)}</span>
                              <span>{formatRateCardValue(row.value, row)} resultado</span>
                            </div>
                            {row.reworkUnits > 0 && (
                              <p className="mt-1 text-xs font-bold text-orange-600">{formatRateCardUnits(row.reworkUnits, row)} en reproceso</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="rounded-lg border border-slate-200 bg-white p-4">
                    <h4 className="flex items-center gap-2 text-lg font-black text-slate-950">
                      <TimerReset size={18} className="text-indigo-600" />
                      Ritmo de entrega
                    </h4>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-100">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Tiempo medio</p>
                        <p className="mt-1 text-xl font-black text-slate-950">{selectedMetric.averageDays == null ? '--' : `${selectedMetric.averageDays} d`}</p>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-100">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Tarde</p>
                        <p className="mt-1 text-xl font-black text-slate-950">{selectedMetric.completedLate}</p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-950">Editar profesional</h3>
              <button onClick={() => setIsModalOpen(false)} className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveMember} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">Nombre completo *</label>
                <input
                  type="text"
                  required
                  value={memberName}
                  onChange={(event) => setMemberName(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">Correo electrónico *</label>
                <input
                  type="email"
                  required
                  value={memberEmail}
                  onChange={(event) => setMemberEmail(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">Cargo / rol *</label>
                <select
                  required
                  value={memberRoleId}
                  onChange={(event) => setMemberRoleId(event.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                >
                  <option value="" disabled>Selecciona un cargo</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)} className="border-slate-200 text-slate-700 hover:bg-slate-50">
                  Cancelar
                </Button>
                <Button type="submit" disabled={roles.length === 0} className="bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                  Guardar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
