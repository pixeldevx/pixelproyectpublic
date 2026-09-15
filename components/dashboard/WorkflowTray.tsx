'use client'

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { collection, query, where, onSnapshot, doc, arrayUnion, Timestamp, writeBatch, increment, getDoc, getDocs } from '@/lib/supabase/document-store';
import { db, auth } from '@/lib/backend';
import { CheckCircle2, MessageSquare, Clock, ArrowRight, ArrowLeft, Loader2, X, ClipboardList, Play, Pause, FolderOpen, ShieldCheck, FileText, ReceiptText, Eye, CalendarDays, Download, ExternalLink, MapPin, GitBranch, CornerDownRight, ChevronDown, ChevronRight, FileUp, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { TaskDocumentsViewer } from '@/components/projects/TaskDocumentsViewer';
import { TaskCommentsModal } from '@/components/projects/TaskCommentsModal';
import { CompleteSubtaskFormModal, SubtaskCompletionSubmission } from '@/components/projects/modals/CompleteSubtaskFormModal';
import { handleDataError, OperationType } from '@/lib/backend-utils';
import { toast } from 'sonner';
import {
  getCompletionStatusForTask,
  getProgressForTaskStatus,
  getRemainingScheduleDays,
  getResumedDueDate,
  isCompletedTaskStatus,
} from '@/lib/taskProgress';

import { useAuth } from '@/hooks/useAuth';
import { organizationNameFor } from '@/lib/organizations';
import { canLoadProjectForUser } from '@/lib/project-access';
import { notifyTaskAssignment } from '@/lib/notifications';
import {
  CONTRACTOR_ACCOUNT_ACTIVE_STATUSES,
  CONTRACTOR_ACCOUNT_STAGE_LABELS,
  getContractorAccountConfiguredApproverId,
  resolveContractorAccountApprovalConfig,
  type ContractorAccountStatus,
} from '@/lib/contractor-account-workflow';
import {
  getStaticRateCardAssignee,
  getStaticRateCardAssignmentKey,
  getStaticRateCardSources,
  isInvalidRateCardUnits,
  normalizeRateCardUnits,
} from '@/lib/rate-card-config';
import { syncRateDrivenIncrementalTasksForRate } from '@/lib/incremental-rate-tasks';
import { addTraceableRateCardMovementToBatch } from '@/lib/rate-card-trace';
import { getTaskDisplayTitle } from '@/lib/task-title';
import {
  SCRUM_WORK_STATUSES,
  getScrumExecutionMode,
  getScrumProgress,
  getScrumStatusLabel,
  isManualScrumTask,
  isScrumInboxEligible,
  isScrumTask,
  mapScrumStatusToTaskStatus,
  normalizeScrumStatus,
  type ScrumWorkStatus,
} from '@/lib/scrum';
import {
  createGoogleCalendarUrl,
  downloadMeetingIcs,
  getMeetingAgenda,
  getMeetingDescription,
  getMeetingLocation,
  getMeetingRecurrenceLabel,
  getMeetingScheduleLabel,
  isMeetingLocationUrl,
  isMeetingTask,
} from '@/lib/calendar-utils';
import { detectActionCandidates } from '@/lib/project-logbook/action-detection';
import {
  isDynamicWorkflowAssignee,
  isVariableWorkflowTaskType,
  isWorkflowTaskType,
  isActiveWorkflowStepStatus,
  resolveWorkflowActiveStepIndexes,
  resolveWorkflowNextStepIndexes,
  resolveWorkflowQualitySourceStepIndex,
  resolveWorkflowPreviousStepIndex,
} from '@/lib/workflow-routing';
import {
  collectWorkflowDocumentsFromHistory,
  getWorkflowDocumentDisplayName,
  isWorkflowDocumentValue,
  isWorkflowDocumentValueArray,
  uploadWorkflowFormDocument,
} from '@/lib/workflow-form-documents';
import { SecureDocumentLink } from '@/components/projects/SecureDocumentLink';

const hasRequiredFormValue = (value: any) => {
  if (isWorkflowDocumentValue(value)) return true;
  if (isWorkflowDocumentValueArray(value)) return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return true;
  return value !== undefined && value !== null && String(value).trim().length > 0;
};

const getMultiSelectValue = (value: any): string[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
};

const toggleMultiSelectValue = (value: any, option: string) => {
  const current = getMultiSelectValue(value);
  return current.includes(option)
    ? current.filter((item) => item !== option)
    : [...current, option];
};

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const getContractorAccountAdministrationHref = (projectId: unknown, accountId: unknown) =>
  `/projects/${encodeURIComponent(String(projectId || ''))}?tab=administration&workspace=contractorAccounts&contractorAccountId=${encodeURIComponent(String(accountId || ''))}`;

const formatFormValue = (value: any) => {
  if (isWorkflowDocumentValue(value)) return getWorkflowDocumentDisplayName(value);
  if (isWorkflowDocumentValueArray(value)) {
    return value.map(getWorkflowDocumentDisplayName).join(', ');
  }
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'Sin selección';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return value || 'Sin respuesta';
};

const formatDateTimeFormValue = (value: any) => {
  if (!value) return 'Sin respuesta';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value).replace('T', ' ');
  return format(parsed, "d MMM yyyy, h:mm a", { locale: es });
};

const renderHistoryFormValue = (value: any, field?: any) => {
  if (isWorkflowDocumentValueArray(value)) {
    return (
      <div className="space-y-2">
        {value.map((documentValue, index) => (
          <SecureDocumentLink
            key={`${documentValue.documentId || documentValue.storagePath || documentValue.url}-${index}`}
            storagePath={documentValue.storagePath}
            fallbackUrl={documentValue.url}
            className="flex min-w-0 items-center gap-2 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs font-bold text-indigo-700 shadow-sm hover:border-indigo-200 hover:text-indigo-900"
          >
            <FileText size={14} className="shrink-0" />
            <span className="min-w-0 truncate">{getWorkflowDocumentDisplayName(documentValue)}</span>
            <ExternalLink size={12} className="ml-auto shrink-0" />
          </SecureDocumentLink>
        ))}
      </div>
    );
  }

  if (isWorkflowDocumentValue(value)) {
    return (
      <SecureDocumentLink
        storagePath={value.storagePath}
        fallbackUrl={value.url}
        className="flex min-w-0 items-center gap-2 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs font-bold text-indigo-700 shadow-sm hover:border-indigo-200 hover:text-indigo-900"
      >
        <FileText size={14} className="shrink-0" />
        <span className="min-w-0 truncate">{getWorkflowDocumentDisplayName(value)}</span>
        <ExternalLink size={12} className="ml-auto shrink-0" />
      </SecureDocumentLink>
    );
  }

  const formattedValue =
    field?.type === 'datetime'
      ? formatDateTimeFormValue(value)
      : String(formatFormValue(value));
  const isUrl = /^https?:\/\//i.test(formattedValue.trim());

  if (isUrl) {
    return (
      <a
        href={formattedValue}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 break-all text-xs font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-2 [overflow-wrap:anywhere] hover:text-indigo-900"
      >
        {formattedValue}
      </a>
    );
  }

  return (
    <span className="min-w-0 whitespace-pre-wrap break-words text-xs font-bold text-slate-800 [overflow-wrap:anywhere]">
      {formattedValue}
    </span>
  );
};

const isWorkflowItem = (task: any) =>
  task?.trayItemType === 'workflow' || (isWorkflowTaskType(task?.type) && Array.isArray(task?.workflowSteps));

const isAssignedToCurrentUser = (task: any, assignedIds: string[]) => {
  if (task?.assignedTo && assignedIds.includes(task.assignedTo)) return true;
  if (Array.isArray(task?.assignedUsers) && task.assignedUsers.some((id: string) => assignedIds.includes(id))) return true;
  if (Array.isArray(task?.assignedTeamMembers) && task.assignedTeamMembers.some((id: string) => assignedIds.includes(id))) return true;
  return false;
};

const isOpenTask = (task: any) => {
  const status = task?.status || 'todo';
  return status !== 'completed' && status !== 'completed_late' && status !== 'listo';
};

const isContractorAccountInboxStatus = (status: string) =>
  CONTRACTOR_ACCOUNT_ACTIVE_STATUSES.includes(status as ContractorAccountStatus);

const normalizeActorIds = (ids: any[] = []) =>
  Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));

const addActorAliases = (target: string[], profile: any, documentId?: string) => {
  [
    documentId,
    profile?.id,
    profile?.authUserId,
    profile?.userId,
    profile?.uid,
    profile?.memberId,
    profile?.email,
  ].forEach((value) => {
    const normalized = String(value || '').trim();
    if (normalized) target.push(normalized);
  });
};

const matchesActor = (candidateValues: unknown[], actorIds: string[]) => {
  const actorKeys = new Set(actorIds.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  return candidateValues.some((value) => actorKeys.has(String(value || '').trim().toLowerCase()));
};

const getMeetingParticipantIds = (task: any) =>
  normalizeActorIds([
    task?.assignedTo,
    ...(Array.isArray(task?.assignedUsers) ? task.assignedUsers : []),
    ...(Array.isArray(task?.assignedTeamMembers) ? task.assignedTeamMembers : []),
    ...(Array.isArray(task?.meetingParticipantIds) ? task.meetingParticipantIds : []),
    ...(Array.isArray(task?.meeting?.participantIds) ? task.meeting.participantIds : []),
    ...(Array.isArray(task?.meeting?.attendeeIds) ? task.meeting.attendeeIds : []),
  ]);

const meetingResponseMatchesActor = (response: any, actorIds: any[]) => {
  const ids = normalizeActorIds(actorIds);
  if (ids.length === 0) return false;

  return (
    ids.includes(response?.participantId) ||
    ids.includes(response?.userId) ||
    ids.includes(response?.memberId) ||
    (Array.isArray(response?.userIds) && response.userIds.some((id: string) => ids.includes(id)))
  );
};

const hasMeetingResponseForUser = (task: any, actorIds: any[]) => {
  const responses = Array.isArray(task?.meetingResponses) ? task.meetingResponses : [];
  return responses.some((response: any) => meetingResponseMatchesActor(response, actorIds));
};

const getMeetingParticipantIdForActor = (task: any, actorIds: any[]) => {
  const ids = normalizeActorIds(actorIds);
  const participantIds = getMeetingParticipantIds(task);
  return ids.find((id) => participantIds.includes(id)) || participantIds[0] || ids[0] || '';
};

const getMeetingParticipantName = (task: any, participantId: string, fallback = 'Participante') => {
  const attendees = Array.isArray(task?.meeting?.attendees) ? task.meeting.attendees : [];
  const attendee = attendees.find((candidate: any) => candidate?.id === participantId);
  return attendee?.name || attendee?.email || fallback;
};

const buildMeetingLogbookContent = (task: any, responses: any[]) => {
  const responseLines = responses
    .map((response: any, index: number) => {
      const participantName = response.participantName || response.userName || getMeetingParticipantName(task, response.participantId, `Participante ${index + 1}`);
      return `${index + 1}. ${participantName}: ${response.comment || 'Sin comentario'}`;
    })
    .join('\n');

  return [
    `Se cerró la reunión "${task?.title || task?.name || 'Reunión'}".`,
    `Proyecto: ${task?.projectName || 'Proyecto'}.`,
    `Horario: ${getMeetingScheduleLabel(task)}.`,
    task?.meeting?.location ? `Lugar o enlace: ${task.meeting.location}.` : '',
    task?.meeting?.agenda ? `Agenda: ${task.meeting.agenda}` : '',
    '',
    'Comentarios de participantes:',
    responseLines || 'Sin comentarios registrados.',
  ].filter((line) => line !== '').join('\n');
};

const hasWorkflowReviewForUser = (task: any, actorIds: any[]) => {
  const ids = normalizeActorIds(actorIds);
  if (ids.length === 0) return false;

  const reviewedByIds = Array.isArray(task?.reviewedByIds) ? task.reviewedByIds : [];
  if (reviewedByIds.some((id: string) => ids.includes(id))) return true;

  const reviewReceipts = Array.isArray(task?.workflowReviewReceipts) ? task.workflowReviewReceipts : [];
  if (
    reviewReceipts.some((receipt: any) =>
      ids.includes(receipt?.userId) ||
      ids.includes(receipt?.memberId) ||
      (Array.isArray(receipt?.userIds) && receipt.userIds.some((id: string) => ids.includes(id)))
    )
  ) {
    return true;
  }

  return Boolean(task?.workflowHistory?.some((history: any) => ids.includes(history?.userId) || ids.includes(history?.memberId)));
};

const hasAssignedTaskReviewForUser = (task: any, actorIds: any[]) => {
  const ids = normalizeActorIds(actorIds);
  if (ids.length === 0 || !isCompletedTaskStatus(task?.status)) return false;

  const reviewedByIds = Array.isArray(task?.reviewedByIds) ? task.reviewedByIds : [];
  if (reviewedByIds.some((id: string) => ids.includes(id))) return true;

  const reviewReceipts = Array.isArray(task?.taskReviewReceipts) ? task.taskReviewReceipts : [];
  if (
    reviewReceipts.some((receipt: any) =>
      ids.includes(receipt?.userId) ||
      ids.includes(receipt?.memberId) ||
      (Array.isArray(receipt?.userIds) && receipt.userIds.some((id: string) => ids.includes(id)))
    )
  ) {
    return true;
  }

  const statusHistory = Array.isArray(task?.statusHistory) ? task.statusHistory : [];
  return statusHistory.some((entry: any) =>
    isCompletedTaskStatus(entry?.status) &&
    (
      ids.includes(entry?.changedBy) ||
      ids.includes(entry?.memberId) ||
      (Array.isArray(entry?.userIds) && entry.userIds.some((id: string) => ids.includes(id)))
    )
  );
};

const getTaskStatusLabel = (status: string) => {
  switch (status) {
    case 'completed':
      return 'Finalizada';
    case 'completed_late':
      return 'Finalizada con retraso';
    case 'in_progress':
      return 'Trabajando';
    case 'stuck':
      return 'Estancada';
    case 'rescheduled':
      return 'Reprogramada';
    case 'pending':
    case 'todo':
      return 'Pendiente';
    default:
      return status || 'Pendiente';
  }
};

const getTaskStatusClass = (status: string) => {
  switch (status) {
    case 'completed':
      return 'bg-emerald-50 text-emerald-700';
    case 'completed_late':
      return 'bg-orange-50 text-orange-700';
    case 'in_progress':
      return 'bg-amber-50 text-amber-700';
    case 'stuck':
      return 'bg-red-50 text-red-700';
    case 'rescheduled':
      return 'bg-indigo-50 text-indigo-700';
    case 'pending':
    case 'todo':
      return 'bg-slate-100 text-slate-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
};

const getTaskDate = (value: any) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateInputValue = (value: any) => {
  const date = getTaskDate(value);
  if (!date) return '';
  return format(date, 'yyyy-MM-dd');
};

const parseDateInputValue = (value: string) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toHistoryDateValue = (value: any) => {
  const date = getTaskDate(value);
  return date ? format(date, 'yyyy-MM-dd') : null;
};

const getTaskTimestamp = (value: any) => {
  const date = getTaskDate(value);
  return date ? date.getTime() : 0;
};

const getInboxTaskTitle = (task: any) => getTaskDisplayTitle(task, 'Tarea sin nombre');

const isFormDataRecord = (value: any) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const getWorkflowStepFormData = (task: any, currentStep: any, stepIndex: number) => {
  if (isFormDataRecord(currentStep?.formData) && Object.keys(currentStep.formData).length > 0) {
    return { ...currentStep.formData };
  }

  const latestHistoryWithForm = [...(task?.workflowHistory || [])]
    .filter((history: any) =>
      history?.stepIndex === stepIndex &&
      history?.action === 'approve' &&
      isFormDataRecord(history?.formData) &&
      Object.keys(history.formData).length > 0
    )
    .sort((left: any, right: any) => getTaskTimestamp(right.timestamp) - getTaskTimestamp(left.timestamp))[0];

  return latestHistoryWithForm?.formData ? { ...latestHistoryWithForm.formData } : {};
};

const normalizeCompletionStatus = (nextStatus: string, task: any) => {
  return getCompletionStatusForTask(nextStatus, task);
};

const toIsoString = (value: any) => {
  const date = getTaskDate(value);
  return date ? date.toISOString() : null;
};

const startOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const getDelayDays = (plannedEndValue: any, completedAt: Date) => {
  const plannedEnd = getTaskDate(plannedEndValue);
  if (!plannedEnd) return 0;
  const delay = startOfLocalDay(completedAt) - startOfLocalDay(plannedEnd);
  return delay > 0 ? Math.ceil(delay / 86400000) : 0;
};

const getDurationDays = (startedAtValue: any, completedAt: Date) => {
  const startedAt = getTaskDate(startedAtValue);
  if (!startedAt) return null;
  const days = Math.max(0, (completedAt.getTime() - startedAt.getTime()) / 86400000);
  return Math.round(days * 10) / 10;
};

const getWorkflowStepPlannedStart = (task: any, step: any) =>
  step?.plannedStartAt ||
  step?.plannedStartDate ||
  step?.startDate ||
  step?.start ||
  task?.startDate ||
  task?.start ||
  task?.createdAt ||
  null;

const getWorkflowStepPlannedEnd = (task: any, step: any) =>
  step?.plannedEndAt ||
  step?.plannedEndDate ||
  step?.endDate ||
  step?.end ||
  step?.dueDate ||
  task?.endDate ||
  task?.end ||
  task?.dueDate ||
  null;

const getWorkflowStepStartedAt = (task: any, step: any) =>
  step?.startedAt || step?.restartedAt || getWorkflowStepPlannedStart(task, step) || task?.createdAt || null;

const getTaskPerformanceStartedAt = (task: any) =>
  task?.startedAt || task?.startDate || task?.start || task?.createdAt || null;

const getTaskPerformancePlannedEnd = (task: any) =>
  task?.endDate || task?.end || task?.dueDate || null;

const getPerformanceAssigneeId = (candidate: any, fallback?: string | null) => {
  const value = candidate?.assignedTo || candidate?.assignedTeamMembers?.[0] || candidate?.assignedUsers?.[0] || fallback || null;
  return value && value !== 'DYNAMIC' ? value : fallback || null;
};

const buildWorkflowStepPerformanceEntry = ({
  task,
  step,
  stepIndex,
  action,
  completedAt,
  user,
  memberId,
  actorIds,
}: {
  task: any;
  step: any;
  stepIndex: number;
  action: string;
  completedAt: Date;
  user: any;
  memberId: string | null;
  actorIds: string[];
}) => {
  const plannedStart = getWorkflowStepPlannedStart(task, step);
  const plannedEnd = getWorkflowStepPlannedEnd(task, step);
  const startedAt = getWorkflowStepStartedAt(task, step);
  const assigneeId = getPerformanceAssigneeId(step, memberId || user?.uid);
  const delayDays = getDelayDays(plannedEnd, completedAt);

  return {
    id: `${task.id}-workflow-step-${stepIndex}-${action}-${completedAt.getTime()}`,
    type: 'workflow_step',
    source: 'workflow_tray',
    projectId: task.projectId,
    projectName: task.projectName || null,
    organizationId: task.organizationId || null,
    taskId: task.id,
    taskTitle: task.title || task.name || 'Tarea',
    externalWorkflowId: task.externalWorkflowId || null,
    department: task.workflowDepartment || task.department || null,
    municipality: task.workflowMunicipality || task.municipality || null,
    stepIndex,
    stepLabel: step?.label || `Paso ${stepIndex + 1}`,
    action,
    outcome: action === 'approve' ? 'completed' : action === 'return' ? 'returned' : action,
    assigneeId,
    userId: user?.uid || null,
    memberId,
    userIds: actorIds,
    userName: user?.displayName || user?.email || 'Usuario',
    startedAt: toIsoString(startedAt),
    plannedStartAt: toIsoString(plannedStart),
    plannedEndAt: toIsoString(plannedEnd),
    completedAt: completedAt.toISOString(),
    durationDays: getDurationDays(startedAt, completedAt),
    delayDays,
    completedLate: delayDays > 0,
    ...getDateKeys(completedAt),
  };
};

const buildTaskPerformanceEntry = ({
  task,
  status,
  completedAt,
  user,
  memberId,
  actorIds,
}: {
  task: any;
  status: string;
  completedAt: Date;
  user: any;
  memberId: string | null;
  actorIds: string[];
}) => {
  const startedAt = getTaskPerformanceStartedAt(task);
  const plannedEnd = getTaskPerformancePlannedEnd(task);
  const delayDays = getDelayDays(plannedEnd, completedAt);

  return {
    id: `${task.id}-task-${status}-${completedAt.getTime()}`,
    type: 'task',
    source: 'inbox_status',
    projectId: task.projectId,
    projectName: task.projectName || null,
    organizationId: task.organizationId || null,
    taskId: task.id,
    taskTitle: task.title || task.name || 'Tarea',
    status,
    outcome: 'completed',
    assigneeId: getPerformanceAssigneeId(task, memberId || user?.uid),
    userId: user?.uid || null,
    memberId,
    userIds: actorIds,
    userName: user?.displayName || user?.email || 'Usuario',
    startedAt: toIsoString(startedAt),
    plannedStartAt: toIsoString(task?.startDate || task?.start || task?.createdAt),
    plannedEndAt: toIsoString(plannedEnd),
    completedAt: completedAt.toISOString(),
    durationDays: getDurationDays(startedAt, completedAt),
    delayDays,
    completedLate: delayDays > 0,
    ...getDateKeys(completedAt),
  };
};

const isDynamicRateCardEnabled = (source: any) =>
  Boolean(source?.dynamicRateCard || source?.rateCardMode === 'dynamic' || source?.dynamicRateCardConfig);

const getTaskCompletionForm = (task: any) =>
  task?.completionForm || task?.subtaskCompletionForm || null;

const taskHasCompletionForm = (task: any) => {
  const form = getTaskCompletionForm(task);
  if (!form) return false;

  return Boolean(
    (Array.isArray(form.fields) && form.fields.length > 0) ||
    (Array.isArray(form.rateCards) && form.rateCards.length > 0) ||
    form.rateCardId ||
    form.dynamicRateCard ||
    form.rateCardMode === 'dynamic' ||
    form.dynamicRateCardConfig
  );
};

const taskShouldAskCompletionForm = (task: any) =>
  Boolean(task?.parentTaskId && taskHasCompletionForm(task));

const getDynamicRateCardUnits = (source: any) =>
  normalizeRateCardUnits(source?.dynamicRateCardConfig?.defaultUnits ?? source?.unitsToAdd);

const shouldRequestDynamicRateCardUnits = (source: any) =>
  source?.autoAddUnits === false || source?.dynamicRateCardConfig?.promptForUnits === true;

const applyRuntimeStaticRateCardAssigneesToStep = (
  step: any,
  assigneesByKey: Record<string, string>
) => {
  if (!step) return step;
  let updatedStep = { ...step };
  const sources = getStaticRateCardSources(updatedStep).filter((source) => source.assigneeMode === 'runtime');

  sources.forEach((source) => {
    const assignedTo = assigneesByKey[source.key];
    if (!assignedTo) return;

    if (source.source === 'form') {
      if (typeof source.itemIndex === 'number' && Array.isArray(updatedStep.form?.rateCards)) {
        updatedStep = {
          ...updatedStep,
          form: {
            ...updatedStep.form,
            rateCards: updatedStep.form.rateCards.map((item: any, itemIndex: number) =>
              itemIndex === source.itemIndex ? { ...item, assignedTo } : item
            ),
          },
        };
      } else if (updatedStep.form) {
        updatedStep = { ...updatedStep, form: { ...updatedStep.form, assignedTo } };
      }
      return;
    }

    if (typeof source.itemIndex === 'number' && Array.isArray(updatedStep.rateCards)) {
      updatedStep = {
        ...updatedStep,
        rateCards: updatedStep.rateCards.map((item: any, itemIndex: number) =>
          itemIndex === source.itemIndex ? { ...item, assignedTo } : item
        ),
      };
    } else {
      updatedStep = { ...updatedStep, assignedTo };
    }
  });

  return updatedStep;
};

const getDateKeys = (date = new Date()) => {
  const year = date.getFullYear();
  const dateKey = date.toISOString().slice(0, 10);
  const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const startOfYear = new Date(year, 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000) + 1;
  const weekKey = `${year}-W${String(Math.ceil(dayOfYear / 7)).padStart(2, '0')}`;

  return { dateKey, weekKey, monthKey };
};

const getWorkflowDynamicRateCardSource = (task: any, action: string) => {
  const currentIndex = task?.currentStepIndex || 0;
  const currentStep = task?.workflowSteps?.[currentIndex];

  if ((action === 'approve' || action === 'return') && isDynamicRateCardEnabled(currentStep)) {
    return {
      source: 'workflow_step',
      sourceConfig: currentStep,
      stepIndex: currentIndex,
    };
  }

  if ((action === 'approve' || action === 'return') && isDynamicRateCardEnabled(currentStep?.form)) {
    return {
      source: 'workflow_form',
      sourceConfig: currentStep.form,
      stepIndex: currentIndex,
    };
  }

  if (
    action === 'approve' &&
    Array.isArray(task?.workflowSteps) &&
    currentIndex === task.workflowSteps.length - 1 &&
    isDynamicRateCardEnabled(task)
  ) {
    return {
      source: 'workflow_task',
      sourceConfig: task,
      stepIndex: currentIndex,
    };
  }

  return null;
};

const isQualityGateStep = (step: any) =>
  Boolean(step?.isQualityGate || step?.type === 'quality_gate' || step?.taskType === 'quality_gate');

const getWorkflowCurrentStepIndexForActor = (task: any, actorIds: string[] = []) => {
  const steps = Array.isArray(task?.workflowSteps) ? task.workflowSteps : [];
  if (steps.length === 0) return Number(task?.currentStepIndex) || 0;

  const boundedStoredIndex = Math.min(
    Math.max(0, Number(task?.currentStepIndex) || 0),
    steps.length - 1
  );
  const activeStepIndexes = resolveWorkflowActiveStepIndexes({ steps });
  const actorActiveIndex = activeStepIndexes.find((stepIndex) => {
    const assignee = steps[stepIndex]?.assignedTo;
    return assignee && actorIds.includes(assignee);
  });

  if (typeof actorActiveIndex === 'number') return actorActiveIndex;
  return activeStepIndexes[0] ?? boundedStoredIndex;
};

const getQualityParticipantIds = (
  task: any,
  currentIndex: number,
  currentStep: any,
  reviewerId: string | null,
  userId?: string,
  sourceStepIndex?: number | null
) => {
  const previousStep =
    typeof sourceStepIndex === 'number'
      ? task.workflowSteps?.[sourceStepIndex]
      : currentIndex > 0
        ? task.workflowSteps?.[currentIndex - 1]
        : null;
  const professionalId =
    previousStep?.completedByMemberId ||
    (Array.isArray(previousStep?.completedByIds) ? previousStep.completedByIds.find(Boolean) : null) ||
    previousStep?.completedBy ||
    previousStep?.startedByMemberId ||
    (previousStep?.assignedTo && !isDynamicWorkflowAssignee(previousStep.assignedTo) ? previousStep.assignedTo : null) ||
    task.assignedTo ||
    task.assignedTeamMembers?.[0] ||
    task.assignedUsers?.[0] ||
    userId ||
    null;

  const qualityReviewerId =
    reviewerId ||
    userId ||
    (currentStep?.assignedTo && !isDynamicWorkflowAssignee(currentStep.assignedTo) ? currentStep.assignedTo : null) ||
    null;

  return { professionalId, reviewerId: qualityReviewerId };
};

const getDueState = (task: any) => {
  const status = task?.status || 'todo';
  if (status === 'completed' || status === 'completed_late' || status === 'listo') return 'closed';
  if (status === 'stuck' || status === 'detenido') return 'paused';

  const endDate = getTaskDate(task?.endDate || task?.end);
  if (!endDate) return 'none';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endOfDay = new Date(endDate);
  endOfDay.setHours(23, 59, 59, 999);

  if (endOfDay.getTime() < today.getTime()) return 'overdue';

  const msUntilDue = endOfDay.getTime() - Date.now();
  return msUntilDue <= 2 * 24 * 60 * 60 * 1000 ? 'due_soon' : 'ok';
};

const getInboxDueSortTime = (task: any) => {
  const endDate = getTaskDate(task?.endDate || task?.end);
  if (!endDate) return Number.POSITIVE_INFINITY;

  return endDate.getTime();
};

const getInboxUrgencyStyles = (dueState: string) => {
  switch (dueState) {
    case 'overdue':
      return {
        row: 'border-red-200 bg-red-50 hover:bg-red-100/80',
        rail: 'bg-red-600',
        due: 'bg-red-600 text-white shadow-sm',
        text: 'text-red-700',
        progress: 'bg-red-600',
      };
    case 'due_soon':
      return {
        row: 'border-orange-200 bg-orange-50 hover:bg-orange-100/80',
        rail: 'bg-orange-500',
        due: 'bg-orange-500 text-white shadow-sm',
        text: 'text-orange-700',
        progress: 'bg-orange-500',
      };
    case 'ok':
      return {
        row: 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70',
        rail: 'bg-emerald-500',
        due: 'bg-emerald-100 text-emerald-700',
        text: 'text-emerald-700',
        progress: 'bg-emerald-500',
      };
    case 'paused':
      return {
        row: 'border-red-200 bg-red-50/70 hover:bg-red-100/70',
        rail: 'bg-red-600',
        due: 'bg-red-100 text-red-700',
        text: 'text-red-700',
        progress: 'bg-red-600',
      };
    default:
      return {
        row: 'border-slate-200 bg-white hover:bg-slate-50',
        rail: 'bg-slate-300',
        due: 'bg-slate-100 text-slate-600',
        text: 'text-slate-500',
        progress: 'bg-indigo-600',
      };
  }
};

const getDueLabel = (dueState: string) => {
  if (dueState === 'overdue') return 'Vencida';
  if (dueState === 'due_soon') return 'Por vencer';
  if (dueState === 'paused') return 'Pausada';
  return 'En fecha';
};

const getPriorityLabel = (priority: string) => {
  if (priority === 'high') return 'Alta';
  if (priority === 'low') return 'Baja';
  return 'Media';
};

const getPriorityClass = (priority: string) => {
  if (priority === 'high') return 'bg-red-600 text-white shadow-sm ring-1 ring-red-700/20';
  if (priority === 'low') return 'bg-slate-100 text-slate-600';
  return 'bg-amber-100 text-amber-800';
};

const getInboxTaskTypeMeta = (task: any, forceWorkflow = false) => {
  if (forceWorkflow || isWorkflowItem(task)) {
    return {
      label: 'Workflow',
      Icon: GitBranch,
      className: 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-indigo-100',
    };
  }

  if (isScrumTask(task)) {
    const executionMode = getScrumExecutionMode(task);
    return executionMode === 'manual'
      ? {
          label: 'Scrum · Manual',
          Icon: Inbox,
          className: 'border-cyan-200 bg-cyan-50 text-cyan-800 shadow-cyan-100',
        }
      : {
          label: 'Scrum · GitHub',
          Icon: GitBranch,
          className: 'border-violet-200 bg-violet-50 text-violet-700 shadow-violet-100',
        };
  }

  if (isMeetingTask(task)) {
    return {
      label: 'Reunión',
      Icon: CalendarDays,
      className: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 shadow-fuchsia-100',
    };
  }

  if (task?.parentTaskId) {
    return {
      label: 'Subtarea',
      Icon: CornerDownRight,
      className: 'border-amber-200 bg-amber-50 text-amber-700 shadow-amber-100',
    };
  }

  return {
    label: 'Tarea',
    Icon: ClipboardList,
    className: 'border-sky-200 bg-sky-50 text-sky-700 shadow-sky-100',
  };
};

const getWorkflowAttentionBadge = (status: string) => {
  if (status === 'detenido') {
    return {
      label: 'Detenido',
      className: 'border-orange-200 bg-orange-50 text-orange-700',
    };
  }

  if (status === 'devuelto' || status === 'returned') {
    return {
      label: 'Devuelto',
      className: 'border-red-200 bg-red-50 text-red-700',
    };
  }

  return null;
};

const renderInboxTaskTypeBadge = (task: any, forceWorkflow = false) => {
  const meta = getInboxTaskTypeMeta(task, forceWorkflow);
  const Icon = meta.Icon;

  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider shadow-sm ${meta.className}`}>
      <Icon size={11} strokeWidth={2.5} />
      {meta.label}
    </span>
  );
};

const getWorkflowStepStatusLabel = (status: string) => {
  switch (status) {
    case 'listo':
      return 'Listo';
    case 'en_curso':
      return 'En curso';
    case 'devuelto':
    case 'returned':
      return 'Devuelto';
    case 'detenido':
      return 'Detenido';
    default:
      return 'Pendiente';
  }
};

const getWorkflowStepStatusClass = (status: string) => {
  switch (status) {
    case 'listo':
      return 'bg-emerald-100 text-emerald-700';
    case 'en_curso':
      return 'bg-indigo-100 text-indigo-700';
    case 'devuelto':
    case 'returned':
      return 'bg-red-100 text-red-700';
    case 'detenido':
      return 'bg-orange-100 text-orange-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
};

export default function WorkflowTray() {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'reviewed'>('pending');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const managedOrganizationIds = React.useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );
  
  const [actionModal, setActionModal] = useState<{ isOpen: boolean, task: any, type: 'approve' | 'return' | 'stop' | 'resume' }>({ isOpen: false, task: null, type: 'approve' });
  const [staticRateCardUnits, setStaticRateCardUnits] = useState<Record<string, string>>({});
  const [staticRateCardAssignees, setStaticRateCardAssignees] = useState<Record<string, string>>({});
  const [actionComment, setActionComment] = useState('');
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [workflowDocumentFiles, setWorkflowDocumentFiles] = useState<Record<string, File[]>>({});
  const [nextStepAssignee, setNextStepAssignee] = useState<string>('');
  const [currentMemberProfiles, setCurrentMemberProfiles] = useState<any[]>([]);
  const [projectTeamMembers, setProjectTeamMembers] = useState<any[]>([]);
  const [projectRateCards, setProjectRateCards] = useState<any[]>([]);
  const [projectQualityCauses, setProjectQualityCauses] = useState<any[]>([]);
  const [qualityCauseIds, setQualityCauseIds] = useState<string[]>([]);
  const [qualityApprovalMode, setQualityApprovalMode] = useState<'accepted' | 'accepted_with_observations'>('accepted');
  const [qualityObservationComment, setQualityObservationComment] = useState('');
  const [dynamicRateCardAssignee, setDynamicRateCardAssignee] = useState('');
  const [dynamicRateCardId, setDynamicRateCardId] = useState('');
  const [dynamicRateCardUnits, setDynamicRateCardUnits] = useState('1');
  const [dynamicRateCardModal, setDynamicRateCardModal] = useState<{
    isOpen: boolean;
    task: any;
    nextStatus: string;
  }>({ isOpen: false, task: null, nextStatus: 'completed' });
  const [completionFormModal, setCompletionFormModal] = useState<{
    isOpen: boolean;
    task: any;
    nextStatus: string;
  }>({ isOpen: false, task: null, nextStatus: 'completed' });
  const [dynamicRateCardComment, setDynamicRateCardComment] = useState('');
  const [meetingCompletionModal, setMeetingCompletionModal] = useState<{
    isOpen: boolean;
    task: any;
    nextStatus: string;
  }>({ isOpen: false, task: null, nextStatus: 'completed' });
  const [meetingCompletionComment, setMeetingCompletionComment] = useState('');
  const [pauseTaskModal, setPauseTaskModal] = useState<{ isOpen: boolean; task: any }>({ isOpen: false, task: null });
  const [pauseReason, setPauseReason] = useState('');
  const [rescheduleTaskModal, setRescheduleTaskModal] = useState<{ isOpen: boolean; task: any }>({ isOpen: false, task: null });
  const [rescheduleStartDate, setRescheduleStartDate] = useState('');
  const [rescheduleEndDate, setRescheduleEndDate] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [docsModalTask, setDocsModalTask] = useState<any>(null);
  const [detailsModalTask, setDetailsModalTask] = useState<any>(null);
  const [historyModalTask, setHistoryModalTask] = useState<any>(null);
  const [commentsModalTask, setCommentsModalTask] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortFilter, setSortFilter] = useState('newest');
  const [collapsedInboxGroups, setCollapsedInboxGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedProjectId = params.get('projectId');
    const linkedTaskId = params.get('taskId');
    if (linkedProjectId) {
      setProjectFilter(linkedProjectId);
    }
    if (linkedTaskId) {
      setSearchTerm(linkedTaskId);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, 'organizations')), (snapshot) => {
      setOrganizations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let unsubscribeProjects: (() => void) | null = null;
    let taskUnsubscribes: (() => void)[] = [];
    const projectTaskItems = new Map<string, any[]>();
    const projectAdministrativeItems = new Map<string, any[]>();

    const publishProjectItems = (projectId: string) => {
      const projectItems = [
        ...(projectTaskItems.get(projectId) || []),
        ...(projectAdministrativeItems.get(projectId) || []),
      ];
      setWorkflows((current) => {
        const otherProjects = current.filter((item) => item.projectId !== projectId);
        return [...otherProjects, ...projectItems];
      });
    };

    const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setWorkflows([]);
        setCurrentMemberProfiles([]);
        setMemberId(null);
        setMemberIds([]);
        setLoading(false);
        return;
      }

      // First, get the current user's team_member ID
      const fetchUserTeamMemberId = async () => {
        try {
          const { getDocs } = await import('@/lib/supabase/document-store');
          const qTeam = query(collection(db, 'team_members'), where('email', '==', user.email));
          const querySnapshot = await getDocs(qTeam);
          
          let mId = user.uid; // Fallback to uid (e.g., for admin)
          const allMemberIds = [user.uid, user.email].filter(Boolean) as string[];
          const currentProfiles = querySnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
          if (!querySnapshot.empty) {
            mId = querySnapshot.docs[0].id;
            querySnapshot.docs.forEach((docSnap) => {
              addActorAliases(allMemberIds, docSnap.data(), docSnap.id);
            });
          }
          const normalizedMemberIds = normalizeActorIds(allMemberIds);
          setCurrentMemberProfiles(currentProfiles);
          setMemberId(mId || null);
          setMemberIds(normalizedMemberIds);

          // Now fetch projects and tasks
          const q = query(
            collection(db, 'projects'),
          );

          unsubscribeProjects = onSnapshot(q, (snapshot) => {
            const projectDocs = snapshot.docs
              .map(doc => ({ id: doc.id, ...doc.data() }))
              .filter((project) => {
                const canLoadNormally = canLoadProjectForUser(project, {
                  assignedIds: normalizedMemberIds,
                  managedOrganizationIds,
                  userId: user.uid,
                  userRole,
                });
                if (canLoadNormally) return true;

                const projectOrganizationIds = [project.organizationId, ...(project.organizationIds || [])].filter(Boolean);
                const organization = organizations.find((candidate) => projectOrganizationIds.includes(candidate.id));
                const projectConfig = project.contractorAccountApprovalConfig || {};
                const approvalConfig = resolveContractorAccountApprovalConfig(
                  projectConfig,
                  organization?.contractorAccountApprovalConfig
                );
                return Object.values(approvalConfig).some((value) => matchesActor([value], normalizedMemberIds));
              });
            const projectsById = new Map(projectDocs.map((project) => [project.id, project]));
            const projectIds = projectDocs.map(project => project.id);
            const activeProjectIds = new Set(projectIds);
            setWorkflows((current) => current.filter((item) => activeProjectIds.has(item.projectId)));
            
            let projectsProcessed = 0;

            // Clean up previous task listeners if projects change
            taskUnsubscribes.forEach(unsub => unsub());
            taskUnsubscribes = [];
            projectTaskItems.clear();
            projectAdministrativeItems.clear();

            if (projectIds.length === 0) {
              setWorkflows([]);
              setLoading(false);
              return;
            }

            projectIds.forEach(projectId => {
              const project = projectsById.get(projectId);
              const tasksQ = query(collection(db, 'projects', projectId, 'tasks'));

              const unsubTask = onSnapshot(tasksQ, (taskSnapshot) => {
                const snapshotItems = taskSnapshot.docs
                  .map(doc => {
                    const taskData = doc.data();
                    const taskIsWorkflow = isWorkflowTaskType(taskData.type) && Array.isArray(taskData.workflowSteps);
                    return {
                      ...taskData,
                      id: doc.id,
                      projectId,
                      trayItemType: taskIsWorkflow ? 'workflow' : 'assigned_task',
                      projectName: project?.name || 'Proyecto',
                      organizationId: project?.organizationId || null,
                      organizationIds: project ? [project.organizationId].filter(Boolean) : [],
                      organizationName: project ? organizationNameFor(project, organizations) : 'Sin organización',
                    };
                  });
                const tasksById = new Map(snapshotItems.map((task: any) => [task.id, task]));
                const projectItems = snapshotItems
                  .map((task: any) => {
                    const parentTask = task.parentTaskId ? tasksById.get(task.parentTaskId) : null;
                    const parentTaskTitle = parentTask?.title || parentTask?.name || task.originalTitle || null;
                    const actorCurrentStepIndex = isWorkflowItem(task)
                      ? getWorkflowCurrentStepIndexForActor(task, normalizedMemberIds)
                      : task.currentStepIndex;

                    return {
                      ...task,
                      currentStepIndex: actorCurrentStepIndex,
                      actorCurrentStepIndex,
                      parentTaskTitle,
                    };
                  })
                  .filter((task: any) => {
                    if (!isWorkflowItem(task)) {
                      if (!isScrumInboxEligible(task)) return false;
                      const isAssigned = isAssignedToCurrentUser(task, normalizedMemberIds);
                      const hasReviewedTask = isMeetingTask(task)
                        ? hasMeetingResponseForUser(task, normalizedMemberIds) || hasAssignedTaskReviewForUser(task, normalizedMemberIds)
                        : hasAssignedTaskReviewForUser(task, normalizedMemberIds);
                      const isPendingMeetingForActor = isMeetingTask(task)
                        ? !hasMeetingResponseForUser(task, normalizedMemberIds)
                        : true;
                      return (isOpenTask(task) && isAssigned && isPendingMeetingForActor) || hasReviewedTask;
                    }

                    const currentStep = task.workflowSteps?.[task.currentStepIndex || 0];
                    const isAssigned = currentStep?.assignedTo && matchesActor([currentStep.assignedTo], normalizedMemberIds);
                    const isPending = currentStep?.status === 'en_curso' || currentStep?.status === 'reproceso' || currentStep?.status === 'pending' || currentStep?.status === 'detenido';
                    const hasInteracted = hasWorkflowReviewForUser(task, normalizedMemberIds);
                    
                    return (isAssigned && isPending) || hasInteracted;
                  });

                projectTaskItems.set(projectId, projectItems);
                publishProjectItems(projectId);
                
                projectsProcessed++;
                if (projectsProcessed === projectIds.length) {
                  setLoading(false);
                }
              }, (error) => {
                handleDataError(error, OperationType.GET, `projects/${projectId}/tasks`);
              });

              const accountQ = query(collection(db, 'projects', projectId, 'contractorPaymentRequests'));
              const unsubAccounts = onSnapshot(accountQ, (accountSnapshot) => {
                const projectOrganizationIds = [project?.organizationId, ...(project?.organizationIds || [])].filter(Boolean);
                const organization = organizations.find((candidate) => projectOrganizationIds.includes(candidate.id));
                const projectConfig = project?.contractorAccountApprovalConfig || {};
                const approvalConfig = resolveContractorAccountApprovalConfig(
                  projectConfig,
                  organization?.contractorAccountApprovalConfig
                );

                const administrativeItems = accountSnapshot.docs
                  .map((accountDoc) => {
                    const account = accountDoc.data();
                    const status = String(account.status || 'submitted');
                    if (!isContractorAccountInboxStatus(status)) return null;
                    const configuredApproverId = getContractorAccountConfiguredApproverId(
                      approvalConfig,
                      status as ContractorAccountStatus
                    );
                    const persistedAssigneeCandidates = [
                      account.currentApproverId,
                      account.currentApproverMemberId,
                      account.currentApproverAuthUserId,
                      account.currentApproverEmail,
                    ];
                    const hasPersistedAssignee = persistedAssigneeCandidates.some((value) => String(value || '').trim());
                    const fallbackAssigneeCandidates = status === 'returned'
                        ? [
                            account.contractorId,
                            account.contractorAuthUserId,
                            account.contractorEmail,
                            account.requesterSignature?.signerUserId,
                            account.requesterSignature?.signerMemberId,
                            account.requesterSignature?.email,
                          ]
                        : [configuredApproverId];
                    const assigneeCandidates = hasPersistedAssignee
                      ? persistedAssigneeCandidates
                      : fallbackAssigneeCandidates;
                    const currentApproverId = String(assigneeCandidates.find((value) => String(value || '').trim()) || '');
                    if (!currentApproverId || !matchesActor(assigneeCandidates, normalizedMemberIds)) return null;

                    const stageLabel = CONTRACTOR_ACCOUNT_STAGE_LABELS[status as ContractorAccountStatus] || 'Aprobación administrativa';
                    const contractorName = account.contractorName || 'Contratista';
                    return {
                      id: `contractor-account-${accountDoc.id}-${status}`,
                      sourceDocumentId: accountDoc.id,
                      projectId,
                      projectName: project?.name || 'Proyecto',
                      organizationId: project?.organizationId || null,
                      organizationIds: projectOrganizationIds,
                      organizationName: project ? organizationNameFor(project, organizations) : 'Sin organización',
                      trayItemType: 'administrative_approval',
                      type: 'administrative_approval',
                      status: 'todo',
                      priority: 'high',
                      assignedTo: currentApproverId,
                      title: status === 'returned'
                        ? `Subsanar y reenviar cuenta de cobro de ${contractorName}`
                        : `Revisar cuenta de cobro de ${contractorName}`,
                      description: `${stageLabel} · ${account.periodStart || 'Sin fecha'} a ${account.periodEnd || 'Sin fecha'}`,
                      administrativeRequestType: 'contractorAccount',
                      contractorAccountId: accountDoc.id,
                      contractorAccountStatus: status,
                      contractorAccountStageLabel: stageLabel,
                      administrativeHref: getContractorAccountAdministrationHref(projectId, accountDoc.id),
                      createdAt: account.updatedAt || account.submittedAt || account.createdAt || new Date().toISOString(),
                      updatedAt: account.updatedAt || account.submittedAt || account.createdAt || new Date().toISOString(),
                    };
                  })
                  .filter(Boolean);

                projectAdministrativeItems.set(projectId, administrativeItems);
                publishProjectItems(projectId);
              }, (error) => {
                handleDataError(error, OperationType.GET, `projects/${projectId}/contractorPaymentRequests`);
              });

              taskUnsubscribes.push(unsubTask, unsubAccounts);
            });
          }, (error) => {
            handleDataError(error, OperationType.LIST, 'projects');
            setLoading(false);
          });

        } catch (error) {
          console.error("Error fetching user team member ID:", error);
          setLoading(false);
        }
      };

      fetchUserTeamMemberId();
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProjects) unsubscribeProjects();
      taskUnsubscribes.forEach(unsub => unsub());
    };
  }, [userRole, managedOrganizationIds, organizations]);

  const loadProjectRateCardContext = async (projectId: string) => {
    try {
      const projectSnap = await getDoc(doc(db, 'projects', projectId));
      const projectData = projectSnap.exists() ? projectSnap.data() : {};
      const assignedMemberIds = projectData?.assignedTeamMembers || [];

      if (assignedMemberIds.length > 0) {
        const teamQ = query(collection(db, 'team_members'), where('__name__', 'in', assignedMemberIds));
        const teamSnap = await getDocs(teamQ);
        setProjectTeamMembers(teamSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      } else {
        setProjectTeamMembers([]);
      }

      const rateCardsSnap = await getDocs(query(collection(db, 'projects', projectId, 'rateCards')));
      setProjectRateCards(
        rateCardsSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((left: any, right: any) => String(left.name || '').localeCompare(String(right.name || ''))),
      );

      const qualityCausesSnap = await getDocs(query(collection(db, 'projects', projectId, 'qualityCauses')));
      setProjectQualityCauses(
        qualityCausesSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .filter((cause: any) => cause.active !== false)
          .sort((left: any, right: any) => String(left.name || left.label || '').localeCompare(String(right.name || right.label || ''))),
      );
    } catch (error) {
      console.error('Error loading rate card context:', error);
      toast.error('No se pudieron cargar las personas, rate cards o causales del proyecto.');
    }
  };

  const resetDynamicRateCardFields = (source: any = null, defaultAssignee = '') => {
    setDynamicRateCardAssignee(defaultAssignee);
    setDynamicRateCardId('');
    setDynamicRateCardUnits(String(getDynamicRateCardUnits(source)));
    setDynamicRateCardComment('');
  };

  const resetQualityReviewFields = () => {
    setQualityCauseIds([]);
    setQualityApprovalMode('accepted');
    setQualityObservationComment('');
  };

  const toggleQualityCause = (causeId: string) => {
    setQualityCauseIds((current) =>
      current.includes(causeId)
        ? current.filter((id) => id !== causeId)
        : [...current, causeId]
    );
  };

  const addDynamicRateCardChargeToBatch = (
    batch: ReturnType<typeof writeBatch>,
    params: {
      projectId: string;
      task: any;
      rateCardId: string;
      assigneeId: string;
      units: number;
      source: string;
      rateCardSourceKey?: string | null;
      stepIndex?: number | null;
      comment?: string | null;
      isRework?: boolean;
      reversal?: boolean;
    },
  ) => {
    const amount = Number(params.units);
    if (!params.rateCardId || !params.assigneeId || !Number.isFinite(amount)) return null;
    const now = new Date();
    const entry = addTraceableRateCardMovementToBatch(batch, {
      projectId: params.projectId,
      task: params.task,
      rateCardId: params.rateCardId,
      assignedTo: params.assigneeId,
      units: params.reversal ? Math.abs(amount) : amount,
      source: params.source,
      rateCardSourceKey: params.rateCardSourceKey || params.source,
      stepIndex: params.stepIndex ?? null,
      comment: params.comment || null,
      occurredAt: now,
      actor: {
        id: user?.uid || null,
        email: user?.email || null,
        name: user?.displayName || user?.email || null,
      },
      isRework: Boolean(params.isRework),
      reversal: Boolean(params.reversal),
      completionMode: 'workflow_tray',
    });

    if (!entry) return null;

    return {
      entryId: entry.id,
      rateCardId: params.rateCardId,
      assignedTo: params.assigneeId,
      units: entry.units,
      source: params.source,
      rateCardSourceKey: entry.rateCardSourceKey || params.rateCardSourceKey || params.source,
      stepIndex: params.stepIndex ?? null,
      reversal: Boolean(params.reversal),
      createdAt: now.toISOString(),
    };
  };

  const resolveCurrentActorName = React.useCallback((members: any[] = projectTeamMembers) => {
    const currentEmail = normalizeEmail(user?.email);
    const currentId = user?.uid;
    const candidates = [...members, ...currentMemberProfiles];
    const actor = candidates.find((member) => {
      if (!member) return false;
      if (currentEmail && normalizeEmail(member.email) === currentEmail) return true;
      return currentId && [member.id, member.uid, member.authUserId].includes(currentId);
    });

    return (
      actor?.name ||
      actor?.displayName ||
      user?.email ||
      user?.displayName ||
      'Usuario'
    );
  }, [currentMemberProfiles, projectTeamMembers, user?.displayName, user?.email, user?.uid]);

  const prepareWorkflowApproveFormData = async (task: any, currentStep: any, currentIndex: number) => {
    const preparedFormData =
      Object.keys(formData).length > 0
        ? { ...formData }
        : { ...(currentStep?.formData || {}) };

    for (const field of currentStep?.form?.fields || []) {
      if (field.type !== 'document') continue;
      const files = workflowDocumentFiles[field.id] || [];
      if (files.length === 0) continue;

      const uploadedDocuments = [];
      for (const file of files) {
        uploadedDocuments.push(await uploadWorkflowFormDocument({
          file,
          projectId: task.projectId,
          projectName: task.projectName,
          task,
          tasks: workflows,
          user,
          field: { ...field, documentName: files.length > 1 && !field.documentVersioning ? file.name : field.documentName },
          stepIndex: currentIndex,
          stepLabel: currentStep?.label || `Paso ${currentIndex + 1}`,
        }));
      }
      preparedFormData[field.id] = uploadedDocuments.length === 1 ? uploadedDocuments[0] : uploadedDocuments;
    }

    return preparedFormData;
  };

  const confirmAction = async () => {
    if (!user || !actionModal.task) return;
    
    if (!actionComment.trim()) {
      toast.warning("Las observaciones son obligatorias.");
      return;
    }

    const task = actionModal.task;
    const action = actionModal.type;
    const currentIndex = task.currentStepIndex || 0;
    const workflowStepsForRouting = task.workflowSteps || [];
    const currentStep = workflowStepsForRouting[currentIndex];
    const isVariableWorkflow = isVariableWorkflowTaskType(task.type);
    const actorName = resolveCurrentActorName();
    const actorEmail = user.email || null;
    const actorUser = { ...user, displayName: actorName };
    const approveFormData =
      action === 'approve'
        ? Object.keys(formData).length > 0
          ? formData
          : currentStep?.formData || {}
        : {};
    const approveNextIndexes =
      action === 'approve'
        ? resolveWorkflowNextStepIndexes({
            steps: workflowStepsForRouting,
            currentIndex,
            formData: approveFormData,
          })
        : [];
    const approveNextStepRequiresDynamicAssignee = Boolean(
      approveNextIndexes.some((nextIndex) =>
        isDynamicWorkflowAssignee(workflowStepsForRouting[nextIndex]?.assignedTo)
      )
    );
    const approveNeedsNextAssignee = Boolean(
      action === 'approve' &&
        approveNextIndexes.length > 0 &&
        (currentStep?.assignsNextStep || approveNextStepRequiresDynamicAssignee)
    );
    const returnTargetIndex = action === 'return'
      ? resolveWorkflowPreviousStepIndex({
          steps: workflowStepsForRouting,
          currentIndex,
          history: task.workflowHistory || [],
        })
      : null;
    const currentStepIsQualityGate = isQualityGateStep(currentStep);
    const qualitySourceStepIndex = currentStepIsQualityGate
      ? resolveWorkflowQualitySourceStepIndex({
          steps: workflowStepsForRouting,
          currentIndex,
          history: task.workflowHistory || [],
        })
      : null;
    const selectedQualityCauses = projectQualityCauses.filter((cause) => qualityCauseIds.includes(String(cause.id)));
    const selectedQualityCauseLabels = selectedQualityCauses.map((cause) => cause.name || cause.label || 'Causal sin nombre');
    const isApprovalWithObservations =
      currentStepIsQualityGate && action === 'approve' && qualityApprovalMode === 'accepted_with_observations';
    const staticRateCardSources = getStaticRateCardSources(currentStep);
    const runtimeStaticRateCardSources = staticRateCardSources.filter((source) => source.assigneeMode === 'runtime');
    const workflowDynamicRateCardSource = getWorkflowDynamicRateCardSource(task, action);
    const workflowDynamicRateCardRequestsUnits = workflowDynamicRateCardSource
      ? shouldRequestDynamicRateCardUnits(workflowDynamicRateCardSource.sourceConfig)
      : false;

    // Validate form data if approving and form exists
    if (action === 'approve' && currentStep?.form?.fields) {
      const missingRequired = currentStep.form.fields.some((f: any) => {
        if (!f.required) return false;
        if (f.type === 'document' && (workflowDocumentFiles[f.id] || []).length > 0) return false;
        return !hasRequiredFormValue(formData[f.id]);
      });
      if (missingRequired) {
        toast.warning("Por favor complete todos los campos obligatorios del formulario.");
        return;
      }
    }

    if (workflowDynamicRateCardSource) {
      if (
        !dynamicRateCardAssignee ||
        !dynamicRateCardId ||
        (workflowDynamicRateCardRequestsUnits && isInvalidRateCardUnits(dynamicRateCardUnits))
      ) {
        toast.warning("Completa la persona, el perfil y las unidades del Rate Card dinámico.");
        return;
      }
    }

    if (
      (action === 'approve' || action === 'return') &&
      runtimeStaticRateCardSources.some((source) => !staticRateCardAssignees[source.key])
    ) {
      toast.warning("Selecciona el profesional para cada Rate Card fijo que se asigna al ejecutar.");
      return;
    }

    if (action === 'approve' || action === 'return') {
      const staticRateCardAssignmentKeys = staticRateCardSources.map((source) =>
        getStaticRateCardAssignmentKey(
          source,
          currentStep.assignedTo || task.assignedTo || user?.uid,
          staticRateCardAssignees[source.key]
        )
      );
      const hasDuplicateStaticRateCardAssignments = staticRateCardAssignmentKeys.some(
        (assignmentKey, index) => staticRateCardAssignmentKeys.indexOf(assignmentKey) !== index
      );
      if (hasDuplicateStaticRateCardAssignments) {
        toast.warning("El mismo Rate Card solo puede cargarse una vez por profesional en este paso.");
        return;
      }
    }

    if (currentStepIsQualityGate && (action === 'return' || isApprovalWithObservations) && qualityCauseIds.length === 0) {
      toast.warning("Selecciona al menos una causal de calidad.");
      return;
    }

    if (isApprovalWithObservations && !qualityObservationComment.trim()) {
      toast.warning("Escribe la observación general de los errores detectados.");
      return;
    }

    if (currentStepIsQualityGate && (action === 'approve' || action === 'return') && qualitySourceStepIndex === null) {
      toast.error("Este control de calidad no tiene un paso origen trazable. Revisa la ruta que envía a calidad antes de aprobar o devolver.");
      return;
    }

    if (action === 'return' && returnTargetIndex === null) {
      toast.warning("No hay una ruta anterior configurada para devolver este workflow.");
      return;
    }

    if (approveNeedsNextAssignee && !nextStepAssignee) {
      toast.warning(
        approveNextStepRequiresDynamicAssignee
          ? "El siguiente paso resuelto por la ruta tiene responsable dinámico. Selecciona quién lo recibirá."
          : "Selecciona el responsable del siguiente paso."
      );
      return;
    }
    
    setProcessingId(task.id);

    try {
      const preparedApproveFormData =
        action === 'approve'
          ? await prepareWorkflowApproveFormData(task, currentStep, currentIndex)
          : {};
      const batch = writeBatch(db);
      const taskRef = doc(db, 'projects', task.projectId, 'tasks', task.id);
      const steps = [...task.workflowSteps];
      
      let nextIndex = currentIndex;
      let newStatus = task.status;
      let progress = task.progress || 0;
      const rateCardChargesToSync: any[] = [];
      let assignedNextWorkflowIndexes: number[] = [];

      const currentStepWasApprovedBefore = Boolean(task.workflowHistory?.some((h: any) => h.stepIndex === currentIndex && h.action === 'approve'));
      const hasBeenActedUpon = task.workflowHistory?.some((h: any) => h.stepIndex === currentIndex && (h.action === 'approve' || h.action === 'return'));

      // Rate Card Update for the current step (whether approved or returned)
      if (staticRateCardSources.length > 0 && (action === 'approve' || (action === 'return' && currentStepWasApprovedBefore))) {
        staticRateCardSources.forEach((staticRateCardSource) => {
          const isReturnAction = action === 'return';
          const units = staticRateCardSource.autoAddUnits === false
            ? normalizeRateCardUnits(staticRateCardUnits[staticRateCardSource.key], 0)
            : normalizeRateCardUnits(staticRateCardSource.unitsToAdd);
          const assignedUser = getStaticRateCardAssignee(
            staticRateCardSource,
            currentStep.assignedTo || task.assignedTo || user?.uid,
            staticRateCardAssignees[staticRateCardSource.key]
          );

          if (!units || !assignedUser) return;

          const charge = addDynamicRateCardChargeToBatch(batch, {
            projectId: task.projectId,
            task,
            rateCardId: staticRateCardSource.rateCardId,
            assigneeId: assignedUser,
            units,
            source: isReturnAction
              ? (staticRateCardSource.source === 'form' ? 'workflow_step_form_static_reversal' : 'workflow_step_static_reversal')
              : (staticRateCardSource.source === 'form' ? 'workflow_step_form_static' : 'workflow_step_static'),
            rateCardSourceKey: staticRateCardSource.key,
            stepIndex: currentIndex,
            comment: actionComment || (isReturnAction ? 'Reverso del Rate Card por devolución del paso.' : null),
            isRework: !isReturnAction && hasBeenActedUpon,
            reversal: isReturnAction,
          });
          if (charge) rateCardChargesToSync.push(charge);
        });
      }

      if (runtimeStaticRateCardSources.length > 0 && (action === 'approve' || action === 'return')) {
        steps[currentIndex] = applyRuntimeStaticRateCardAssigneesToStep(steps[currentIndex], staticRateCardAssignees);
      }

      let dynamicRateCardCharge: any = null;
      if (workflowDynamicRateCardSource && (action === 'approve' || currentStepWasApprovedBefore)) {
        const taskWasCompletedBefore = task.workflowHistory?.some((h: any) => h.stepIndex === task.workflowSteps.length - 1 && h.action === 'approve');
        dynamicRateCardCharge = addDynamicRateCardChargeToBatch(batch, {
          projectId: task.projectId,
          task,
          rateCardId: dynamicRateCardId,
          assigneeId: dynamicRateCardAssignee,
          units: workflowDynamicRateCardRequestsUnits
            ? normalizeRateCardUnits(dynamicRateCardUnits, 0)
            : getDynamicRateCardUnits(workflowDynamicRateCardSource.sourceConfig),
          source: action === 'return'
            ? `${workflowDynamicRateCardSource.source}_reversal`
            : workflowDynamicRateCardSource.source,
          rateCardSourceKey: `dynamic:${workflowDynamicRateCardSource.source}:${workflowDynamicRateCardSource.stepIndex ?? currentIndex}`,
          stepIndex: workflowDynamicRateCardSource.stepIndex,
          comment: actionComment || (action === 'return' ? 'Reverso del Rate Card dinámico por devolución.' : null),
          isRework: action !== 'return' && (workflowDynamicRateCardSource.source === 'workflow_step' ? hasBeenActedUpon : taskWasCompletedBefore),
          reversal: action === 'return',
        });
        if (dynamicRateCardCharge) rateCardChargesToSync.push(dynamicRateCardCharge);
      }

      let qualityEvent: any = null;
      if (currentStepIsQualityGate && (action === 'approve' || action === 'return')) {
        const eventRef = doc(collection(db, 'projects', task.projectId, 'qualityEvents'));
        const now = new Date();
        const sourceStep = qualitySourceStepIndex !== null ? workflowStepsForRouting[qualitySourceStepIndex] : null;
        const participants = getQualityParticipantIds(task, currentIndex, currentStep, memberId, user.uid, qualitySourceStepIndex);
        const result = action === 'approve' ? 'accepted' : 'rejected';
        const qualityStatus = result === 'accepted'
          ? isApprovalWithObservations ? 'accepted_with_observations' : 'accepted'
          : 'rejected';
        const qualityComment = isApprovalWithObservations
          ? qualityObservationComment.trim()
          : action === 'return'
            ? qualityObservationComment.trim() || actionComment.trim()
            : actionComment.trim();
        const qualityCauseIdList = action === 'return' || isApprovalWithObservations ? qualityCauseIds : [];
        const qualityCauseLabelList = action === 'return' || isApprovalWithObservations ? selectedQualityCauseLabels : [];
        qualityEvent = {
          id: eventRef.id,
          projectId: task.projectId,
          taskId: task.id,
          taskTitle: task.title || task.name || 'Tarea',
          stepIndex: currentIndex,
          stepLabel: currentStep?.label || `Paso ${currentIndex + 1}`,
          sourceStepIndex: qualitySourceStepIndex,
          sourceStepLabel: sourceStep?.label || (qualitySourceStepIndex !== null ? `Paso ${qualitySourceStepIndex + 1}` : null),
          sourceStepAssignee: sourceStep?.assignedTo || null,
          result,
          action: result,
          professionalId: participants.professionalId,
          reviewerId: participants.reviewerId,
          qualityStatus,
          approvedWithObservations: isApprovalWithObservations,
          causeIds: qualityCauseIdList,
          causeLabels: qualityCauseLabelList,
          causeId: qualityCauseIdList[0] || null,
          causeLabel: qualityCauseLabelList.join(', ') || null,
          comment: qualityComment,
          workflowComment: actionComment.trim(),
          ...getDateKeys(now),
          createdAt: Timestamp.now(),
          createdBy: user.uid,
          createdByEmail: actorEmail,
          createdByName: actorName,
        };
        batch.set(eventRef, qualityEvent);
      }

      const actionDate = new Date();
      const actionTimestamp = Timestamp.fromDate(actionDate);
      const reviewActorIds = normalizeActorIds([user.uid, memberId, ...memberIds]);
      const workflowPerformanceEntry =
        action === 'approve' || action === 'return'
          ? buildWorkflowStepPerformanceEntry({
              task,
              step: currentStep,
              stepIndex: currentIndex,
              action,
              completedAt: actionDate,
              user: actorUser,
              memberId,
              actorIds: reviewActorIds,
            })
          : null;

      if (action === 'approve') {
        steps[currentIndex] = {
          ...steps[currentIndex],
          status: 'listo',
          completedAt: actionTimestamp,
          completedBy: user.uid,
          completedByMemberId: memberId,
          completedByIds: reviewActorIds,
          durationDays: workflowPerformanceEntry?.durationDays ?? null,
          delayDays: workflowPerformanceEntry?.delayDays ?? 0,
          completedLate: Boolean(workflowPerformanceEntry?.completedLate),
        };
        // Save form data to the step
        if (Object.keys(preparedApproveFormData).length > 0) {
          steps[currentIndex].formData = preparedApproveFormData;
        }

        const resolvedNextIndexes = resolveWorkflowNextStepIndexes({
          steps,
          currentIndex,
          formData: Object.keys(preparedApproveFormData).length > 0 ? preparedApproveFormData : steps[currentIndex]?.formData || {},
        });

        if (resolvedNextIndexes.length > 0) {
          assignedNextWorkflowIndexes = resolvedNextIndexes;
          nextIndex = resolvedNextIndexes[0];

          resolvedNextIndexes.forEach((resolvedNextIndex) => {
            const nextStepWasCompleted = steps[resolvedNextIndex]?.status === 'listo';
            const shouldReopenCompletedStep = Boolean(isVariableWorkflow && nextStepWasCompleted);
            const nextStepAlreadyActive = isActiveWorkflowStepStatus(steps[resolvedNextIndex]?.status);

            steps[resolvedNextIndex] = {
              ...steps[resolvedNextIndex],
              status: shouldReopenCompletedStep
                ? 'reproceso'
                : nextStepWasCompleted
                  ? 'listo'
                  : nextStepAlreadyActive
                    ? steps[resolvedNextIndex]?.status
                    : 'en_curso',
              completedAt: shouldReopenCompletedStep ? null : steps[resolvedNextIndex]?.completedAt,
              completedBy: shouldReopenCompletedStep ? null : steps[resolvedNextIndex]?.completedBy,
              completedByMemberId: shouldReopenCompletedStep ? null : steps[resolvedNextIndex]?.completedByMemberId,
              completedByIds: shouldReopenCompletedStep ? [] : steps[resolvedNextIndex]?.completedByIds,
              restartedAt: shouldReopenCompletedStep ? actionTimestamp : steps[resolvedNextIndex]?.restartedAt,
              startedAt: shouldReopenCompletedStep ? actionTimestamp : steps[resolvedNextIndex]?.startedAt || actionTimestamp,
              startedBy: shouldReopenCompletedStep ? user.uid : steps[resolvedNextIndex]?.startedBy || user.uid,
              startedByMemberId: shouldReopenCompletedStep ? memberId : steps[resolvedNextIndex]?.startedByMemberId || memberId,
              assignedAt: actionTimestamp,
            };

            if ((currentStep.assignsNextStep || isDynamicWorkflowAssignee(steps[resolvedNextIndex]?.assignedTo)) && nextStepAssignee) {
              steps[resolvedNextIndex].assignedTo = nextStepAssignee;
            }
          });
          newStatus = 'in_progress';
        } else {
          const remainingActiveStepIndexes = resolveWorkflowActiveStepIndexes({ steps });
          if (remainingActiveStepIndexes.length > 0) {
            nextIndex = remainingActiveStepIndexes[0];
            newStatus = 'in_progress';
          } else {
            newStatus = normalizeCompletionStatus('completed', task);
          }

          // Task-level rate card update if whole workflow completes
          if ((newStatus === 'completed' || newStatus === 'completed_late') && task.isRateCardTask && task.rateCardId) {
            const units = normalizeRateCardUnits(task.unitsToAdd);
            const assignedUser = task.assignedTo || user?.uid;
            
            // Check if the task was already completed before (i.e., this is a rework of the final step)
            const taskWasCompletedBefore = task.workflowHistory?.some((h: any) => h.stepIndex === steps.length - 1 && h.action === 'approve');
            
            if (assignedUser) {
              const charge = addDynamicRateCardChargeToBatch(batch, {
                projectId: task.projectId,
                task,
                rateCardId: task.rateCardId,
                assigneeId: assignedUser,
                units,
                source: 'workflow_task_completion',
                stepIndex: currentIndex,
                comment: actionComment || 'Rate Card registrado al finalizar el workflow.',
                isRework: taskWasCompletedBefore,
              });
              if (charge) rateCardChargesToSync.push(charge);
            }
          }
        }
      } else if (action === 'return') {
        // Return
        steps[currentIndex] = {
          ...steps[currentIndex],
          status: 'devuelto',
          completedAt: actionTimestamp,
          completedBy: user.uid,
          completedByMemberId: memberId,
          completedByIds: reviewActorIds,
          durationDays: workflowPerformanceEntry?.durationDays ?? null,
          delayDays: workflowPerformanceEntry?.delayDays ?? 0,
          completedLate: Boolean(workflowPerformanceEntry?.completedLate),
        };
        
        if (returnTargetIndex !== null) {
          nextIndex = returnTargetIndex;
          steps[nextIndex] = {
            ...steps[nextIndex],
            status: 'reproceso',
            restartedAt: actionTimestamp,
            startedAt: actionTimestamp,
            startedBy: user.uid,
            startedByMemberId: memberId,
            assignedAt: actionTimestamp,
          };
        }
      } else if (action === 'stop') {
        steps[currentIndex].status = 'detenido';
      } else if (action === 'resume') {
        // Find if it was reproceso before, or just en_curso
        const wasReproceso = task.workflowHistory?.some((h: any) => h.stepIndex === currentIndex && h.action === 'return');
        steps[currentIndex] = {
          ...steps[currentIndex],
          status: wasReproceso ? 'reproceso' : 'en_curso',
          startedAt: steps[currentIndex]?.startedAt || actionTimestamp,
          startedBy: steps[currentIndex]?.startedBy || user.uid,
          startedByMemberId: steps[currentIndex]?.startedByMemberId || memberId,
        };
      }

      progress = Math.round((steps.filter((step) => step.status === 'listo').length / steps.length) * 100);
      if (newStatus === 'completed' || newStatus === 'completed_late') progress = 100;

      const taskUpdate: any = {
        workflowSteps: steps,
        currentStepIndex: nextIndex,
        status: newStatus,
        progress: progress,
        updatedAt: actionTimestamp,
        reviewedByIds: arrayUnion(...reviewActorIds),
        workflowReviewReceipts: arrayUnion({
          id: `${task.id}-${currentIndex}-${action}-${Date.now()}`,
          stepIndex: currentIndex,
          stepLabel: currentStep?.label || `Paso ${currentIndex + 1}`,
          userId: user.uid,
          memberId,
          userIds: reviewActorIds,
          userEmail: actorEmail,
          userName: actorName,
          action,
          comment: actionComment,
          timestamp: actionTimestamp,
        }),
        workflowHistory: arrayUnion({
          stepIndex: currentIndex,
          userId: user.uid,
          memberId,
          userIds: reviewActorIds,
          userEmail: actorEmail,
          userName: actorName,
          action: action,
          comment: actionComment,
          formData: action === 'approve' ? preparedApproveFormData : null,
          nextStepAssignee: action === 'approve' && approveNeedsNextAssignee && assignedNextWorkflowIndexes.length > 0 ? nextStepAssignee : null,
          nextStepIndex: action === 'return' ? nextIndex : assignedNextWorkflowIndexes[0] ?? null,
          nextStepIndexes: action === 'approve' ? assignedNextWorkflowIndexes : action === 'return' ? [nextIndex] : [],
          dynamicRateCard: dynamicRateCardCharge,
          qualityEvent,
          performanceEntryId: workflowPerformanceEntry?.id || null,
          durationDays: workflowPerformanceEntry?.durationDays ?? null,
          delayDays: workflowPerformanceEntry?.delayDays ?? 0,
          timestamp: actionTimestamp
        })
      };

      if (workflowPerformanceEntry) {
        taskUpdate.performanceHistory = arrayUnion(workflowPerformanceEntry);
      }

      if (newStatus === 'completed' || newStatus === 'completed_late') {
        taskUpdate.completedAt = actionTimestamp;
        taskUpdate.completedBy = user.uid;
        taskUpdate.completedByMemberId = memberId;
      }

      batch.update(taskRef, taskUpdate);

      await batch.commit();

      await Promise.all(
        Array.from(new Set(rateCardChargesToSync.map((charge) => charge?.rateCardId).filter(Boolean))).map((rateCardId) =>
          syncRateDrivenIncrementalTasksForRate({
            projectId: task.projectId,
            rateCardId,
          }),
        ),
      );

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(task.projectId, task.parentTaskId);
      }

      const notificationStepIndexes =
        action === 'approve'
          ? assignedNextWorkflowIndexes
          : action === 'return' && returnTargetIndex !== null
            ? [returnTargetIndex]
            : [];
      Array.from(new Set(notificationStepIndexes)).forEach((stepIndex) => {
        void notifyTaskAssignment({
          projectId: task.projectId,
          taskId: task.id,
          assigneeId: steps[stepIndex]?.assignedTo,
          stepIndex,
          eventType: 'workflow_step_assigned',
          source: `workflow_${action}`,
        });
      });

      setActionModal({ isOpen: false, task: null, type: 'approve' });
      setActionComment('');
      setFormData({});
      setWorkflowDocumentFiles({});
      setStaticRateCardAssignees({});
      resetQualityReviewFields();
      resetDynamicRateCardFields();
    } catch (error) {
      console.error('Error updating workflow:', error);
    } finally {
      setProcessingId(null);
    }
  };

  const openActionModal = async (task: any, type: 'approve' | 'return' | 'stop' | 'resume') => {
    const currentIndex = task.currentStepIndex || 0;
    const currentStep = task.workflowSteps?.[currentIndex];
    const initialFormData = type === 'approve'
      ? getWorkflowStepFormData(task, currentStep, currentIndex)
      : {};

    setActionModal({ isOpen: true, task, type });
    setActionComment('');
    setFormData(initialFormData);
    setWorkflowDocumentFiles({});
    setNextStepAssignee('');
    resetQualityReviewFields();
    
    const staticRateCardSources = getStaticRateCardSources(currentStep);
    setStaticRateCardUnits(
      Object.fromEntries(staticRateCardSources.map((source) => [source.key, String(normalizeRateCardUnits(source.unitsToAdd))]))
    );
    setStaticRateCardAssignees(
      Object.fromEntries(
        staticRateCardSources
          .filter((source) => source.assigneeMode === 'runtime')
          .map((source) => [source.key, source.assignedTo || ''])
      )
    );
    const dynamicSource = getWorkflowDynamicRateCardSource(task, type);
    resetDynamicRateCardFields(dynamicSource?.sourceConfig, currentStep?.assignedTo || task.assignedTo || memberId || user?.uid || '');

    const workflowHasDynamicTargets =
      type === 'approve' &&
      Array.isArray(task.workflowSteps) &&
      task.workflowSteps.some((step: any) => isDynamicWorkflowAssignee(step?.assignedTo));

    if ((type === 'approve' && currentStep?.assignsNextStep) || workflowHasDynamicTargets || dynamicSource || staticRateCardSources.length > 0 || isQualityGateStep(currentStep)) {
      await loadProjectRateCardContext(task.projectId);
    }
  };

  const updateAssignedTaskStatus = async (task: any, nextStatus: string, dynamicCharge?: {
    assigneeId: string;
    rateCardId: string;
    units: number;
    comment?: string | null;
  }, meetingSubmission?: {
    comment: string;
  }, statusAction?: {
    comment?: string | null;
    scrumStatus?: ScrumWorkStatus;
    reschedule?: {
      start: Date;
      end: Date;
    };
  }, completionSubmission?: SubtaskCompletionSubmission) => {
    if (!user || !task?.id || isWorkflowItem(task)) return;
    if (statusAction?.scrumStatus && !isManualScrumTask(task)) {
      toast.info('Esta tarea avanza mediante GitHub y no admite cambios técnicos manuales desde la Bandeja.');
      return;
    }

    let statusComment = statusAction?.comment?.trim() || null;
    if (nextStatus === 'stuck' && task.status !== 'stuck' && !statusComment) {
      setPauseTaskModal({ isOpen: true, task });
      setPauseReason('');
      return;
    }

    if (nextStatus === 'rescheduled' && !statusAction?.reschedule) {
      setRescheduleTaskModal({ isOpen: true, task });
      setRescheduleStartDate(toDateInputValue(task.startDate || task.start || new Date()));
      setRescheduleEndDate(toDateInputValue(task.endDate || task.end || new Date()));
      setRescheduleReason('');
      return;
    }

    if (nextStatus === 'rescheduled' && !statusComment) {
      toast.warning('Agrega el argumento de la reprogramación.');
      return;
    }

    const isRescheduleAction = nextStatus === 'rescheduled';
    let finalStatus = isRescheduleAction ? 'in_progress' : normalizeCompletionStatus(nextStatus, task);
    let progress = getProgressForTaskStatus(finalStatus, task.progress);
    const requestedScrumStatus = isManualScrumTask(task) ? statusAction?.scrumStatus : undefined;
    if (requestedScrumStatus) {
      progress = getScrumProgress(requestedScrumStatus, task.progress);
    }
    const taskHasDynamicRateCard = isDynamicRateCardEnabled(task);
    const wasCompleted = isCompletedTaskStatus(task.status);
    let isCompleted = isCompletedTaskStatus(finalStatus);
    const reviewActorIds = normalizeActorIds([user.uid, memberId, ...memberIds]);
    const actorName = resolveCurrentActorName();
    const actorEmail = user.email || null;
    const actorUser = { ...user, displayName: actorName };
    let meetingCompletion: {
      response: any;
      responses: any[];
      completedParticipantIds: string[];
      pendingParticipantIds: string[];
      allParticipantsCompleted: boolean;
      logbookContent?: string;
    } | null = null;

    if (isMeetingTask(task) && isCompleted && !wasCompleted) {
      if (!meetingSubmission?.comment?.trim()) {
        setMeetingCompletionModal({ isOpen: true, task, nextStatus });
        setMeetingCompletionComment('');
        return;
      }

      if (hasMeetingResponseForUser(task, reviewActorIds)) {
        toast.info('Ya registraste tu comentario para esta reunión.');
        return;
      }

      const participantIds = getMeetingParticipantIds(task);
      const participantId = getMeetingParticipantIdForActor(task, reviewActorIds);
      const existingResponses = Array.isArray(task.meetingResponses) ? task.meetingResponses : [];
      const actionTimestamp = Timestamp.now();
      const response = {
        id: `${task.id}-${participantId || user.uid}-${Date.now()}`,
        participantId,
        userId: user.uid,
        memberId,
        userIds: reviewActorIds,
        participantName: getMeetingParticipantName(task, participantId, actorName || 'Participante'),
        participantEmail: actorEmail,
        comment: meetingSubmission.comment.trim(),
        timestamp: actionTimestamp,
        source: 'meeting_closure',
      };
      const responses = [...existingResponses, response];
      const completedParticipantIds = participantIds.filter((candidateId) =>
        responses.some((candidateResponse: any) => meetingResponseMatchesActor(candidateResponse, [candidateId]))
      );
      const pendingParticipantIds = participantIds.filter((candidateId) => !completedParticipantIds.includes(candidateId));
      const allParticipantsCompleted = pendingParticipantIds.length === 0;

      meetingCompletion = {
        response,
        responses,
        completedParticipantIds,
        pendingParticipantIds,
        allParticipantsCompleted,
        logbookContent: allParticipantsCompleted ? buildMeetingLogbookContent(task, responses) : undefined,
      };

      if (!allParticipantsCompleted) {
        finalStatus = task.status === 'todo' || task.status === 'pending' ? 'in_progress' : task.status || 'in_progress';
        progress = participantIds.length > 0
          ? Math.round((completedParticipantIds.length / participantIds.length) * 100)
          : Math.max(50, Number(task.progress || 0));
        isCompleted = false;
      }
    }

    if (taskShouldAskCompletionForm(task) && isCompleted && !wasCompleted && !completionSubmission && !meetingCompletion) {
      setCompletionFormModal({ isOpen: true, task, nextStatus });
      await loadProjectRateCardContext(task.projectId);
      return;
    }

    if (taskHasDynamicRateCard && isCompleted && !wasCompleted && !dynamicCharge && !meetingCompletion && !completionSubmission) {
      setDynamicRateCardModal({ isOpen: true, task, nextStatus });
      resetDynamicRateCardFields(task, task.assignedTo || memberId || user?.uid || '');
      await loadProjectRateCardContext(task.projectId);
      return;
    }

    setProcessingId(task.id);

    try {
      const batch = writeBatch(db);
      const taskRef = doc(db, 'projects', task.projectId, 'tasks', task.id);
      let dynamicRateCardCharge: any = null;
      let completionRateCardCharges: any[] = [];
      const completionForm = getTaskCompletionForm(task);

      if (completionSubmission && completionForm && isCompleted && !wasCompleted) {
        const staticSources = getStaticRateCardSources({ form: completionForm });
        staticSources.forEach((source) => {
          const units = source.autoAddUnits === false
            ? normalizeRateCardUnits(completionSubmission.staticRateCardUnits[source.key], 0)
            : normalizeRateCardUnits(source.unitsToAdd);
          const assigneeId = getStaticRateCardAssignee(
            source,
            task.assignedTo || memberId || user.uid,
            completionSubmission.staticRateCardAssignees[source.key],
          );

          if (!source.rateCardId || !assigneeId || !Number.isFinite(units)) return;

          const charge = addDynamicRateCardChargeToBatch(batch, {
            projectId: task.projectId,
            task,
            rateCardId: source.rateCardId,
            assigneeId,
            units,
            source: source.source === 'form' ? 'assigned_subtask_completion_form' : 'assigned_subtask_completion_step',
            rateCardSourceKey: source.key,
            comment: completionSubmission.comment,
          });

          if (charge) completionRateCardCharges.push(charge);
        });

        if (completionSubmission.dynamicRateCard) {
          const charge = addDynamicRateCardChargeToBatch(batch, {
            projectId: task.projectId,
            task,
            rateCardId: completionSubmission.dynamicRateCard.rateCardId,
            assigneeId: completionSubmission.dynamicRateCard.assigneeId,
            units: completionSubmission.dynamicRateCard.units,
            source: 'assigned_subtask_completion_form_dynamic',
            rateCardSourceKey: `dynamic:${completionSubmission.dynamicRateCard.rateCardId}`,
            comment: completionSubmission.comment,
          });

          if (charge) completionRateCardCharges.push(charge);
        }
      }

      if (taskShouldAskCompletionForm(task) && wasCompleted && !isCompleted && Array.isArray(task.completionRateCardLastCharges)) {
        task.completionRateCardLastCharges.forEach((lastCharge: any) => {
          if (!lastCharge?.rateCardId || !lastCharge?.assignedTo) return;
          const charge = addDynamicRateCardChargeToBatch(batch, {
            projectId: task.projectId,
            task,
            rateCardId: lastCharge.rateCardId,
            assigneeId: lastCharge.assignedTo,
            units: -Math.abs(Number(lastCharge.units || 0)),
            source: 'assigned_subtask_completion_form_reversal',
            rateCardSourceKey: lastCharge.rateCardSourceKey || lastCharge.source || 'assigned_subtask_completion_form',
            comment: 'Reverso automático por cambio de estado desde finalizada.',
            reversal: true,
          });
          if (charge) completionRateCardCharges.push(charge);
        });
      }

      if (task.isRateCardTask && task.rateCardId && task.unitsToAdd) {
        const oldProgress = task.progress || 0;
        const deltaProgress = progress - oldProgress;
        const unitsDelta = (deltaProgress / 100) * task.unitsToAdd;

        if (unitsDelta !== 0) {
          const assignedUser = task.assignedTo || user?.uid;
          if (assignedUser) {
            const charge = addDynamicRateCardChargeToBatch(batch, {
              projectId: task.projectId,
              task,
              rateCardId: task.rateCardId,
              assigneeId: assignedUser,
              units: unitsDelta,
              source: 'assigned_task_progress',
              rateCardSourceKey: `assigned_task_progress:${oldProgress}->${progress}`,
              comment: completionSubmission?.comment || statusComment || 'Ajuste por cambio de progreso de la tarea.',
              reversal: unitsDelta < 0,
            });
            if (charge) completionRateCardCharges.push(charge);
          }
        }
      }

      if (taskHasDynamicRateCard && isCompleted && !wasCompleted && dynamicCharge) {
        dynamicRateCardCharge = addDynamicRateCardChargeToBatch(batch, {
          projectId: task.projectId,
          task,
          rateCardId: dynamicCharge.rateCardId,
          assigneeId: dynamicCharge.assigneeId,
          units: dynamicCharge.units,
          source: 'assigned_task',
          rateCardSourceKey: `assigned_task:${dynamicCharge.rateCardId}`,
          comment: dynamicCharge.comment || null,
        });
      }

      if (taskHasDynamicRateCard && wasCompleted && !isCompleted && task.dynamicRateCardLastCharge) {
        const lastCharge = task.dynamicRateCardLastCharge;
        dynamicRateCardCharge = addDynamicRateCardChargeToBatch(batch, {
          projectId: task.projectId,
          task,
          rateCardId: lastCharge.rateCardId,
          assigneeId: lastCharge.assignedTo,
          units: -Math.abs(Number(lastCharge.units || 0)),
          source: 'assigned_task_reversal',
          rateCardSourceKey: lastCharge.rateCardSourceKey || lastCharge.source || `assigned_task:${lastCharge.rateCardId}`,
          comment: 'Reverso automático por cambio de estado desde finalizada.',
          reversal: true,
        });
      }

      const actionDate = new Date();
      const actionTimestamp = Timestamp.fromDate(actionDate);
      const previousStatus = task.status || null;
      const isPausingSchedule = finalStatus === 'stuck' && previousStatus !== 'stuck';
      const isResumingSchedule = previousStatus === 'stuck' && finalStatus === 'in_progress';
      const statusHistoryEntry: any = {
        id: `${task.id}-status-${isRescheduleAction ? 'rescheduled' : finalStatus}-${Date.now()}`,
        status: isRescheduleAction ? 'rescheduled' : finalStatus,
        effectiveStatus: finalStatus,
        previousStatus,
        action: isRescheduleAction ? 'reschedule' : isPausingSchedule ? 'pause' : isResumingSchedule ? 'resume' : 'status',
        changedBy: user.uid,
        memberId,
        userIds: reviewActorIds,
        changedByEmail: actorEmail,
        changedByName: actorName,
        timestamp: actionTimestamp,
        source: requestedScrumStatus ? 'inbox_scrum_manual' : 'inbox',
        comment: meetingCompletion?.response?.comment || completionSubmission?.comment || dynamicCharge?.comment || statusComment,
        dynamicRateCard: dynamicRateCardCharge,
      };
      if (requestedScrumStatus) {
        statusHistoryEntry.previousScrumStatus = normalizeScrumStatus(task.scrumStatus || task.status);
        statusHistoryEntry.scrumStatus = requestedScrumStatus;
      }
      if (completionSubmission && completionForm) {
        statusHistoryEntry.formData = completionSubmission.formData;
        statusHistoryEntry.completionFormTitle = completionForm.title || 'Formulario de cierre';
        statusHistoryEntry.completionRateCardCharges = completionRateCardCharges;
      }
      const taskPerformanceEntry =
        isCompleted && !wasCompleted
          ? buildTaskPerformanceEntry({
              task,
              status: finalStatus,
              completedAt: actionDate,
              user: actorUser,
              memberId,
              actorIds: reviewActorIds,
            })
          : null;
      const taskUpdate: any = {
        status: finalStatus,
        progress,
        updatedAt: actionTimestamp,
        statusHistory: arrayUnion(statusHistoryEntry),
      };
      if (requestedScrumStatus) {
        taskUpdate.scrumStatus = requestedScrumStatus;
        taskUpdate.scrumStatusUpdatedAt = actionTimestamp;
        taskUpdate.scrumStatusUpdatedBy = user.uid;
        taskUpdate.scrumStatusUpdatedByMemberId = memberId;
      }

      if (isRescheduleAction && statusAction?.reschedule) {
        const { start, end } = statusAction.reschedule;
        taskUpdate.startDate = start;
        taskUpdate.endDate = end;
        taskUpdate.start = start;
        taskUpdate.end = end;
        taskUpdate.schedulePause = null;
        statusHistoryEntry.previousStartDate = toHistoryDateValue(task.startDate || task.start);
        statusHistoryEntry.previousEndDate = toHistoryDateValue(task.endDate || task.end);
        statusHistoryEntry.newStartDate = toHistoryDateValue(start);
        statusHistoryEntry.newEndDate = toHistoryDateValue(end);
      }

      if (isPausingSchedule) {
        const remainingDays = getRemainingScheduleDays(task.endDate || task.end, actionDate);
        taskUpdate.schedulePause = {
          pausedAt: actionTimestamp,
          pausedBy: user.uid,
          pausedByEmail: actorEmail,
          pausedByName: actorName,
          reason: statusComment,
          previousStatus,
          remainingDays,
          originalEndDate: toHistoryDateValue(task.endDate || task.end),
        };
        statusHistoryEntry.remainingDaysAtPause = remainingDays;
        statusHistoryEntry.previousEndDate = toHistoryDateValue(task.endDate || task.end);
      }

      if (isResumingSchedule) {
        const remainingDays = task.schedulePause?.remainingDays;
        const resumedEndDate =
          remainingDays === null || remainingDays === undefined
            ? getTaskDate(task.endDate || task.end) || actionDate
            : getResumedDueDate(remainingDays, actionDate);
        taskUpdate.endDate = resumedEndDate;
        taskUpdate.end = resumedEndDate;
        taskUpdate.schedulePauseHistory = arrayUnion({
          ...(task.schedulePause || {}),
          resumedAt: actionTimestamp,
          resumedBy: user.uid,
          resumedByEmail: actorEmail,
          resumedByName: actorName,
          resumedEndDate: toHistoryDateValue(resumedEndDate),
        });
        taskUpdate.schedulePause = null;
        statusHistoryEntry.remainingDaysRestored = remainingDays ?? null;
        statusHistoryEntry.previousEndDate = toHistoryDateValue(task.endDate || task.end);
        statusHistoryEntry.newEndDate = toHistoryDateValue(resumedEndDate);
      }

      if (taskPerformanceEntry) {
        taskUpdate.performanceHistory = arrayUnion(taskPerformanceEntry);
        taskUpdate.completedAt = actionTimestamp;
        taskUpdate.completedBy = user.uid;
        taskUpdate.completedByMemberId = memberId;
      } else if (wasCompleted && !isCompleted) {
        taskUpdate.completedAt = null;
        taskUpdate.completedBy = null;
        taskUpdate.completedByMemberId = null;
      }

      if (meetingCompletion) {
        taskUpdate.meetingResponses = arrayUnion(meetingCompletion.response);
        taskUpdate.meetingCompletedParticipantIds = meetingCompletion.completedParticipantIds;
        taskUpdate.meetingPendingParticipantIds = meetingCompletion.pendingParticipantIds;
      }

      if ((isCompleted && !wasCompleted) || meetingCompletion) {
        taskUpdate.reviewedByIds = arrayUnion(...reviewActorIds);
        taskUpdate.taskReviewReceipts = arrayUnion({
          id: `${task.id}-status-${finalStatus}-${Date.now()}`,
          status: finalStatus,
          previousStatus: task.status || null,
          userId: user.uid,
          memberId,
          userIds: reviewActorIds,
          userEmail: actorEmail,
          userName: actorName,
          comment: meetingCompletion?.response?.comment || completionSubmission?.comment || dynamicCharge?.comment || statusComment,
          timestamp: actionTimestamp,
          source: meetingCompletion ? 'meeting_closure' : completionSubmission ? 'subtask_completion_form' : 'inbox_status',
          performanceEntryId: taskPerformanceEntry?.id || null,
        });
      }

      if (dynamicRateCardCharge && !dynamicRateCardCharge.reversal && dynamicCharge) {
        taskUpdate.dynamicRateCardLastCharge = dynamicRateCardCharge;
      } else if (taskHasDynamicRateCard && wasCompleted && !isCompleted) {
        taskUpdate.dynamicRateCardLastCharge = null;
      }

      if (completionSubmission && completionForm && isCompleted && !wasCompleted) {
        taskUpdate.completionFormData = completionSubmission.formData;
        taskUpdate.completionFormHistory = arrayUnion({
          id: `${task.id}-completion-form-${Date.now()}`,
          formTitle: completionForm.title || 'Formulario de cierre',
          formData: completionSubmission.formData,
          comment: completionSubmission.comment,
          rateCardCharges: completionRateCardCharges,
          completedBy: user.uid,
          completedByEmail: actorEmail,
          completedByName: actorName,
          timestamp: actionTimestamp,
        });
        taskUpdate.completionRateCardLastCharges = completionRateCardCharges;
      } else if (taskShouldAskCompletionForm(task) && wasCompleted && !isCompleted) {
        taskUpdate.completionRateCardLastCharges = [];
      }

      if (meetingCompletion?.allParticipantsCompleted && !task.meetingLogbookEntryId) {
        const logbookRef = doc(collection(db, 'projects', task.projectId, 'logbookEntries'));
        const logbookContent = meetingCompletion.logbookContent || buildMeetingLogbookContent(task, meetingCompletion.responses);
        batch.set(logbookRef, {
          projectId: task.projectId,
          title: `Reunión: ${task.title || task.name || 'Sin título'}`,
          content: logbookContent,
          type: 'meeting',
          source: 'meeting_closure',
          meetingTaskId: task.id,
          meetingTaskTitle: task.title || task.name || 'Reunión',
          meetingResponses: meetingCompletion.responses,
          actionCandidates: detectActionCandidates(logbookContent),
          derivedLinks: [
            {
              taskId: task.id,
              taskTitle: task.title || task.name || 'Reunión',
              relationType: 'meeting_closure',
              linkedAt: actionTimestamp,
            },
          ],
          createdAt: actionTimestamp,
          updatedAt: actionTimestamp,
          createdBy: user.uid,
          createdByEmail: actorEmail,
          createdByName: actorName,
        });
        taskUpdate.meetingLogbookEntryId = logbookRef.id;
        taskUpdate.meetingClosedAt = actionTimestamp;
      }

      batch.update(taskRef, taskUpdate);

      await batch.commit();

      await Promise.all(
        Array.from(
          new Set([
            dynamicRateCardCharge?.rateCardId,
            ...completionRateCardCharges.map((charge) => charge?.rateCardId),
          ].filter(Boolean)),
        ).map((rateCardId) =>
          syncRateDrivenIncrementalTasksForRate({
            projectId: task.projectId,
            rateCardId,
          }),
        ),
      );

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(task.projectId, task.parentTaskId);
      }

      if (meetingCompletion?.allParticipantsCompleted) {
        toast.success('Reunión cerrada y registrada en la bitácora.');
      } else if (meetingCompletion) {
        toast.success('Comentario registrado. La reunión sigue pendiente para otros participantes.');
      } else {
        toast.success(finalStatus === 'completed_late' ? 'Tarea finalizada con retraso.' : 'Estado actualizado.');
      }
    } catch (error: any) {
      console.error('Error updating assigned task status:', error);
      toast.error(error?.message || 'No se pudo actualizar la tarea.');
    } finally {
      setProcessingId(null);
    }
  };

  const confirmAssignedTaskDynamicRateCard = async () => {
    const task = dynamicRateCardModal.task;
    if (!task) return;
    const taskRequestsUnits = shouldRequestDynamicRateCardUnits(task);

    if (
      !dynamicRateCardAssignee ||
      !dynamicRateCardId ||
      (taskRequestsUnits && isInvalidRateCardUnits(dynamicRateCardUnits))
    ) {
      toast.warning("Completa la persona, el perfil y las unidades del Rate Card dinámico.");
      return;
    }

    await updateAssignedTaskStatus(task, dynamicRateCardModal.nextStatus, {
      assigneeId: dynamicRateCardAssignee,
      rateCardId: dynamicRateCardId,
      units: taskRequestsUnits ? normalizeRateCardUnits(dynamicRateCardUnits, 0) : getDynamicRateCardUnits(task),
      comment: dynamicRateCardComment.trim() || null,
    });

    setDynamicRateCardModal({ isOpen: false, task: null, nextStatus: 'completed' });
    resetDynamicRateCardFields();
  };

  const confirmAssignedSubtaskCompletionForm = async (submission: SubtaskCompletionSubmission) => {
    const task = completionFormModal.task;
    if (!task) return;

    await updateAssignedTaskStatus(
      task,
      completionFormModal.nextStatus,
      undefined,
      undefined,
      undefined,
      submission,
    );

    setCompletionFormModal({ isOpen: false, task: null, nextStatus: 'completed' });
  };

  const confirmMeetingCompletion = async () => {
    const task = meetingCompletionModal.task;
    if (!task) return;

    if (!meetingCompletionComment.trim()) {
      toast.warning('Agrega tu comentario para cerrar tu participación en la reunión.');
      return;
    }

    await updateAssignedTaskStatus(task, meetingCompletionModal.nextStatus, undefined, {
      comment: meetingCompletionComment.trim(),
    });
    setMeetingCompletionModal({ isOpen: false, task: null, nextStatus: 'completed' });
    setMeetingCompletionComment('');
  };

  const confirmPauseAssignedTask = async () => {
    const task = pauseTaskModal.task;
    const cleanReason = pauseReason.trim();

    if (!task) return;
    if (!cleanReason) {
      toast.warning('Describe por qué se estanca la tarea.');
      return;
    }

    await updateAssignedTaskStatus(task, 'stuck', undefined, undefined, {
      comment: cleanReason,
    });
    setPauseTaskModal({ isOpen: false, task: null });
    setPauseReason('');
  };

  const confirmRescheduleAssignedTask = async () => {
    const task = rescheduleTaskModal.task;
    const start = parseDateInputValue(rescheduleStartDate);
    const end = parseDateInputValue(rescheduleEndDate);
    const cleanReason = rescheduleReason.trim();

    if (!task) return;
    if (!start || !end) {
      toast.warning('Selecciona fecha de inicio y fecha fin.');
      return;
    }
    if (start.getTime() > end.getTime()) {
      toast.warning('La fecha de inicio no puede ser posterior a la fecha fin.');
      return;
    }
    if (!cleanReason) {
      toast.warning('Agrega el argumento de la reprogramación.');
      return;
    }

    await updateAssignedTaskStatus(task, 'rescheduled', undefined, undefined, {
      comment: cleanReason,
      reschedule: { start, end },
    });
    setRescheduleTaskModal({ isOpen: false, task: null });
    setRescheduleStartDate('');
    setRescheduleEndDate('');
    setRescheduleReason('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  const assignedIdsForInbox = memberIds.length > 0 ? memberIds : [user?.uid, memberId].filter(Boolean);

  const isPendingTaskForMe = (task: any) => {
    const taskIsWorkflow = isWorkflowItem(task);
    const workflowCurrentIndex = taskIsWorkflow
      ? getWorkflowCurrentStepIndexForActor(task, assignedIdsForInbox as string[])
      : 0;
    const currentStep = taskIsWorkflow ? task.workflowSteps?.[workflowCurrentIndex] : null;
    if (!taskIsWorkflow && isMeetingTask(task)) {
      return isOpenTask(task) &&
        isAssignedToCurrentUser(task, assignedIdsForInbox as string[]) &&
        !hasMeetingResponseForUser(task, assignedIdsForInbox);
    }

    if (!taskIsWorkflow && !isScrumInboxEligible(task)) return false;

    return taskIsWorkflow
      ? currentStep?.assignedTo && assignedIdsForInbox.includes(currentStep.assignedTo) &&
        (currentStep?.status === 'en_curso' || currentStep?.status === 'reproceso' || currentStep?.status === 'pending' || currentStep?.status === 'detenido')
      : isOpenTask(task) && isAssignedToCurrentUser(task, assignedIdsForInbox as string[]);
  };

  const isReviewedTaskForMe = (task: any) => {
    if (isWorkflowItem(task)) return hasWorkflowReviewForUser(task, assignedIdsForInbox);
    if (!isScrumInboxEligible(task)) return false;
    if (isMeetingTask(task)) return hasMeetingResponseForUser(task, assignedIdsForInbox) || hasAssignedTaskReviewForUser(task, assignedIdsForInbox as string[]);
    return hasAssignedTaskReviewForUser(task, assignedIdsForInbox as string[]);
  };

  const isInActiveInboxTab = (task: any) =>
    activeTab === 'pending' ? isPendingTaskForMe(task) : isReviewedTaskForMe(task);

  const pendingInboxCount = workflows.filter(isPendingTaskForMe).length;

  const projectOptions = Array.from(
    new Map(workflows.map((task) => [task.projectId, task.projectName || 'Proyecto'])).entries()
  ).filter(([projectId]) => Boolean(projectId)).sort((a, b) => a[1].localeCompare(b[1]));

  const mailboxCounts = workflows.reduce((counts, task) => {
    if (!isInActiveInboxTab(task) || !task.projectId) return counts;
    counts.set(task.projectId, (counts.get(task.projectId) || 0) + 1);
    return counts;
  }, new Map<string, number>());
  const allMailboxCount = workflows.filter(isInActiveInboxTab).length;

  const filteredWorkflows = workflows.filter(task => {
    const searchLower = searchTerm.toLowerCase();
    const taskIsWorkflow = isWorkflowItem(task);
    const externalId = (task.externalWorkflowId || '').toLowerCase();
    const taskId = (task.id || '').toLowerCase();
    const title = (task.title || '').toLowerCase();
    const parentTitle = (task.parentTaskTitle || task.parentTitle || task.matrixTaskTitle || task.originalTitle || '').toLowerCase();
    const organizationName = (task.organizationName || '').toLowerCase();
    const projectName = (task.projectName || '').toLowerCase();
    const descriptionText = (task.description || task.initialObservation || '').toLowerCase();
    const administrativeStage = (task.contractorAccountStageLabel || '').toLowerCase();
    const currentStepStatus = taskIsWorkflow
      ? (task.workflowSteps?.[task.currentStepIndex]?.status || '').toLowerCase()
      : (task.status || 'todo').toLowerCase();
    const hasRescheduleHistory = Array.isArray(task.statusHistory) && task.statusHistory.some((entry: any) => entry?.action === 'reschedule' || entry?.status === 'rescheduled');
    
    if (!isInActiveInboxTab(task)) return false;

    if (projectFilter !== 'all' && task.projectId !== projectFilter) return false;

    if (statusFilter !== 'all') {
      const dueState = getDueState(task);
      if (statusFilter === 'workflow' && !taskIsWorkflow) return false;
      if (statusFilter === 'assigned_task' && (taskIsWorkflow || task.trayItemType === 'administrative_approval')) return false;
      if (statusFilter === 'administrative_approval' && task.trayItemType !== 'administrative_approval') return false;
      if (statusFilter === 'overdue' && dueState !== 'overdue') return false;
      if (statusFilter === 'due_soon' && dueState !== 'due_soon') return false;
      if (statusFilter === 'rescheduled' && !hasRescheduleHistory && currentStepStatus !== 'rescheduled') return false;
      if (!['workflow', 'assigned_task', 'administrative_approval', 'overdue', 'due_soon', 'rescheduled'].includes(statusFilter) && currentStepStatus !== statusFilter) return false;
    }

    return externalId.includes(searchLower) || 
           taskId.includes(searchLower) || 
           title.includes(searchLower) ||
           parentTitle.includes(searchLower) ||
           organizationName.includes(searchLower) ||
           projectName.includes(searchLower) ||
           descriptionText.includes(searchLower) ||
           administrativeStage.includes(searchLower) ||
           currentStepStatus.includes(searchLower);
  }).sort((a, b) => {
    if (sortFilter === 'due_asc') {
      const aDueTime = getInboxDueSortTime(a);
      const bDueTime = getInboxDueSortTime(b);
      if (aDueTime !== bDueTime) return aDueTime < bDueTime ? -1 : 1;
    }

    const bTime = getTaskTimestamp(b.createdAt) || getTaskTimestamp(b.updatedAt);
    const aTime = getTaskTimestamp(a.createdAt) || getTaskTimestamp(a.updatedAt);
    return bTime - aTime;
  });

  const getInboxParentTitle = (task: any) =>
    task?.parentTaskTitle ||
    task?.parentTitle ||
    task?.matrixTaskTitle ||
    task?.originalTitle ||
    task?.parentName ||
    'Tarea matriz';

  const groupedInboxItems = (() => {
    const parentIds = new Set(filteredWorkflows.map((task: any) => task.parentTaskId).filter(Boolean));
    const groups = new Map<string, any>();
    const orderedItems: any[] = [];
    const pushedGroups = new Set<string>();

    const ensureGroup = (task: any) => {
      const parentId = task.parentTaskId || task.id;
      const key = `${task.projectId || 'project'}:${parentId}`;
      const existing = groups.get(key);
      if (existing) return existing;

      const group = {
        type: 'group',
        key,
        parentId,
        parentTask: null,
        parentTitle: getInboxParentTitle(task),
        projectId: task.projectId,
        projectName: task.projectName || 'Proyecto',
        organizationName: task.organizationName || 'Sin organización',
        children: [],
      };
      groups.set(key, group);
      return group;
    };

    filteredWorkflows.forEach((task: any) => {
      if (task.parentTaskId) {
        const group = ensureGroup(task);
        group.children.push(task);
        return;
      }

      if (parentIds.has(task.id)) {
        const group = ensureGroup(task);
        group.parentTask = task;
        group.parentTitle = getInboxTaskTitle(task);
        return;
      }

      orderedItems.push({ type: 'single', key: `${task.projectId}-${task.id}`, task });
    });

    filteredWorkflows.forEach((task: any) => {
      if (task.parentTaskId || parentIds.has(task.id)) {
        const group = groups.get(`${task.projectId || 'project'}:${task.parentTaskId || task.id}`);
        if (group && !pushedGroups.has(group.key)) {
          orderedItems.push(group);
          pushedGroups.add(group.key);
        }
      }
    });

    return orderedItems.sort((left, right) => {
      const leftTask = left.type === 'single' ? left.task : (left.parentTask || left.children[0]);
      const rightTask = right.type === 'single' ? right.task : (right.parentTask || right.children[0]);
      if (sortFilter === 'due_asc') {
        const leftDue = getInboxDueSortTime(leftTask);
        const rightDue = getInboxDueSortTime(rightTask);
        if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
      }

      const rightTime = getTaskTimestamp(rightTask?.createdAt) || getTaskTimestamp(rightTask?.updatedAt);
      const leftTime = getTaskTimestamp(leftTask?.createdAt) || getTaskTimestamp(leftTask?.updatedAt);
      return rightTime - leftTime;
    });
  })();
  const activeDynamicRateCardSource = actionModal.isOpen
    ? getWorkflowDynamicRateCardSource(actionModal.task, actionModal.type)
    : null;
  const activeDynamicRateCardRequestsUnits = activeDynamicRateCardSource
    ? shouldRequestDynamicRateCardUnits(activeDynamicRateCardSource.sourceConfig)
    : false;
  const activeStaticRateCardSources = actionModal.isOpen
    ? getStaticRateCardSources(actionModal.task?.workflowSteps?.[actionModal.task.currentStepIndex || 0])
    : [];
  const manualStaticRateCardSources = activeStaticRateCardSources.filter((source) => source.autoAddUnits === false);
  const hasMissingManualStaticUnits = manualStaticRateCardSources.some(
    (source) => isInvalidRateCardUnits(staticRateCardUnits[source.key])
  );
  const runtimeStaticRateCardSources = activeStaticRateCardSources.filter((source) => source.assigneeMode === 'runtime');
  const hasMissingRuntimeStaticAssignees = runtimeStaticRateCardSources.some(
    (source) => !staticRateCardAssignees[source.key]
  );
  const activeQualityGateStep = actionModal.isOpen
    ? actionModal.task?.workflowSteps?.[actionModal.task.currentStepIndex || 0]
    : null;
  const activeWorkflowNextIndexes =
    actionModal.isOpen && actionModal.type === 'approve' && Array.isArray(actionModal.task?.workflowSteps)
      ? resolveWorkflowNextStepIndexes({
          steps: actionModal.task.workflowSteps,
          currentIndex: actionModal.task.currentStepIndex || 0,
          formData: Object.keys(formData).length > 0 ? formData : activeQualityGateStep?.formData || {},
        })
      : [];
  const activeWorkflowNextIndex = activeWorkflowNextIndexes[0] ?? null;
  const activeApproveNextStepRequiresDynamicAssignee = Boolean(
    actionModal.isOpen &&
      activeWorkflowNextIndexes.some((nextIndex) =>
        isDynamicWorkflowAssignee(actionModal.task?.workflowSteps?.[nextIndex]?.assignedTo)
      )
  );
  const activeApproveNeedsNextAssignee = Boolean(
    actionModal.isOpen &&
      actionModal.type === 'approve' &&
      (activeQualityGateStep?.assignsNextStep || activeApproveNextStepRequiresDynamicAssignee) &&
      activeWorkflowNextIndexes.length > 0
  );
  const activeQualityGateIsApproveWithObservations =
    isQualityGateStep(activeQualityGateStep) &&
    actionModal.type === 'approve' &&
    qualityApprovalMode === 'accepted_with_observations';
  const activeQualityGateMissingCauses =
    isQualityGateStep(activeQualityGateStep) &&
    (actionModal.type === 'return' || activeQualityGateIsApproveWithObservations) &&
    qualityCauseIds.length === 0;
  const activeQualityGateMissingObservation =
    activeQualityGateIsApproveWithObservations && !qualityObservationComment.trim();
  const assignedTaskDynamicRateCardRequestsUnits = dynamicRateCardModal.task
    ? shouldRequestDynamicRateCardUnits(dynamicRateCardModal.task)
    : false;

  const getInteractionHistory = (task: any) => {
    if (!task) return [];
    if (isWorkflowItem(task)) {
      return (task.workflowHistory || []).map((entry: any) => ({
        ...entry,
        historyType: 'workflow',
      }));
    }

    const statusHistory = Array.isArray(task.statusHistory) ? task.statusHistory : [];
    if (statusHistory.length > 0) {
      return statusHistory.map((entry: any) => ({
        ...entry,
        action: entry.action || 'status',
        historyType: 'status',
      }));
    }

    const reviewReceipts = Array.isArray(task.taskReviewReceipts) ? task.taskReviewReceipts : [];
    return reviewReceipts.map((entry: any) => ({
      ...entry,
      action: 'status',
      historyType: 'status',
    }));
  };

  const getHistoryBadgeLabel = (history: any) => {
    if (history.historyType === 'status') return getTaskStatusLabel(history.status);
    if (history.action === 'approve') return 'Aprobado';
    if (history.action === 'return') return 'Devuelto';
    if (history.action === 'stop') return 'Detenido';
    if (history.action === 'resume') return 'Reanudado';
    return 'Comentario';
  };

  const getHistoryBadgeClass = (history: any) => {
    if (history.historyType === 'status') return getTaskStatusClass(history.status);
    if (history.action === 'approve') return 'bg-emerald-50 text-emerald-700';
    if (history.action === 'return') return 'bg-red-50 text-red-700';
    if (history.action === 'stop') return 'bg-orange-50 text-orange-700';
    if (history.action === 'resume') return 'bg-blue-50 text-blue-700';
    return 'bg-slate-100 text-slate-700';
  };

  const renderHistoryIcon = (history: any) => {
    if (history.action === 'reschedule') {
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
          <CalendarDays size={16} />
        </div>
      );
    }

    if (history.historyType === 'status' && isCompletedTaskStatus(history.status)) {
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 size={16} />
        </div>
      );
    }

    if (history.action === 'approve') {
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 size={16} />
        </div>
      );
    }

    if (history.action === 'return') {
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-600">
          <ArrowLeft size={16} />
        </div>
      );
    }

    if (history.action === 'stop' || history.action === 'pause') {
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-orange-600">
          <Pause size={16} />
        </div>
      );
    }

    if (history.action === 'resume') {
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <Play size={16} />
        </div>
      );
    }

    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
        <ClipboardList size={16} />
      </div>
    );
  };

  const getHistoryActorName = (history: any) => {
    const historyEmail = normalizeEmail(
      history.userEmail || history.changedByEmail || history.participantEmail || history.createdByEmail
    );
    const historyIds = [
      history.userId,
      history.changedBy,
      history.memberId,
      history.participantId,
      ...(Array.isArray(history.userIds) ? history.userIds : []),
    ].filter(Boolean).map(String);
    const candidates = [...projectTeamMembers, ...currentMemberProfiles];
    const actor = candidates.find((member) => {
      if (!member) return false;
      if (historyEmail && normalizeEmail(member.email) === historyEmail) return true;
      return historyIds.some((id) => [member.id, member.uid, member.authUserId].includes(id));
    });

    return (
      actor?.name ||
      actor?.displayName ||
      history.userEmail ||
      history.changedByEmail ||
      history.participantEmail ||
      history.createdByEmail ||
      history.userName ||
      history.changedByName ||
      history.participantName ||
      'Usuario'
    );
  };

  const getHistoryDetailText = (history: any, task: any) => {
    if (history.historyType === 'status') {
      if (history.scrumStatus) {
        const previousScrumStatus = history.previousScrumStatus
          ? getScrumStatusLabel(history.previousScrumStatus)
          : null;
        const nextScrumStatus = getScrumStatusLabel(history.scrumStatus);
        return previousScrumStatus
          ? `Scrum: ${previousScrumStatus} -> ${nextScrumStatus}`
          : `Etapa Scrum: ${nextScrumStatus}`;
      }
      if (history.action === 'pause') {
        const remaining = history.remainingDaysAtPause;
        return remaining === null || remaining === undefined
          ? 'Vencimiento pausado'
          : `Vencimiento pausado con ${remaining} día${Number(remaining) === 1 ? '' : 's'} restante${Number(remaining) === 1 ? '' : 's'}`;
      }
      if (history.action === 'resume') {
        return history.newEndDate ? `Vencimiento reanudado hasta ${history.newEndDate}` : 'Vencimiento reanudado';
      }
      if (history.action === 'reschedule') {
        return `Reprogramación: ${history.previousEndDate || 'sin fecha'} -> ${history.newEndDate || 'sin fecha'}`;
      }
      const previousStatus = history.previousStatus ? getTaskStatusLabel(history.previousStatus) : null;
      const nextStatus = getTaskStatusLabel(history.status);
      return previousStatus ? `${previousStatus} -> ${nextStatus}` : `Estado: ${nextStatus}`;
    }

    return `Paso ${history.stepIndex + 1}: ${task.workflowSteps?.[history.stepIndex]?.label || 'Desconocido'}`;
  };

  const renderUtilityButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    extraClassName = 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
    badge?: number,
  ) => (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${extraClassName}`}
      title={label}
      aria-label={label}
    >
      {icon}
      {Boolean(badge) && (
        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-indigo-600 px-1 text-center text-[9px] font-bold leading-4 text-white">
          {badge! > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );

  const renderWorkflowModalActions = (task: any, onCloseModal?: () => void) => {
    if (activeTab !== 'pending' || !isWorkflowItem(task)) return null;

    const currentIndex = task.currentStepIndex || 0;
    const workflowSteps = task.workflowSteps || [];
    const currentStep = workflowSteps[currentIndex] || {};
    const isStopped = currentStep?.status === 'detenido';
    const isProcessing = processingId === task.id;
    const returnTargetIndex = resolveWorkflowPreviousStepIndex({
      steps: workflowSteps,
      currentIndex,
      history: task.workflowHistory || [],
    });

    const openWorkflowAction = (type: 'approve' | 'return' | 'stop' | 'resume') => {
      onCloseModal?.();
      void openActionModal(task, type);
    };

    return (
      <div className="flex flex-wrap items-center gap-2">
        {isStopped ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openWorkflowAction('resume')}
            disabled={isProcessing}
            className="h-8 text-blue-600"
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Reanudar
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openWorkflowAction('stop')}
            disabled={isProcessing}
            className="h-8 text-orange-600"
          >
            <Pause className="mr-1.5 h-3.5 w-3.5" />
            Detener
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => openWorkflowAction('return')}
          disabled={isProcessing || returnTargetIndex === null || isStopped}
          className="h-8 text-red-600"
          title={returnTargetIndex === null ? 'No hay una ruta anterior para devolver' : 'Devolver por la ruta configurada'}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Devolver
        </Button>
        <Button
          size="sm"
          onClick={() => openWorkflowAction('approve')}
          disabled={isProcessing || isStopped}
          className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {currentIndex === workflowSteps.length - 1 ? (
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
          )}
          {currentIndex === workflowSteps.length - 1 ? 'Finalizar' : 'Aprobar'}
        </Button>
      </div>
    );
  };

  const toggleInboxGroup = (groupKey: string) => {
    setCollapsedInboxGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  const renderInboxHierarchyMarker = (options: any = {}) => {
    if (options.groupToggle) {
      const { collapsed, count, onToggle, label } = options.groupToggle;
      const Icon = collapsed ? ChevronRight : ChevronDown;

      return (
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-indigo-100 bg-white px-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-700 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50"
          title={label}
          aria-label={label}
        >
          <Icon size={13} strokeWidth={2.5} />
          {count}
        </button>
      );
    }

    if (options.nested) {
      return (
        <span className="inline-flex h-6 shrink-0 items-center justify-center rounded-md bg-indigo-50 px-1 text-indigo-400">
          <CornerDownRight size={13} strokeWidth={2.4} />
        </span>
      );
    }

    return null;
  };

  const renderInboxItem = (task: any, options: any = {}) => {
    const taskIsWorkflow = isWorkflowItem(task);
    const dueState = getDueState(task);
    const urgencyStyles = getInboxUrgencyStyles(dueState);
    const endDate = getTaskDate(task.endDate || task.end);
    const dueText = endDate
      ? `Vence ${format(endDate, 'd MMM', { locale: es })}`
      : `Creada ${format(getTaskDate(task.createdAt) || new Date(), 'd MMM', { locale: es })}`;
    const dueLabel = dueState === 'none' ? 'Sin fecha' : getDueLabel(dueState);
    const commentCount = Number(task.commentCount || 0);
    const title = getInboxTaskTitle(task);
    const description = task.initialObservation || task.description || 'Sin descripción';
    const priority = task.priority || 'medium';
    const isAdministrativeApproval = task.trayItemType === 'administrative_approval' && task.administrativeRequestType === 'contractorAccount';

    if (isAdministrativeApproval) {
      return (
        <article
          key={`${task.projectId}-${task.id}`}
          className="relative grid min-h-[68px] gap-3 bg-cyan-50/50 px-3 py-3 transition-colors hover:bg-cyan-50 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
        >
          <span className="absolute bottom-0 left-0 top-0 w-1 bg-cyan-500" />
          <div className="min-w-0 pl-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-cyan-600 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white">
                <ReceiptText size={12} />
                Cuenta de cobro
              </span>
              <span className="inline-flex shrink-0 rounded-md bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wider text-cyan-800 ring-1 ring-cyan-100">
                {task.contractorAccountStageLabel || 'Aprobación'}
              </span>
              <h3 className="min-w-0 flex-[1_1_100%] truncate text-sm font-black text-slate-950 sm:flex-1">{title}</h3>
            </div>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-600">
              <span className="shrink-0 font-black text-cyan-800">{task.organizationName || 'Sin organización'}</span>
              <span className="min-w-0 truncate">{task.projectName} · {description}</span>
            </div>
          </div>
          <Link
            href={task.administrativeHref || getContractorAccountAdministrationHref(task.projectId, task.contractorAccountId)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 text-xs font-black text-white shadow-sm transition hover:bg-cyan-700"
          >
            Revisar cuenta
            <ArrowRight size={14} />
          </Link>
        </article>
      );
    }

    if (!taskIsWorkflow) {
      const progress = Math.min(100, Math.max(0, Number(task.progress || 0)));
      const status = task.status || 'todo';
      const historyCount = getInteractionHistory(task).length;
      const taskIsScrum = isScrumTask(task);
      const manualScrum = isManualScrumTask(task);
      const scrumStatus = taskIsScrum ? normalizeScrumStatus(task.scrumStatus || task.status) : null;

      return (
        <article
          key={`${task.projectId}-${task.id}`}
          className={`relative grid min-h-[54px] gap-2 px-3 py-2 transition-colors lg:grid-cols-[minmax(0,1fr)_auto] lg:py-1.5 ${urgencyStyles.row} ${options.nested ? 'ml-3 border-l-2 border-indigo-100 pl-4' : ''}`}
        >
          <span className={`absolute bottom-0 left-0 top-0 w-1 ${urgencyStyles.rail}`} />
          <div className="min-w-0 pl-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {renderInboxHierarchyMarker(options)}
              {renderInboxTaskTypeBadge(task)}
              <h3 className="min-w-0 flex-[1_1_100%] truncate text-sm font-bold text-slate-900 sm:flex-1">{title}</h3>
              <span className={`hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:inline-flex ${getTaskStatusClass(status)}`}>
                {getTaskStatusLabel(status)}
              </span>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${urgencyStyles.due}`}>
                <Clock size={11} />
                {dueState === 'ok' ? 'A tiempo' : dueLabel}
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${getPriorityClass(priority)}`}>
                {getPriorityLabel(priority)}
              </span>
            </div>

            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
              <span className={`shrink-0 font-bold ${urgencyStyles.text}`}>
                {task.organizationName || 'Sin organización'}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {task.projectName ? `${task.projectName} · ` : ''}{description}
              </span>
              <span className="hidden shrink-0 text-slate-400 sm:inline">{dueText}</span>
              <div className="ml-auto hidden shrink-0 items-center gap-2 md:flex">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/80">
                  <div
                    className={`h-full ${status === 'stuck' ? 'bg-red-600' : status === 'in_progress' ? 'bg-orange-500' : urgencyStyles.progress}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="w-8 text-right text-[11px] font-bold text-slate-600">{progress}%</span>
                {task.type === 'quantitative' && (
                  <span className="max-w-[120px] truncate text-[11px] text-slate-500">
                    {task.currentValue || 0}/{task.indicatorValue || 0} {task.indicator || ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 pl-2 lg:justify-end lg:pl-0">
            {activeTab === 'pending' && manualScrum && scrumStatus && (
              <select
                value={scrumStatus}
                onChange={(event) => {
                  const nextScrumStatus = event.target.value as ScrumWorkStatus;
                  void updateAssignedTaskStatus(
                    task,
                    mapScrumStatusToTaskStatus(nextScrumStatus),
                    undefined,
                    undefined,
                    { scrumStatus: nextScrumStatus },
                  );
                }}
                disabled={processingId === task.id}
                className="h-8 min-w-[154px] flex-1 rounded-md border border-cyan-200 bg-white px-2 text-xs font-bold text-cyan-900 outline-none focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-60 sm:h-7 sm:flex-none"
                title="Cambiar etapa Scrum manual"
              >
                {SCRUM_WORK_STATUSES.map((scrumOption) => (
                  <option key={scrumOption.value} value={scrumOption.value}>{scrumOption.label}</option>
                ))}
              </select>
            )}
            {activeTab === 'pending' && taskIsScrum && !manualScrum && (
              <Link
                href={`/projects/${task.projectId}?tab=scrum&scrumView=github&workItem=${encodeURIComponent(task.id)}`}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-violet-200 bg-white px-3 text-xs font-black text-violet-700 transition hover:bg-violet-50 sm:h-7 sm:flex-none"
                title="Esta tarea avanza con evidencia GitHub"
              >
                <GitBranch size={13} /> Control GitHub
              </Link>
            )}
            {activeTab === 'pending' && !taskIsScrum && (
              <select
                value={status}
                onChange={(event) => void updateAssignedTaskStatus(task, event.target.value)}
                disabled={processingId === task.id}
                className="h-8 min-w-[132px] flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 sm:h-7 sm:flex-none"
                title="Cambiar estado"
              >
                <option value="todo">Pendiente</option>
                <option value="in_progress">Trabajando</option>
                <option value="stuck">Estancada</option>
                <option value="rescheduled">Reprogramar</option>
                <option value="completed">Finalizar</option>
                {status === 'completed_late' && <option value="completed_late">Finalizada con retraso</option>}
              </select>
            )}
            {renderUtilityButton('Detalles', <Eye size={14} />, () => setDetailsModalTask(task), 'text-slate-600 hover:bg-white/80 hover:text-indigo-700')}
            {renderUtilityButton('Comentarios', <MessageSquare size={14} />, () => setCommentsModalTask(task), 'text-slate-600 hover:bg-white/80 hover:text-indigo-700', commentCount)}
            {renderUtilityButton('Documentos', <FileText size={14} />, () => setDocsModalTask(task), 'text-indigo-600 hover:bg-white/80 hover:text-indigo-700')}
            {historyCount > 0 &&
              renderUtilityButton('Historial', <ClipboardList size={14} />, () => setHistoryModalTask(task), 'text-slate-600 hover:bg-white/80 hover:text-slate-900', historyCount)}
            <Link
              href={taskIsScrum
                ? `/projects/${task.projectId}?tab=scrum&workItem=${encodeURIComponent(task.id)}`
                : `/projects/${task.projectId}?tab=tasks`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-white/80 hover:text-slate-900"
              title="Abrir proyecto"
              aria-label="Abrir proyecto"
            >
              <FolderOpen size={14} />
            </Link>
          </div>
        </article>
      );
    }

    const currentIndex = task.currentStepIndex || 0;
    const workflowSteps = task.workflowSteps || [];
    const currentWorkflowStep = workflowSteps[currentIndex] || {};
    const stepStatus = currentWorkflowStep?.status;
    const isReturned = stepStatus === 'devuelto' || stepStatus === 'returned';
    const isStopped = stepStatus === 'detenido';
    const returnTargetIndex = resolveWorkflowPreviousStepIndex({
      steps: workflowSteps,
      currentIndex,
      history: task.workflowHistory || [],
    });
    const workflowUrgencyStyles = isReturned ? getInboxUrgencyStyles('overdue') : urgencyStyles;
    const workflowHistoryCount = getInteractionHistory(task).length;
    const attentionBadge = getWorkflowAttentionBadge(stepStatus);

    return (
      <article
        key={`${task.projectId}-${task.id}`}
        className={`relative grid min-h-[54px] gap-2 px-3 py-2 transition-colors lg:grid-cols-[minmax(0,1fr)_auto] lg:py-1.5 ${workflowUrgencyStyles.row} ${options.nested ? 'ml-3 border-l-2 border-indigo-100 pl-4' : ''}`}
      >
        <span className={`absolute bottom-0 left-0 top-0 w-1 ${workflowUrgencyStyles.rail}`} />
        <div className="min-w-0 pl-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {renderInboxHierarchyMarker(options)}
            {renderInboxTaskTypeBadge(task, true)}
            {attentionBadge && (
              <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${attentionBadge.className}`}>
                {attentionBadge.label}
              </span>
            )}
            <h3 className="min-w-0 flex-[1_1_100%] truncate text-sm font-bold text-slate-900 sm:flex-1">{title}</h3>
            <span className="hidden shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 sm:inline-flex">
              Paso {currentIndex + 1}/{workflowSteps.length || 1}
            </span>
            {isQualityGateStep(currentWorkflowStep) && (
              <span className="hidden shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 sm:inline-flex">
                <ShieldCheck size={11} />
                Calidad
              </span>
            )}
            <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${workflowUrgencyStyles.due}`}>
              <Clock size={11} />
              {dueState === 'ok' ? 'A tiempo' : dueLabel}
            </span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${getPriorityClass(priority)}`}>
              {getPriorityLabel(priority)}
            </span>
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
            <span className={`shrink-0 font-bold ${workflowUrgencyStyles.text}`}>
              {task.organizationName || 'Sin organización'}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {task.projectName ? `${task.projectName} · ` : ''}{description}
            </span>
            <span className="hidden shrink-0 text-slate-400 sm:inline">{dueText}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 pl-2 lg:justify-end lg:pl-0">
          {activeTab === 'pending' ? (
            <>
              {isStopped ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openActionModal(task, 'resume')}
                  disabled={processingId === task.id}
                  className="h-7 px-2 text-blue-600 hover:bg-white/80"
                  title="Reanudar workflow"
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openActionModal(task, 'stop')}
                  disabled={processingId === task.id}
                  className="h-7 px-2 text-orange-600 hover:bg-white/80"
                  title="Detener workflow"
                >
                  <Pause className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => openActionModal(task, 'return')}
                disabled={processingId === task.id || returnTargetIndex === null || isStopped}
                className="h-7 px-2 text-red-600 hover:bg-white/80"
                title={returnTargetIndex === null ? 'No hay una ruta anterior para devolver' : 'Devolver por la ruta configurada'}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                onClick={() => openActionModal(task, 'approve')}
                disabled={processingId === task.id || isStopped}
                className="h-7 bg-emerald-600 px-2.5 text-white hover:bg-emerald-700"
              >
                {currentIndex === workflowSteps.length - 1 ? (
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                ) : (
                  <ArrowRight className="mr-1 h-3.5 w-3.5" />
                )}
                <span className="text-xs font-bold">
                  {currentIndex === workflowSteps.length - 1 ? 'Finalizar' : 'Aprobar'}
                </span>
              </Button>
            </>
          ) : (
            <span className="rounded-md border border-slate-100 bg-white/70 px-2 py-1 text-xs font-semibold text-slate-500">
              Revisado
            </span>
          )}
          {renderUtilityButton('Detalles', <Eye size={14} />, () => setDetailsModalTask(task), 'text-slate-600 hover:bg-white/80 hover:text-indigo-700')}
          {renderUtilityButton('Documentos', <FileText size={14} />, () => setDocsModalTask(task), 'text-indigo-600 hover:bg-white/80 hover:text-indigo-700')}
          {renderUtilityButton('Comentarios', <MessageSquare size={14} />, () => setCommentsModalTask(task), 'text-slate-600 hover:bg-white/80 hover:text-indigo-700', commentCount)}
          {workflowHistoryCount > 0 &&
            renderUtilityButton('Interacciones', <ClipboardList size={14} />, () => setHistoryModalTask(task), 'text-slate-600 hover:bg-white/80 hover:text-slate-900', workflowHistoryCount)}
        </div>
      </article>
    );
  };

  const renderInboxGroup = (group: any) => {
    const isCollapsed = Boolean(collapsedInboxGroups[group.key]);
    const childCount = group.children.length;
    const groupToggle = {
      collapsed: isCollapsed,
      count: childCount,
      onToggle: () => toggleInboxGroup(group.key),
      label: `${isCollapsed ? 'Mostrar' : 'Ocultar'} ${childCount} subtarea${childCount === 1 ? '' : 's'} de ${group.parentTitle}`,
    };

    const groupHeader = group.parentTask ? (
      renderInboxItem(group.parentTask, { groupToggle })
    ) : (
      <article
        key={`${group.key}-header`}
        className="relative grid min-h-[52px] gap-2 bg-slate-50 px-3 py-2 transition-colors hover:bg-indigo-50/50 lg:grid-cols-[minmax(0,1fr)_auto]"
      >
        <span className="absolute bottom-0 left-0 top-0 w-1 bg-indigo-400" />
        <div className="min-w-0 pl-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {renderInboxHierarchyMarker({ groupToggle })}
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-indigo-700">
              <GitBranch size={11} strokeWidth={2.5} />
              Matriz
            </span>
            <h3 className="min-w-0 flex-[1_1_100%] truncate text-sm font-black text-slate-900 sm:flex-1">
              {group.parentTitle}
            </h3>
            <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-500 shadow-sm ring-1 ring-slate-200">
              {childCount} subtarea{childCount === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
            <span className="shrink-0 font-bold text-indigo-700">{group.organizationName}</span>
            <span className="min-w-0 flex-1 truncate">{group.projectName}</span>
          </div>
        </div>
        <div className="flex items-center justify-end pr-1 text-[11px] font-semibold text-slate-400">
          {isCollapsed ? 'Subtareas ocultas' : 'Subtareas desplegadas'}
        </div>
      </article>
    );

    return (
      <React.Fragment key={group.key}>
        {groupHeader}
        {!isCollapsed && group.children.map((child: any) => renderInboxItem(child, { nested: true }))}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Recibidos</h2>
              <span className="inline-flex items-center rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-bold text-white">
                {pendingInboxCount} pendiente{pendingInboxCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                activeTab === 'pending'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Pendientes
            </button>
            <button
              onClick={() => setActiveTab('reviewed')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                activeTab === 'reviewed'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Revisados
            </button>
            </div>
          </div>
        </div>

        <div className="mt-2 border-t border-slate-100 pt-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setProjectFilter('all')}
              className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors ${
                projectFilter === 'all'
                  ? 'border-indigo-200 bg-indigo-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700'
              }`}
            >
              Todo
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                projectFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {allMailboxCount}
              </span>
            </button>
            {projectOptions.map(([projectId, projectName]) => {
              const isActiveMailbox = projectFilter === projectId;
              return (
                <button
                  key={projectId}
                  type="button"
                  onClick={() => setProjectFilter(projectId)}
                  className={`inline-flex h-8 max-w-[240px] shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors ${
                    isActiveMailbox
                      ? 'border-indigo-200 bg-indigo-600 text-white shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700'
                  }`}
                  title={projectName}
                >
                  <span className="truncate">{projectName}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    isActiveMailbox ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {mailboxCounts.get(projectId) || 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[1fr_200px_220px]">
          <input
            type="text"
            placeholder="Buscar por ID, título, proyecto, organización o estado..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          <select
            value={sortFilter}
            onChange={(event) => setSortFilter(event.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            title="Ordenar tareas"
          >
            <option value="newest">Orden: recientes</option>
            <option value="due_asc">Orden: próximas a vencer</option>
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">Todos los estados</option>
            <option value="todo">Pendiente</option>
            <option value="in_progress">Trabajando</option>
            <option value="stuck">Estancada</option>
            <option value="rescheduled">Reprogramadas</option>
            <option value="en_curso">Workflow en curso</option>
            <option value="detenido">Workflow detenido</option>
            <option value="overdue">Vencidas</option>
            <option value="due_soon">Por vencer</option>
            <option value="assigned_task">Solo tareas</option>
            <option value="workflow">Solo workflows</option>
            <option value="administrative_approval">Cuentas de cobro</option>
          </select>
        </div>
      </div>

      {filteredWorkflows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center sm:p-12">
          <CheckCircle2 className="w-12 h-12 text-slate-200 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900">
            {searchTerm ? 'No se encontraron resultados' : '¡Todo al día!'}
          </h3>
          <p className="text-slate-500">
            {searchTerm ? 'Intenta con otros términos de búsqueda.' : 'No tienes workflows ni tareas pendientes asignadas.'}
          </p>
        </div>
      ) : (
        <>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {groupedInboxItems.map((item) =>
              item.type === 'group' ? renderInboxGroup(item) : renderInboxItem(item.task)
            )}
          </div>
        </div>
        </>
      )}

      {/* Action Modal */}
      {actionModal.isOpen && actionModal.task && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">
                {actionModal.type === 'approve' ? 'Aprobar y Continuar' : 
                 actionModal.type === 'return' ? 'Devolver Tarea' :
                 actionModal.type === 'stop' ? 'Detener Workflow' : 'Reanudar Workflow'}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                ¿Está seguro de {actionModal.type === 'approve' ? 'remitir' : 
                                 actionModal.type === 'return' ? 'devolver' :
                                 actionModal.type === 'stop' ? 'detener' : 'reanudar'} la tarea &quot;{actionModal.task.title}&quot;?
              </p>
            </div>
            
            <div className="p-6 space-y-4 bg-slate-50 max-h-[60vh] overflow-y-auto">
              {actionModal.type === 'approve' && actionModal.task.workflowSteps[actionModal.task.currentStepIndex || 0]?.form && (
                <div className="space-y-4 mb-6 pb-6 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <ClipboardList size={16} className="text-indigo-600" />
                    {actionModal.task.workflowSteps[actionModal.task.currentStepIndex || 0].form.title}
                  </h3>
                  
                  {actionModal.task.workflowSteps[actionModal.task.currentStepIndex || 0].form.fields.map((field: any) => (
                    <div key={field.id}>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        {field.label} {field.required && <span className="text-red-500">*</span>}
                      </label>
                      
                      {field.type === 'text' && (
                        <input
                          type="text"
                          value={formData[field.id] || ''}
                          onChange={(e) => setFormData((current) => ({ ...current, [field.id]: e.target.value }))}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          required={field.required}
                        />
                      )}
                      
                      {field.type === 'number' && (
                        <input
                          type="number"
                          value={formData[field.id] || ''}
                          onChange={(e) => setFormData((current) => ({ ...current, [field.id]: e.target.value }))}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          required={field.required}
                        />
                      )}
                      
                      {field.type === 'date' && (
                        <input
                          type="date"
                          value={formData[field.id] || ''}
                          onChange={(e) => setFormData((current) => ({ ...current, [field.id]: e.target.value }))}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          required={field.required}
                        />
                      )}

                      {field.type === 'datetime' && (
                        <input
                          type="datetime-local"
                          value={formData[field.id] || ''}
                          onChange={(e) => setFormData((current) => ({ ...current, [field.id]: e.target.value }))}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          required={field.required}
                        />
                      )}
                      
                      {field.type === 'select' && (
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          {field.options?.length ? (
                            field.selectionMode === 'single' ? (
                              <select
                                value={Array.isArray(formData[field.id]) ? (formData[field.id][0] || '') : (formData[field.id] || '')}
                                onChange={(e) => setFormData((current) => ({ ...current, [field.id]: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                required={field.required}
                              >
                                <option value="">Selecciona una opción</option>
                                {field.options.map((opt: string, idx: number) => (
                                  <option key={idx} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div className="space-y-2">
                                {field.options.map((opt: string, idx: number) => {
                                  const selectedValues = getMultiSelectValue(formData[field.id]);
                                  return (
                                    <label key={idx} className="flex items-center gap-2 text-sm text-slate-700">
                                      <input
                                        type="checkbox"
                                        checked={selectedValues.includes(opt)}
                                        onChange={() =>
                                          setFormData((current) => ({
                                            ...current,
                                            [field.id]: toggleMultiSelectValue(current[field.id], opt),
                                          }))
                                        }
                                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                                      />
                                      {opt}
                                    </label>
                                  );
                                })}
                              </div>
                            )
                          ) : (
                            <p className="text-xs text-amber-600">
                              Este campo no tiene opciones configuradas.
                            </p>
                          )}
                          <p className="text-[10px] text-slate-400">
                            {field.selectionMode === 'single'
                              ? 'Selecciona una sola opción.'
                              : 'Puedes seleccionar una o varias opciones.'}
                          </p>
                        </div>
                      )}
                      
                      {field.type === 'checkbox' && (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="checkbox"
                            id={`cb-${field.id}`}
                            checked={formData[field.id] || false}
                            onChange={(e) => setFormData((current) => ({ ...current, [field.id]: e.target.checked }))}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                            required={field.required}
                          />
                          <label htmlFor={`cb-${field.id}`} className="text-sm text-slate-600 cursor-pointer">
                            Confirmar
                          </label>
                        </div>
                      )}

                      {field.type === 'document' && (
                        <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/60 p-3">
                          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm transition-colors hover:border-indigo-200">
                            <span className="flex min-w-0 items-center gap-2">
                              <FileUp size={16} className="text-indigo-600" />
                              <span className="truncate">
                                {(workflowDocumentFiles[field.id] || []).length > 0
                                  ? `${workflowDocumentFiles[field.id].length} documento${workflowDocumentFiles[field.id].length === 1 ? '' : 's'} seleccionado${workflowDocumentFiles[field.id].length === 1 ? '' : 's'}`
                                  : 'Seleccionar documentos'}
                              </span>
                            </span>
                            <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-1 text-[10px] uppercase tracking-wider text-indigo-700">
                              Adjuntar
                            </span>
                            <input
                              type="file"
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                const selectedFiles = Array.from(event.target.files || []);
                                setWorkflowDocumentFiles((current) => ({
                                  ...current,
                                  [field.id]: selectedFiles,
                                }));
                              }}
                            />
                          </label>
                          {(workflowDocumentFiles[field.id] || []).length > 0 && (
                            <div className="mt-2 space-y-1">
                              {workflowDocumentFiles[field.id].map((selectedFile) => (
                                <div key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-indigo-100 bg-white/80 px-3 py-2 text-xs font-bold text-slate-700">
                                  <FileText size={14} className="shrink-0 text-indigo-600" />
                                  <span className="truncate">{selectedFile.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {isWorkflowDocumentValueArray(formData[field.id]) && (
                            <div className="mt-2 space-y-2">
                              {formData[field.id].map((documentValue: any, index: number) => (
                                <SecureDocumentLink
                                  key={`${documentValue.documentId || documentValue.storagePath || documentValue.url}-${index}`}
                                  storagePath={documentValue.storagePath}
                                  fallbackUrl={documentValue.url}
                                  className="flex min-w-0 items-center gap-2 rounded-lg border border-indigo-100 bg-white/80 px-3 py-2 text-xs font-bold text-indigo-700 hover:text-indigo-900"
                                >
                                  <FileText size={14} className="shrink-0" />
                                  <span className="truncate">{getWorkflowDocumentDisplayName(documentValue)}</span>
                                  <ExternalLink size={12} className="ml-auto shrink-0" />
                                </SecureDocumentLink>
                              ))}
                            </div>
                          )}
                          {isWorkflowDocumentValue(formData[field.id]) && (
                            <SecureDocumentLink
                              storagePath={formData[field.id].storagePath}
                              fallbackUrl={formData[field.id].url}
                              className="mt-2 flex min-w-0 items-center gap-2 rounded-lg border border-indigo-100 bg-white/80 px-3 py-2 text-xs font-bold text-indigo-700 hover:text-indigo-900"
                            >
                              <FileText size={14} className="shrink-0" />
                              <span className="truncate">{getWorkflowDocumentDisplayName(formData[field.id])}</span>
                              <ExternalLink size={12} className="ml-auto shrink-0" />
                            </SecureDocumentLink>
                          )}
                          <p className="mt-2 text-[11px] leading-5 text-slate-500">
                            {field.documentFolderPath
                              ? `Ruta: ${field.documentFolderPath}. `
                              : 'Ruta: carpeta principal de la tarea. '}
                            {field.documentVersioning
                              ? `Se publicará como una nueva versión de ${field.documentName || field.label}.`
                              : 'Quedará como evidencia independiente del paso.'}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {activeApproveNeedsNextAssignee && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Asignar siguiente paso a <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={nextStepAssignee}
                    onChange={(e) => setNextStepAssignee(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    required
                  >
                    <option value="">Seleccione un responsable...</option>
                    {projectTeamMembers.map(member => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </select>
                  {activeApproveNextStepRequiresDynamicAssignee && (
                    <p className="mt-1 text-xs font-medium text-indigo-600">
                      La ruta evaluada llega a un paso con asignación dinámica.
                    </p>
                  )}
                </div>
              )}

              {isQualityGateStep(activeQualityGateStep) && (
                <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-700">
                    <ShieldCheck size={14} />
                    Control de calidad
                  </p>
                  {actionModal.type === 'approve' && (
                    <div className="mb-3 grid gap-2 sm:grid-cols-2">
                      <label className={`cursor-pointer rounded-lg border p-3 text-xs font-bold transition ${qualityApprovalMode === 'accepted' ? 'border-emerald-200 bg-white text-emerald-700 ring-2 ring-emerald-100' : 'border-amber-100 bg-white/70 text-slate-600 hover:bg-white'}`}>
                        <input
                          type="radio"
                          checked={qualityApprovalMode === 'accepted'}
                          onChange={() => {
                            setQualityApprovalMode('accepted');
                            setQualityCauseIds([]);
                            setQualityObservationComment('');
                          }}
                          className="mr-2"
                        />
                        Aprobado
                      </label>
                      <label className={`cursor-pointer rounded-lg border p-3 text-xs font-bold transition ${qualityApprovalMode === 'accepted_with_observations' ? 'border-amber-300 bg-white text-amber-700 ring-2 ring-amber-100' : 'border-amber-100 bg-white/70 text-slate-600 hover:bg-white'}`}>
                        <input
                          type="radio"
                          checked={qualityApprovalMode === 'accepted_with_observations'}
                          onChange={() => setQualityApprovalMode('accepted_with_observations')}
                          className="mr-2"
                        />
                        Aprobado con observaciones
                      </label>
                    </div>
                  )}
                  {actionModal.type === 'approve' && qualityApprovalMode === 'accepted' ? (
                    <p className="text-xs text-amber-700">
                      Se registrará como revisión aceptada sin errores asociados para el contratista.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="mb-2 block text-xs font-medium text-slate-700">
                          {actionModal.type === 'return' ? 'Causales de devolución' : 'Errores observados'} <span className="text-red-500">*</span>
                        </label>
                        {projectQualityCauses.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-amber-200 bg-white/70 p-3 text-xs text-amber-700">
                            Configura primero las causales en la pestaña Gestión de calidad del proyecto.
                          </p>
                        ) : (
                          <div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border border-amber-100 bg-white p-2 sm:grid-cols-2">
                            {projectQualityCauses.map((cause) => {
                              const causeId = String(cause.id);
                              return (
                                <label key={causeId} className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-xs font-semibold text-slate-700 hover:bg-amber-50">
                                  <input
                                    type="checkbox"
                                    checked={qualityCauseIds.includes(causeId)}
                                    onChange={() => toggleQualityCause(causeId)}
                                    className="mt-0.5 h-4 w-4 rounded border-amber-200 text-amber-600 focus:ring-amber-500"
                                  />
                                  <span>{cause.name || cause.label || 'Causal sin nombre'}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {actionModal.type === 'approve' && qualityApprovalMode === 'accepted_with_observations' && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-700">
                            Observación general de los errores <span className="text-red-500">*</span>
                          </label>
                          <textarea
                            value={qualityObservationComment}
                            onChange={(event) => setQualityObservationComment(event.target.value)}
                            placeholder="Resume los errores encontrados para que queden visibles en la cuenta de cobro..."
                            className="h-20 w-full resize-none rounded-lg border border-amber-100 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeDynamicRateCardSource && (
                <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wider text-emerald-700">
                    Rate Card dinámico
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        Persona <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={dynamicRateCardAssignee}
                        onChange={(e) => setDynamicRateCardAssignee(e.target.value)}
                        className="w-full rounded-lg border border-emerald-100 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      >
                        <option value="">Seleccionar...</option>
                        {dynamicRateCardAssignee && !projectTeamMembers.some((member) => member.id === dynamicRateCardAssignee) && (
                          <option value={dynamicRateCardAssignee}>Responsable actual</option>
                        )}
                        {projectTeamMembers.map((member) => (
                          <option key={member.id} value={member.id}>{member.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        Perfil <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={dynamicRateCardId}
                        onChange={(e) => setDynamicRateCardId(e.target.value)}
                        className="w-full rounded-lg border border-emerald-100 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      >
                        <option value="">Seleccionar...</option>
                        {projectRateCards.map((rateCard) => (
                          <option key={rateCard.id} value={rateCard.id}>{rateCard.name}</option>
                        ))}
                      </select>
                    </div>
                    {activeDynamicRateCardRequestsUnits ? (
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Unidades <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9]*[.,]?[0-9]*"
                          value={dynamicRateCardUnits}
                          onChange={(e) => setDynamicRateCardUnits(e.target.value)}
                          className="w-full rounded-lg border border-emerald-100 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                    ) : (
                      <div className="md:col-span-2 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-xs text-emerald-700">
                        Auto suma: se cargarán <strong>{getDynamicRateCardUnits(activeDynamicRateCardSource.sourceConfig)}</strong> unidades configuradas.
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-[10px] text-emerald-700">
                    Este cargo quedará registrado por persona, día, semana y mes.
                  </p>
                </div>
              )}

              {manualStaticRateCardSources.length > 0 && (
                <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-sm font-medium text-slate-700">
                    Unidades a sumar <span className="text-red-500">*</span>
                  </p>
                  <div className="space-y-2">
                    {manualStaticRateCardSources.map((source) => {
                      const rateCard = projectRateCards.find((candidate) => candidate.id === source.rateCardId);

                      return (
                        <label key={source.key} className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-2">
                          <span className="truncate text-xs font-bold text-slate-600">
                            {rateCard?.name || 'Rate Card'}
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9]*[.,]?[0-9]*"
                            value={staticRateCardUnits[source.key] ?? String(source.unitsToAdd ?? '')}
                            onChange={(e) =>
                              setStaticRateCardUnits((current) => ({
                                ...current,
                                [source.key]: e.target.value,
                              }))
                            }
                            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            required
                          />
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">
                    Este paso tiene uno o varios indicadores con unidades manuales.
                  </p>
                </div>
              )}

              {runtimeStaticRateCardSources.length > 0 && (
                <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                  <p className="mb-2 text-sm font-medium text-indigo-800">
                    Profesional del Rate Card <span className="text-red-500">*</span>
                  </p>
                  <div className="space-y-2">
                    {runtimeStaticRateCardSources.map((source) => {
                      const rateCard = projectRateCards.find((candidate) => candidate.id === source.rateCardId);

                      return (
                        <label key={source.key} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(180px,260px)] md:items-center">
                          <span className="truncate text-xs font-bold text-indigo-700">
                            {rateCard?.name || 'Rate Card'}
                          </span>
                          <select
                            value={staticRateCardAssignees[source.key] || ''}
                            onChange={(e) =>
                              setStaticRateCardAssignees((current) => ({
                                ...current,
                                [source.key]: e.target.value,
                              }))
                            }
                            className="h-9 rounded-lg border border-indigo-100 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            required
                          >
                            <option value="">Selecciona profesional</option>
                            {projectTeamMembers.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name || member.email || 'Profesional'}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] text-indigo-700">
                    Este indicador se cargará al profesional seleccionado en esta aprobación.
                  </p>
                </div>
              )}

              {actionModal.type === 'approve' && actionModal.task && (() => {
                const evidenceDocs = collectWorkflowDocumentsFromHistory(actionModal.task);
                const recentHistory = [...(actionModal.task.workflowHistory || [])]
                  .sort((left: any, right: any) => getTaskTimestamp(right.timestamp) - getTaskTimestamp(left.timestamp))
                  .slice(0, 5);

                return (
                  <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                          <FileText size={16} className="text-indigo-600" />
                          Documentos e interacciones del workflow
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Revisa la evidencia generada en pasos anteriores antes de aprobar.
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold text-indigo-700">
                        {evidenceDocs.length} documentos
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                          Documentación por paso
                        </p>
                        {evidenceDocs.length > 0 ? (
                          <div className="space-y-2">
                            {evidenceDocs.slice(0, 6).map((docValue: any, index: number) => (
                              <SecureDocumentLink
                                key={`${docValue.documentId || docValue.storagePath || docValue.url}-${index}`}
                                storagePath={docValue.storagePath}
                                fallbackUrl={docValue.url}
                                className="flex min-w-0 items-start gap-2 rounded-lg border border-white bg-white px-3 py-2 text-xs shadow-sm hover:border-indigo-100"
                              >
                                <FileText size={14} className="mt-0.5 shrink-0 text-indigo-600" />
                                <span className="min-w-0">
                                  <span className="block truncate font-bold text-slate-800">
                                    {getWorkflowDocumentDisplayName(docValue)}
                                  </span>
                                  <span className="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                    {docValue.stepLabel || 'Paso'} · {docValue.fieldLabel || 'Documento'}
                                    {docValue.version ? ` · v${docValue.version}` : ''}
                                  </span>
                                </span>
                                <ExternalLink size={12} className="ml-auto mt-0.5 shrink-0 text-slate-400" />
                              </SecureDocumentLink>
                            ))}
                          </div>
                        ) : (
                          <p className="rounded-lg border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
                            Este workflow aún no tiene documentos adjuntos en sus pasos.
                          </p>
                        )}
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                          Últimas interacciones
                        </p>
                        {recentHistory.length > 0 ? (
                          <div className="space-y-2">
                            {recentHistory.map((history: any, index: number) => {
                              const historyDate = getTaskDate(history.timestamp);
                              return (
                                <div key={`${history.timestamp?.seconds || index}-${history.action}`} className="rounded-lg border border-white bg-white p-3 text-xs shadow-sm">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-bold text-slate-800">{history.userName || history.userEmail || 'Usuario'}</span>
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                      {history.action || 'interacción'}
                                    </span>
                                  </div>
                                  <p className="mt-1 line-clamp-2 text-slate-600">{history.comment || 'Sin observación registrada.'}</p>
                                  {historyDate && (
                                    <p className="mt-1 text-[10px] font-semibold text-slate-400">
                                      {format(historyDate, "d MMM yyyy, h:mm a", { locale: es })}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="rounded-lg border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
                            Este workflow aún no tiene interacciones registradas.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Observaciones <span className="text-red-500">*</span>
                </label>
                <textarea
                  placeholder="Ingrese sus observaciones (obligatorio)..."
                  value={actionComment}
                  onChange={(e) => setActionComment(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none h-24"
                  required
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setActionModal({ isOpen: false, task: null, type: 'approve' });
                  setWorkflowDocumentFiles({});
                  setStaticRateCardAssignees({});
                  resetQualityReviewFields();
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmAction}
                disabled={!actionComment.trim() || processingId === actionModal.task.id || (activeApproveNeedsNextAssignee && !nextStepAssignee) || activeQualityGateMissingCauses || activeQualityGateMissingObservation || hasMissingManualStaticUnits || hasMissingRuntimeStaticAssignees || (Boolean(activeDynamicRateCardSource) && (!dynamicRateCardAssignee || !dynamicRateCardId || (activeDynamicRateCardRequestsUnits && isInvalidRateCardUnits(dynamicRateCardUnits))))}
                className={
                  actionModal.type === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 
                  actionModal.type === 'return' ? 'bg-red-600 hover:bg-red-700 text-white' :
                  actionModal.type === 'stop' ? 'bg-orange-600 hover:bg-orange-700 text-white' :
                  'bg-blue-600 hover:bg-blue-700 text-white'
                }
              >
                {processingId === actionModal.task.id ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : actionModal.type === 'approve' ? (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                ) : actionModal.type === 'return' ? (
                  <ArrowLeft className="w-4 h-4 mr-2" />
                ) : actionModal.type === 'stop' ? (
                  <Pause className="w-4 h-4 mr-2" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                {actionModal.type === 'approve' ? 'Confirmar y Remitir' : 
                 actionModal.type === 'return' ? 'Confirmar Devolución' :
                 actionModal.type === 'stop' ? 'Confirmar Detención' : 'Confirmar Reanudación'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {meetingCompletionModal.isOpen && meetingCompletionModal.task && (() => {
        const meetingTask = meetingCompletionModal.task;
        const participantIds = getMeetingParticipantIds(meetingTask);
        const completedParticipantIds = participantIds.filter((participantId) =>
          (meetingTask.meetingResponses || []).some((response: any) => meetingResponseMatchesActor(response, [participantId]))
        );
        const pendingCount = Math.max(0, participantIds.length - completedParticipantIds.length - 1);

        return (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-700">
                    <CalendarDays size={14} />
                    Cierre de reunión
                  </div>
                  <h2 className="truncate text-xl font-bold text-slate-900">
                    {meetingTask.title || meetingTask.name || 'Reunión'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {getMeetingScheduleLabel(meetingTask)}
                  </p>
                  {getMeetingLocation(meetingTask) && (
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-cyan-700">
                      <MapPin size={13} className="shrink-0" />
                      {isMeetingLocationUrl(meetingTask) ? (
                        <a
                          href={getMeetingLocation(meetingTask)}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 truncate underline decoration-cyan-300 underline-offset-2"
                        >
                          {getMeetingLocation(meetingTask)}
                        </a>
                      ) : (
                        <span className="min-w-0 truncate">{getMeetingLocation(meetingTask)}</span>
                      )}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setMeetingCompletionModal({ isOpen: false, task: null, nextStatus: 'completed' });
                    setMeetingCompletionComment('');
                  }}
                  className="shrink-0"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </Button>
              </div>

              <div className="space-y-4 bg-slate-50 p-6">
                <div className="rounded-xl border border-cyan-100 bg-white p-4">
                  <p className="text-sm font-bold text-slate-900">
                    Tu comentario quedará unido al acta de la reunión.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Cuando todos los responsables hayan comentado, Pixel creará una entrada única en la bitácora del proyecto.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                      {completedParticipantIds.length} comentaron
                    </span>
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                      {pendingCount} quedarán pendientes
                    </span>
                  </div>
                  {(getMeetingDescription(meetingTask) || getMeetingAgenda(meetingTask)) && (
                    <div className="mt-3 space-y-2">
                      {getMeetingDescription(meetingTask) && (
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Descripción</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">
                            {getMeetingDescription(meetingTask)}
                          </p>
                        </div>
                      )}
                      {getMeetingAgenda(meetingTask) && (
                        <div className="rounded-lg bg-cyan-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wider text-cyan-700">Agenda</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 [overflow-wrap:anywhere]">
                            {getMeetingAgenda(meetingTask)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-bold text-slate-700">
                    Comentario de la reunión <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={meetingCompletionComment}
                    onChange={(e) => setMeetingCompletionComment(e.target.value)}
                    className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    placeholder="Escribe acuerdos, decisiones, bloqueos o compromisos que aportaste a esta reunión..."
                  />
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setMeetingCompletionModal({ isOpen: false, task: null, nextStatus: 'completed' });
                    setMeetingCompletionComment('');
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={confirmMeetingCompletion}
                  disabled={processingId === meetingTask.id || !meetingCompletionComment.trim()}
                  className="bg-cyan-700 text-white hover:bg-cyan-800"
                >
                  {processingId === meetingTask.id && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Guardar comentario
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {pauseTaskModal.isOpen && pauseTaskModal.task && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-orange-700">
                  <Pause size={14} />
                  Estancar tarea
                </div>
                <h2 className="text-xl font-bold text-slate-900">
                  {pauseTaskModal.task.title || pauseTaskModal.task.name || 'Tarea'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  El vencimiento quedará pausado y el motivo se guardará en interacciones.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setPauseTaskModal({ isOpen: false, task: null });
                  setPauseReason('');
                }}
                className="shrink-0"
              >
                <X className="h-5 w-5 text-slate-400" />
              </Button>
            </div>

            <div className="space-y-4 bg-slate-50 p-6">
              <div className="rounded-xl border border-orange-100 bg-orange-50 p-4 text-sm text-orange-800">
                Describe el bloqueo con suficiente contexto para que el equipo entienda qué se debe resolver antes de reanudar.
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">
                  Motivo del estancamiento <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={pauseReason}
                  onChange={(event) => setPauseReason(event.target.value)}
                  className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-orange-500/20"
                  placeholder="Ej: Se pausa porque falta aprobación del cliente, insumo externo o definición técnica..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 p-6">
              <Button
                variant="outline"
                onClick={() => {
                  setPauseTaskModal({ isOpen: false, task: null });
                  setPauseReason('');
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmPauseAssignedTask}
                disabled={processingId === pauseTaskModal.task.id || !pauseReason.trim()}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                {processingId === pauseTaskModal.task.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar pausa
              </Button>
            </div>
          </div>
        </div>
      )}

      {rescheduleTaskModal.isOpen && rescheduleTaskModal.task && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-700">
                  <CalendarDays size={14} />
                  Reprogramación
                </div>
                <h2 className="text-xl font-bold text-slate-900">
                  {rescheduleTaskModal.task.title || rescheduleTaskModal.task.name || 'Tarea'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Cambia el cronograma y deja la tarea nuevamente en estado trabajando.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setRescheduleTaskModal({ isOpen: false, task: null });
                  setRescheduleStartDate('');
                  setRescheduleEndDate('');
                  setRescheduleReason('');
                }}
                className="shrink-0"
              >
                <X className="h-5 w-5 text-slate-400" />
              </Button>
            </div>

            <div className="space-y-4 bg-slate-50 p-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-bold text-slate-700">
                    Nueva fecha de inicio <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={rescheduleStartDate}
                    onChange={(event) => setRescheduleStartDate(event.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-slate-700">
                    Nueva fecha fin <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={rescheduleEndDate}
                    onChange={(event) => setRescheduleEndDate(event.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">
                  Argumento de la reprogramación <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rescheduleReason}
                  onChange={(event) => setRescheduleReason(event.target.value)}
                  className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Explica por qué cambia el cronograma y qué se espera resolver con la nueva fecha..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 p-6">
              <Button
                variant="outline"
                onClick={() => {
                  setRescheduleTaskModal({ isOpen: false, task: null });
                  setRescheduleStartDate('');
                  setRescheduleEndDate('');
                  setRescheduleReason('');
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmRescheduleAssignedTask}
                disabled={
                  processingId === rescheduleTaskModal.task.id ||
                  !rescheduleStartDate ||
                  !rescheduleEndDate ||
                  !rescheduleReason.trim()
                }
                className="bg-indigo-600 text-white hover:bg-indigo-700"
              >
                {processingId === rescheduleTaskModal.task.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reprogramar tarea
              </Button>
            </div>
          </div>
        </div>
      )}

      {dynamicRateCardModal.isOpen && dynamicRateCardModal.task && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-800">Asignar Rate Card</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {dynamicRateCardModal.task.title || dynamicRateCardModal.task.name || 'Tarea'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setDynamicRateCardModal({ isOpen: false, task: null, nextStatus: 'completed' });
                  resetDynamicRateCardFields();
                }}
              >
                <X className="w-5 h-5 text-slate-400" />
              </Button>
            </div>

            <div className="p-6 space-y-4 bg-slate-50">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Persona que aporta <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={dynamicRateCardAssignee}
                    onChange={(e) => setDynamicRateCardAssignee(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">Seleccionar...</option>
                    {dynamicRateCardAssignee && !projectTeamMembers.some((member) => member.id === dynamicRateCardAssignee) && (
                      <option value={dynamicRateCardAssignee}>Responsable actual</option>
                    )}
                    {projectTeamMembers.map((member) => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Perfil de Rate Card <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={dynamicRateCardId}
                    onChange={(e) => setDynamicRateCardId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">Seleccionar...</option>
                    {projectRateCards.map((rateCard) => (
                      <option key={rateCard.id} value={rateCard.id}>{rateCard.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {assignedTaskDynamicRateCardRequestsUnits ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Unidades <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    value={dynamicRateCardUnits}
                    onChange={(e) => setDynamicRateCardUnits(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm text-emerald-700">
                  Auto suma: se cargarán <strong>{getDynamicRateCardUnits(dynamicRateCardModal.task)}</strong> unidades configuradas.
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Comentario
                </label>
                <textarea
                  value={dynamicRateCardComment}
                  onChange={(e) => setDynamicRateCardComment(e.target.value)}
                  className="h-20 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Detalle opcional del aporte..."
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setDynamicRateCardModal({ isOpen: false, task: null, nextStatus: 'completed' });
                  resetDynamicRateCardFields();
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmAssignedTaskDynamicRateCard}
                disabled={processingId === dynamicRateCardModal.task.id || !dynamicRateCardAssignee || !dynamicRateCardId || (assignedTaskDynamicRateCardRequestsUnits && isInvalidRateCardUnits(dynamicRateCardUnits))}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {processingId === dynamicRateCardModal.task.id && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Guardar y finalizar
              </Button>
            </div>
          </div>
        </div>
      )}

      <CompleteSubtaskFormModal
        isOpen={completionFormModal.isOpen}
        onClose={() => setCompletionFormModal({ isOpen: false, task: null, nextStatus: 'completed' })}
        task={completionFormModal.task}
        user={user}
        teamMembers={projectTeamMembers}
        rateCards={projectRateCards}
        tasks={workflows}
        onSubmit={confirmAssignedSubtaskCompletionForm}
      />

      {detailsModalTask && (() => {
        const detailTask = detailsModalTask;
        const taskIsWorkflow = isWorkflowItem(detailTask);
        const detailDueState = getDueState(detailTask);
        const detailUrgencyStyles = getInboxUrgencyStyles(detailDueState);
        const detailEndDate = getTaskDate(detailTask.endDate || detailTask.end);
        const detailTitle = getInboxTaskTitle(detailTask);
        const detailProgress = Math.min(100, Math.max(0, Number(detailTask.progress || 0)));
        const detailWorkflowSteps = detailTask.workflowSteps || [];
        const detailCurrentIndex = detailTask.currentStepIndex || 0;
        const detailCurrentStep = detailWorkflowSteps[detailCurrentIndex] || {};
        const detailAttentionBadge = taskIsWorkflow ? getWorkflowAttentionBadge(detailCurrentStep?.status) : null;
        const detailIsScrum = isScrumTask(detailTask);
        const detailScrumMode = detailIsScrum ? getScrumExecutionMode(detailTask) : null;
        const detailScrumStatus = detailIsScrum ? normalizeScrumStatus(detailTask.scrumStatus || detailTask.status) : null;

        return (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-4 shrink-0">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {renderInboxTaskTypeBadge(detailTask, taskIsWorkflow)}
                    {detailAttentionBadge && (
                      <span className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${detailAttentionBadge.className}`}>
                        {detailAttentionBadge.label}
                      </span>
                    )}
                    <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${detailUrgencyStyles.due}`}>
                      {detailDueState === 'ok' ? 'A tiempo' : detailDueState === 'none' ? 'Sin fecha' : getDueLabel(detailDueState)}
                    </span>
                    <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${getPriorityClass(detailTask.priority || 'medium')}`}>
                      {getPriorityLabel(detailTask.priority || 'medium')}
                    </span>
                  </div>
                  <h2 className="break-words text-lg font-bold text-slate-900">{detailTitle}</h2>
                  <p className="mt-1 break-words text-sm text-slate-500">
                    {detailTask.organizationName || 'Sin organización'} · {detailTask.projectName || 'Sin proyecto'}
                    {detailEndDate ? ` · Vence ${format(detailEndDate, 'd MMM yyyy', { locale: es })}` : ''}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setDetailsModalTask(null)} className="shrink-0">
                  <X className="w-5 h-5 text-slate-400" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto bg-slate-50 p-5">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">
                    {detailTask.initialObservation || detailTask.description || 'Sin descripción'}
                  </p>

                  {detailIsScrum && detailScrumMode && detailScrumStatus && (
                    <div className={`mt-4 rounded-xl border p-3 ${detailScrumMode === 'manual' ? 'border-cyan-200 bg-cyan-50' : 'border-violet-200 bg-violet-50'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`text-[10px] font-black uppercase tracking-wider ${detailScrumMode === 'manual' ? 'text-cyan-700' : 'text-violet-700'}`}>Control Scrum</p>
                          <p className="mt-1 break-words text-sm font-black text-slate-900">
                            {detailScrumMode === 'manual' ? 'Manual desde esta Bandeja' : 'Automático con GitHub'}
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-700 ring-1 ring-slate-200">
                          {getScrumStatusLabel(detailScrumStatus)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">
                        {detailScrumMode === 'manual'
                          ? 'Los cambios hechos aquí se reflejan inmediatamente en el sprint y el tablero de Desarrollo.'
                          : `El avance técnico usa ${detailTask.scrumCode || 'el código Pixel'} y se consulta en la pestaña GitHub.`}
                      </p>
                    </div>
                  )}

                  {detailIsScrum && (
                    <div className="mt-4 rounded-xl border border-cyan-200 bg-white p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-cyan-700">Criterios de aceptación</p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-xs font-semibold leading-5 text-slate-700 [overflow-wrap:anywhere]">
                        {detailTask.acceptanceCriteria || 'Esta tarea no tiene criterios definidos. Deben completarse antes de su validación.'}
                      </p>
                    </div>
                  )}

                  {isMeetingTask(detailTask) && (
                    <div className="mt-4 rounded-xl border border-cyan-100 bg-cyan-50 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-bold text-cyan-900">
                            <CalendarDays size={16} />
                            {getMeetingScheduleLabel(detailTask)}
                          </div>
                          <p className="mt-1 text-xs font-semibold text-cyan-700">
                            {getMeetingRecurrenceLabel(detailTask)}
                          </p>
                          {getMeetingLocation(detailTask) && (
                            <p className="mt-2 flex min-w-0 items-center gap-2 text-xs text-cyan-800">
                              <MapPin size={13} className="shrink-0" />
                              {isMeetingLocationUrl(detailTask) ? (
                                <a
                                  href={getMeetingLocation(detailTask)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="min-w-0 truncate font-bold underline decoration-cyan-300 underline-offset-2"
                                >
                                  {getMeetingLocation(detailTask)}
                                </a>
                              ) : (
                                <span className="min-w-0 truncate">{getMeetingLocation(detailTask)}</span>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => downloadMeetingIcs(detailTask)}
                            className="h-8 border-cyan-200 bg-white text-cyan-700 hover:bg-cyan-50"
                          >
                            <Download className="mr-1 h-3.5 w-3.5" />
                            .ics
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              const url = createGoogleCalendarUrl(detailTask);
                              if (url) window.open(url, '_blank', 'noopener,noreferrer');
                            }}
                            className="h-8 bg-cyan-700 text-white hover:bg-cyan-800"
                          >
                            <ExternalLink className="mr-1 h-3.5 w-3.5" />
                            Google
                          </Button>
                        </div>
                      </div>
                      {getMeetingDescription(detailTask) && (
                        <div className="mt-4 rounded-lg border border-cyan-100 bg-white p-3">
                          <p className="text-[10px] font-black uppercase tracking-wider text-cyan-700">
                            Descripción
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 [overflow-wrap:anywhere]">
                            {getMeetingDescription(detailTask)}
                          </p>
                        </div>
                      )}
                      {getMeetingAgenda(detailTask) && (
                        <div className="mt-3 rounded-lg border border-cyan-100 bg-white p-3">
                          <p className="text-[10px] font-black uppercase tracking-wider text-cyan-700">
                            Agenda
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 [overflow-wrap:anywhere]">
                            {getMeetingAgenda(detailTask)}
                          </p>
                        </div>
                      )}
                      {Array.isArray(detailTask.meetingResponses) && detailTask.meetingResponses.length > 0 && (
                        <div className="mt-4 rounded-lg border border-cyan-100 bg-white p-3">
                          <p className="mb-2 text-xs font-black uppercase tracking-wider text-cyan-700">
                            Comentarios registrados
                          </p>
                          <div className="space-y-2">
                            {detailTask.meetingResponses.map((response: any, index: number) => (
                              <div key={response.id || `${response.participantId}-${index}`} className="rounded-lg bg-slate-50 p-2">
                                <p className="text-xs font-bold text-slate-800">
                                  {response.participantName || response.userName || getMeetingParticipantName(detailTask, response.participantId, `Participante ${index + 1}`)}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                                  {response.comment || 'Sin comentario'}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {taskIsWorkflow ? (
                    <div className="mt-4 space-y-2">
                      {detailWorkflowSteps.map((step: any, index: number) => {
                        const isCurrent = index === detailCurrentIndex;
                        const stepStatus = step?.status || (isCurrent ? 'en_curso' : 'pendiente');

                        return (
                          <div
                            key={step.id || step.label || index}
                            className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${isCurrent ? 'border-indigo-200 bg-indigo-50' : 'border-slate-100 bg-slate-50'}`}
                          >
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isCurrent ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>
                              {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-slate-900">
                                {step.label || `Paso ${index + 1}`}
                              </p>
                              <p className="truncate text-xs text-slate-500">
                                {step.assignedToName || step.assigneeName || step.assignedRole || 'Sin responsable visible'}
                              </p>
                            </div>
                            <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getWorkflowStepStatusClass(stepStatus)}`}>
                              {getWorkflowStepStatusLabel(stepStatus)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg bg-slate-50 p-3">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                        <span>{getTaskStatusLabel(detailTask.status || 'todo')}</span>
                        <span>{detailProgress}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                        <div className={`h-full ${detailUrgencyStyles.progress}`} style={{ width: `${detailProgress}%` }} />
                      </div>
                      {detailTask.type === 'quantitative' && (
                        <p className="mt-2 text-xs text-slate-500">
                          Avance: {detailTask.currentValue || 0}/{detailTask.indicatorValue || 0} {detailTask.indicator || ''}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4">
                {renderWorkflowModalActions(detailTask, () => setDetailsModalTask(null))}
                <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCommentsModalTask(detailTask);
                    setDetailsModalTask(null);
                  }}
                >
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Comentarios
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDocsModalTask(detailTask);
                    setDetailsModalTask(null);
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Documentos
                </Button>
                <Link
                  href={detailIsScrum
                    ? `/projects/${detailTask.projectId}?tab=scrum&workItem=${encodeURIComponent(detailTask.id)}`
                    : `/projects/${detailTask.projectId}?tab=tasks`}
                  onClick={() => setDetailsModalTask(null)}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  {detailIsScrum ? 'Abrir en Desarrollo' : 'Abrir proyecto'}
                </Link>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* History Modal */}
      {historyModalTask && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-xl font-bold text-slate-800">Historial de Interacciones</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {getInboxTaskTitle(historyModalTask)}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setHistoryModalTask(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </Button>
            </div>
            
            <div className="p-6 overflow-y-auto bg-slate-50 flex-1">
              {(() => {
                const historyEntries = getInteractionHistory(historyModalTask)
                  .slice()
                  .sort((left: any, right: any) => getTaskTimestamp(right.timestamp) - getTaskTimestamp(left.timestamp));

                return (
                  <div className="space-y-6">
                    {historyEntries.map((history: any, index: number) => {
                      const historyDate = getTaskDate(history.timestamp);
                      const historyKey = history.id || `${history.historyType}-${historyDate?.getTime() || 0}-${index}`;

                      return (
                        <div key={historyKey} className="flex min-w-0 gap-3 sm:gap-4">
                          <div className="mt-1 shrink-0">
                            {renderHistoryIcon(history)}
                          </div>
                          <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">
                                  {getHistoryActorName(history)}
                                </p>
                                <p className="break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
                                  {getHistoryDetailText(history, historyModalTask)}
                                </p>
                              </div>
                              <div className="shrink-0 text-left sm:text-right">
                                <span className={`rounded-full px-2 py-1 text-xs font-medium ${getHistoryBadgeClass(history)}`}>
                                  {getHistoryBadgeLabel(history)}
                                </span>
                                <p className="mt-1 text-[10px] text-slate-400">
                                  {historyDate ? format(historyDate, "d MMM yyyy, h:mm a", { locale: es }) : 'Fecha desconocida'}
                                </p>
                              </div>
                            </div>
                            {(history.comment || history.dynamicRateCard?.comment) && (
                              <div className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700 [overflow-wrap:anywhere]">
                                {history.comment || history.dynamicRateCard?.comment}
                              </div>
                            )}

                            {history.formData && Object.keys(history.formData).length > 0 && (
                              <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-indigo-600">Datos del Formulario</p>
                                <div className="space-y-2">
                                  {Object.entries(history.formData).map(([fieldId, value]: [string, any]) => {
                                    const step = historyModalTask.workflowSteps?.[history.stepIndex];
                                    const field = step?.form?.fields?.find((f: any) => f.id === fieldId);
                                    return (
                                      <div
                                        key={fieldId}
                                        className="grid min-w-0 gap-1 rounded-md border border-indigo-100/60 bg-white/55 p-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-3"
                                      >
                                        <span className="min-w-0 break-words text-[11px] font-bold uppercase tracking-wide text-slate-600 [overflow-wrap:anywhere]">
                                          {field?.label || fieldId}
                                        </span>
                                        {renderHistoryFormValue(value, field)}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {historyEntries.length === 0 && (
                  <div className="text-center py-8 text-slate-500">
                    <MessageSquare className="w-12 h-12 mx-auto text-slate-200 mb-3" />
                    <p>No hay interacciones registradas aún.</p>
                  </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {(() => {
              const historyActions = renderWorkflowModalActions(historyModalTask, () => setHistoryModalTask(null));
              if (!historyActions) return null;

              return (
                <div className="flex justify-end border-t border-slate-100 bg-white p-4">
                  {historyActions}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Documents Modal */}
      <TaskDocumentsViewer
        isOpen={!!docsModalTask}
        onClose={() => setDocsModalTask(null)}
        task={docsModalTask}
        userId={user?.uid || ''}
        currentUser={user}
        teamMembers={projectTeamMembers}
        canManageAccess={false}
        canDeleteDocuments={false}
      />

      <TaskCommentsModal
        isOpen={!!commentsModalTask}
        onClose={() => setCommentsModalTask(null)}
        projectId={commentsModalTask?.projectId || ''}
        task={commentsModalTask}
        currentUser={user}
        teamMembers={projectTeamMembers}
        footerActions={commentsModalTask ? renderWorkflowModalActions(commentsModalTask, () => setCommentsModalTask(null)) : null}
      />
    </div>
  );
}
