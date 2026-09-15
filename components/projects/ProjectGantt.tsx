"use client"

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import "gantt-task-react/dist/index.css";
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { GripVertical, Trash2, RefreshCw, FileText, ListTodo, Users, Calendar, ChevronLeft, ChevronRight, AlertCircle, Plus, PanelRightClose, PanelRightOpen, Settings, CornerDownRight, MessageSquare, MoreHorizontal, RotateCcw, ClipboardList, Search, X, EyeOff, Maximize2, History, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { TaskDateEditorModal } from './TaskDateEditorModal';
import { getTaskDisplayTitle, getTaskTitle, sanitizeTaskTitleForSave } from '@/lib/task-title';
import { createGoogleCalendarUrl, downloadMeetingIcs, getMeetingEndDate, getMeetingScheduleLabel, getMeetingStartDate, isMeetingTask } from '@/lib/calendar-utils';
import { getWorkflowTaskTypeLabel, isStateWorkflowTaskType, isVariableWorkflowTaskType, isWorkflowTaskType } from '@/lib/workflow-routing';

type ScheduleFilter = 'overdue' | 'due_soon' | 'completed_late' | null;

type TaskGroup = {
  id: string;
  name: string;
  color?: string;
  order?: number;
};

type VisibleTaskRow =
  | { type: 'group'; id: string; group: TaskGroup; taskCount: number; tasks: any[] }
  | { type: 'task'; id: string; task: any };

type FullscreenGanttTaskMeta = {
  rowKind: 'group' | 'task';
  title: string;
  parentTitle?: string;
  groupColor?: string;
  groupTaskCount?: number;
  depth: number;
  childCount: number;
  isExpanded: boolean;
  isWorkflowStep?: boolean;
  taskTypeLabel?: string;
  statusLabel?: string;
  priorityLabel?: string;
  assigneeName?: string;
  dateLabel?: string;
  progress?: number;
};

type FullscreenGanttTask = Task & {
  fullscreenMeta?: FullscreenGanttTaskMeta;
};

interface ProjectGanttProps {
  tasks: any[];
  teamMembers: any[];
  assigneeOptions?: any[];
  taskGroups?: TaskGroup[];
  onUpdateTaskProgress?: (taskId: string, progress: number, task: any) => void;
  onUpdateTaskValue?: (taskId: string, value: number, task: any) => void;
  onUpdateTaskStatus?: (taskId: string, status: string, task: any) => void;
  onUpdateTaskPriority?: (taskId: string, priority: string, task: any) => void;
  onUpdateTaskAssignee?: (taskId: string, assigneeId: string, task: any) => void;
  onUpdateTaskGroup?: (taskId: string, groupId: string, task: any) => void | Promise<void>;
  onDeleteTask?: (taskId: string) => void;
  onDeleteTasks?: (taskIds: string[]) => void;
  onDeleteTaskTree?: (taskId: string, task: any) => void;
  onSyncTask?: (taskId: string, task: any) => void;
  onReorderTasks?: (newTasks: any[]) => void;
  onUpdateTaskDates?: (taskId: string, start: Date, end: Date, task: any) => void;
  onUpdateTaskTitle?: (taskId: string, title: string, task: any) => void | Promise<void>;
  onCreateTaskGroup?: (name: string, color: string) => void | Promise<void>;
  onUpdateTaskGroupDefinition?: (groupId: string, updates: Partial<TaskGroup>) => void | Promise<void>;
  onDeleteTaskGroup?: (groupId: string) => void | Promise<void>;
  onOpenIncrementTask?: (task: any) => void;
  canEditTaskDetails?: boolean;
  canEditTaskDates?: boolean;
  canEditTaskStatus?: boolean;
  canAddSubtasks?: boolean;
  canEditTaskStructure?: boolean;
  canDeleteTasks?: boolean;
  onEditTaskStructure?: (task: any) => void;
  onAddSubtask?: (task: any) => void;
  onOpenTaskDocs?: (taskId: string, task: any) => void;
  onOpenTaskComments?: (task: any) => void;
  onResetWorkflowTask?: (task: any) => void | Promise<void>;
  onCreateBulkWorkflowIterations?: (task: any) => void;
  onRepairMissingTaskMatrix?: (task: any) => void | Promise<void>;
  onCreateTask?: () => void;
}

const UNGROUPED_GROUP_ID = '__ungrouped__';
const DEFAULT_UNGROUPED_GROUP: TaskGroup = {
  id: UNGROUPED_GROUP_ID,
  name: 'Sin grupo',
  color: '#94a3b8',
  order: -1,
};
const TASK_GROUP_COLORS = ['#579bfc', '#00c875', '#fdab3d', '#e2445c', '#a25ddc', '#00a9ff', '#ffcb00', '#784bd1'];

const getTaskDate = (value: any) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTaskDateTime = (value: any) => {
  const date = getTaskDate(value);
  return date ? date.getTime() : 0;
};

const formatTaskDateLabel = (value: any, fallback = 'Sin fecha') => {
  const date = getTaskDate(value);
  if (!date) return fallback;
  return format(date, 'd MMM yyyy', { locale: es });
};

const formatTaskDateTimeLabel = (value: any, fallback = 'Fecha no registrada') => {
  const date = getTaskDate(value);
  if (!date) return fallback;
  return format(date, 'd MMM yyyy, h:mm a', { locale: es });
};

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const resolveTimelineActorName = (entry: any, teamMembers: any[] = []) => {
  const entryEmail = normalizeEmail(entry.userEmail || entry.changedByEmail || entry.participantEmail || entry.createdByEmail);
  const entryIds = [
    entry.userId,
    entry.changedBy,
    entry.memberId,
    entry.participantId,
    ...(Array.isArray(entry.userIds) ? entry.userIds : []),
  ].filter(Boolean).map(String);
  const actor = teamMembers.find((member) => {
    if (!member) return false;
    if (entryEmail && normalizeEmail(member.email) === entryEmail) return true;
    return entryIds.some((id) => [member.id, member.uid, member.authUserId].includes(id));
  });

  return (
    actor?.name ||
    actor?.displayName ||
    entry.userEmail ||
    entry.changedByEmail ||
    entry.participantEmail ||
    entry.createdByEmail ||
    entry.userName ||
    entry.changedByName ||
    entry.participantName ||
    'Usuario'
  );
};

const getCompactMeetingScheduleLabel = (task: any) => {
  const start = getMeetingStartDate(task);
  const end = getMeetingEndDate(task);
  if (!start) return 'Horario';
  const startLabel = format(start, 'd MMM, h:mm a', { locale: es });
  if (!end) return startLabel;
  return `${startLabel} - ${format(end, 'h:mm a', { locale: es })}`;
};

const getTaskPriority = (task: any) => {
  return task?.priority || task?.originalTask?.priority || 'medium';
};

const getTaskCommentCount = (task: any) => {
  return Number(task?.commentCount || task?.originalTask?.commentCount || 0);
};

const getTaskInteractionTimeline = (task: any, teamMembers: any[] = []) => {
  if (!task) return [];

  const workflowHistory = Array.isArray(task.workflowHistory)
    ? task.workflowHistory.map((entry: any) => ({
        ...entry,
        kind: 'workflow',
        date: entry.timestamp || entry.createdAt || entry.completedAt || entry.startedAt,
        title: entry.action === 'return'
          ? 'Devolución de workflow'
          : entry.action === 'approve'
            ? 'Paso aprobado'
            : entry.action === 'stop'
              ? 'Workflow detenido'
              : entry.action === 'resume'
                ? 'Workflow reanudado'
                : 'Interacción de workflow',
        description: entry.stepLabel || entry.comment || entry.status || '',
        actor: resolveTimelineActorName(entry, teamMembers),
      }))
    : [];

  const statusHistory = Array.isArray(task.statusHistory)
    ? task.statusHistory.map((entry: any) => ({
        ...entry,
        kind: 'status',
        date: entry.timestamp || entry.createdAt,
        title: entry.action === 'reschedule'
          ? 'Tarea reprogramada'
          : entry.action === 'pause'
            ? 'Tarea estancada'
            : entry.action === 'resume'
              ? 'Tarea reanudada'
              : 'Cambio de estado',
        description: entry.comment || [entry.previousStatus, entry.effectiveStatus || entry.status].filter(Boolean).join(' -> '),
        actor: resolveTimelineActorName(entry, teamMembers),
      }))
    : [];

  const reviewReceipts = Array.isArray(task.taskReviewReceipts)
    ? task.taskReviewReceipts.map((entry: any) => ({
        ...entry,
        kind: 'review',
        date: entry.timestamp || entry.createdAt,
        title: 'Revisión registrada',
        description: entry.comment || entry.status || '',
        actor: resolveTimelineActorName(entry, teamMembers),
      }))
    : [];

  const incrementHistory = Array.isArray(task.incrementHistory)
    ? task.incrementHistory.map((entry: any) => ({
        ...entry,
        kind: 'increment',
        date: entry.createdAt || entry.timestamp,
        title: 'Incremento registrado',
        description: `${entry.amount || 0} ${entry.indicator || task.indicator || ''}`.trim(),
        actor: entry.createdByEmail || entry.createdBy || 'Usuario',
      }))
    : [];

  return [...workflowHistory, ...statusHistory, ...reviewReceipts, ...incrementHistory]
    .sort((left: any, right: any) => getTaskDateTime(right.date) - getTaskDateTime(left.date));
};

const getTaskGroupId = (task: any) => task?.groupId || UNGROUPED_GROUP_ID;

const getTaskGroupColor = (group?: TaskGroup) => group?.color || '#579bfc';

const normalizeSearchValue = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const getStatusSearchTerms = (status: string) => {
  switch (status) {
    case 'completed':
    case 'listo':
      return 'completed listo finalizado finalizada terminado terminada';
    case 'completed_late':
      return 'completed_late listo con retraso finalizado con retraso tarde';
    case 'rescheduled':
      return 'rescheduled reprogramacion reprogramada reprogramado cambio cronograma fechas';
    case 'in_progress':
    case 'en_curso':
      return 'in_progress en curso trabajando iniciado iniciada';
    case 'stuck':
    case 'detenido':
      return 'stuck detenido estancado bloqueado bloqueada';
    case 'devuelto':
      return 'devuelto devolucion corregir correccion';
    case 'reproceso':
      return 'reproceso devuelto correccion';
    case 'todo':
    case 'pending':
      return 'todo pending pendiente no iniciado';
    case 'not_started':
      return 'not_started no iniciado sin iniciar pendiente';
    default:
      return status || '';
  }
};

const getPrioritySearchTerms = (priority: string) => {
  switch (priority) {
    case 'high':
      return 'high alta urgente critica critico prioridad alta';
    case 'low':
      return 'low baja prioridad baja';
    case 'medium':
    default:
      return 'medium media prioridad media';
  }
};

const getTaskTime = (value: any) => {
  const date = getTaskDate(value);
  return date ? date.getTime() : null;
};

const getGroupDateRange = (tasks: any[]) => {
  const starts = tasks
    .map((task) => getTaskTime(task.startDate || task.start))
    .filter((value): value is number => value !== null);
  const ends = tasks
    .map((task) => getTaskTime(task.endDate || task.end))
    .filter((value): value is number => value !== null);
  const fallback = new Date();

  return {
    start: starts.length ? new Date(Math.min(...starts)) : fallback,
    end: ends.length ? new Date(Math.max(...ends)) : fallback,
  };
};

const getGroupProgress = (tasks: any[]) => {
  if (tasks.length === 0) return 0;
  const total = tasks.reduce((sum, task) => sum + Number(task.progress || 0), 0);
  return Math.round(total / tasks.length);
};

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'high':
      return 'bg-[#e2445c] text-white';
    case 'medium':
      return 'bg-[#5559df] text-white';
    case 'low':
      return 'bg-[#c4c4c4] text-white';
    default:
      return 'bg-[#5559df] text-white';
  }
};

const getTaskScheduleState = (task: any) => {
  const status = task?.status || 'todo';
  if (status === 'completed_late') return 'completed_late';
  if (status === 'completed' || status === 'listo') return 'completed';
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

const isTaskFinished = (task: any) => {
  const status = task?.status || '';
  return status === 'completed' || status === 'completed_late' || status === 'listo';
};

const getScheduleRailColor = (task: any) => {
  const scheduleState = getTaskScheduleState(task);
  if (scheduleState === 'overdue') return 'bg-red-600';
  if (scheduleState === 'due_soon') return 'bg-orange-500';
  if (scheduleState === 'completed_late') return 'bg-orange-600';
  if (scheduleState === 'completed') return 'bg-[#00c875]';
  if (scheduleState === 'paused') return 'bg-[#e2445c]';
  if (task.status === 'in_progress') return 'bg-[#fdab3d]';
  return 'bg-slate-300';
};

const getScheduleDateClass = (task: any) => {
  const scheduleState = getTaskScheduleState(task);
  if (scheduleState === 'overdue') return 'bg-red-50 border-red-200 text-red-700';
  if (scheduleState === 'due_soon') return 'bg-orange-50 border-orange-200 text-orange-700';
  if (scheduleState === 'completed_late') return 'bg-orange-50 border-orange-200 text-orange-700';
  if (scheduleState === 'completed') return 'bg-[#00c875]/10 border-[#00c875]/20 text-[#00a35f]';
  if (scheduleState === 'paused') return 'bg-red-50 border-red-100 text-red-700';
  if (task.status === 'in_progress') return 'bg-[#fdab3d]/10 border-[#fdab3d]/20 text-[#d97706]';
  return 'bg-slate-50 border-slate-200 text-slate-500';
};

const getScheduleBarColors = (task: any) => {
  const scheduleState = getTaskScheduleState(task);
  if (scheduleState === 'overdue') return { backgroundColor: '#dc2626', backgroundSelectedColor: '#b91c1c' };
  if (scheduleState === 'due_soon') return { backgroundColor: '#f97316', backgroundSelectedColor: '#ea580c' };
  if (scheduleState === 'completed_late') return { backgroundColor: '#f97316', backgroundSelectedColor: '#ea580c' };
  if (scheduleState === 'completed') return { backgroundColor: '#00c875', backgroundSelectedColor: '#00a35f' };
  if (scheduleState === 'paused') return { backgroundColor: '#e2445c', backgroundSelectedColor: '#c8374d' };
  if (task.status === 'in_progress') return { backgroundColor: '#fdab3d', backgroundSelectedColor: '#e69a35' };
  return { backgroundColor: '#c4c4c4', backgroundSelectedColor: '#b0b0b0' };
};

const getFullscreenGanttBarColors = (task: any) => {
  if (!task) {
    return {
      backgroundColor: '#dbe4f0',
      backgroundSelectedColor: '#c6d3e3',
      progressColor: 'rgba(79, 70, 229, 0.24)',
      progressSelectedColor: 'rgba(79, 70, 229, 0.34)',
    };
  }

  const scheduleState = getTaskScheduleState(task);
  if (scheduleState === 'overdue') {
    return {
      backgroundColor: '#ef4444',
      backgroundSelectedColor: '#dc2626',
      progressColor: 'rgba(255, 255, 255, 0.26)',
      progressSelectedColor: 'rgba(255, 255, 255, 0.34)',
    };
  }
  if (scheduleState === 'due_soon' || scheduleState === 'completed_late' || task.status === 'in_progress') {
    return {
      backgroundColor: '#f59e0b',
      backgroundSelectedColor: '#d97706',
      progressColor: 'rgba(255, 255, 255, 0.28)',
      progressSelectedColor: 'rgba(255, 255, 255, 0.38)',
    };
  }
  if (scheduleState === 'completed') {
    return {
      backgroundColor: '#10b981',
      backgroundSelectedColor: '#059669',
      progressColor: 'rgba(255, 255, 255, 0.24)',
      progressSelectedColor: 'rgba(255, 255, 255, 0.34)',
    };
  }
  if (scheduleState === 'paused') {
    return {
      backgroundColor: '#e2445c',
      backgroundSelectedColor: '#be3148',
      progressColor: 'rgba(255, 255, 255, 0.25)',
      progressSelectedColor: 'rgba(255, 255, 255, 0.34)',
    };
  }

  return {
    backgroundColor: '#cbd5e1',
    backgroundSelectedColor: '#94a3b8',
    progressColor: 'rgba(79, 70, 229, 0.18)',
    progressSelectedColor: 'rgba(79, 70, 229, 0.28)',
  };
};

const sortChildTasks = (childTasks: any[]) => {
  return [...childTasks].sort((a, b) => {
    const aOrder = a.cycleNumber ?? a.displayOrder ?? 0;
    const bOrder = b.cycleNumber ?? b.displayOrder ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0);
  });
};

const getRecoveredMatrixTitle = (children: any[]) => {
  const firstChild = children[0] || {};
  const candidate =
    firstChild.matrixTaskTitle ||
    firstChild.parentTaskTitle ||
    firstChild.parentTitle ||
    firstChild.originalTitle ||
    getTaskDisplayTitle(firstChild, 'Tarea matriz recuperada');

  return String(candidate || 'Tarea matriz recuperada').trim() || 'Tarea matriz recuperada';
};

const getRecoveredMatrixStatus = (children: any[]) => {
  if (children.length > 0 && children.every(isTaskFinished)) {
    return children.some((child) => child.status === 'completed_late') ? 'completed_late' : 'completed';
  }

  if (children.some((child) => child.status === 'stuck' || child.status === 'detenido')) return 'stuck';
  if (children.some((child) => ['in_progress', 'en_curso', 'trabajando', 'reproceso'].includes(child.status))) return 'in_progress';
  return 'todo';
};

const buildRecoveredMatrixTask = (parentId: string, children: any[]) => {
  const firstChild = children[0] || {};
  const dateRange = getGroupDateRange(children);
  const title = getRecoveredMatrixTitle(children);
  const workflowSteps = Array.isArray(firstChild.workflowSteps)
    ? firstChild.workflowSteps.map((step: any) => ({
        ...step,
        status: 'not_started',
        completed: false,
      }))
    : [];

  return {
    id: parentId,
    title,
    name: title,
    originalTitle: title,
    description: firstChild.description || '',
    startDate: dateRange.start,
    endDate: dateRange.end,
    start: dateRange.start,
    end: dateRange.end,
    assignedTo: firstChild.assignedTo || '',
    status: getRecoveredMatrixStatus(children),
    progress: getGroupProgress(children),
    type: isWorkflowTaskType(firstChild.type) ? firstChild.type : workflowSteps.length > 0 ? 'workflow' : (firstChild.type || 'state'),
    priority: firstChild.priority || 'medium',
    groupId: getTaskGroupId(firstChild) === UNGROUPED_GROUP_ID ? null : getTaskGroupId(firstChild),
    currentValue: 0,
    isParentTask: true,
    isRecoveredMatrix: true,
    missingParentTaskId: parentId,
    recoveredChildCount: children.length,
    totalSubtasks: children.length,
    totalCycles: Math.max(children.length, Number(firstChild.totalCycles || 0)),
    workflowSteps,
    currentStepIndex: 0,
    displayOrder: Math.min(...children.map((child) => Number(child.displayOrder || 0)).filter((value) => Number.isFinite(value)), 0) - 1,
  };
};

const getFullscreenGanttLabel = (name: string, mode: ViewMode) => {
  const cleanName = String(name || '').replace(/\s+/g, ' ').trim();
  const maxLength = mode === ViewMode.Day ? 34 : mode === ViewMode.Week ? 44 : 56;

  if (cleanName.length <= maxLength) return cleanName;
  return `${cleanName.slice(0, maxLength - 1)}…`;
};

const getTaskStatusLabel = (status: string) => {
  switch (status) {
    case 'completed': return 'LISTO';
    case 'completed_late': return 'LISTO CON RETRASO';
    case 'rescheduled': return 'REPROGRAMACIÓN';
    case 'in_progress': return 'TRABAJANDO';
    case 'stuck': return 'ESTANCADO';
    case 'todo':
    case 'pending': return 'PENDIENTE';
    case 'en_curso': return 'EN CURSO';
    case 'listo': return 'LISTO';
    case 'devuelto': return 'DEVUELTO';
    case 'reproceso': return 'REPROCESO';
    case 'detenido': return 'DETENIDO';
    case 'not_started': return 'NO INICIADO';
    default: return status?.toUpperCase();
  }
};

const getTaskPriorityLabel = (priority: string) => {
  if (priority === 'high') return 'Alta';
  if (priority === 'low') return 'Baja';
  return 'Media';
};

const getFullscreenTaskKindLabel = (task: any) => {
  if (task?.isWorkflowStep) return 'Paso';
  if (isWorkflowTaskType(task?.type)) return getWorkflowTaskTypeLabel(task.type);
  if (task?.type === 'quantitative') return 'Cuantitativa';
  if (isMeetingTask(task)) return 'Reunión';
  return task?.parentTaskId ? 'Subtarea' : 'Tarea';
};

const getFullscreenMetaRailClass = (statusLabel?: string) => {
  if (statusLabel === 'LISTO') return 'bg-emerald-400';
  if (statusLabel === 'LISTO CON RETRASO' || statusLabel === 'TRABAJANDO' || statusLabel === 'EN CURSO') return 'bg-orange-400';
  if (statusLabel === 'ESTANCADO' || statusLabel === 'DETENIDO' || statusLabel === 'DEVUELTO') return 'bg-red-500';
  return 'bg-slate-300';
};

const getFullscreenStatusPillClass = (statusLabel?: string) => {
  if (statusLabel === 'LISTO') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (statusLabel === 'LISTO CON RETRASO' || statusLabel === 'TRABAJANDO' || statusLabel === 'EN CURSO') return 'bg-orange-50 text-orange-700 ring-orange-100';
  if (statusLabel === 'ESTANCADO' || statusLabel === 'DETENIDO' || statusLabel === 'DEVUELTO') return 'bg-red-50 text-red-700 ring-red-100';
  return 'bg-slate-100 text-slate-600 ring-slate-200';
};

const FullscreenGanttTaskListHeader: React.FC<{
  headerHeight: number;
  rowWidth: string;
  fontFamily: string;
  fontSize: string;
}> = ({ headerHeight, rowWidth }) => (
  <div
    className="fullscreen-gantt-list-header border-b border-slate-200 bg-white"
    style={{ height: headerHeight, minWidth: rowWidth, maxWidth: rowWidth }}
  >
    <div className="flex h-full items-center justify-between gap-3 px-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">Tareas</p>
        <p className="mt-0.5 text-[11px] font-bold text-slate-500">Jerarquía compacta</p>
      </div>
      <span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-indigo-600">
        Línea
      </span>
    </div>
  </div>
);

const FullscreenGanttTaskListTable: React.FC<{
  rowHeight: number;
  rowWidth: string;
  fontFamily: string;
  fontSize: string;
  locale: string;
  tasks: Task[];
  selectedTaskId: string;
  setSelectedTask: (taskId: string) => void;
  onExpanderClick: (task: Task) => void;
}> = ({ rowHeight, rowWidth, tasks, selectedTaskId, setSelectedTask, onExpanderClick }) => (
  <div className="fullscreen-gantt-list-table bg-white">
    {tasks.map((rawTask) => {
      const task = rawTask as FullscreenGanttTask;
      const meta = task.fullscreenMeta;
      const isGroup = meta?.rowKind === 'group';
      const isSelected = selectedTaskId === task.id;
      const canExpand = Boolean(meta?.childCount);
      const indent = isGroup ? 0 : Math.min(meta?.depth || 0, 5) * 14;
      const connectorLeft = 18 + Math.max(0, (meta?.depth || 0) - 1) * 14;

      return (
        <div
          key={`${task.id}-fullscreen-row`}
          role="button"
          tabIndex={0}
          onClick={() => setSelectedTask(task.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setSelectedTask(task.id);
            }
          }}
          className={`group relative flex items-center border-b border-slate-100 transition ${
            isGroup
              ? 'bg-slate-50/95'
              : isSelected
                ? 'bg-indigo-50/95 shadow-[inset_0_0_0_1px_rgba(79,70,229,0.24)]'
                : 'bg-white hover:bg-slate-50'
          }`}
          style={{ height: rowHeight, minWidth: rowWidth, maxWidth: rowWidth }}
          title={meta?.title || task.name}
        >
          <span
            className={`absolute inset-y-0 left-0 w-1.5 ${isGroup ? '' : getFullscreenMetaRailClass(meta?.statusLabel)}`}
            style={isGroup ? { backgroundColor: meta?.groupColor || '#94a3b8' } : undefined}
          />

          {!isGroup && (meta?.depth || 0) > 0 && (
            <>
              <span
                className="absolute top-0 h-full w-px bg-indigo-100"
                style={{ left: connectorLeft }}
              />
              <span
                className="absolute top-1/2 h-px w-5 bg-indigo-200"
                style={{ left: connectorLeft }}
              />
            </>
          )}

          <div className="flex min-w-0 flex-1 items-center gap-2 px-3" style={{ paddingLeft: 12 + indent }}>
            {canExpand ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onExpanderClick(task);
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                aria-label={meta?.isExpanded ? 'Contraer' : 'Expandir'}
              >
                <ChevronRight size={13} className={`transition-transform ${meta?.isExpanded ? 'rotate-90' : ''}`} />
              </button>
            ) : (
              <span className={`h-2 w-2 shrink-0 rounded-full ${isGroup ? 'bg-slate-400' : getFullscreenMetaRailClass(meta?.statusLabel)}`} />
            )}

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <p className={`min-w-0 flex-1 truncate text-sm leading-tight ${isGroup ? 'font-black text-slate-900' : 'font-black text-slate-800'}`}>
                {meta?.title || task.name}
              </p>
              {!isGroup && meta?.statusLabel && (
                <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ring-1 lg:inline-flex ${getFullscreenStatusPillClass(meta.statusLabel)}`}>
                  {meta.statusLabel}
                </span>
              )}
              {isGroup && typeof meta?.groupTaskCount === 'number' && (
                <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">
                  {meta.groupTaskCount}
                </span>
              )}
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

export const ProjectGantt: React.FC<ProjectGanttProps> = ({
  tasks,
  teamMembers,
  assigneeOptions,
  taskGroups = [],
  onUpdateTaskProgress,
  onUpdateTaskValue,
  onUpdateTaskStatus,
  onUpdateTaskPriority,
  onUpdateTaskAssignee,
  onUpdateTaskGroup,
  onDeleteTask,
  onDeleteTasks,
  onDeleteTaskTree,
  onSyncTask,
  onReorderTasks,
  onUpdateTaskDates,
  onUpdateTaskTitle,
  onCreateTaskGroup,
  onUpdateTaskGroupDefinition,
  onDeleteTaskGroup,
  onOpenIncrementTask,
  canEditTaskDetails,
  canEditTaskDates,
  canEditTaskStatus,
  canAddSubtasks,
  canEditTaskStructure,
  canDeleteTasks,
  onEditTaskStructure,
  onAddSubtask,
  onOpenTaskDocs,
  onOpenTaskComments,
  onResetWorkflowTask,
  onCreateBulkWorkflowIterations,
  onRepairMissingTaskMatrix,
  onCreateTask
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(true);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [openActionMenuTaskId, setOpenActionMenuTaskId] = useState<string | null>(null);
  const [taskForDateEdit, setTaskForDateEdit] = useState<any>(null);
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>(null);
  const [hideCompletedTasks, setHideCompletedTasks] = useState(true);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState(TASK_GROUP_COLORS[0]);
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [repairingMatrixIds, setRepairingMatrixIds] = useState<string[]>([]);
  const [isFullscreenGanttOpen, setIsFullscreenGanttOpen] = useState(false);
  const [isFullscreenDetailOpen, setIsFullscreenDetailOpen] = useState(false);
  const [selectedTimelineTaskId, setSelectedTimelineTaskId] = useState<string | null>(null);
  const fullscreenGanttPanRef = useRef<HTMLDivElement | null>(null);
  const taskAssigneeOptions = assigneeOptions || teamMembers;
  const canModifyTaskDetails = Boolean(canEditTaskDetails);
  const canModifyTaskDates = Boolean(canEditTaskDates && onUpdateTaskDates);
  const canChangeTaskStatus = Boolean(canEditTaskStatus && onUpdateTaskStatus);
  const canChangeTaskAssignee = Boolean(canModifyTaskDetails && onUpdateTaskAssignee);
  const canCreateSubtasks = Boolean(canAddSubtasks && onAddSubtask);
  const canRemoveTasks = Boolean(canDeleteTasks && (onDeleteTask || onDeleteTasks || onDeleteTaskTree));
  const canManageTaskGroups = Boolean(canModifyTaskDetails && (onCreateTaskGroup || onUpdateTaskGroup || onUpdateTaskGroupDefinition || onDeleteTaskGroup));
  const sortedTaskGroups = useMemo(() => {
    const validGroups = [...taskGroups].filter((group) => group?.id && group?.name);
    const configuredDefaultGroup = validGroups.find((group) => group.id === UNGROUPED_GROUP_ID);
    const defaultGroup = {
      ...DEFAULT_UNGROUPED_GROUP,
      ...configuredDefaultGroup,
      id: UNGROUPED_GROUP_ID,
      name: configuredDefaultGroup?.name?.trim() || DEFAULT_UNGROUPED_GROUP.name,
      color: configuredDefaultGroup?.color || DEFAULT_UNGROUPED_GROUP.color,
      order: configuredDefaultGroup?.order ?? DEFAULT_UNGROUPED_GROUP.order,
    };

    const customGroups = validGroups
      .filter((group) => group.id !== UNGROUPED_GROUP_ID)
      .sort((left, right) => {
        const leftOrder = left.order ?? 0;
        const rightOrder = right.order ?? 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.name.localeCompare(right.name);
      });

    return [defaultGroup, ...customGroups];
  }, [taskGroups]);
  const defaultTaskGroup = sortedTaskGroups[0] || DEFAULT_UNGROUPED_GROUP;
  const assignableTaskGroups = sortedTaskGroups.filter((group) => group.id !== UNGROUPED_GROUP_ID);
  const normalizedTaskSearchQuery = useMemo(() => normalizeSearchValue(taskSearchQuery), [taskSearchQuery]);
  const taskSearchTokens = useMemo(
    () => normalizedTaskSearchQuery.split(/\s+/).filter(Boolean),
    [normalizedTaskSearchQuery]
  );
  const hasActiveTaskSearch = taskSearchTokens.length > 0;
  const hasActiveTaskFilter = Boolean(scheduleFilter || hasActiveTaskSearch);
  const assigneeSearchMap = useMemo(() => {
    const map = new Map<string, string>();
    [...teamMembers, ...taskAssigneeOptions].forEach((member) => {
      if (!member?.id || map.has(member.id)) return;
      map.set(member.id, [
        member.name,
        member.email,
        member.role,
        member.systemRole,
        member.projectRole,
        member.projectRoleName,
      ].filter(Boolean).join(' '));
    });
    return map;
  }, [taskAssigneeOptions, teamMembers]);
  const assigneeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    [...teamMembers, ...taskAssigneeOptions].forEach((member) => {
      if (!member?.id || map.has(member.id)) return;
      map.set(member.id, member.name || member.displayName || member.email || member.id);
    });
    return map;
  }, [taskAssigneeOptions, teamMembers]);
  const groupSearchMap = useMemo(() => {
    return new Map(sortedTaskGroups.map((group) => [group.id, group.name]));
  }, [sortedTaskGroups]);

  const toggleParent = (parentId: string) => {
    setExpandedParents(prev => ({
      ...prev,
      [parentId]: !prev[parentId]
    }));
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  const handleCreateGroup = async () => {
    const cleanName = newGroupName.trim().replace(/\s+/g, ' ');
    if (!cleanName || !onCreateTaskGroup) return;

    await onCreateTaskGroup(cleanName, newGroupColor);
    setNewGroupName("");
    setNewGroupColor(TASK_GROUP_COLORS[0]);
  };

  const handleRepairRecoveredMatrix = async (task: any) => {
    if (!task?.id || !onRepairMissingTaskMatrix) return;

    setOpenActionMenuTaskId(null);
    setRepairingMatrixIds((current) => Array.from(new Set([...current, task.id])));

    try {
      await onRepairMissingTaskMatrix(task);
    } finally {
      setRepairingMatrixIds((current) => current.filter((taskId) => taskId !== task.id));
    }
  };

  const startEditingTitle = (task: any) => {
    if (!canModifyTaskDetails || !onUpdateTaskTitle || task.isWorkflowStep) return;
    setEditingTaskId(task.id);
    setEditingTaskTitle(getTaskDisplayTitle(task));
  };

  const finishEditingTitle = async (task: any) => {
    if (!editingTaskId) return;

    const nextTitle = sanitizeTaskTitleForSave(task, editingTaskTitle);
    const currentTitle = sanitizeTaskTitleForSave(task, getTaskTitle(task));
    setEditingTaskId(null);

    if (!nextTitle || nextTitle === currentTitle || !onUpdateTaskTitle) {
      setEditingTaskTitle("");
      return;
    }

    await onUpdateTaskTitle(task.id, nextTitle, task);
    setEditingTaskTitle("");
  };

  // Sort tasks by displayOrder or createdAt
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (a.displayOrder !== undefined && b.displayOrder !== undefined) {
        return a.displayOrder - b.displayOrder;
      }
      return (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0);
    });
  }, [tasks]);

  const tasksById = useMemo(
    () => new Map(sortedTasks.map((task) => [task.id, task])),
    [sortedTasks]
  );

  const allChildrenByParentId = useMemo(() => {
    return tasks.reduce<Map<string, any[]>>((map, task) => {
      if (!task.parentTaskId) return map;
      const children = map.get(task.parentTaskId) || [];
      children.push(task);
      map.set(task.parentTaskId, children);
      return map;
    }, new Map<string, any[]>());
  }, [tasks]);

  const completionFilteredTasks = useMemo(() => {
    if (!hideCompletedTasks) return sortedTasks;

    const childrenByParentId = sortedTasks.reduce<Map<string, any[]>>((map, task) => {
      if (!task.parentTaskId) return map;
      const siblings = map.get(task.parentTaskId) || [];
      siblings.push(task);
      map.set(task.parentTaskId, siblings);
      return map;
    }, new Map<string, any[]>());

    const hasOpenDescendant = (taskId: string): boolean => {
      const children = childrenByParentId.get(taskId) || [];
      return children.some((child) => !isTaskFinished(child) || hasOpenDescendant(child.id));
    };

    return sortedTasks.filter((task) => !isTaskFinished(task) || hasOpenDescendant(task.id));
  }, [hideCompletedTasks, sortedTasks]);

  const completedTaskCount = useMemo(
    () => sortedTasks.filter((task) => isTaskFinished(task) && !task.isWorkflowStep).length,
    [sortedTasks]
  );

  const hiddenCompletedCount = hideCompletedTasks ? Math.max(0, sortedTasks.length - completionFilteredTasks.length) : 0;

  const scheduleStats = useMemo(() => {
    const realTasks = sortedTasks.filter((task) => !task.isWorkflowStep);
    return {
      overdue: realTasks.filter((task) => getTaskScheduleState(task) === 'overdue').length,
      dueSoon: realTasks.filter((task) => getTaskScheduleState(task) === 'due_soon').length,
      completedLate: realTasks.filter((task) => getTaskScheduleState(task) === 'completed_late').length,
    };
  }, [sortedTasks]);

  const filteredSortedTasks = useMemo(() => {
    const scheduleFilteredTasks = scheduleFilter
      ? completionFilteredTasks.filter((task) => getTaskScheduleState(task) === scheduleFilter)
      : completionFilteredTasks;

    if (taskSearchTokens.length === 0) return scheduleFilteredTasks;

    const tasksById = new Map(completionFilteredTasks.map((task) => [task.id, task]));
    const childTasksByParentId = completionFilteredTasks.reduce<Map<string, any[]>>((map, task) => {
      if (!task.parentTaskId) return map;
      const siblings = map.get(task.parentTaskId) || [];
      siblings.push(task);
      map.set(task.parentTaskId, siblings);
      return map;
    }, new Map<string, any[]>());
    const includedIds = new Set<string>();

    const getAssigneeText = (assigneeId: string) => {
      if (!assigneeId) return '';
      if (assigneeId === 'DYNAMIC') return 'dinamico dinamica asignacion dinamica responsable dinamico';
      return assigneeSearchMap.get(assigneeId) || assigneeId;
    };

    const appendAncestors = (task: any) => {
      let currentTask = task;
      while (currentTask?.id && !includedIds.has(currentTask.id)) {
        includedIds.add(currentTask.id);
        currentTask = currentTask.parentTaskId ? tasksById.get(currentTask.parentTaskId) : null;
      }
    };

    const appendDescendants = (task: any) => {
      const children = childTasksByParentId.get(task.id) || [];
      children.forEach((child) => {
        if (includedIds.has(child.id)) return;
        includedIds.add(child.id);
        appendDescendants(child);
      });
    };

    const taskMatchesSearch = (task: any) => {
      const parentTask = task.parentTaskId ? tasksById.get(task.parentTaskId) : null;
      const workflowStepsText = Array.isArray(task.workflowSteps)
        ? task.workflowSteps.map((step: any, index: number) => [
          `paso ${index + 1}`,
          step.label,
          step.name,
          step.status,
          getStatusSearchTerms(step.status),
          getAssigneeText(step.assignedTo),
        ].filter(Boolean).join(' ')).join(' ')
        : '';
      const text = normalizeSearchValue([
        task.id,
        task.title,
        task.name,
        getTaskTitle(task, ''),
        getTaskDisplayTitle(task, ''),
        task.externalWorkflowId,
        task.description,
        task.notes,
        task.observation,
        task.observacion,
        task.type,
        task.indicator,
        task.municipality,
        task.workflowMunicipality,
        task.municipio,
        task.department,
        task.workflowDepartment,
        task.departamento,
        task.city,
        task.locality,
        task.status,
        getStatusSearchTerms(task.status),
        task.priority,
        getPrioritySearchTerms(getTaskPriority(task)),
        groupSearchMap.get(getTaskGroupId(task)),
        getAssigneeText(task.assignedTo),
        parentTask ? getTaskDisplayTitle(parentTask, '') : '',
        parentTask?.externalWorkflowId,
        workflowStepsText,
      ].filter(Boolean).join(' '));

      return taskSearchTokens.every((token) => text.includes(token));
    };

    scheduleFilteredTasks.forEach((task) => {
      if (!taskMatchesSearch(task)) return;
      appendAncestors(task);
      appendDescendants(task);
    });

    return completionFilteredTasks.filter((task) => includedIds.has(task.id));
  }, [assigneeSearchMap, completionFilteredTasks, groupSearchMap, scheduleFilter, taskSearchTokens]);

  const shouldShowTaskGroups = sortedTaskGroups.length > 0 || completionFilteredTasks.some((task) => task.groupId);

  const visibleRows = useMemo<VisibleTaskRow[]>(() => {
    const baseSourceTasks = hasActiveTaskFilter ? filteredSortedTasks : completionFilteredTasks;
    const sourceTaskMap = new Map(baseSourceTasks.map((task) => [task.id, task]));
    const contextualParentIds = new Set<string>();
    const missingChildrenByParentId = new Map<string, any[]>();

    baseSourceTasks.forEach((task) => {
      const visitedParentIds = new Set<string>();
      let parentId = task.parentTaskId;

      while (parentId && !visitedParentIds.has(parentId)) {
        visitedParentIds.add(parentId);
        const parentTask = sourceTaskMap.get(parentId) || tasksById.get(parentId);
        if (!parentTask) {
          const children = missingChildrenByParentId.get(parentId) || [];
          children.push(task);
          missingChildrenByParentId.set(parentId, children);
          if (hasActiveTaskFilter) {
            contextualParentIds.add(parentId);
          }
          break;
        }

        if (!sourceTaskMap.has(parentId)) {
          sourceTaskMap.set(parentId, parentTask);
          contextualParentIds.add(parentId);
        }

        parentId = parentTask.parentTaskId;
      }
    });

    const recoveredParents = Array.from(missingChildrenByParentId.entries()).map(([parentId, children]) =>
      buildRecoveredMatrixTask(parentId, sortChildTasks(children))
    );
    const recoveredParentMap = new Map(recoveredParents.map((task) => [task.id, task]));
    recoveredParents.forEach((task) => {
      sourceTaskMap.set(task.id, task);
    });

    const sourceTasks: any[] = [];
    const insertedRecoveredParentIds = new Set<string>();
    sortedTasks.forEach((task) => {
      if (!sourceTaskMap.has(task.id)) return;

      const recoveredParentId =
        task.parentTaskId && recoveredParentMap.has(task.parentTaskId)
          ? task.parentTaskId
          : null;

      if (recoveredParentId && !insertedRecoveredParentIds.has(recoveredParentId)) {
        const recoveredParent = recoveredParentMap.get(recoveredParentId);
        if (recoveredParent) {
          sourceTasks.push(recoveredParent);
          insertedRecoveredParentIds.add(recoveredParentId);
        }
      }

      sourceTasks.push(task);
    });

    recoveredParents.forEach((task) => {
      if (!insertedRecoveredParentIds.has(task.id)) {
        sourceTasks.push(task);
      }
    });

    const sourceTaskIds = new Set(sourceTasks.map((task) => task.id));
    const sourceChildrenByParentId = sourceTasks.reduce<Map<string, any[]>>((map, task) => {
      if (!task.parentTaskId) return map;
      const children = map.get(task.parentTaskId) || [];
      children.push(task);
      map.set(task.parentTaskId, children);
      return map;
    }, new Map<string, any[]>());
    const rows: VisibleTaskRow[] = [];

    const appendTaskTree = (task: any) => {
      rows.push({ type: 'task', id: task.id, task });
      const subTasks = sortChildTasks(sourceChildrenByParentId.get(task.id) || []);
      const shouldShowChildren = Boolean(
        expandedParents[task.id] ||
        hasActiveTaskSearch ||
        contextualParentIds.has(task.id)
      );
      if (subTasks.length > 0 && shouldShowChildren) {
        subTasks.forEach(subTask => {
          rows.push({ type: 'task', id: subTask.id, task: subTask });
          // Generate visual sub-tasks for workflow steps
          if (isWorkflowTaskType(subTask.type) && subTask.workflowSteps && (expandedParents[subTask.id] || hasActiveTaskSearch)) {
            subTask.workflowSteps.forEach((step: any, idx: number) => {
              rows.push({ type: 'task', id: `${subTask.id}-step-${idx}`, task: {
                id: `${subTask.id}-step-${idx}`,
                title: `Paso ${idx + 1}: ${step.label}`,
                name: `Paso ${idx + 1}: ${step.label}`,
                parentTaskId: subTask.id,
                isWorkflowStep: true,
                stepIndex: idx,
                status: step.status || 'not_started',
                priority: getTaskPriority(subTask),
                assignedTo: step.assignedTo,
                startDate: step.plannedStartDate || step.startDate || step.plannedStartAt || subTask.startDate,
                endDate: step.plannedEndDate || step.endDate || step.plannedEndAt || subTask.endDate,
                progress: step.status === 'listo' ? 100 : (step.status === 'en_curso' || step.status === 'reproceso' ? 50 : 0),
                type: 'workflow_step',
                originalTask: subTask
              }});
            });
          }
        });
      } else if (isWorkflowTaskType(task.type) && task.workflowSteps && shouldShowChildren) {
        // Generate visual sub-tasks for workflow steps (no cycles)
        task.workflowSteps.forEach((step: any, idx: number) => {
          rows.push({ type: 'task', id: `${task.id}-step-${idx}`, task: {
            id: `${task.id}-step-${idx}`,
            title: `Paso ${idx + 1}: ${step.label}`,
            name: `Paso ${idx + 1}: ${step.label}`,
            parentTaskId: task.id,
            isWorkflowStep: true,
            stepIndex: idx,
            status: step.status || 'not_started',
            priority: getTaskPriority(task),
            assignedTo: step.assignedTo,
            startDate: step.plannedStartDate || step.startDate || step.plannedStartAt || task.startDate,
            endDate: step.plannedEndDate || step.endDate || step.plannedEndAt || task.endDate,
            progress: step.status === 'listo' ? 100 : (step.status === 'en_curso' || step.status === 'reproceso' ? 50 : 0),
            type: 'workflow_step',
            originalTask: task
          }});
        });
      }
    };

    if (!shouldShowTaskGroups) {
      const parentsAndNormal = sourceTasks.filter(t => !t.parentTaskId || !sourceTaskIds.has(t.parentTaskId));
      parentsAndNormal.forEach(appendTaskTree);
      return rows;
    }

    const topLevelTasks = sourceTasks.filter(t => !t.parentTaskId || !sourceTaskIds.has(t.parentTaskId));
    const knownGroupIds = new Set(sortedTaskGroups.map((group) => group.id));
    const groupedTasks = sortedTaskGroups.map((group) => ({
      group,
      tasks: topLevelTasks.filter((task) => {
        const groupId = getTaskGroupId(task);
        if (group.id === UNGROUPED_GROUP_ID) {
          return groupId === UNGROUPED_GROUP_ID || !knownGroupIds.has(groupId);
        }
        return groupId === group.id;
      }),
    }));

    groupedTasks.forEach(({ group, tasks: groupTasks }) => {
      if (hasActiveTaskFilter && groupTasks.length === 0) return;

      rows.push({
        type: 'group',
        id: `group-${group.id}`,
        group,
        taskCount: groupTasks.length,
        tasks: groupTasks,
      });

      if (!collapsedGroups[group.id] || hasActiveTaskSearch) {
        groupTasks.forEach(appendTaskTree);
      }
    });

    return rows;
  }, [collapsedGroups, completionFilteredTasks, expandedParents, filteredSortedTasks, hasActiveTaskFilter, hasActiveTaskSearch, shouldShowTaskGroups, sortedTaskGroups, sortedTasks, tasksById]);

  const visibleTasks = useMemo(
    () => visibleRows.filter((row): row is Extract<VisibleTaskRow, { type: 'task' }> => row.type === 'task').map((row) => row.task),
    [visibleRows]
  );

  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);

  const visibleSelectableTaskIds = useMemo(
    () => visibleTasks.filter((task) => !task.isWorkflowStep).map((task) => task.id),
    [visibleTasks]
  );

  const selectedVisibleTaskCount = visibleSelectableTaskIds.filter((taskId) => selectedTaskIdSet.has(taskId)).length;
  const hasSelectedTasks = selectedTaskIds.length > 0;
  const areAllVisibleTasksSelected = visibleSelectableTaskIds.length > 0 && selectedVisibleTaskCount === visibleSelectableTaskIds.length;

  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((selectedId) => selectedId !== taskId)
        : [...current, taskId]
    );
  };

  const toggleAllVisibleTasks = () => {
    setSelectedTaskIds((current) => {
      const visibleIds = new Set(visibleSelectableTaskIds);
      if (visibleIds.size === 0) return current;

      if (visibleSelectableTaskIds.every((taskId) => current.includes(taskId))) {
        return current.filter((taskId) => !visibleIds.has(taskId));
      }

      return Array.from(new Set([...current, ...visibleSelectableTaskIds]));
    });
  };

  const requestDeleteSelectedTasks = () => {
    const persistedSelectedIds = selectedTaskIds.filter((taskId) => tasks.some((task) => task.id === taskId));
    if (persistedSelectedIds.length === 0) return;

    if (onDeleteTasks) {
      onDeleteTasks(persistedSelectedIds);
    } else if (persistedSelectedIds.length === 1) {
      onDeleteTask?.(persistedSelectedIds[0]);
    }
    setSelectedTaskIds([]);
    setIsSelectionMode(false);
  };

  const exitSelectionMode = () => {
    setSelectedTaskIds([]);
    setIsSelectionMode(false);
  };

  // Map Supabase tasks to gantt-task-react tasks
  const visibleRowById = useMemo(
    () => new Map(visibleRows.map((row) => [row.id, row])),
    [visibleRows]
  );

  const visibleTaskMap = useMemo(
    () => new Map(visibleTasks.map((task) => [task.id, task])),
    [visibleTasks]
  );

  const visibleChildCountByParentId = useMemo(() => {
    return visibleTasks.reduce<Map<string, number>>((map, task) => {
      if (!task.parentTaskId) return map;
      map.set(task.parentTaskId, (map.get(task.parentTaskId) || 0) + 1);
      return map;
    }, new Map<string, number>());
  }, [visibleTasks]);

  const ganttTasks: FullscreenGanttTask[] = useMemo(() => {
    if (visibleRows.length === 0) return [];
    const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));
    const getTaskDepth = (task: any) => {
      let depth = 0;
      let parentId = task?.parentTaskId;
      const visitedIds = new Set<string>();

      while (parentId && !visitedIds.has(parentId)) {
        visitedIds.add(parentId);
        depth += 1;
        const parentTask = visibleTaskMap.get(parentId) || tasksById.get(parentId);
        parentId = parentTask?.parentTaskId;
      }

      return depth;
    };

    return visibleRows.map((row, index) => {
      if (row.type === 'group') {
        const range = getGroupDateRange(row.tasks);
        const groupColor = getTaskGroupColor(row.group);

        return {
          id: row.id,
          name: row.group.name,
          start: range.start,
          end: range.end,
          progress: getGroupProgress(row.tasks),
          type: 'project',
          displayOrder: index + 1,
          hideChildren: row.taskCount > 0 ? Boolean(collapsedGroups[row.group.id] && !hasActiveTaskSearch) : undefined,
          fullscreenMeta: {
            rowKind: 'group',
            title: row.group.name,
            groupColor,
            groupTaskCount: row.taskCount,
            depth: 0,
            childCount: row.taskCount,
            isExpanded: !collapsedGroups[row.group.id] || hasActiveTaskSearch,
            progress: getGroupProgress(row.tasks),
          },
          styles: {
            backgroundColor: `${groupColor}55`,
            backgroundSelectedColor: `${groupColor}88`,
            progressColor: groupColor,
            progressSelectedColor: groupColor,
          }
        };
      }

      const t = row.task;
      const visibleChildCount = visibleChildCountByParentId.get(t.id) || 0;
      const storedChildCount = allChildrenByParentId.get(t.id)?.length || 0;
      const workflowStepCount = isWorkflowTaskType(t.type) && Array.isArray(t.workflowSteps) ? t.workflowSteps.length : 0;
      const totalChildCount = Math.max(visibleChildCount, storedChildCount, workflowStepCount);
      const hasChildren = totalChildCount > 0;
      const barColors = getScheduleBarColors(t);
      const parentTask = t.parentTaskId ? visibleTaskMap.get(t.parentTaskId) || tasksById.get(t.parentTaskId) : null;
      const assigneeName =
        t.assignedTo === 'DYNAMIC'
          ? 'Asignación dinámica'
          : assigneeNameMap.get(t.assignedTo || '') || '';
      const statusLabel = getTaskStatusLabel(t.status || 'todo');
      const taskTitle = getTaskDisplayTitle(t);

      return {
        id: t.id,
        name: taskTitle,
        start: getTaskDate(t.startDate) || new Date(),
        end: getTaskDate(t.endDate) || new Date(),
        progress: t.progress || 0,
        type: t.isParentTask || hasChildren ? 'project' : 'task',
        project: t.parentTaskId && visibleTaskIds.has(t.parentTaskId) ? t.parentTaskId : undefined,
        displayOrder: index + 1,
        hideChildren: hasChildren ? !(expandedParents[t.id] || hasActiveTaskSearch) : undefined,
        fullscreenMeta: {
          rowKind: 'task',
          title: taskTitle,
          parentTitle: parentTask ? getTaskDisplayTitle(parentTask) : undefined,
          depth: getTaskDepth(t),
          childCount: totalChildCount,
          isExpanded: Boolean(expandedParents[t.id] || hasActiveTaskSearch),
          isWorkflowStep: Boolean(t.isWorkflowStep),
          taskTypeLabel: getFullscreenTaskKindLabel(t),
          statusLabel,
          priorityLabel: getTaskPriorityLabel(getTaskPriority(t)),
          assigneeName,
          dateLabel: `${formatTaskDateLabel(t.startDate || t.start)} - ${formatTaskDateLabel(t.endDate || t.end)}`,
          progress: Number(t.progress || 0),
        },
        styles: {
          backgroundColor: barColors.backgroundColor,
          backgroundSelectedColor: barColors.backgroundSelectedColor,
          progressColor: '#ffffff44',
          progressSelectedColor: '#ffffff66',
        }
      };
    });
  }, [allChildrenByParentId, assigneeNameMap, collapsedGroups, expandedParents, hasActiveTaskSearch, tasksById, visibleChildCountByParentId, visibleRows, visibleTaskMap, visibleTasks]);

  const fullscreenGanttTasks: FullscreenGanttTask[] = useMemo(
    () => ganttTasks.map((task) => {
      const sourceRow = visibleRowById.get(task.id);
      const sourceTask = sourceRow?.type === 'task' ? sourceRow.task : null;
      const fullscreenStyles = sourceRow?.type === 'group'
        ? {
            backgroundColor: `${getTaskGroupColor(sourceRow.group)}66`,
            backgroundSelectedColor: `${getTaskGroupColor(sourceRow.group)}99`,
            progressColor: getTaskGroupColor(sourceRow.group),
            progressSelectedColor: getTaskGroupColor(sourceRow.group),
          }
        : getFullscreenGanttBarColors(sourceTask);

      return {
        ...task,
        name: getFullscreenGanttLabel(task.name, viewMode),
        styles: {
          ...task.styles,
          ...fullscreenStyles,
        },
      };
    }),
    [ganttTasks, viewMode, visibleRowById]
  );

  const selectedTimelineTask = useMemo(() => {
    if (selectedTimelineTaskId) {
      const explicitTask = visibleTasks.find((task) => task.id === selectedTimelineTaskId);
      if (explicitTask) return explicitTask;
    }

    return visibleTasks.find((task) => !task.isWorkflowStep) || visibleTasks[0] || null;
  }, [selectedTimelineTaskId, visibleTasks]);

  const selectedTimelineSourceTask = selectedTimelineTask?.originalTask || selectedTimelineTask;
  const selectedTimelineAssignee = selectedTimelineSourceTask
    ? teamMembers.find((member) => member.id === selectedTimelineSourceTask.assignedTo)
    : null;
  const selectedTimelineInteractions = useMemo(
    () => getTaskInteractionTimeline(selectedTimelineSourceTask, teamMembers),
    [selectedTimelineSourceTask, teamMembers]
  );

  const openFullscreenGantt = () => {
    if (!selectedTimelineTaskId) {
      const firstSelectableTask = visibleTasks.find((task) => !task.isWorkflowStep) || visibleTasks[0];
      setSelectedTimelineTaskId(firstSelectableTask?.id || null);
    }
    setIsFullscreenDetailOpen(false);
    setIsFullscreenGanttOpen(true);
  };

  const handleFullscreenTaskClick = (ganttTask: Task) => {
    const clickedTask = visibleTasks.find((task) => task.id === ganttTask.id);
    if (clickedTask) {
      setSelectedTimelineTaskId(clickedTask.id);
      setIsFullscreenDetailOpen(true);
    }
  };

  useEffect(() => {
    if (!isFullscreenGanttOpen) return;
    const root = fullscreenGanttPanRef.current;
    if (!root) return;

    let isPointerDown = false;
    let didDrag = false;
    let startX = 0;
    let startY = 0;
    let startScrollX = 0;
    let startScrollY = 0;
    let suppressClickUntil = 0;

    const getHorizontalScroller = () => root.querySelector<HTMLElement>('._2k9Ys') || root;
    const getVerticalScroller = () => root.querySelector<HTMLElement>('._1eT-t') || root;

    const shouldIgnorePanTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return true;
      return Boolean(target.closest('button, a, input, select, textarea, [role="button"], [data-no-pan]'));
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || shouldIgnorePanTarget(event.target)) return;
      isPointerDown = true;
      didDrag = false;
      startX = event.clientX;
      startY = event.clientY;
      startScrollX = getHorizontalScroller().scrollLeft;
      startScrollY = getVerticalScroller().scrollTop;
      root.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isPointerDown) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (!didDrag && Math.hypot(deltaX, deltaY) < 5) return;

      didDrag = true;
      root.classList.add('is-panning');
      getHorizontalScroller().scrollLeft = startScrollX - deltaX;
      getVerticalScroller().scrollTop = startScrollY - deltaY;
      event.preventDefault();
    };

    const stopPan = (event: PointerEvent) => {
      if (didDrag) suppressClickUntil = Date.now() + 120;
      isPointerDown = false;
      didDrag = false;
      root.classList.remove('is-panning');
      root.releasePointerCapture?.(event.pointerId);
    };

    const handleClickCapture = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    root.addEventListener('pointerdown', handlePointerDown);
    root.addEventListener('pointermove', handlePointerMove);
    root.addEventListener('pointerup', stopPan);
    root.addEventListener('pointercancel', stopPan);
    root.addEventListener('click', handleClickCapture, true);

    return () => {
      root.removeEventListener('pointerdown', handlePointerDown);
      root.removeEventListener('pointermove', handlePointerMove);
      root.removeEventListener('pointerup', stopPan);
      root.removeEventListener('pointercancel', stopPan);
      root.removeEventListener('click', handleClickCapture, true);
      root.classList.remove('is-panning');
    };
  }, [isFullscreenGanttOpen]);

  const handleDragEnd = (result: DropResult) => {
    if (!canModifyTaskDetails || !onReorderTasks) return;
    if (hasActiveTaskFilter) return;
    if (!result.destination) return;

    const sourceRow = visibleRows[result.source.index];
    const destinationRow = visibleRows[result.destination.index];
    if (!sourceRow || sourceRow.type !== 'task') return;

    // We only allow dragging of top-level tasks (parents and normal)
    const parentsAndNormal = sortedTasks.filter(t => !t.parentTaskId);
    const draggedTask = sourceRow.task;

    if (!draggedTask || draggedTask.parentTaskId) return;

    const sourceIndex = parentsAndNormal.findIndex(t => t.id === draggedTask.id);
    if (sourceIndex === -1) return;

    let destIndex = parentsAndNormal.length;
    let nextGroupId = draggedTask.groupId || '';
    if (destinationRow?.type === 'group') {
      nextGroupId = destinationRow.group.id === UNGROUPED_GROUP_ID ? '' : destinationRow.group.id;
      const firstTaskInGroupIndex = parentsAndNormal.findIndex((task) => getTaskGroupId(task) === (nextGroupId || UNGROUPED_GROUP_ID));
      destIndex = firstTaskInGroupIndex === -1 ? parentsAndNormal.length : firstTaskInGroupIndex;
    } else if (destinationRow?.type === 'task') {
      const destinationTask = destinationRow.task.parentTaskId
        ? parentsAndNormal.find((task) => task.id === destinationRow.task.parentTaskId)
        : destinationRow.task;
      nextGroupId = destinationTask?.groupId || '';
      if (destinationTask) {
        destIndex = parentsAndNormal.findIndex(t => t.id === destinationTask.id);
        if (destIndex === -1) {
          // Dropped on a subtask, place it after the parent
          destIndex = parentsAndNormal.findIndex(t => t.id === destinationTask.parentTaskId) + 1;
        }
      }
    }

    const [reorderedItem] = parentsAndNormal.splice(sourceIndex, 1);
    if (sourceIndex < destIndex) destIndex -= 1;
    parentsAndNormal.splice(Math.max(0, destIndex), 0, {
      ...reorderedItem,
      groupId: nextGroupId || null,
    });

    // Create a map of updated display orders
    const orderMap = new Map<string, number>();
    parentsAndNormal.forEach((item, index) => {
      orderMap.set(item.id, index);
    });

    // Update displayOrder for all items, keeping subtasks intact
    const updatedItems = tasks.map(item => {
      if (orderMap.has(item.id)) {
        const reorderedTask = parentsAndNormal.find((task) => task.id === item.id);
        return {
          ...item,
          displayOrder: orderMap.get(item.id)!,
          groupId: reorderedTask?.groupId || null,
        };
      }
      return item;
    });

    onReorderTasks(updatedItems);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
      case 'listo': return 'bg-[#00c875] text-white';
      case 'completed_late': return 'bg-orange-500 text-white';
      case 'in_progress':
      case 'en_curso': return 'bg-[#fdab3d] text-white';
      case 'rescheduled': return 'bg-indigo-600 text-white';
      case 'stuck':
      case 'detenido': return 'bg-[#e2445c] text-white';
      case 'devuelto': return 'bg-[#ff7575] text-white';
      case 'reproceso': return 'bg-[#f59e0b] text-white';
      case 'todo':
      case 'pending':
      case 'not_started': return 'bg-[#c4c4c4] text-white';
      default: return 'bg-[#c4c4c4] text-white';
    }
  };

  const getStatusLabel = (status: string) => {
    return getTaskStatusLabel(status);
  };

  const toggleScheduleFilter = (filter: Exclude<ScheduleFilter, null>) => {
    if (filter === 'completed_late') {
      setHideCompletedTasks(false);
    }
    setScheduleFilter((current) => current === filter ? null : filter);
  };

  const clearTaskFilters = () => {
    setScheduleFilter(null);
    setTaskSearchQuery("");
  };

  const renderScheduleFilterChip = (
    filter: Exclude<ScheduleFilter, null>,
    count: number,
    label: string,
    inactiveClassName: string,
    activeClassName: string
  ) => {
    const isActive = scheduleFilter === filter;
    return (
      <button
        type="button"
        onClick={() => toggleScheduleFilter(filter)}
        className={`rounded-full px-2.5 py-1 font-bold transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${
          isActive ? activeClassName : inactiveClassName
        }`}
        aria-pressed={isActive}
        title={isActive ? 'Quitar filtro' : `Filtrar tareas ${label}`}
      >
        {count} {label}
      </button>
    );
  };

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 px-4 bg-white rounded-lg border border-slate-200">
        <ListTodo className="w-12 h-12 text-slate-200 mx-auto mb-3" />
        <h3 className="text-base font-medium text-slate-900">No hay tareas</h3>
        <p className="text-sm text-slate-500 mt-1 mb-4">Crea tareas para empezar a medir el progreso.</p>
        {onCreateTask && (
          <Button onClick={onCreateTask} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus size={16} className="mr-2" />
            Crear Primera Tarea
          </Button>
        )}
      </div>
    );
  }

  return (
    <div translate="no" className="flex flex-col h-full bg-white rounded-lg overflow-visible border border-slate-200 shadow-sm">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-slate-200 bg-white">
        <div className="flex shrink-0 items-center gap-2">
          {onCreateTask && (
            <Button onClick={onCreateTask} size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white h-8 px-3 mr-2">
              <Plus size={14} className="mr-1.5" />
              Nueva Tarea
            </Button>
          )}
          {canRemoveTasks && !isSelectionMode && visibleSelectableTaskIds.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsSelectionMode(true)}
              className="h-8 border-slate-200 px-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-indigo-700"
            >
              <ClipboardList size={14} className="mr-1.5" />
              Seleccionar
            </Button>
          )}
          {canRemoveTasks && isSelectionMode && hasSelectedTasks && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={requestDeleteSelectedTasks}
              className="h-8 border-red-200 bg-red-50 px-3 text-[11px] font-bold text-red-700 hover:bg-red-100"
            >
              <Trash2 size={14} className="mr-1.5" />
              Eliminar {selectedTaskIds.length}
            </Button>
          )}
          {isSelectionMode && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exitSelectionMode}
              className="h-8 border-slate-200 px-3 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
            >
              Cancelar selección
            </Button>
          )}
          {canManageTaskGroups && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsGroupManagerOpen(true)}
              className="h-8 px-3 text-[11px] font-bold border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <ListTodo size={14} className="mr-1.5" />
              Grupos
            </Button>
          )}
          <div
            aria-hidden={isTimelineCollapsed}
            className={`flex overflow-hidden rounded-md bg-slate-100 transition-all ${
              isTimelineCollapsed ? 'w-0 p-0 opacity-0 pointer-events-none' : 'p-1 opacity-100'
            }`}
          >
            <button
              onClick={() => setViewMode(ViewMode.Day)}
              className={`px-3 py-1 text-[11px] font-bold rounded transition-all ${viewMode === ViewMode.Day ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              DÍA
            </button>
            <button
              onClick={() => setViewMode(ViewMode.Week)}
              className={`px-3 py-1 text-[11px] font-bold rounded transition-all ${viewMode === ViewMode.Week ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              SEMANA
            </button>
            <button
              onClick={() => setViewMode(ViewMode.Month)}
              className={`px-3 py-1 text-[11px] font-bold rounded transition-all ${viewMode === ViewMode.Month ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              MES
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsTimelineCollapsed((current) => !current)}
            className="h-8 px-3 text-[11px] font-bold border-slate-200 text-slate-600 hover:bg-slate-50"
            title={isTimelineCollapsed ? "Mostrar cronograma" : "Ocultar cronograma"}
          >
            {isTimelineCollapsed ? (
              <PanelRightOpen size={14} className="mr-1.5" />
            ) : (
              <PanelRightClose size={14} className="mr-1.5" />
            )}
            {isTimelineCollapsed ? "Mostrar Gantt" : "Solo tareas"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openFullscreenGantt}
            disabled={ganttTasks.length === 0}
            className="h-8 px-3 text-[11px] font-bold border-indigo-100 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
            title="Abrir cronograma interactivo en pantalla completa"
          >
            <Maximize2 size={14} className="mr-1.5" />
            Gantt completo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHideCompletedTasks((current) => !current)}
            className={`h-8 px-3 text-[11px] font-bold transition-all ${
              hideCompletedTasks
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            title={hideCompletedTasks ? 'Mostrar tareas finalizadas' : 'Ocultar tareas finalizadas'}
            aria-pressed={hideCompletedTasks}
          >
            <EyeOff size={14} className="mr-1.5" />
            {hideCompletedTasks ? 'Finalizadas ocultas' : 'Ocultar finalizadas'}
            {completedTaskCount > 0 && (
              <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] ${
                hideCompletedTasks ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {completedTaskCount}
              </span>
            )}
          </Button>
        </div>
        <div className="relative min-w-[260px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={taskSearchQuery}
            onChange={(event) => setTaskSearchQuery(event.target.value)}
            placeholder="Buscar tarea, ID, responsable, grupo, estado, municipio o departamento..."
            className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/70 pl-9 pr-9 text-xs font-medium text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-200 focus:bg-white focus:ring-2 focus:ring-indigo-500/10"
            aria-label="Buscar tareas"
          />
          {taskSearchQuery && (
            <button
              type="button"
              onClick={() => setTaskSearchQuery("")}
              className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Limpiar busqueda de tareas"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] font-medium text-slate-400">
          {renderScheduleFilterChip(
            'overdue',
            scheduleStats.overdue,
            'atrasadas',
            'bg-red-50 text-red-700 hover:bg-red-100',
            'bg-red-600 text-white shadow-sm ring-2 ring-red-200'
          )}
          {renderScheduleFilterChip(
            'due_soon',
            scheduleStats.dueSoon,
            'por vencer',
            'bg-orange-50 text-orange-700 hover:bg-orange-100',
            'bg-orange-500 text-white shadow-sm ring-2 ring-orange-200'
          )}
          {renderScheduleFilterChip(
            'completed_late',
            scheduleStats.completedLate,
            'con retraso',
            'bg-slate-100 text-slate-600 hover:bg-slate-200',
            'bg-slate-700 text-white shadow-sm ring-2 ring-slate-200'
          )}
          {scheduleFilter && (
            <button
              type="button"
              onClick={() => setScheduleFilter(null)}
              className="rounded-full bg-indigo-50 px-2.5 py-1 font-bold text-indigo-700 transition-colors hover:bg-indigo-100"
            >
              Limpiar filtro
            </button>
          )}
          {hasActiveTaskSearch && (
            <button
              type="button"
              onClick={() => setTaskSearchQuery("")}
              className="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-600 transition-colors hover:bg-slate-200"
            >
              Limpiar busqueda
            </button>
          )}
          <span>
            {hasActiveTaskFilter
              ? `${filteredSortedTasks.length} resultado${filteredSortedTasks.length === 1 ? '' : 's'}`
              : hideCompletedTasks
                ? `${completionFilteredTasks.length} visibles · ${hiddenCompletedCount} finalizadas ocultas`
                : `${tasks.length} tareas en total`}
          </span>
        </div>
      </div>

      <div className="flex bg-slate-50/30">
        {/* Left side: Task List (Monday Style) */}
        <div className={`${isTimelineCollapsed ? 'w-full border-r-0' : 'w-[760px] border-r'} shrink-0 border-slate-200 flex flex-col`}>
          <div className="h-10 flex items-center px-4 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-white">
            <div className="w-10 flex justify-center">
              {canRemoveTasks && isSelectionMode && visibleSelectableTaskIds.length > 0 && (
                <input
                  type="checkbox"
                  checked={areAllVisibleTasksSelected}
                  onChange={toggleAllVisibleTasks}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  title={areAllVisibleTasksSelected ? 'Quitar selección visible' : 'Seleccionar tareas visibles'}
                  aria-label={areAllVisibleTasksSelected ? 'Quitar selección visible' : 'Seleccionar tareas visibles'}
                />
              )}
            </div>
            <div className="flex-1 min-w-[220px]">Tarea</div>
            <div className="w-24 px-2 text-center">Persona</div>
            <div className="w-28 px-2 text-center">Estado</div>
            <div className="w-24 px-2 text-center">Prioridad</div>
            <div className="w-32 px-2 text-center">Cronograma</div>
            <div className="w-28 px-2 text-center">Progreso / Valor</div>
          </div>

          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="tasks">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="w-full overflow-visible"
                >
                  {visibleTasks.length === 0 && (hasActiveTaskFilter || hideCompletedTasks) ? (
                    <div className="flex min-h-[180px] flex-col items-center justify-center border-b border-slate-100 px-4 text-center">
                      <ListTodo className="mb-2 text-slate-300" size={28} />
                      <p className="text-sm font-semibold text-slate-700">
                        {hideCompletedTasks && !hasActiveTaskFilter ? 'Todas las tareas visibles estan finalizadas.' : 'No hay tareas con esta busqueda o filtro.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (hideCompletedTasks && !hasActiveTaskFilter) {
                            setHideCompletedTasks(false);
                            return;
                          }
                          clearTaskFilters();
                        }}
                        className="mt-2 rounded-md bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 transition-colors hover:bg-indigo-100"
                      >
                        {hideCompletedTasks && !hasActiveTaskFilter ? 'Mostrar finalizadas' : 'Ver todas las tareas'}
                      </button>
                    </div>
                  ) : visibleRows.map((row, rowIndex) => {
                    if (row.type === 'group') {
                      const groupColor = getTaskGroupColor(row.group);
                      const isCollapsed = Boolean(collapsedGroups[row.group.id]);

                      return (
                        <Draggable
                          key={row.id}
                          draggableId={row.id}
                          index={rowIndex}
                          isDragDisabled
                        >
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`flex h-10 items-center border-b border-slate-200 bg-white px-4 shadow-[inset_0_-1px_0_rgba(226,232,240,0.55)] ${
                                row.taskCount === 0 ? 'bg-slate-50/80' : ''
                              }`}
                              style={{ borderLeft: `6px solid ${groupColor}` }}
                            >
                              <button
                                type="button"
                                onClick={() => toggleGroup(row.group.id)}
                                className="mr-2 flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
                                title={isCollapsed ? 'Expandir grupo' : 'Contraer grupo'}
                              >
                                {isCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} className="-rotate-90" />}
                              </button>
                              <span className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: groupColor }} />
                              <span className="min-w-0 truncate text-sm font-black text-slate-800">{row.group.name}</span>
                              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                {row.taskCount} tarea{row.taskCount === 1 ? '' : 's'}
                              </span>
                              {row.taskCount === 0 && (
                                <span className="ml-3 hidden text-[11px] font-semibold text-slate-400 md:inline">
                                  Arrastra una tarea hasta este grupo
                                </span>
                              )}
                              {canManageTaskGroups && (
                                <button
                                  type="button"
                                  onClick={() => setIsGroupManagerOpen(true)}
                                  className="ml-auto rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-indigo-600"
                                  title="Editar grupos"
                                >
                                  <Settings size={14} />
                                </button>
                              )}
                            </div>
                          )}
                        </Draggable>
                      );
                    }

                    const task = row.task;
                    const index = rowIndex;
                    const isRecoveredMatrix = Boolean(task.isRecoveredMatrix && !tasksById.has(task.id));
                    const isRepairingMatrix = repairingMatrixIds.includes(task.id);
                    const assignedMember = teamMembers.find(m => m.id === task.assignedTo);
                    const taskTitle = getTaskTitle(task);
                    const taskDisplayTitle = getTaskDisplayTitle(task);
                    const startDate = getTaskDate(task.startDate);
                    const endDate = getTaskDate(task.endDate);
                    const scheduleState = getTaskScheduleState(task);
                    const isQuantitative = task.type === 'quantitative';
                    const isMeeting = isMeetingTask(task);
                    const hasDependentTasks = allChildrenByParentId.has(task.id);
                    const isParent = task.isParentTask || hasDependentTasks;
                    const isSubTask = Boolean(task.parentTaskId && !isRecoveredMatrix);
                    const isExpanded = expandedParents[task.id];
                    const isEditingTitle = editingTaskId === task.id;
                    const taskPriority = getTaskPriority(task);
                    const commentCount = getTaskCommentCount(task);
                    const canEditThisTaskDates = Boolean(canModifyTaskDates && !task.isWorkflowStep && !isRecoveredMatrix);
                    const canEditThisTaskAssignee = Boolean(canChangeTaskAssignee && !task.isWorkflowStep && task.assignedTo !== 'DYNAMIC' && !isRecoveredMatrix);
                    const isWorkflowTask = isWorkflowTaskType(task.type) && !task.isWorkflowStep;
                    const canUseStatusSelect = Boolean(canChangeTaskStatus && !isRecoveredMatrix && (!isWorkflowTask || (task.status || 'todo') === 'todo'));
                    const canAddSubtask = Boolean(canCreateSubtasks && task.type === 'state' && !task.parentTaskId && !task.isWorkflowStep && !isRecoveredMatrix);
                    const canResetWorkflow = Boolean(
                      canModifyTaskDetails &&
                      onResetWorkflowTask &&
                      isWorkflowTaskType(task.type) &&
                      !isRecoveredMatrix &&
                      !task.isParentTask &&
                      (task.status !== 'todo' || (task.progress || 0) > 0 || task.externalWorkflowId)
                    );
                    const canCreateBulkWorkflowIterations = Boolean(
                      canCreateSubtasks &&
                      onCreateBulkWorkflowIterations &&
                      isWorkflowTaskType(task.type) &&
                      !isStateWorkflowTaskType(task.type) &&
                      !task.isWorkflowStep &&
                      !isRecoveredMatrix
                    );
                    const taskRowsCount = visibleRows.filter((visibleRow) => visibleRow.type === 'task').length;
                    const shouldOpenActionMenuUp = taskRowsCount <= 4 || rowIndex >= visibleRows.length - 3;
                    const hasActionItems = Boolean(
                      !task.isWorkflowStep &&
                      (
                        (isRecoveredMatrix && onRepairMissingTaskMatrix) ||
                        (!isRecoveredMatrix && canModifyTaskDetails && onUpdateTaskTitle) ||
                        (!isRecoveredMatrix && onOpenTaskDocs) ||
                        (!isRecoveredMatrix && canEditTaskStructure && onEditTaskStructure) ||
                        canAddSubtask ||
                        isMeeting ||
                        (!isRecoveredMatrix && canModifyTaskDetails && isQuantitative) ||
                        (!isRecoveredMatrix && canModifyTaskDetails && task.syncExternal && onSyncTask) ||
                        canCreateBulkWorkflowIterations ||
                        canResetWorkflow ||
                        (!isRecoveredMatrix && canManageTaskGroups && onUpdateTaskGroup && assignableTaskGroups.length > 0) ||
                        (!isRecoveredMatrix && canRemoveTasks)
                      )
                    );

                    return (
                      <Draggable key={task.id} draggableId={task.id} index={index} isDragDisabled={hasActiveTaskFilter || !canModifyTaskDetails || isSubTask || isEditingTitle}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`flex items-center h-10 border-b transition-colors group relative ${snapshot.isDragging ? 'bg-white shadow-xl z-50 ring-1 ring-indigo-500/20' : ''} ${isRecoveredMatrix ? 'border-amber-100 bg-amber-50/40 hover:bg-amber-50/70' : isSubTask ? 'bg-indigo-50/30 border-indigo-100 hover:bg-indigo-50/60' : 'border-slate-100 hover:bg-slate-50'}`}
                          >
                            {/* Monday-style colored left bar */}
                            <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${getScheduleRailColor(task)}`} />

                            {isSubTask && (
                              <>
                                <div className="absolute left-5 top-0 bottom-0 w-px bg-indigo-100" />
                                <div className="absolute left-5 top-1/2 h-px w-6 bg-indigo-200" />
                              </>
                            )}

                            <div className="w-10 flex items-center justify-center gap-1 text-slate-300 group-hover:text-slate-400">
                              {canRemoveTasks && isSelectionMode && !task.isWorkflowStep ? (
                                <input
                                  type="checkbox"
                                  checked={selectedTaskIdSet.has(task.id)}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => toggleTaskSelection(task.id)}
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  title={`Seleccionar ${taskTitle}`}
                                  aria-label={`Seleccionar ${taskTitle}`}
                                />
                              ) : null}
                              {!isSubTask && (
                                <span
                                  {...provided.dragHandleProps}
                                  className={`${isSelectionMode ? 'hidden' : 'flex'} ${canModifyTaskDetails ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                                >
                                  <GripVertical size={14} />
                                </span>
                              )}
                            </div>

                            <div className={`flex-1 min-w-[220px] px-2 flex items-center gap-2 ${task.isWorkflowStep ? 'pl-10' : isSubTask ? 'pl-6' : ''}`}>
                              {isSubTask && <CornerDownRight size={14} className="shrink-0 text-indigo-300" />}
                              {(isParent || isWorkflowTaskType(task.type)) && !task.isWorkflowStep && (
                                <button
                                  onClick={() => toggleParent(task.id)}
                                  className="w-4 h-4 flex items-center justify-center rounded bg-slate-200 text-slate-600 hover:bg-slate-300"
                                >
                                  {isExpanded ? <ChevronLeft className="w-3 h-3 -rotate-90" /> : <ChevronRight className="w-3 h-3" />}
                                </button>
                              )}
                              {isEditingTitle ? (
                                <input
                                  autoFocus
                                  value={editingTaskTitle}
                                  onChange={(event) => setEditingTaskTitle(event.target.value)}
                                  onBlur={() => void finishEditingTitle(task)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.currentTarget.blur();
                                    }
                                    if (event.key === 'Escape') {
                                      setEditingTaskId(null);
                                      setEditingTaskTitle("");
                                    }
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                  className="h-7 min-w-0 flex-1 rounded-md border border-indigo-200 bg-white px-2 text-sm font-medium text-slate-800 outline-none ring-2 ring-indigo-500/10"
                                />
                              ) : (
                                <>
                                  {isMeeting && (
                                    <Calendar size={14} className="shrink-0 text-cyan-600" />
                                  )}
                                  <button
                                    type="button"
                                    onDoubleClick={() => {
                                      if (!isRecoveredMatrix) startEditingTitle(task);
                                    }}
                                    className={`min-w-0 flex-1 truncate text-left text-sm font-medium ${task.status === 'completed' || task.status === 'completed_late' || task.status === 'listo' ? 'text-slate-400 line-through' : isRecoveredMatrix ? 'font-black text-amber-800' : isSubTask ? 'text-slate-600' : 'text-slate-700'}`}
                                    title={isRecoveredMatrix ? `${taskDisplayTitle} · matriz recuperada desde ${task.recoveredChildCount || 0} subtareas` : taskDisplayTitle}
                                  >
                                    {taskDisplayTitle}
                                  </button>
                                  {onOpenTaskComments && !task.isWorkflowStep && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        onOpenTaskComments(task);
                                      }}
                                      className="relative shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                                      title="Comentarios"
                                    >
                                      <MessageSquare size={14} />
                                      {commentCount > 0 && (
                                        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-indigo-600 px-1 text-center text-[9px] font-bold leading-4 text-white">
                                          {commentCount > 99 ? '99+' : commentCount}
                                        </span>
                                      )}
                                    </button>
                                  )}
                                  {isMeeting && (
                                    <span className="shrink-0 rounded bg-cyan-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan-700 ring-1 ring-cyan-100">
                                      Reunión
                                    </span>
                                  )}
                                  {isMeeting && (
                                    <span
                                      className="max-w-[150px] shrink truncate rounded bg-cyan-100 px-1.5 py-0.5 text-[9px] font-black text-cyan-800 ring-1 ring-cyan-200"
                                      title={getMeetingScheduleLabel(task)}
                                    >
                                      {getCompactMeetingScheduleLabel(task)}
                                    </span>
                                  )}
                                </>
                              )}
                              {isSubTask && (
                                <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tight text-indigo-500 border border-indigo-100">
                                  Subtarea
                                </span>
                              )}
                              {isRecoveredMatrix && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-tight text-amber-700 border border-amber-200">
                                  {isRepairingMatrix && <RefreshCw size={10} className="animate-spin" />}
                                  {isRepairingMatrix ? 'Reparando matriz' : 'Matriz recuperada'}
                                </span>
                              )}
                              {task.isRateCardTask && (
                                <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 text-[8px] font-bold rounded uppercase tracking-tighter shrink-0 border border-indigo-100 shadow-sm">
                                  RC
                                </span>
                              )}
                              {isWorkflowTaskType(task.type) && !isSubTask && (
                                <span className={`px-1.5 py-0.5 text-[8px] font-bold rounded uppercase tracking-tighter shrink-0 border shadow-sm ${
                                  isStateWorkflowTaskType(task.type)
                                    ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                                    : isVariableWorkflowTaskType(task.type)
                                    ? 'border-violet-100 bg-violet-50 text-violet-600'
                                    : 'border-amber-100 bg-amber-50 text-amber-600'
                                }`}>
                                  {isStateWorkflowTaskType(task.type) ? 'EST' : isVariableWorkflowTaskType(task.type) ? 'WFV' : 'WF'}
                                </span>
                              )}
                              {task.requiresDocument && !task.linkedDocumentId && (
                                <span title="Requiere documento">
                                  <AlertCircle size={12} className="text-amber-500 shrink-0" />
                                </span>
                              )}
                            </div>

                            <div className="w-24 px-2 flex justify-center">
                              <div
                                className={`relative flex max-w-full items-center justify-center rounded-md ${
                                  canEditThisTaskAssignee ? 'cursor-pointer hover:bg-indigo-50/70' : ''
                                }`}
                                title={canEditThisTaskAssignee ? 'Cambiar responsable' : assignedMember?.name || 'Sin asignar'}
                              >
                                {task.assignedTo === 'DYNAMIC' ? (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-7 h-7 rounded-full bg-orange-50 border border-orange-200 flex items-center justify-center shadow-sm" title="Asignación Dinámica">
                                      <span className="text-[10px] font-bold text-orange-600">?</span>
                                    </div>
                                    <span className="text-[10px] text-slate-500 hidden lg:block truncate max-w-[50px]">Dinámica</span>
                                  </div>
                                ) : assignedMember ? (
                                  <div className="flex items-center gap-1.5 px-1 py-0.5">
                                    <div className={`w-7 h-7 rounded-full bg-indigo-50 border flex items-center justify-center overflow-hidden shadow-sm ${
                                      canEditThisTaskAssignee ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-indigo-100'
                                    }`}>
                                      {assignedMember.photoURL ? (
                                        <Image
                                          src={assignedMember.photoURL}
                                          alt={assignedMember.name}
                                          width={28}
                                          height={28}
                                          className="w-full h-full object-cover"
                                          referrerPolicy="no-referrer"
                                        />
                                      ) : (
                                        <span className="text-[10px] font-bold text-indigo-600">{assignedMember.name.charAt(0).toUpperCase()}</span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-slate-500 hidden lg:block truncate max-w-[50px]">{assignedMember.name.split(' ')[0]}</span>
                                  </div>
                                ) : (
                                  <div className={`w-7 h-7 rounded-full border border-dashed flex items-center justify-center bg-slate-50/50 ${
                                    canEditThisTaskAssignee ? 'border-indigo-300 text-indigo-500 ring-2 ring-indigo-100' : 'border-slate-300 text-slate-300'
                                  }`}>
                                    <Users size={12} className={canEditThisTaskAssignee ? 'text-indigo-500' : 'text-slate-300'} />
                                  </div>
                                )}

                                {canEditThisTaskAssignee && (
                                  <select
                                    value={task.assignedTo || ''}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) => {
                                      event.stopPropagation();
                                      onUpdateTaskAssignee?.(task.id, event.target.value, task);
                                    }}
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    aria-label={`Cambiar responsable de ${taskTitle}`}
                                  >
                                    <option value="">Sin asignar</option>
                                    {taskAssigneeOptions.map((member) => (
                                      <option key={member.id} value={member.id}>
                                        {member.name || member.email}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </div>

                            <div className="w-28 h-full relative group/status">
                              {task.isWorkflowStep ? (
                                <select
                                  value={task.status || 'not_started'}
                                  onChange={(e) => {
                                    // Update the specific step status in the parent task
                                    const newStatus = e.target.value;
                                    const parentTask = task.originalTask;
                                    const updatedSteps = [...parentTask.workflowSteps];
                                    updatedSteps[task.stepIndex].status = newStatus;
                                    onUpdateTaskStatus?.(parentTask.id, parentTask.status, { ...parentTask, workflowSteps: updatedSteps });
                                  }}
                                  disabled={!canChangeTaskStatus}
                                  className={`h-full w-full appearance-none flex items-center justify-center text-[10px] font-bold tracking-tight px-2 text-center focus:outline-none transition-all hover:brightness-105 ${canChangeTaskStatus ? 'cursor-pointer' : 'cursor-default'} ${getStatusColor(task.status)}`}
                                >
                                  <option value="not_started" className="bg-white text-slate-700" disabled>NO INICIADO</option>
                                  <option value="en_curso" className="bg-white text-slate-700" disabled>EN CURSO</option>
                                  <option value="listo" className="bg-white text-slate-700" disabled>LISTO</option>
                                  <option value="devuelto" className="bg-white text-slate-700" disabled>DEVUELTO</option>
                                  <option value="reproceso" className="bg-white text-slate-700" disabled>REPROCESO</option>
                                  <option value="detenido" className="bg-white text-slate-700">DETENIDO</option>
                                  {/* Allow changing back to en_curso if it was manually stopped */}
                                  {task.status === 'detenido' && <option value="en_curso" className="bg-white text-slate-700">REANUDAR (EN CURSO)</option>}
                                </select>
                              ) : (
                                <select
                                  value={task.status || 'todo'}
                                  onChange={(e) => onUpdateTaskStatus?.(task.id, e.target.value, task)}
                                  disabled={!canUseStatusSelect}
                                  title={isWorkflowTask ? 'Los workflows se inician, pausan o reprograman aquí; se finalizan por sus pasos.' : undefined}
                                  className={`h-full w-full appearance-none flex items-center justify-center text-[10px] font-bold tracking-tight px-2 text-center focus:outline-none transition-all hover:brightness-105 ${canUseStatusSelect ? 'cursor-pointer' : 'cursor-default'} ${getStatusColor(task.status)}`}
                                >
                                  {isWorkflowTask ? (
                                    <>
                                      {task.status !== 'in_progress' && (
                                        <option value={task.status || 'todo'} className="bg-white text-slate-700" disabled>
                                          {getStatusLabel(task.status || 'todo')}
                                        </option>
                                      )}
                                      <option value="in_progress" className="bg-white text-slate-700">TRABAJANDO</option>
                                      <option value="stuck" className="bg-white text-slate-700">ESTANCADO</option>
                                      <option value="rescheduled" className="bg-white text-slate-700">REPROGRAMAR</option>
                                    </>
                                  ) : (
                                    <>
                                      <option value="todo" className="bg-white text-slate-700">PENDIENTE</option>
                                      <option value="in_progress" className="bg-white text-slate-700">TRABAJANDO</option>
                                      <option value="stuck" className="bg-white text-slate-700">ESTANCADO</option>
                                      <option value="rescheduled" className="bg-white text-slate-700">REPROGRAMAR</option>
                                      <option value="completed" className="bg-white text-slate-700">LISTO</option>
                                      {task.status === 'completed_late' && <option value="completed_late" className="bg-white text-slate-700">LISTO CON RETRASO</option>}
                                    </>
                                  )}
                                </select>
                              )}
                              <div className="absolute inset-0 pointer-events-none opacity-0 group-hover/status:opacity-100 bg-black/5 transition-opacity" />
                            </div>

                            <div className="w-24 h-full relative group/priority">
                              {canModifyTaskDetails && onUpdateTaskPriority && !isRecoveredMatrix ? (
                                <select
                                  value={taskPriority}
                                  onChange={(e) => onUpdateTaskPriority(task.id, e.target.value, task)}
                                  className={`h-full w-full appearance-none flex items-center justify-center text-[10px] font-bold tracking-tight px-2 cursor-pointer text-center focus:outline-none transition-all hover:brightness-105 ${getPriorityColor(taskPriority)}`}
                                >
                                  <option value="high" className="bg-white text-slate-700">ALTA</option>
                                  <option value="medium" className="bg-white text-slate-700">MEDIA</option>
                                  <option value="low" className="bg-white text-slate-700">BAJA</option>
                                </select>
                              ) : (
                                <div className={`flex h-full w-full items-center justify-center text-[10px] font-bold tracking-tight ${getPriorityColor(taskPriority)}`}>
                                  {taskPriority === 'high' ? 'ALTA' : taskPriority === 'low' ? 'BAJA' : 'MEDIA'}
                                </div>
                              )}
                              <div className="absolute inset-0 pointer-events-none opacity-0 group-hover/priority:opacity-100 bg-black/5 transition-opacity" />
                            </div>

                            <div className="w-32 px-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  if (!canEditThisTaskDates) return;
                                  event.stopPropagation();
                                  setTaskForDateEdit(task);
                                }}
                                disabled={!canEditThisTaskDates}
                                className={`rounded-md h-7 w-full flex items-center justify-center relative overflow-hidden group/timeline border ${
                                  canEditThisTaskDates ? 'cursor-pointer hover:ring-2 hover:ring-indigo-500/10' : 'cursor-default'
                                } ${getScheduleDateClass(task)}`}
                                title={`${canEditThisTaskDates ? 'Editar fechas' : 'Sin permiso para editar fechas'}${scheduleState === 'overdue' ? ' · Atrasada' : scheduleState === 'due_soon' ? ' · Por vencer' : scheduleState === 'completed_late' ? ' · Finalizada con retraso' : ''}`}
                              >
                                <div className="z-10 flex items-center gap-1 text-[9px] font-bold">
                                  <Calendar size={10} />
                                  {startDate && endDate ? (
                                    `${format(startDate, 'd MMM', { locale: es })} - ${format(endDate, 'd MMM', { locale: es })}`
                                  ) : '-'}
                                </div>
                                <div className="absolute inset-0 bg-black/5 opacity-0 group-hover/timeline:opacity-100 transition-opacity" />
                              </button>
                            </div>

                            <div className="w-28 px-3 flex flex-col justify-center gap-1">
                              <div className="flex items-center justify-between text-[9px] font-bold">
                                <span className={task.progress === 100 ? 'text-[#00c875]' : 'text-slate-400'}>{task.progress || 0}%</span>
                                {isQuantitative && (
                                  <span className="text-[8px] text-indigo-500 bg-indigo-50 px-1 rounded">
                                    {task.currentValue || 0}/{task.indicatorValue} {task.indicator}
                                  </span>
                                )}
                                {isWorkflowTaskType(task.type) && task.workflowSteps && (
                                  <span className="text-[8px] text-amber-600 bg-amber-50 px-1 rounded">
                                    Paso {task.currentStepIndex + 1}/{task.workflowSteps.length}
                                  </span>
                                )}
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden shadow-inner">
                                <div
                                  className={`h-full transition-all duration-700 ease-out ${
                                    scheduleState === 'overdue' ? 'bg-red-600' :
                                    scheduleState === 'due_soon' ? 'bg-orange-500' :
                                    task.status === 'completed_late' ? 'bg-orange-500' :
                                    task.status === 'completed' ? 'bg-[#00c875]' :
                                    task.status === 'stuck' ? 'bg-[#e2445c]' :
                                    'bg-indigo-500'
                                  }`}
                                  style={{ width: `${task.progress || 0}%` }}
                                />
                              </div>
                            </div>

                            {hasActionItems && (
                              <div className="absolute right-2 flex items-center">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOpenActionMenuTaskId((currentId) => currentId === task.id ? null : task.id);
                                  }}
                                  className="rounded-md bg-white/90 p-1.5 text-slate-400 opacity-0 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-indigo-50 hover:text-indigo-600 group-hover:opacity-100"
                                  title="Acciones de tarea"
                                  aria-label={`Acciones de ${taskTitle}`}
                                >
                                  <MoreHorizontal size={15} />
                                </button>

                                {openActionMenuTaskId === task.id && (
                                  <div
                                    className={`absolute right-0 z-40 max-h-80 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl ${
                                      shouldOpenActionMenuUp ? 'bottom-8' : 'top-8'
                                    }`}
                                  >
                                    {isRecoveredMatrix && onRepairMissingTaskMatrix && (
                                      <button
                                        type="button"
                                        disabled={isRepairingMatrix}
                                        onClick={() => void handleRepairRecoveredMatrix(task)}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-amber-700 hover:bg-amber-50 disabled:cursor-wait disabled:opacity-70"
                                      >
                                        <RefreshCw size={14} className={isRepairingMatrix ? 'animate-spin' : ''} />
                                        {isRepairingMatrix ? 'Reparando...' : 'Reparar matriz'}
                                      </button>
                                    )}
                                    {canManageTaskGroups && onUpdateTaskGroup && assignableTaskGroups.length > 0 && !task.parentTaskId && !task.isWorkflowStep && !isRecoveredMatrix && (
                                      <div className="border-b border-slate-100 px-3 py-2">
                                        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                          Grupo
                                        </label>
                                        <select
                                          value={task.groupId || ''}
                                          onMouseDown={(event) => event.stopPropagation()}
                                          onClick={(event) => event.stopPropagation()}
                                          onChange={(event) => {
                                            event.stopPropagation();
                                            void onUpdateTaskGroup(task.id, event.target.value, task);
                                            setOpenActionMenuTaskId(null);
                                          }}
                                          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                                        >
                                          <option value="">{defaultTaskGroup.name}</option>
                                          {assignableTaskGroups.map((group) => (
                                            <option key={group.id} value={group.id}>
                                              {group.name}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                    {canModifyTaskDetails && onUpdateTaskTitle && !isRecoveredMatrix && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuTaskId(null);
                                          startEditingTitle(task);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                      >
                                        <Settings size={14} />
                                        Editar nombre
                                      </button>
                                    )}
                                    {onOpenTaskDocs && !isRecoveredMatrix && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuTaskId(null);
                                          onOpenTaskDocs(task.id, task);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                      >
                                        <FileText size={14} />
                                        Detalles e iteraciones
                                      </button>
                                    )}
                                    {canEditTaskStructure && onEditTaskStructure && !isRecoveredMatrix && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuTaskId(null);
                                          onEditTaskStructure(task);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                      >
                                        <Settings size={14} />
                                        Estructura y subtareas
                                      </button>
                                    )}
                                    {canAddSubtask && !isRecoveredMatrix && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuTaskId(null);
                                          onAddSubtask?.(task);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                      >
                                        <Plus size={14} />
                                        Agregar subtarea
                                      </button>
                                    )}
                                    {isMeeting && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenActionMenuTaskId(null);
                                            downloadMeetingIcs(task);
                                          }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-cyan-700 hover:bg-cyan-50"
                                          title={getMeetingScheduleLabel(task)}
                                        >
                                          <Calendar size={14} />
                                          Descargar .ics
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenActionMenuTaskId(null);
                                            const url = createGoogleCalendarUrl(task);
                                            if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                          }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-cyan-700 hover:bg-cyan-50"
                                        >
                                          <Calendar size={14} />
                                          Google Calendar
                                        </button>
                                      </>
                                    )}
                                    {canCreateBulkWorkflowIterations && !isRecoveredMatrix && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuTaskId(null);
                                          onCreateBulkWorkflowIterations?.(task);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                      >
                                        <ClipboardList size={14} />
                                        Iteraciones masivas
                                      </button>
                                    )}
                                    {canModifyTaskDetails && isQuantitative && !isWorkflowTaskType(task.type) && !isRecoveredMatrix && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuTaskId(null);
                                          if (onOpenIncrementTask) {
                                            onOpenIncrementTask(task);
                                            return;
                                          }
                                          const val = prompt('Ingresar nuevo valor actual:', task.currentValue || 0);
                                          if (val !== null) onUpdateTaskValue?.(task.id, Number(val), task);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                      >
                                        <Plus size={14} />
                                        Registrar incremento
                                      </button>
                                    )}
                                    {canModifyTaskDetails && task.syncExternal && onSyncTask && !isRecoveredMatrix && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuTaskId(null);
                                          onSyncTask(task.id, task);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                      >
                                        <RefreshCw size={14} />
                                        Sincronizar
                                      </button>
                                    )}
                                    {canResetWorkflow && !isRecoveredMatrix && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuTaskId(null);
                                          void onResetWorkflowTask?.(task);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-amber-700 hover:bg-amber-50"
                                      >
                                        <RotateCcw size={14} />
                                        Reiniciar flujo
                                      </button>
                                    )}
                                    {canRemoveTasks && hasDependentTasks && onDeleteTaskTree && !task.isWorkflowStep && !isRecoveredMatrix && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuTaskId(null);
                                          onDeleteTaskTree(task.id, task);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-red-700 hover:bg-red-50"
                                      >
                                        <Trash2 size={14} />
                                        Eliminar matriz y subtareas
                                      </button>
                                    )}
                                    {canRemoveTasks && (!hasDependentTasks || !onDeleteTaskTree) && !isRecoveredMatrix && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuTaskId(null);
                                          if (onDeleteTasks) {
                                            onDeleteTasks([task.id]);
                                            return;
                                          }
                                          onDeleteTask?.(task.id);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50"
                                      >
                                        <Trash2 size={14} />
                                        Eliminar
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>

        <div
          aria-hidden={isTimelineCollapsed}
          className={`overflow-hidden bg-white transition-[flex-basis,width,opacity] ${
            isTimelineCollapsed
              ? 'w-0 min-w-0 basis-0 grow-0 shrink opacity-0 pointer-events-none'
              : 'flex-1 opacity-100'
          }`}
        >
          <div className="project-gantt-timeline-only h-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200">
            {ganttTasks.length > 0 ? (
              <Gantt
                tasks={ganttTasks}
                viewMode={viewMode}
                listCellWidth=""
                columnWidth={viewMode === ViewMode.Day ? 65 : viewMode === ViewMode.Week ? 150 : 250}
                headerHeight={40}
                rowHeight={40}
                barCornerRadius={4}
                barFill={70}
                handleWidth={8}
                fontSize="11px"
                fontFamily="Inter, sans-serif"
                todayColor="rgba(99, 102, 241, 0.03)"
                onProgressChange={canModifyTaskDetails && onUpdateTaskProgress ? (task) => {
                  const originalTask = tasks.find(t => t.id === task.id);
                  if (!originalTask) return;
                  onUpdateTaskProgress(task.id, task.progress, originalTask);
                } : undefined}
                onDateChange={canModifyTaskDates ? (task) => {
                  const originalTask = tasks.find(t => t.id === task.id);
                  if (!originalTask) return;
                  onUpdateTaskDates?.(task.id, task.start, task.end, originalTask);
                } : undefined}
              />
            ) : (
              <div className="flex h-full min-h-[180px] items-center justify-center text-sm font-medium text-slate-400">
                Sin tareas para mostrar en el cronograma.
              </div>
            )}
          </div>
        </div>
      </div>
      {isFullscreenGanttOpen && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-slate-50 text-slate-950">
          <div className="relative overflow-hidden border-b border-white/10 bg-[#070b1a] px-5 py-4 text-white shadow-2xl">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-2/3 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.34),transparent_34%),linear-gradient(90deg,rgba(20,184,166,0.16),transparent_60%)]" />
            <div className="relative flex min-h-14 items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-lg shadow-indigo-950/40 ring-1 ring-white/15">
                    <Maximize2 size={18} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-black tracking-tight">Gantt interactivo del proyecto</h2>
                    <p className="truncate text-sm font-semibold text-slate-300">
                      {fullscreenGanttTasks.length} linea{fullscreenGanttTasks.length === 1 ? '' : 's'} visibles · haz clic en una barra para revisar sus detalles.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-slate-200 lg:flex">
                  <span className="text-indigo-200">{scheduleStats.overdue}</span>
                  <span>atrasadas</span>
                  <span className="h-4 w-px bg-white/15" />
                  <span className="text-orange-200">{scheduleStats.dueSoon}</span>
                  <span>por vencer</span>
                </div>
                <div className="hidden rounded-2xl bg-white/10 p-1 shadow-inner shadow-black/10 sm:flex">
                  <button
                    type="button"
                    onClick={() => setViewMode(ViewMode.Day)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${viewMode === ViewMode.Day ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-300 hover:text-white'}`}
                  >
                    Día
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode(ViewMode.Week)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${viewMode === ViewMode.Week ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-300 hover:text-white'}`}
                  >
                    Semana
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode(ViewMode.Month)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${viewMode === ViewMode.Month ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-300 hover:text-white'}`}
                  >
                    Mes
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsFullscreenDetailOpen(false);
                    setIsFullscreenGanttOpen(false);
                  }}
                  className="rounded-2xl p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
                  aria-label="Cerrar Gantt completo"
                >
                  <X size={22} />
                </button>
              </div>
            </div>
          </div>

          <div className="relative min-h-0 flex-1 bg-slate-100">
            <div className="min-h-0 bg-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 text-xs font-bold text-slate-500 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-emerald-700">
                    <span className="h-2 w-2 rounded-full bg-[#00c875]" />
                    Finalizadas
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-100 bg-orange-50 px-3 py-1.5 text-orange-700">
                    <span className="h-2 w-2 rounded-full bg-[#fdab3d]" />
                    Trabajando / por vencer
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-red-700">
                    <span className="h-2 w-2 rounded-full bg-red-600" />
                    Atrasadas / estancadas
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-indigo-600">
                    Arrastra para navegar
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                    Vista {viewMode === ViewMode.Day ? 'diaria' : viewMode === ViewMode.Week ? 'semanal' : 'mensual'}
                  </span>
                </div>
              </div>

              <div ref={fullscreenGanttPanRef} className="project-gantt-fullscreen-scroll h-[calc(100vh-134px)] overflow-auto bg-[#f8fafc] p-3">
                {fullscreenGanttTasks.length > 0 ? (
                  <div className="project-gantt-fullscreen-canvas min-w-[900px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <Gantt
                      tasks={fullscreenGanttTasks}
                      viewMode={viewMode}
                      listCellWidth="320px"
                      columnWidth={viewMode === ViewMode.Day ? 68 : viewMode === ViewMode.Week ? 150 : 240}
                      headerHeight={52}
                      rowHeight={42}
                      barCornerRadius={8}
                      barFill={52}
                      handleWidth={8}
                      fontSize={viewMode === ViewMode.Month ? "11px" : "10px"}
                      fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
                      todayColor="rgba(79, 70, 229, 0.07)"
                      TaskListHeader={FullscreenGanttTaskListHeader}
                      TaskListTable={FullscreenGanttTaskListTable}
                      onClick={handleFullscreenTaskClick}
                      onSelect={(task, isSelected) => {
                        if (isSelected) handleFullscreenTaskClick(task);
                      }}
                      onExpanderClick={(task) => {
                        const meta = (task as FullscreenGanttTask).fullscreenMeta;
                        if (meta?.rowKind === 'group') {
                          const groupId = task.id.replace(/^group-/, '');
                          toggleGroup(groupId);
                          return;
                        }
                        toggleParent(task.id);
                      }}
                      onProgressChange={canModifyTaskDetails && onUpdateTaskProgress ? (task) => {
                        const originalTask = tasks.find(t => t.id === task.id);
                        if (!originalTask) return;
                        onUpdateTaskProgress(task.id, task.progress, originalTask);
                      } : undefined}
                      onDateChange={canModifyTaskDates ? (task) => {
                        const originalTask = tasks.find(t => t.id === task.id);
                        if (!originalTask) return;
                        onUpdateTaskDates?.(task.id, task.start, task.end, originalTask);
                      } : undefined}
                    />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">
                    No hay tareas para visualizar en pantalla completa.
                  </div>
                )}
              </div>
            </div>

            {isFullscreenDetailOpen && selectedTimelineSourceTask && (
            <aside className="absolute bottom-4 right-4 top-4 z-30 flex w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/95 shadow-2xl shadow-slate-950/30 backdrop-blur-xl">
              <div className="border-b border-white/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-indigo-300">
                    <Activity size={14} />
                    Detalle seleccionado
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsFullscreenDetailOpen(false)}
                    className="rounded-xl p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
                    aria-label="Cerrar detalle"
                  >
                    <X size={18} />
                  </button>
                </div>
                {selectedTimelineSourceTask ? (
                  <>
                    <h3 className="mt-3 break-words text-xl font-black leading-tight text-white [overflow-wrap:anywhere]">
                      {getTaskDisplayTitle(selectedTimelineTask || selectedTimelineSourceTask)}
                    </h3>
                    {selectedTimelineTask?.isWorkflowStep && (
                      <p className="mt-1 break-words text-xs font-semibold text-slate-400 [overflow-wrap:anywhere]">
                        Pertenece a {getTaskDisplayTitle(selectedTimelineSourceTask)}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-black text-white">
                        {getStatusLabel(selectedTimelineTask?.status || selectedTimelineSourceTask.status || 'todo')}
                      </span>
                      <span className="rounded-full bg-indigo-500/15 px-2.5 py-1 text-xs font-black text-indigo-200">
                        {isWorkflowTaskType(selectedTimelineSourceTask.type) ? getWorkflowTaskTypeLabel(selectedTimelineSourceTask.type) : selectedTimelineSourceTask.type === 'quantitative' ? 'Cuantitativa' : isMeetingTask(selectedTimelineSourceTask) ? 'Reunión' : 'Tarea'}
                      </span>
                      <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-black text-slate-200">
                        {getTaskPriority(selectedTimelineSourceTask) === 'high' ? 'Alta' : getTaskPriority(selectedTimelineSourceTask) === 'low' ? 'Baja' : 'Media'}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">Selecciona una barra del cronograma para ver sus datos.</p>
                )}
              </div>

              {selectedTimelineSourceTask && (
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Inicio</p>
                      <p className="mt-1 text-sm font-black text-white">
                        {formatTaskDateLabel(selectedTimelineSourceTask.startDate || selectedTimelineSourceTask.start)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Fin</p>
                      <p className="mt-1 text-sm font-black text-white">
                        {formatTaskDateLabel(selectedTimelineSourceTask.endDate || selectedTimelineSourceTask.end)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Responsable</p>
                      <p className="mt-1 truncate text-sm font-black text-white" title={selectedTimelineAssignee?.name || 'Sin responsable'}>
                        {selectedTimelineAssignee?.name || (selectedTimelineSourceTask.assignedTo === 'DYNAMIC' ? 'Dinámico' : 'Sin responsable')}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Avance</p>
                      <p className="mt-1 text-sm font-black text-white">{selectedTimelineSourceTask.progress || 0}%</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                      <span>Progreso de la tarea</span>
                      <span>{selectedTimelineSourceTask.progress || 0}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-indigo-400 transition-all"
                        style={{ width: `${Math.min(100, Number(selectedTimelineSourceTask.progress || 0))}%` }}
                      />
                    </div>
                    {isWorkflowTaskType(selectedTimelineSourceTask.type) && Array.isArray(selectedTimelineSourceTask.workflowSteps) && (
                      <p className="mt-2 text-xs font-semibold text-amber-200">
                        Paso {(selectedTimelineSourceTask.currentStepIndex || 0) + 1} de {selectedTimelineSourceTask.workflowSteps.length}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    {onOpenTaskDocs && !selectedTimelineTask?.isWorkflowStep && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsFullscreenGanttOpen(false);
                          onOpenTaskDocs(selectedTimelineSourceTask.id, selectedTimelineSourceTask);
                        }}
                        className="rounded-xl border border-indigo-400/30 bg-indigo-500 px-3 py-2.5 text-sm font-black text-white shadow-lg shadow-indigo-950/20 transition hover:bg-indigo-400"
                      >
                        Ver detalles e iteraciones
                      </button>
                    )}
                    {onOpenTaskComments && !selectedTimelineTask?.isWorkflowStep && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsFullscreenGanttOpen(false);
                          onOpenTaskComments(selectedTimelineSourceTask);
                        }}
                        className="rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2.5 text-sm font-black text-white transition hover:bg-white/[0.12]"
                      >
                        Comentarios e interacciones
                      </button>
                    )}
                  </div>

                  <div className="mt-5">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
                        <History size={14} />
                        Interacciones
                      </p>
                      <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black text-slate-300">
                        {selectedTimelineInteractions.length}
                      </span>
                    </div>
                    {selectedTimelineInteractions.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm font-semibold text-slate-500">
                        Esta tarea todavía no tiene interacciones registradas.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {selectedTimelineInteractions.slice(0, 10).map((interaction: any, index: number) => (
                          <div key={`${interaction.kind}-${index}-${getTaskDateTime(interaction.date)}`} className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-words text-sm font-black text-white [overflow-wrap:anywhere]">
                                  {interaction.title}
                                </p>
                                <p className="mt-0.5 truncate text-xs font-semibold text-indigo-200" title={interaction.actor}>
                                  {interaction.actor}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-slate-300">
                                {interaction.kind}
                              </span>
                            </div>
                            {interaction.description && (
                              <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-300 [overflow-wrap:anywhere]">
                                {interaction.description}
                              </p>
                            )}
                            <p className="mt-2 text-[10px] font-semibold text-slate-500">
                              {formatTaskDateTimeLabel(interaction.date)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </aside>
            )}
          </div>
        </div>
      )}
      {isGroupManagerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-base font-black text-slate-900">Grupos de tareas</h3>
                <p className="text-xs text-slate-500">
                  1 grupo predeterminado · {assignableTaskGroups.length} personalizado{assignableTaskGroups.length === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsGroupManagerOpen(false)}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto bg-slate-50 p-5">
              {onCreateTaskGroup && (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(event) => setNewGroupName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleCreateGroup();
                        }
                      }}
                      placeholder="Nombre del grupo"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <Button
                      type="button"
                      onClick={() => void handleCreateGroup()}
                      disabled={!newGroupName.trim()}
                      className="h-9 bg-indigo-600 px-3 text-white hover:bg-indigo-700"
                    >
                      <Plus size={14} className="mr-1" />
                      Crear
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {TASK_GROUP_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewGroupColor(color)}
                        className={`h-6 w-6 rounded-full border-2 transition-transform ${
                          newGroupColor === color ? 'scale-110 border-slate-900' : 'border-white ring-1 ring-slate-200'
                        }`}
                        style={{ backgroundColor: color }}
                        aria-label={`Color ${color}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {sortedTaskGroups.map((group) => {
                    const knownGroupIds = new Set(sortedTaskGroups.map((candidate) => candidate.id));
                    const groupTaskCount = sortedTasks.filter((task) => {
                      if (task.parentTaskId) return false;
                      const groupId = getTaskGroupId(task);
                      if (group.id === UNGROUPED_GROUP_ID) {
                        return groupId === UNGROUPED_GROUP_ID || !knownGroupIds.has(groupId);
                      }
                      return groupId === group.id;
                    }).length;
                    const isDefaultGroup = group.id === UNGROUPED_GROUP_ID;

                    return (
                      <div key={group.id} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: getTaskGroupColor(group) }} />
                          <input
                            defaultValue={group.name}
                            onBlur={(event) => {
                              const nextName = event.target.value.trim().replace(/\s+/g, ' ');
                              if (!nextName) {
                                event.target.value = group.name;
                                return;
                              }
                              if (nextName && nextName !== group.name) {
                                void onUpdateTaskGroupDefinition?.(group.id, { name: nextName });
                              }
                            }}
                            className="h-8 min-w-0 flex-1 rounded-md border border-transparent px-2 text-sm font-bold text-slate-800 outline-none transition-colors hover:border-slate-200 focus:border-indigo-200 focus:ring-2 focus:ring-indigo-500/10"
                          />
                          {isDefaultGroup && (
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
                              Predeterminado
                            </span>
                          )}
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                            {groupTaskCount}
                          </span>
                          {onDeleteTaskGroup && !isDefaultGroup && (
                            <button
                              type="button"
                              onClick={() => void onDeleteTaskGroup(group.id)}
                              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              title="Eliminar grupo"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 pl-5">
                          {TASK_GROUP_COLORS.map((color) => (
                            <button
                              key={`${group.id}-${color}`}
                              type="button"
                              onClick={() => void onUpdateTaskGroupDefinition?.(group.id, { color })}
                              className={`h-5 w-5 rounded-full border-2 ${
                                getTaskGroupColor(group) === color ? 'border-slate-900' : 'border-white ring-1 ring-slate-200'
                              }`}
                              style={{ backgroundColor: color }}
                              aria-label={`Color ${color}`}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}
      <TaskDateEditorModal
        isOpen={!!taskForDateEdit}
        task={taskForDateEdit}
        onClose={() => setTaskForDateEdit(null)}
        onSave={(taskId, start, end, task) => onUpdateTaskDates?.(taskId, start, end, task)}
      />
    </div>
  );
};
