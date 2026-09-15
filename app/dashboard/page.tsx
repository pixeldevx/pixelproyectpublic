"use client"

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { collection, onSnapshot, orderBy, query } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import { belongsToAnyOrganization } from '@/lib/organizations';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock,
  FolderKanban,
  Inbox,
  Layers3,
  Sparkles,
  Target,
  Users,
  Zap,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { differenceInCalendarDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getTaskDisplayTitle } from '@/lib/task-title';
import { isWorkflowTaskType } from '@/lib/workflow-routing';

type DashboardProject = {
  id: string;
  name?: string;
  description?: string;
  status?: string;
  ownerId?: string;
  assignedUsers?: string[];
  assignedTeamMembers?: string[];
  assignedEmails?: string[];
  organizationId?: string;
  organizationIds?: string[];
  createdAt?: any;
  updatedAt?: any;
};

type DashboardTask = {
  id: string;
  projectId: string;
  projectName: string;
  title?: string;
  name?: string;
  status?: string;
  priority?: string;
  progress?: number;
  assignedTo?: string;
  assignedUsers?: string[];
  assignedTeamMembers?: string[];
  parentTaskId?: string;
  type?: string;
  workflowSteps?: any[];
  currentStepIndex?: number;
  externalWorkflowId?: string;
  originalTitle?: string;
  parentTaskTitle?: string;
  endDate?: any;
  end?: any;
  dueDate?: any;
  updatedAt?: any;
  createdAt?: any;
};

type ProjectDashboard = {
  project: DashboardProject;
  tasks: DashboardTask[];
  userTasks: DashboardTask[];
  stats: DashboardStats;
  userStats: DashboardStats;
};

type DashboardStats = {
  total: number;
  pending: number;
  active: number;
  blocked: number;
  completed: number;
  completedLate: number;
  overdue: number;
  dueSoon: number;
  highPriority: number;
  workflows: number;
  averageProgress: number;
  completionRate: number;
};

const MANAGER_ROLES = new Set(['admin', 'org_admin', 'manager', 'coordinador']);
const COMPLETED_STATUSES = new Set(['completed', 'completed_late', 'listo']);
const ACTIVE_STATUSES = new Set(['in_progress', 'en_curso', 'trabajando', 'reproceso']);
const BLOCKED_STATUSES = new Set(['stuck', 'detenido', 'blocked']);
const PENDING_STATUSES = new Set(['todo', 'pending', 'not_started', 'no_iniciado']);

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador global',
  org_admin: 'Administrador de organización',
  manager: 'Gerente',
  coordinador: 'Coordinador',
  administrativo: 'Administrativo',
  user: 'Profesional',
};

const STATUS_CHART_COLORS = {
  pending: '#94a3b8',
  active: '#f59e0b',
  blocked: '#ef4444',
  completed: '#10b981',
  completedLate: '#f97316',
};

const getDate = (value: any): Date | null => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTime = (value: any) => getDate(value)?.getTime() || 0;

const getTaskTitle = (task: DashboardTask) => getTaskDisplayTitle(task, 'Tarea sin nombre');

const getStatusBucket = (status?: string) => {
  const normalized = String(status || 'todo').toLowerCase();
  if (normalized === 'completed_late') return 'completedLate';
  if (COMPLETED_STATUSES.has(normalized)) return 'completed';
  if (BLOCKED_STATUSES.has(normalized)) return 'blocked';
  if (ACTIVE_STATUSES.has(normalized)) return 'active';
  if (PENDING_STATUSES.has(normalized)) return 'pending';
  return 'pending';
};

const isCompletedTask = (task: DashboardTask) => COMPLETED_STATUSES.has(String(task.status || '').toLowerCase());

const getScheduleState = (task: DashboardTask) => {
  if (isCompletedTask(task)) return task.status === 'completed_late' ? 'completed_late' : 'completed';
  if (BLOCKED_STATUSES.has(String(task.status || '').toLowerCase())) return 'paused';
  const endDate = getDate(task.endDate || task.end || task.dueDate);
  if (!endDate) return 'none';
  const days = differenceInCalendarDays(endDate, new Date());
  if (days < 0) return 'overdue';
  if (days <= 2) return 'due_soon';
  return 'ok';
};

const getDueLabel = (task: DashboardTask) => {
  const endDate = getDate(task.endDate || task.end || task.dueDate);
  if (!endDate) return 'Sin fecha';
  const days = differenceInCalendarDays(endDate, new Date());
  if (days < 0) return `Venció ${format(endDate, 'd MMM', { locale: es })}`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `Vence ${format(endDate, 'd MMM', { locale: es })}`;
};

const getDueClass = (task: DashboardTask) => {
  const state = getScheduleState(task);
  if (state === 'overdue') return 'bg-red-50 text-red-700 ring-red-100';
  if (state === 'due_soon') return 'bg-orange-50 text-orange-700 ring-orange-100';
  if (state === 'completed_late') return 'bg-orange-50 text-orange-700 ring-orange-100';
  if (state === 'completed') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (state === 'paused') return 'bg-red-50 text-red-700 ring-red-100';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
};

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
  if (bucket === 'completedLate') return 'bg-orange-50 text-orange-700';
  if (bucket === 'completed') return 'bg-emerald-50 text-emerald-700';
  if (bucket === 'blocked') return 'bg-red-50 text-red-700';
  if (bucket === 'active') return 'bg-amber-50 text-amber-700';
  return 'bg-slate-100 text-slate-700';
};

const getPriorityClass = (priority?: string) => {
  if (priority === 'high') return 'bg-red-600 text-white';
  if (priority === 'low') return 'bg-slate-100 text-slate-600';
  return 'bg-indigo-50 text-indigo-700';
};

const isTaskAssignedToUser = (task: DashboardTask, assignedIds: string[]) => {
  if (task.assignedTo && assignedIds.includes(task.assignedTo)) return true;
  if (Array.isArray(task.assignedUsers) && task.assignedUsers.some((id) => assignedIds.includes(id))) return true;
  if (Array.isArray(task.assignedTeamMembers) && task.assignedTeamMembers.some((id) => assignedIds.includes(id))) return true;

  if (isWorkflowTaskType(task.type) && Array.isArray(task.workflowSteps)) {
    const currentStep = task.workflowSteps[task.currentStepIndex || 0];
    return Boolean(currentStep?.assignedTo && assignedIds.includes(currentStep.assignedTo));
  }

  return false;
};

const calculateStats = (tasks: DashboardTask[]): DashboardStats => {
  const safeTasks = tasks.filter(Boolean);
  const total = safeTasks.length;
  const completed = safeTasks.filter((task) => getStatusBucket(task.status) === 'completed').length;
  const completedLate = safeTasks.filter((task) => getStatusBucket(task.status) === 'completedLate').length;
  const active = safeTasks.filter((task) => getStatusBucket(task.status) === 'active').length;
  const blocked = safeTasks.filter((task) => getStatusBucket(task.status) === 'blocked').length;
  const pending = safeTasks.filter((task) => getStatusBucket(task.status) === 'pending').length;
  const openTasks = safeTasks.filter((task) => !isCompletedTask(task));

  return {
    total,
    pending,
    active,
    blocked,
    completed,
    completedLate,
    overdue: openTasks.filter((task) => getScheduleState(task) === 'overdue').length,
    dueSoon: openTasks.filter((task) => getScheduleState(task) === 'due_soon').length,
    highPriority: openTasks.filter((task) => task.priority === 'high').length,
    workflows: openTasks.filter((task) => isWorkflowTaskType(task.type)).length,
    averageProgress: total ? Math.round(safeTasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / total) : 0,
    completionRate: total ? Math.round(((completed + completedLate) / total) * 100) : 0,
  };
};

const getProjectHealth = (stats: DashboardStats) => {
  if (stats.overdue > 0 || stats.blocked > 0) {
    return { label: 'Crítico', className: 'bg-red-50 text-red-700 ring-red-100', rail: 'bg-red-500' };
  }
  if (stats.dueSoon > 0 || stats.highPriority > 0) {
    return { label: 'Vigilancia', className: 'bg-orange-50 text-orange-700 ring-orange-100', rail: 'bg-orange-500' };
  }
  if (stats.total > 0 && stats.completionRate >= 80) {
    return { label: 'Saludable', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100', rail: 'bg-emerald-500' };
  }
  return { label: 'En marcha', className: 'bg-indigo-50 text-indigo-700 ring-indigo-100', rail: 'bg-indigo-500' };
};

const compactNumber = (value: number) => new Intl.NumberFormat('es-CO').format(value);

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  tone,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  tone: 'indigo' | 'emerald' | 'amber' | 'red' | 'cyan';
}) {
  const toneClass = {
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    red: 'bg-red-50 text-red-700 ring-red-100',
    cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{title}</p>
          <p className="mt-2 break-words text-2xl font-black tracking-tight text-slate-950 sm:mt-3 sm:text-3xl">{value}</p>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 sm:h-10 sm:w-10 ${toneClass}`}>
          {icon}
        </div>
      </div>
      <p className="mt-2 text-xs font-medium leading-5 text-slate-500 sm:mt-3 sm:text-sm">{subtitle}</p>
    </div>
  );
}

function ProgressLine({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-500">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<string, DashboardTask[]>>({});
  const [selectedScopeId, setSelectedScopeId] = useState('all');
  const [projectsLoading, setProjectsLoading] = useState(true);
  const userUid = user?.uid || '';
  const userEmail = user?.email?.toLowerCase() || '';

  const managedOrganizationIds = useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );

  const currentUserIds = useMemo(() => {
    const ids = new Set<string>();
    if (userUid) ids.add(userUid);

    teamMembers.forEach((member) => {
      const memberEmail = String(member.email || '').toLowerCase();
      if (memberEmail && memberEmail === userEmail) ids.add(member.id);
      if (member.authUserId && member.authUserId === userUid) ids.add(member.id);
      if (member.uid && member.uid === userUid) ids.add(member.id);
    });

    return Array.from(ids);
  }, [teamMembers, userEmail, userUid]);

  const canSeeProjectSummary = MANAGER_ROLES.has(userRole || '');

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      query(collection(db, 'team_members')),
      (snapshot) => {
        setTeamMembers(snapshot.docs.map((teamDoc) => ({ id: teamDoc.id, ...teamDoc.data() })));
      },
      (error) => {
        console.error('Error loading dashboard team members:', error);
      }
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      query(collection(db, 'projects')),
      (snapshot) => {
        const projectData = snapshot.docs
          .map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() } as DashboardProject))
          .sort((left, right) => getTime(right.updatedAt || right.createdAt) - getTime(left.updatedAt || left.createdAt));

        setProjects(projectData);
        setProjectsLoading(false);
      },
      (error) => {
        console.error('Error loading dashboard projects:', error);
        setProjectsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const visibleProjects = useMemo(() => {
    return projects.filter((project) => {
      if (userRole === 'admin') return true;
      if (userRole === 'org_admin') return belongsToAnyOrganization(project, managedOrganizationIds);

      const assignedUsers = Array.isArray(project.assignedUsers) ? project.assignedUsers : [];
      const assignedTeamMembers = Array.isArray(project.assignedTeamMembers) ? project.assignedTeamMembers : [];
      const assignedEmails = Array.isArray(project.assignedEmails) ? project.assignedEmails.map((email) => String(email).toLowerCase()) : [];

      return (
        project.ownerId === userUid ||
        assignedUsers.includes(userUid) ||
        assignedEmails.includes(userEmail) ||
        assignedTeamMembers.some((memberId) => currentUserIds.includes(memberId))
      );
    });
  }, [currentUserIds, managedOrganizationIds, projects, userEmail, userRole, userUid]);

  useEffect(() => {
    if (!user) return;

    if (visibleProjects.length === 0) return;

    const unsubscribes = visibleProjects.map((project) =>
      onSnapshot(
        query(collection(db, 'projects', project.id, 'tasks'), orderBy('displayOrder', 'asc')),
        (snapshot) => {
          const tasks = snapshot.docs.map((taskDoc) => ({
            id: taskDoc.id,
            projectId: project.id,
            projectName: project.name || 'Proyecto',
            ...taskDoc.data(),
          } as DashboardTask));

          setTasksByProject((current) => ({ ...current, [project.id]: tasks }));
        },
        (error) => {
          console.error(`Error loading dashboard tasks for ${project.id}:`, error);
        }
      )
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [user, visibleProjects]);

  const projectDashboards = useMemo<ProjectDashboard[]>(() => {
    return visibleProjects.map((project) => {
      const projectTasks = tasksByProject[project.id] || [];
      const userTasks = projectTasks.filter((task) => isTaskAssignedToUser(task, currentUserIds));

      return {
        project,
        tasks: projectTasks,
        userTasks,
        stats: calculateStats(projectTasks),
        userStats: calculateStats(userTasks),
      };
    });
  }, [currentUserIds, tasksByProject, visibleProjects]);

  const selectedProjectDashboard = useMemo(() => {
    if (selectedScopeId === 'all') return null;
    return projectDashboards.find((item) => item.project.id === selectedScopeId) || null;
  }, [projectDashboards, selectedScopeId]);
  const effectiveScopeId = selectedProjectDashboard ? selectedScopeId : 'all';

  const allTasks = useMemo(() => projectDashboards.flatMap((item) => item.tasks), [projectDashboards]);
  const allUserTasks = useMemo(() => projectDashboards.flatMap((item) => item.userTasks), [projectDashboards]);
  const scopeProjects = selectedProjectDashboard ? [selectedProjectDashboard] : projectDashboards;
  const scopeAllTasks = selectedProjectDashboard ? selectedProjectDashboard.tasks : allTasks;
  const scopeUserTasks = selectedProjectDashboard ? selectedProjectDashboard.userTasks : allUserTasks;
  const scopeStats = calculateStats(canSeeProjectSummary ? scopeAllTasks : scopeUserTasks);
  const scopeUserStats = calculateStats(scopeUserTasks);
  const overallStats = calculateStats(allTasks);
  const overallUserStats = calculateStats(allUserTasks);
  const loading = projectsLoading;

  const statusChartData = [
    { name: 'Pendientes', value: scopeStats.pending, color: STATUS_CHART_COLORS.pending },
    { name: 'En curso', value: scopeStats.active, color: STATUS_CHART_COLORS.active },
    { name: 'Bloqueadas', value: scopeStats.blocked, color: STATUS_CHART_COLORS.blocked },
    { name: 'Finalizadas', value: scopeStats.completed, color: STATUS_CHART_COLORS.completed },
    { name: 'Con retraso', value: scopeStats.completedLate, color: STATUS_CHART_COLORS.completedLate },
  ].filter((item) => item.value > 0);

  const projectBarData = scopeProjects.map((item) => ({
    name: item.project.name || 'Proyecto',
    progreso: item.stats.averageProgress,
    pendientes: item.stats.pending + item.stats.active + item.stats.blocked,
  })).slice(0, 6);

  const focusTasks = scopeUserTasks
    .filter((task) => !isCompletedTask(task))
    .sort((left, right) => {
      const leftSchedule = getScheduleState(left);
      const rightSchedule = getScheduleState(right);
      const scheduleWeight: Record<string, number> = { overdue: 0, due_soon: 1, ok: 2, none: 3, completed: 4, completed_late: 4 };
      const weightDiff = (scheduleWeight[leftSchedule] ?? 3) - (scheduleWeight[rightSchedule] ?? 3);
      if (weightDiff !== 0) return weightDiff;
      return getTime(left.endDate || left.end || left.dueDate) - getTime(right.endDate || right.end || right.dueDate);
    })
    .slice(0, 7);

  const alerts = [
    {
      id: 'overdue',
      visible: scopeStats.overdue > 0,
      icon: <AlertTriangle size={16} />,
      title: `${scopeStats.overdue} tarea${scopeStats.overdue === 1 ? '' : 's'} atrasada${scopeStats.overdue === 1 ? '' : 's'}`,
      description: 'Requieren accion inmediata para proteger el cronograma.',
      className: 'text-red-700 bg-red-50 ring-red-100',
    },
    {
      id: 'dueSoon',
      visible: scopeStats.dueSoon > 0,
      icon: <Clock size={16} />,
      title: `${scopeStats.dueSoon} por vencer`,
      description: 'Estan dentro de la ventana critica de los proximos dos dias.',
      className: 'text-orange-700 bg-orange-50 ring-orange-100',
    },
    {
      id: 'blocked',
      visible: scopeStats.blocked > 0,
      icon: <Zap size={16} />,
      title: `${scopeStats.blocked} bloqueada${scopeStats.blocked === 1 ? '' : 's'}`,
      description: 'Conviene destrabar responsables, pasos o insumos.',
      className: 'text-red-700 bg-red-50 ring-red-100',
    },
  ].filter((alert) => alert.visible);

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'equipo';
  const scopeLabel = selectedProjectDashboard ? selectedProjectDashboard.project.name || 'Proyecto' : 'Todos los proyectos';

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-slate-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white sm:text-xs sm:tracking-[0.16em]">
                <BrainCircuit size={14} className="text-cyan-300" />
                Centro inteligente
              </div>
              <h1 className="text-2xl font-black leading-tight tracking-tight text-slate-950 sm:text-3xl">
                Hola, {displayName}. Tu operación está lista para decidir.
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">
                {canSeeProjectSummary
                  ? `Estas viendo el pulso de ${visibleProjects.length} proyecto${visibleProjects.length === 1 ? '' : 's'} asignado${visibleProjects.length === 1 ? '' : 's'}, con foco en avance, vencimientos y carga del equipo.`
                  : `Estas viendo tus tareas asignadas dentro de ${visibleProjects.length} proyecto${visibleProjects.length === 1 ? '' : 's'}, ordenadas por prioridad operativa.`}
              </p>
            </div>
            <div className="grid min-w-full grid-cols-2 gap-2 sm:min-w-[440px] sm:gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Rol</p>
                <p className="mt-2 truncate text-sm font-black text-slate-900">{ROLE_LABELS[userRole || 'user'] || userRole || 'Usuario'}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Alcance</p>
                <p className="mt-2 truncate text-sm font-black text-slate-900">{scopeLabel}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <button
            type="button"
            onClick={() => setSelectedScopeId('all')}
            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-4 text-sm font-black transition-colors ${
              effectiveScopeId === 'all'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            General
            <span className={`rounded-full px-2 py-0.5 text-xs ${effectiveScopeId === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {overallUserStats.pending + overallUserStats.active + overallUserStats.blocked}
            </span>
          </button>
          {projectDashboards.map((item) => {
            const openUserTasks = item.userStats.pending + item.userStats.active + item.userStats.blocked;
            return (
              <button
                key={item.project.id}
                type="button"
                onClick={() => setSelectedScopeId(item.project.id)}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-4 text-sm font-black transition-colors ${
                  effectiveScopeId === item.project.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {item.project.name || 'Proyecto'}
                <span className={`rounded-full px-2 py-0.5 text-xs ${effectiveScopeId === item.project.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {openUserTasks}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-lg border border-slate-200 bg-white shadow-sm" />
            ))}
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
            <FolderKanban className="mx-auto mb-3 text-slate-300" size={40} />
            <h2 className="text-lg font-black text-slate-900">Aun no tienes proyectos asignados</h2>
            <p className="mt-1 text-sm text-slate-500">Cuando te vinculen a un proyecto, este tablero empezara a mostrar tu operacion.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-4">
              <MetricCard
                title="Proyectos"
                value={compactNumber(scopeProjects.length)}
                subtitle={`${compactNumber(overallStats.total)} tareas trazadas en tu universo`}
                icon={<FolderKanban size={20} />}
                tone="indigo"
              />
              <MetricCard
                title="Mis pendientes"
                value={compactNumber(scopeUserStats.pending + scopeUserStats.active + scopeUserStats.blocked)}
                subtitle={`${compactNumber(scopeUserStats.dueSoon)} por vencer y ${compactNumber(scopeUserStats.overdue)} atrasadas`}
                icon={<Inbox size={20} />}
                tone={scopeUserStats.overdue > 0 ? 'red' : scopeUserStats.dueSoon > 0 ? 'amber' : 'emerald'}
              />
              <MetricCard
                title={canSeeProjectSummary ? 'Riesgo proyecto' : 'Riesgo personal'}
                value={compactNumber(scopeStats.overdue + scopeStats.dueSoon + scopeStats.blocked)}
                subtitle={`${compactNumber(scopeStats.highPriority)} de prioridad alta abiertas`}
                icon={<AlertTriangle size={20} />}
                tone={scopeStats.overdue > 0 || scopeStats.blocked > 0 ? 'red' : scopeStats.dueSoon > 0 ? 'amber' : 'emerald'}
              />
              <MetricCard
                title="Avance"
                value={`${scopeStats.averageProgress}%`}
                subtitle={`${scopeStats.completionRate}% de tareas finalizadas`}
                icon={<Target size={20} />}
                tone="cyan"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                      <BarChart3 size={19} className="text-indigo-600" />
                      Estado actual
                    </h2>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      {canSeeProjectSummary ? 'Resumen ejecutivo de tareas del alcance seleccionado.' : 'Resumen de tus tareas asignadas.'}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-500">
                    <Activity size={14} />
                    {compactNumber(scopeStats.total)} tareas
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-5">
                  <div className="h-52 rounded-lg border border-slate-100 bg-slate-50/70 p-3 sm:h-64">
                    {statusChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={statusChartData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3}>
                            {statusChartData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: any) => [value, 'Tareas']} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">Sin tareas</div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] sm:gap-3">
                      {[
                        ['Pendientes', scopeStats.pending, 'bg-slate-100 text-slate-700'],
                        ['En curso', scopeStats.active, 'bg-amber-50 text-amber-700'],
                        ['Bloqueadas', scopeStats.blocked, 'bg-red-50 text-red-700'],
                        ['Finalizadas', scopeStats.completed, 'bg-emerald-50 text-emerald-700'],
                        ['Con retraso', scopeStats.completedLate, 'bg-orange-50 text-orange-700'],
                      ].map(([label, value, className]) => (
                        <div key={String(label)} className={`min-h-[86px] rounded-lg p-3 sm:min-h-[96px] ${className}`}>
                          <p className="min-h-7 break-words text-[10px] font-black uppercase leading-4 tracking-[0.06em] opacity-75 [overflow-wrap:anywhere] sm:min-h-8 sm:text-[11px]">
                            {label}
                          </p>
                          <p className="mt-2 text-xl font-black sm:text-2xl">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-lg border border-slate-100 p-4">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-black text-slate-900">Rendimiento por proyecto</p>
                          <p className="text-xs font-medium text-slate-500">Avance promedio y carga pendiente</p>
                        </div>
                        <Layers3 size={18} className="text-slate-300" />
                      </div>
                      <div className="h-48 sm:h-56">
                        {projectBarData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={projectBarData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                              <XAxis
                                dataKey="name"
                                tick={{ fontSize: 10 }}
                                tickFormatter={(value: string) => value.length > 13 ? `${value.slice(0, 12)}...` : value}
                                tickLine={false}
                                axisLine={false}
                                interval={0}
                                height={44}
                              />
                              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                              <Tooltip />
                              <Bar dataKey="progreso" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                              <Bar dataKey="pendientes" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">Sin proyectos para graficar</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-4">
                  <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                    <Sparkles size={19} className="text-amber-500" />
                    Inteligencia operativa
                  </h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">Senales que merecen atencion ahora.</p>
                </div>
                <div className="space-y-3 p-4">
                  {alerts.length === 0 ? (
                    <div className="rounded-lg bg-emerald-50 p-4 text-emerald-700 ring-1 ring-emerald-100">
                      <div className="flex items-center gap-2 font-black">
                        <CheckCircle2 size={18} />
                        Operacion bajo control
                      </div>
                      <p className="mt-2 text-sm font-medium text-emerald-700/80">No hay vencimientos criticos ni bloqueos en este alcance.</p>
                    </div>
                  ) : (
                    alerts.map((alert) => (
                      <div key={alert.id} className={`rounded-lg p-4 ring-1 ${alert.className}`}>
                        <div className="flex items-center gap-2 font-black">
                          {alert.icon}
                          {alert.title}
                        </div>
                        <p className="mt-2 text-sm font-medium opacity-80">{alert.description}</p>
                      </div>
                    ))
                  )}

                  <div className="rounded-lg border border-slate-100 p-4">
                    <p className="mb-3 text-sm font-black text-slate-900">Pulso del alcance</p>
                    <div className="space-y-3">
                      <ProgressLine label="Avance promedio" value={scopeStats.averageProgress} color="bg-indigo-600" />
                      <ProgressLine label="Finalizacion" value={scopeStats.completionRate} color="bg-emerald-500" />
                      <ProgressLine label="Carga personal" value={scopeStats.total ? Math.round((scopeUserStats.total / scopeStats.total) * 100) : 0} color="bg-cyan-500" />
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 p-4">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                      <Inbox size={19} className="text-indigo-600" />
                      Tus tareas asignadas
                    </h2>
                    <p className="mt-1 text-sm font-medium text-slate-500">Ordenadas por urgencia y fecha de cierre.</p>
                  </div>
                  <Link href="/workflows" className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 transition-colors hover:bg-indigo-100">
                    Bandeja
                    <ArrowRight size={14} />
                  </Link>
                </div>
                <div className="divide-y divide-slate-100">
                  {focusTasks.length === 0 ? (
                    <div className="p-6 text-center text-sm font-medium text-slate-500">
                      No tienes tareas abiertas en este alcance.
                    </div>
                  ) : (
                    focusTasks.map((task) => (
                      <div key={`${task.projectId}-${task.id}`} className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50/70 lg:flex-row lg:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${getStatusClass(task.status)}`}>
                              {getStatusLabel(task.status)}
                            </span>
                            <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${getPriorityClass(task.priority)}`}>
                              {task.priority === 'high' ? 'Alta' : task.priority === 'low' ? 'Baja' : 'Media'}
                            </span>
                            <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${getDueClass(task)}`}>
                              {getDueLabel(task)}
                            </span>
                          </div>
                          <p className="truncate text-sm font-black text-slate-900">{getTaskTitle(task)}</p>
                          <p className="mt-1 truncate text-xs font-bold text-slate-500">{task.projectName}</p>
                        </div>
                        <div className="flex items-center gap-3 lg:w-56">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.min(Number(task.progress || 0), 100)}%` }} />
                          </div>
                          <span className="w-10 text-right text-xs font-black text-slate-500">{Number(task.progress || 0)}%</span>
                        </div>
                        <Link href={`/projects/${task.projectId}`} className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-3 text-xs font-black text-slate-700 transition-colors hover:bg-slate-100">
                          Abrir
                        </Link>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-4">
                  <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                    <FolderKanban size={19} className="text-emerald-600" />
                    Proyectos asignados
                  </h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">Salud, avance y carga abierta por frente.</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {scopeProjects.map((item) => {
                    const health = getProjectHealth(item.stats);
                    return (
                      <Link
                        key={item.project.id}
                        href={`/projects/${item.project.id}`}
                        className="block p-4 transition-colors hover:bg-slate-50/70"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-1 h-12 w-1.5 rounded-full ${health.rail}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black text-slate-900">{item.project.name || 'Proyecto'}</p>
                                <p className="mt-1 truncate text-xs font-medium text-slate-500">{item.project.description || 'Sin descripcion'}</p>
                              </div>
                              <span className={`shrink-0 rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${health.className}`}>
                                {health.label}
                              </span>
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                              <div className="rounded-md bg-slate-50 p-2">
                                <p className="font-black text-slate-900">{item.stats.averageProgress}%</p>
                                <p className="font-bold text-slate-400">avance</p>
                              </div>
                              <div className="rounded-md bg-slate-50 p-2">
                                <p className="font-black text-slate-900">{item.userStats.pending + item.userStats.active + item.userStats.blocked}</p>
                                <p className="font-bold text-slate-400">mias</p>
                              </div>
                              <div className="rounded-md bg-slate-50 p-2">
                                <p className="font-black text-slate-900">{item.stats.overdue + item.stats.dueSoon}</p>
                                <p className="font-bold text-slate-400">riesgo</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            </div>

            {canSeeProjectSummary && (
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 p-4">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                      <Users size={19} className="text-cyan-600" />
                      Resumen ejecutivo por proyecto
                    </h2>
                    <p className="mt-1 text-sm font-medium text-slate-500">Lectura rapida para coordinacion y gerencia.</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Proyecto</th>
                        <th className="px-4 py-3">Salud</th>
                        <th className="px-4 py-3">Tareas</th>
                        <th className="px-4 py-3">En curso</th>
                        <th className="px-4 py-3">Atrasadas</th>
                        <th className="px-4 py-3">Finalizadas</th>
                        <th className="px-4 py-3">Avance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {scopeProjects.map((item) => {
                        const health = getProjectHealth(item.stats);
                        return (
                          <tr key={item.project.id} className="hover:bg-slate-50/70">
                            <td className="px-4 py-3">
                              <Link href={`/projects/${item.project.id}`} className="font-black text-slate-900 hover:text-indigo-700">
                                {item.project.name || 'Proyecto'}
                              </Link>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${health.className}`}>
                                {health.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-600">{item.stats.total}</td>
                            <td className="px-4 py-3 font-bold text-amber-700">{item.stats.active}</td>
                            <td className="px-4 py-3 font-bold text-red-700">{item.stats.overdue}</td>
                            <td className="px-4 py-3 font-bold text-emerald-700">{item.stats.completed + item.stats.completedLate}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                                  <div className="h-full rounded-full bg-indigo-600" style={{ width: `${item.stats.averageProgress}%` }} />
                                </div>
                                <span className="text-xs font-black text-slate-500">{item.stats.averageProgress}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
