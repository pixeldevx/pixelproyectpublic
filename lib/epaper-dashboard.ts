import { createHash, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { getWorkspaceClientForSystem } from '@/lib/workspaces/server';

const DOCUMENTS_TABLE = 'app_documents';
const PAGE_SIZE = 1000;
const MAX_TASK_ROWS = 8000;
const MAX_PROJECT_ROWS = 1500;
const SNAPSHOT_CACHE_COLLECTION = 'system/epaper_dashboard_cache';
const SNAPSHOT_CACHE_DOCUMENT = 'admin-e1001';
const SNAPSHOT_CACHE_SCHEMA_VERSION = 1;
const DEFAULT_SOURCE_CHECK_SECONDS = 60;
export const EPAPER_WIDTH = 800;
export const EPAPER_HEIGHT = 480;

type AppDocumentRow = {
  collection_path: string;
  doc_id: string;
  data: Record<string, any>;
  updated_at: string | null;
};

type EpaperProject = {
  id: string;
  name: string;
  description: string;
  status: string;
  updatedAt: number;
};

type EpaperTask = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  dueAt: number | null;
  updatedAt: number;
  currentStepLabel: string;
  currentStepStatus: string;
  isParentTask: boolean;
};

export type EpaperFocusProject = {
  id: string;
  name: string;
  open: number;
  overdue: number;
  dueSoon: number;
  blocked: number;
  highPriority: number;
  completionRate: number;
  averageProgress: number;
  score: number;
};

export type EpaperFocusTask = {
  id: string;
  title: string;
  projectName: string;
  statusLabel: string;
  dueLabel: string;
  urgency: 'overdue' | 'due_soon' | 'blocked' | 'normal';
};

export type EpaperDashboardSnapshot = {
  version: string;
  generatedAt: string;
  generatedAtLabel: string;
  refreshAfterSeconds: number;
  metrics: {
    projects: number;
    activeProjects: number;
    openTasks: number;
    overdueTasks: number;
    dueSoonTasks: number;
    blockedTasks: number;
    highPriorityTasks: number;
    completionRate: number;
  };
  assistantMessage: string;
  focusProjects: EpaperFocusProject[];
  focusTasks: EpaperFocusTask[];
  dataQuality: {
    tasksLoaded: number;
    tasksConsidered: number;
    matrixTasksExcluded: number;
    tasksOutsideActiveProjects: number;
    tasksTruncated: boolean;
    sourceFingerprint: string;
  };
  delivery: {
    state: 'live' | 'cached' | 'stale' | 'fallback';
    ageSeconds: number;
    warning: string | null;
  };
};

type CachedSnapshotDocument = {
  schemaVersion: number;
  snapshot: EpaperDashboardSnapshot;
};

let memorySnapshot: EpaperDashboardSnapshot | null = null;
let lastSourceCheckAt = 0;
let refreshPromise: Promise<EpaperDashboardSnapshot> | null = null;

type AuthResult =
  | { ok: true; tokenSource: 'header' | 'query'; token: string }
  | { ok: false; status: number; message: string };

const COMPLETED_STATUSES = new Set([
  'completed',
  'completed_late',
  'done',
  'finalizada',
  'finalizado',
  'listo',
  'cerrada',
  'cerrado',
]);

const ACTIVE_STATUSES = new Set(['in_progress', 'en_curso', 'trabajando', 'reproceso']);
const BLOCKED_STATUSES = new Set(['blocked', 'stuck', 'detenido', 'bloqueado', 'bloqueada']);
const ACTIVE_WORKFLOW_STEP_STATUSES = new Set([
  'en_curso',
  'in_progress',
  'trabajando',
  'reproceso',
  'detenido',
  'blocked',
  'bloqueado',
  'bloqueada',
  'devuelto',
  'returned',
  'pending',
]);
const INACTIVE_PROJECT_STATUSES = new Set(['archived', 'closed', 'completed', 'cerrado', 'inactivo', 'inactive']);

const normalizeText = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const normalizeStatus = (value: unknown) =>
  typeof value === 'string'
    ? value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    : '';

const getConfiguredTokens = () => {
  const raw = [process.env.EPAPER_ADMIN_TOKEN, process.env.EPAPER_DEVICE_TOKENS]
    .filter(Boolean)
    .join(',');

  return raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
};

const safeTokenEquals = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const authorizeEpaperRequest = (request: NextRequest): AuthResult => {
  const configuredTokens = getConfiguredTokens();
  if (configuredTokens.length === 0) {
    return {
      ok: false,
      status: 503,
      message: 'Falta configurar EPAPER_ADMIN_TOKEN o EPAPER_DEVICE_TOKENS en Vercel.',
    };
  }

  const authorization = request.headers.get('authorization') || '';
  const [scheme, bearerToken] = authorization.split(' ');
  const queryToken = request.nextUrl.searchParams.get('token') || '';
  const token = scheme?.toLowerCase() === 'bearer' && bearerToken ? bearerToken : queryToken;
  const tokenSource = scheme?.toLowerCase() === 'bearer' && bearerToken ? 'header' : 'query';

  if (!token) {
    return { ok: false, status: 401, message: 'Token del dashboard ePaper no enviado.' };
  }

  const isValid = configuredTokens.some((configuredToken) => safeTokenEquals(token, configuredToken));
  if (!isValid) {
    return { ok: false, status: 401, message: 'Token del dashboard ePaper inválido.' };
  }

  return { ok: true, tokenSource, token };
};

const getServerSupabase = () => getWorkspaceClientForSystem(process.env.EPAPER_WORKSPACE_ID || '');

const parseDate = (value: any): number | null => {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    const seconds = value.seconds ?? value._seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }
  return null;
};

const formatTimeLabel = (date: Date) =>
  new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace('.', '');

const compactNumber = (value: number) => new Intl.NumberFormat('es-CO').format(Math.round(value));

const finiteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getSourceCheckIntervalMs = () => {
  const configured = finiteNumber(process.env.EPAPER_SOURCE_CHECK_SECONDS, DEFAULT_SOURCE_CHECK_SECONDS);
  return Math.max(15, Math.min(configured, 3600)) * 1000;
};

const snapshotAgeSeconds = (snapshot: EpaperDashboardSnapshot, now = Date.now()) => {
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt)) return 0;
  return Math.max(0, Math.floor((now - generatedAt) / 1000));
};

const withDeliveryState = (
  snapshot: EpaperDashboardSnapshot,
  state: EpaperDashboardSnapshot['delivery']['state'],
  warning: string | null = null,
): EpaperDashboardSnapshot => ({
  ...snapshot,
  assistantMessage:
    snapshot.delivery?.state === 'fallback'
      ? snapshot.assistantMessage
      : buildAssistantMessage(snapshot),
  delivery: {
    state,
    ageSeconds: snapshotAgeSeconds(snapshot),
    warning,
  },
});

const getProjectIdFromTaskPath = (collectionPath: string) => {
  const segments = collectionPath.split('/');
  const projectIndex = segments.indexOf('projects');
  return projectIndex >= 0 ? segments[projectIndex + 1] || '' : '';
};

const getTaskTitle = (data: Record<string, any>, fallback: string) =>
  normalizeText(data.title) ||
  normalizeText(data.name) ||
  normalizeText(data.originalTitle) ||
  normalizeText(data.taskTitle) ||
  fallback;

const getStepDueAt = (step: any) =>
  parseDate(step?.plannedEndDate) ||
  parseDate(step?.endDate) ||
  parseDate(step?.end) ||
  parseDate(step?.dueDate);

const getCurrentStep = (data: Record<string, any>) => {
  const steps = Array.isArray(data.workflowSteps) ? data.workflowSteps : [];
  if (steps.length === 0) return { step: null, index: -1 };

  const activeSteps = steps
    .map((step, index) => ({ step, index, dueAt: getStepDueAt(step) }))
    .filter(({ step }) => ACTIVE_WORKFLOW_STEP_STATUSES.has(normalizeStatus(step?.status)))
    .sort((left, right) => {
      if (left.dueAt && right.dueAt) return left.dueAt - right.dueAt;
      if (left.dueAt) return -1;
      if (right.dueAt) return 1;
      return left.index - right.index;
    });

  if (activeSteps.length > 0) {
    return { step: activeSteps[0].step, index: activeSteps[0].index };
  }

  const rawIndex = Number(data.currentStepIndex);
  const explicitIndex = Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : 0;
  const index = Math.max(0, Math.min(explicitIndex, steps.length - 1));
  return { step: steps[index] || null, index };
};

const getTaskDueAt = (data: Record<string, any>) => {
  const { step: currentStep } = getCurrentStep(data);
  return (
    getStepDueAt(currentStep) ||
    parseDate(data.endDate) ||
    parseDate(data.end) ||
    parseDate(data.dueDate)
  );
};

const isCompletedTask = (task: EpaperTask) => COMPLETED_STATUSES.has(normalizeStatus(task.status));
const isBlockedTask = (task: EpaperTask) =>
  BLOCKED_STATUSES.has(normalizeStatus(task.status)) ||
  BLOCKED_STATUSES.has(normalizeStatus(task.currentStepStatus));

const getScheduleState = (task: EpaperTask, now = Date.now()) => {
  if (isCompletedTask(task)) return 'completed';
  if (isBlockedTask(task)) return 'blocked';
  if (!task.dueAt) return 'normal';
  const diffDays = Math.ceil((task.dueAt - now) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 2) return 'due_soon';
  return 'normal';
};

const getDueLabel = (task: EpaperTask, now = Date.now()) => {
  if (!task.dueAt) return 'Sin fecha';
  const diffDays = Math.ceil((task.dueAt - now) / 86_400_000);
  if (diffDays < 0) return `Venció hace ${Math.abs(diffDays)} d`;
  if (diffDays === 0) return 'Vence hoy';
  if (diffDays === 1) return 'Vence mañana';
  if (diffDays <= 7) return `Vence en ${diffDays} d`;
  return formatTimeLabel(new Date(task.dueAt)).split(',')[0];
};

const statusLabel = (task: EpaperTask) => {
  if (isBlockedTask(task)) return 'Bloqueada';
  if (isCompletedTask(task)) return 'Finalizada';
  if (ACTIVE_STATUSES.has(normalizeStatus(task.status))) return 'En curso';
  return 'Pendiente';
};

async function fetchRowsByCollectionPath(collectionPath: string, maxRows: number) {
  const supabase = await getServerSupabase();
  const rows: AppDocumentRow[] = [];
  let from = 0;

  while (rows.length < maxRows) {
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data,updated_at')
      .eq('collection_path', collectionPath)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const page = (data || []) as AppDocumentRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows.slice(0, maxRows);
}

async function fetchRowsByCollectionGroup(collectionGroup: string, maxRows: number) {
  const supabase = await getServerSupabase();
  const rows: AppDocumentRow[] = [];
  let from = 0;

  while (rows.length < maxRows) {
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data,updated_at')
      .eq('collection_group', collectionGroup)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const page = (data || []) as AppDocumentRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows.slice(0, maxRows);
}

const getCollectionFingerprint = async (
  field: 'collection_path' | 'collection_group',
  value: string,
) => {
  const supabase = await getServerSupabase();
  const { data, error, count } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('updated_at', { count: 'exact' })
    .eq(field, value)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return `${value}:${count || 0}:${data?.[0]?.updated_at || 'empty'}`;
};

const getSourceFingerprint = async () => {
  const [projectsFingerprint, tasksFingerprint] = await Promise.all([
    getCollectionFingerprint('collection_path', 'projects'),
    getCollectionFingerprint('collection_group', 'tasks'),
  ]);
  return buildVersion({ projectsFingerprint, tasksFingerprint });
};

const isDashboardSnapshot = (value: unknown): value is EpaperDashboardSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EpaperDashboardSnapshot>;
  return Boolean(
    typeof candidate.version === 'string' &&
      typeof candidate.generatedAt === 'string' &&
      candidate.metrics &&
      typeof candidate.metrics === 'object' &&
      Array.isArray(candidate.focusProjects) &&
      Array.isArray(candidate.focusTasks) &&
      candidate.dataQuality &&
      typeof candidate.dataQuality === 'object',
  );
};

const normalizeCachedSnapshot = (snapshot: EpaperDashboardSnapshot): EpaperDashboardSnapshot => ({
  ...snapshot,
  refreshAfterSeconds: Math.max(60, finiteNumber(snapshot.refreshAfterSeconds, 600)),
  metrics: {
    projects: finiteNumber(snapshot.metrics?.projects),
    activeProjects: finiteNumber(snapshot.metrics?.activeProjects),
    openTasks: finiteNumber(snapshot.metrics?.openTasks),
    overdueTasks: finiteNumber(snapshot.metrics?.overdueTasks),
    dueSoonTasks: finiteNumber(snapshot.metrics?.dueSoonTasks),
    blockedTasks: finiteNumber(snapshot.metrics?.blockedTasks),
    highPriorityTasks: finiteNumber(snapshot.metrics?.highPriorityTasks),
    completionRate: finiteNumber(snapshot.metrics?.completionRate),
  },
  assistantMessage: normalizeText(snapshot.assistantMessage, 'Pixel está preparando una nueva recomendación.'),
  focusProjects: Array.isArray(snapshot.focusProjects) ? snapshot.focusProjects : [],
  focusTasks: Array.isArray(snapshot.focusTasks) ? snapshot.focusTasks : [],
  dataQuality: {
    tasksLoaded: finiteNumber(snapshot.dataQuality?.tasksLoaded),
    tasksConsidered: finiteNumber(snapshot.dataQuality?.tasksConsidered),
    matrixTasksExcluded: finiteNumber(snapshot.dataQuality?.matrixTasksExcluded),
    tasksOutsideActiveProjects: finiteNumber(snapshot.dataQuality?.tasksOutsideActiveProjects),
    tasksTruncated: snapshot.dataQuality?.tasksTruncated === true,
    sourceFingerprint: normalizeText(snapshot.dataQuality?.sourceFingerprint),
  },
  delivery: {
    state: 'cached',
    ageSeconds: snapshotAgeSeconds(snapshot),
    warning: null,
  },
});

const readPersistedSnapshot = async (): Promise<EpaperDashboardSnapshot | null> => {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('data')
    .eq('collection_path', SNAPSHOT_CACHE_COLLECTION)
    .eq('doc_id', SNAPSHOT_CACHE_DOCUMENT)
    .maybeSingle();

  if (error) throw error;
  const cached = data?.data as CachedSnapshotDocument | undefined;
  if (
    cached?.schemaVersion !== SNAPSHOT_CACHE_SCHEMA_VERSION ||
    !isDashboardSnapshot(cached?.snapshot)
  ) {
    return null;
  }

  return normalizeCachedSnapshot(cached.snapshot);
};

const persistSnapshot = async (snapshot: EpaperDashboardSnapshot) => {
  const supabase = await getServerSupabase();
  const cachedDocument: CachedSnapshotDocument = {
    schemaVersion: SNAPSHOT_CACHE_SCHEMA_VERSION,
    snapshot: withDeliveryState(snapshot, 'live'),
  };
  const { error } = await supabase.from(DOCUMENTS_TABLE).upsert(
    {
      collection_path: SNAPSHOT_CACHE_COLLECTION,
      doc_id: SNAPSHOT_CACHE_DOCUMENT,
      data: cachedDocument,
    },
    { onConflict: 'collection_path,doc_id' },
  );
  if (error) throw error;
};

const serializeProject = (row: AppDocumentRow): EpaperProject => ({
  id: row.doc_id,
  name: normalizeText(row.data?.name, 'Proyecto sin nombre'),
  description: normalizeText(row.data?.description),
  status: normalizeText(row.data?.status, 'active'),
  updatedAt: parseDate(row.updated_at) || parseDate(row.data?.updatedAt) || parseDate(row.data?.createdAt) || 0,
});

const serializeTask = (row: AppDocumentRow): EpaperTask | null => {
  const projectId = getProjectIdFromTaskPath(row.collection_path);
  if (!projectId) return null;
  const { step: currentStep } = getCurrentStep(row.data || {});
  const progress = Number(row.data?.progress || 0);
  const totalSubtasks = Number(row.data?.totalSubtasks || 0);

  return {
    id: row.doc_id,
    projectId,
    title: getTaskTitle(row.data || {}, row.doc_id),
    status: normalizeText(row.data?.status, 'todo'),
    priority: normalizeText(row.data?.priority, 'medium'),
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(progress, 100)) : 0,
    dueAt: getTaskDueAt(row.data || {}),
    updatedAt: parseDate(row.updated_at) || parseDate(row.data?.updatedAt) || parseDate(row.data?.createdAt) || 0,
    currentStepLabel:
      normalizeText(currentStep?.name) ||
      normalizeText(currentStep?.label) ||
      normalizeText(currentStep?.title) ||
      '',
    currentStepStatus: normalizeText(currentStep?.status),
    isParentTask:
      row.data?.isParentTask === true ||
      normalizeStatus(row.data?.isParentTask) === 'true' ||
      (Number.isFinite(totalSubtasks) && totalSubtasks > 0),
  };
};

const buildFocusProjects = (projects: EpaperProject[], tasks: EpaperTask[]) => {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const tasksByProject = new Map<string, EpaperTask[]>();
  tasks.forEach((task) => {
    const current = tasksByProject.get(task.projectId) || [];
    current.push(task);
    tasksByProject.set(task.projectId, current);
  });

  return Array.from(tasksByProject.entries())
    .map(([projectId, projectTasks]) => {
      const project = projectById.get(projectId);
      const openTasks = projectTasks.filter((task) => !isCompletedTask(task));
      const completed = projectTasks.length - openTasks.length;
      const overdue = openTasks.filter((task) => getScheduleState(task) === 'overdue').length;
      const dueSoon = openTasks.filter((task) => getScheduleState(task) === 'due_soon').length;
      const blocked = openTasks.filter((task) => getScheduleState(task) === 'blocked').length;
      const highPriority = openTasks.filter((task) => normalizeStatus(task.priority) === 'high').length;
      const averageProgress = projectTasks.length
        ? Math.round(projectTasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / projectTasks.length)
        : 0;
      const completionRate = projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0;
      const score = overdue * 9 + blocked * 7 + dueSoon * 4 + highPriority * 2 + openTasks.length * 0.15;

      return {
        id: projectId,
        name: project?.name || 'Proyecto sin nombre',
        open: openTasks.length,
        overdue,
        dueSoon,
        blocked,
        highPriority,
        completionRate,
        averageProgress,
        score,
      };
    })
    .filter((project) => project.open > 0 || project.score > 0)
    .sort((left, right) => right.score - left.score || right.open - left.open)
    .slice(0, 5);
};

const buildFocusTasks = (projects: EpaperProject[], tasks: EpaperTask[]) => {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const urgencyWeight: Record<string, number> = { overdue: 0, blocked: 1, due_soon: 2, normal: 3, completed: 4 };

  return tasks
    .filter((task) => !isCompletedTask(task))
    .map((task) => {
      const scheduleState = getScheduleState(task);
      const urgency: EpaperFocusTask['urgency'] =
        scheduleState === 'overdue' || scheduleState === 'due_soon' || scheduleState === 'blocked'
          ? scheduleState
          : 'normal';
      return {
        id: task.id,
        title: task.currentStepLabel ? `${task.title} · ${task.currentStepLabel}` : task.title,
        projectName: projectById.get(task.projectId)?.name || 'Proyecto',
        statusLabel: statusLabel(task),
        dueLabel: getDueLabel(task),
        urgency,
        dueAt: task.dueAt || Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => {
      const urgencyDiff = (urgencyWeight[left.urgency] ?? 3) - (urgencyWeight[right.urgency] ?? 3);
      if (urgencyDiff !== 0) return urgencyDiff;
      return left.dueAt - right.dueAt;
    })
    .slice(0, 4)
    .map(({ dueAt: _dueAt, ...task }) => task);
};

const pickAssistantVariant = (variants: string[], context: string, now = Date.now()) => {
  if (variants.length === 1) return variants[0];
  // La recomendación permanece estable durante seis horas para que la pantalla no parpadee,
  // pero cambia cuando cambia la operación o inicia una nueva franja del día.
  const rotationBucket = Math.floor(now / (6 * 60 * 60 * 1000));
  const contextOffset = createHash('sha256').update(context).digest()[0];
  return variants[(rotationBucket + contextOffset) % variants.length];
};

export const buildAssistantMessage = (
  snapshot: Pick<EpaperDashboardSnapshot, 'metrics' | 'focusProjects'>,
  now = Date.now(),
) => {
  const focus = snapshot.focusProjects[0];
  const secondary = snapshot.focusProjects[1];
  const metrics = snapshot.metrics;
  const context = [
    metrics.openTasks,
    metrics.overdueTasks,
    metrics.dueSoonTasks,
    metrics.blockedTasks,
    metrics.highPriorityTasks,
    focus?.id || 'sin-foco',
    focus?.open || 0,
    focus?.overdue || 0,
  ].join(':');

  if (metrics.blockedTasks > 0 && focus?.blocked) {
    return pickAssistantVariant(
      [
        `${focus.name} concentra ${focus.blocked} bloqueo${focus.blocked === 1 ? '' : 's'}. Confirma responsable e insumo pendiente antes de abrir más frentes.`,
        `Hay ${metrics.blockedTasks} tarea${metrics.blockedTasks === 1 ? '' : 's'} bloqueada${metrics.blockedTasks === 1 ? '' : 's'}. Empieza por ${focus.name} y libera la ruta que afecta más entregables.`,
        `Señal operativa: ${focus.name} necesita una decisión. Resuelve sus ${focus.blocked} bloqueo${focus.blocked === 1 ? '' : 's'} y luego atiende los vencimientos.`,
      ],
      `blocked:${context}`,
      now,
    );
  }

  if (metrics.overdueTasks > 0) {
    const projectName = focus?.name || 'los proyectos activos';
    const projectOverdue = focus?.overdue || metrics.overdueTasks;
    return pickAssistantVariant(
      [
        `Atención en ${projectName}: ${projectOverdue} vencida${projectOverdue === 1 ? '' : 's'}. Empieza por la más antigua y confirma quién la cerrará hoy.`,
        `El mayor riesgo está en ${projectName}. Destraba primero las ${projectOverdue} vencida${projectOverdue === 1 ? '' : 's'} que bloquean otros entregables.`,
        `${projectName} pide foco: tiene ${projectOverdue} vencida${projectOverdue === 1 ? '' : 's'} y ${focus?.open || metrics.openTasks} abierta${(focus?.open || metrics.openTasks) === 1 ? '' : 's'}. Cierra una ruta crítica antes de abrir otra.`,
        secondary?.overdue
          ? `Dos frentes requieren atención: ${projectName} y ${secondary.name}. Prioriza por antigüedad y asigna dueño a cada vencimiento.`
          : `Hoy gana quien reduce atraso: concentra el equipo en ${projectName} y verifica avance al final de la jornada.`,
      ],
      `overdue:${context}`,
      now,
    );
  }

  if (metrics.dueSoonTasks > 0) {
    return pickAssistantVariant(
      [
        `${metrics.dueSoonTasks} tarea${metrics.dueSoonTasks === 1 ? '' : 's'} vence${metrics.dueSoonTasks === 1 ? '' : 'n'} pronto. Revisa ${focus?.name || 'el proyecto con mayor carga'} antes de que se convierta en atraso.`,
        `Ventana preventiva: confirma hoy responsables y entregables de las ${metrics.dueSoonTasks} tareas próximas a vencer.`,
        `${focus?.name || 'La operación'} está a tiempo, pero tiene compromisos cercanos. Un control hoy evita reprocesos mañana.`,
      ],
      `due-soon:${context}`,
      now,
    );
  }

  if (metrics.highPriorityTasks > 0) {
    return pickAssistantVariant(
      [
        `No hay vencimientos críticos. Revisa las ${metrics.highPriorityTasks} tareas de prioridad alta y protege el avance de ${focus?.name || 'la operación'}.`,
        `La agenda está controlada. Usa esta ventana para cerrar prioridades altas antes de que entren en zona de riesgo.`,
      ],
      `high:${context}`,
      now,
    );
  }

  if (metrics.openTasks === 0) {
    return pickAssistantVariant(
      [
        'Panorama limpio: no hay tareas abiertas en los proyectos visibles. Es un buen momento para planear el siguiente ciclo.',
        'Operación al día. Revisa próximos hitos y deja preparados responsables, insumos y fechas del siguiente frente.',
      ],
      `empty:${context}`,
      now,
    );
  }

  return pickAssistantVariant(
    [
      `Panorama estable: ${metrics.openTasks} tareas abiertas y sin vencimientos críticos. Mantén el ritmo y cierra pendientes pequeños.`,
      `${focus?.name || 'La operación'} concentra la mayor carga, pero está a tiempo. Revisa capacidad y protege sus próximos hitos.`,
      `Sin alertas críticas. Aprovecha para validar calidad, responsables y fechas antes del siguiente corte operativo.`,
    ],
    `stable:${context}`,
    now,
  );
};

const buildVersion = (payload: Record<string, any>) =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);

const buildLiveDashboardSnapshot = async (sourceFingerprint: string): Promise<EpaperDashboardSnapshot> => {
  const [projectRows, taskRows] = await Promise.all([
    fetchRowsByCollectionPath('projects', MAX_PROJECT_ROWS),
    fetchRowsByCollectionGroup('tasks', MAX_TASK_ROWS),
  ]);

  const projects = projectRows.map(serializeProject);
  const tasks = taskRows.map(serializeTask).filter(Boolean) as EpaperTask[];
  const activeProjects = projects.filter((project) => !INACTIVE_PROJECT_STATUSES.has(normalizeStatus(project.status)));
  const activeProjectIds = new Set(activeProjects.map((project) => project.id));
  const tasksInActiveProjects = tasks.filter((task) => activeProjectIds.has(task.projectId));
  const matrixTasksExcluded = tasksInActiveProjects.filter((task) => task.isParentTask).length;
  const operationalTasks = tasksInActiveProjects.filter((task) => !task.isParentTask);
  const openTasks = operationalTasks.filter((task) => !isCompletedTask(task));
  const completedTasks = operationalTasks.length - openTasks.length;
  const overdueTasks = openTasks.filter((task) => getScheduleState(task) === 'overdue').length;
  const dueSoonTasks = openTasks.filter((task) => getScheduleState(task) === 'due_soon').length;
  const blockedTasks = openTasks.filter((task) => getScheduleState(task) === 'blocked').length;
  const highPriorityTasks = openTasks.filter((task) => normalizeStatus(task.priority) === 'high').length;
  const focusProjects = buildFocusProjects(activeProjects, operationalTasks);
  const focusTasks = buildFocusTasks(activeProjects, operationalTasks);
  const lastUpdated = Math.max(
    0,
    ...projects.map((project) => project.updatedAt),
    ...tasks.map((task) => task.updatedAt),
  );

  const baseSnapshot = {
    metrics: {
      projects: projects.length,
      activeProjects: activeProjects.length,
      openTasks: openTasks.length,
      overdueTasks,
      dueSoonTasks,
      blockedTasks,
      highPriorityTasks,
      completionRate: operationalTasks.length ? Math.round((completedTasks / operationalTasks.length) * 100) : 0,
    },
    focusProjects,
  };

  const generatedAt = new Date();
  const snapshot: EpaperDashboardSnapshot = {
    version: buildVersion({
      lastUpdated,
      metrics: baseSnapshot.metrics,
      focusProjects: focusProjects.map((project) => [project.id, project.score, project.open]),
      focusTasks: focusTasks.map((task) => [task.id, task.urgency, task.dueLabel]),
    }),
    generatedAt: generatedAt.toISOString(),
    generatedAtLabel: formatTimeLabel(generatedAt),
    refreshAfterSeconds: Number(process.env.EPAPER_REFRESH_SECONDS || 600),
    metrics: baseSnapshot.metrics,
    assistantMessage: buildAssistantMessage(baseSnapshot),
    focusProjects,
    focusTasks,
    dataQuality: {
      tasksLoaded: tasks.length,
      tasksConsidered: operationalTasks.length,
      matrixTasksExcluded,
      tasksOutsideActiveProjects: tasks.length - tasksInActiveProjects.length,
      tasksTruncated: taskRows.length >= MAX_TASK_ROWS,
      sourceFingerprint,
    },
    delivery: {
      state: 'live',
      ageSeconds: 0,
      warning: null,
    },
  };

  return snapshot;
};

export const createEpaperFallbackSnapshot = (warning: string): EpaperDashboardSnapshot => {
  const generatedAt = new Date();
  const metrics: EpaperDashboardSnapshot['metrics'] = {
    projects: 0,
    activeProjects: 0,
    openTasks: 0,
    overdueTasks: 0,
    dueSoonTasks: 0,
    blockedTasks: 0,
    highPriorityTasks: 0,
    completionRate: 0,
  };
  const assistantMessage =
    'Pixel conserva la pantalla activa, pero la fuente de datos está tardando. La actualización se intentará de nuevo automáticamente.';

  return {
    version: buildVersion({ fallback: true, bucket: Math.floor(generatedAt.getTime() / 3_600_000) }),
    generatedAt: generatedAt.toISOString(),
    generatedAtLabel: formatTimeLabel(generatedAt),
    refreshAfterSeconds: Math.max(60, finiteNumber(process.env.EPAPER_REFRESH_SECONDS, 600)),
    metrics,
    assistantMessage,
    focusProjects: [],
    focusTasks: [],
    dataQuality: {
      tasksLoaded: 0,
      tasksConsidered: 0,
      matrixTasksExcluded: 0,
      tasksOutsideActiveProjects: 0,
      tasksTruncated: false,
      sourceFingerprint: '',
    },
    delivery: {
      state: 'fallback',
      ageSeconds: 0,
      warning,
    },
  };
};

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'La fuente de datos no respondió.';

const refreshDashboardSnapshot = async (): Promise<EpaperDashboardSnapshot> => {
  let cachedSnapshot = memorySnapshot;

  if (!cachedSnapshot) {
    try {
      cachedSnapshot = await readPersistedSnapshot();
    } catch (error) {
      console.error('[epaper] No se pudo leer la última fotografía válida:', errorMessage(error));
    }
  }

  let sourceFingerprint = '';
  try {
    sourceFingerprint = await getSourceFingerprint();
    lastSourceCheckAt = Date.now();
  } catch (error) {
    const warning = `No se pudo comprobar si hubo cambios: ${errorMessage(error)}`;
    console.error('[epaper]', warning);
    lastSourceCheckAt = Date.now();
    if (cachedSnapshot) {
      memorySnapshot = withDeliveryState(cachedSnapshot, 'stale', warning);
      return memorySnapshot;
    }
    const fallbackSnapshot = createEpaperFallbackSnapshot(warning);
    memorySnapshot = fallbackSnapshot;
    return fallbackSnapshot;
  }

  if (
    cachedSnapshot &&
    cachedSnapshot.dataQuality.sourceFingerprint &&
    cachedSnapshot.dataQuality.sourceFingerprint === sourceFingerprint
  ) {
    memorySnapshot = cachedSnapshot;
    return withDeliveryState(cachedSnapshot, 'cached');
  }

  try {
    const liveSnapshot = await buildLiveDashboardSnapshot(sourceFingerprint);
    memorySnapshot = liveSnapshot;
    try {
      await persistSnapshot(liveSnapshot);
    } catch (error) {
      console.error('[epaper] El tablero se generó, pero no se pudo guardar su respaldo:', errorMessage(error));
    }
    return withDeliveryState(liveSnapshot, 'live');
  } catch (error) {
    const warning = `No se pudo recalcular el tablero: ${errorMessage(error)}`;
    console.error('[epaper]', warning);
    if (cachedSnapshot) {
      memorySnapshot = withDeliveryState(cachedSnapshot, 'stale', warning);
      return memorySnapshot;
    }
    const fallbackSnapshot = createEpaperFallbackSnapshot(warning);
    memorySnapshot = fallbackSnapshot;
    return fallbackSnapshot;
  }
};

export async function getEpaperDashboardSnapshot(): Promise<EpaperDashboardSnapshot> {
  const now = Date.now();
  if (memorySnapshot && now - lastSourceCheckAt < getSourceCheckIntervalMs()) {
    return withDeliveryState(
      memorySnapshot,
      memorySnapshot.delivery.state === 'fallback' || memorySnapshot.delivery.state === 'stale'
        ? memorySnapshot.delivery.state
        : 'cached',
      memorySnapshot.delivery.warning,
    );
  }

  refreshPromise ||= refreshDashboardSnapshot().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export const getEpaperImageUrl = (request: NextRequest, auth: Extract<AuthResult, { ok: true }>) => {
  const url = new URL('/api/epaper/admin-dashboard.png', request.url);
  if (auth.tokenSource === 'query') {
    url.searchParams.set('token', auth.token);
  }
  return url.toString();
};

export const summarizeEpaperSnapshot = (snapshot: EpaperDashboardSnapshot) => ({
  version: snapshot.version,
  generated_at: snapshot.generatedAt,
  generated_at_label: snapshot.generatedAtLabel,
  refresh_after_seconds: snapshot.refreshAfterSeconds,
  width: EPAPER_WIDTH,
  height: EPAPER_HEIGHT,
  message: snapshot.assistantMessage,
  metrics: {
    proyectos_activos: snapshot.metrics.activeProjects,
    tareas_abiertas: snapshot.metrics.openTasks,
    vencidas: snapshot.metrics.overdueTasks,
    por_vencer: snapshot.metrics.dueSoonTasks,
    bloqueadas: snapshot.metrics.blockedTasks,
    alta_prioridad: snapshot.metrics.highPriorityTasks,
    avance_global: `${compactNumber(snapshot.metrics.completionRate)}%`,
  },
  foco: snapshot.focusProjects[0] || null,
  estado_datos: snapshot.delivery.state,
  antiguedad_datos_segundos: snapshot.delivery.ageSeconds,
  advertencia: snapshot.delivery.warning,
  calidad_datos: snapshot.dataQuality,
});
