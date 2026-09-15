"use client"

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Gauge,
  Medal,
  Search,
  ShieldCheck,
  Sparkles,
  Timer,
  XCircle,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { collection, collectionGroup, onSnapshot, query } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import { belongsToAnyOrganization, organizationNameFor } from '@/lib/organizations';

type QualityEvent = {
  id: string;
  projectId: string;
  taskId?: string;
  taskTitle?: string;
  stepLabel?: string;
  result?: string;
  professionalId?: string;
  reviewerId?: string;
  causeId?: string;
  causeLabel?: string;
  causeIds?: string[];
  causeLabels?: string[];
  qualityStatus?: string;
  approvedWithObservations?: boolean;
  comment?: string;
  workflowComment?: string;
  createdAt?: any;
  createdBy?: string;
  createdByEmail?: string;
};

type TaskRow = {
  id: string;
  projectId: string;
  title?: string;
  name?: string;
  status?: string;
  progress?: number;
  endDate?: any;
  end?: any;
  dueDate?: any;
};

const ACCESS_ROLES = new Set(['admin', 'org_admin', 'manager', 'coordinador']);

const compactNumber = (value: number) => new Intl.NumberFormat('es-CO').format(value || 0);

const getDate = (value: any): Date | null => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTime = (value: any) => getDate(value)?.getTime() || 0;

const formatDate = (value: any) => {
  const date = getDate(value);
  if (!date) return 'Sin fecha';
  return date.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getProjectIdFromSnapshot = (snapshotDoc: any, data: any) => {
  if (data?.projectId) return data.projectId;
  const path = snapshotDoc?.ref?.path || '';
  const segments = path.split('/');
  const projectIndex = segments.indexOf('projects');
  return projectIndex >= 0 ? segments[projectIndex + 1] || '' : '';
};

const getTaskTitle = (task?: TaskRow | null, event?: QualityEvent) =>
  event?.taskTitle || task?.title || task?.name || 'Tarea sin nombre';

const getTaskDeepLink = (event: QualityEvent) =>
  event.taskId
    ? `/projects/${event.projectId}?tab=tasks&taskId=${encodeURIComponent(event.taskId)}&focus=comments`
    : `/projects/${event.projectId}?tab=quality`;

const getEventCauseLabels = (event: QualityEvent) => {
  if (Array.isArray(event.causeLabels) && event.causeLabels.length > 0) {
    return event.causeLabels.filter(Boolean).map(String);
  }
  return event.causeLabel ? [event.causeLabel] : [];
};

const getEventStatusLabel = (event: QualityEvent) => {
  if (event.approvedWithObservations || event.qualityStatus === 'accepted_with_observations') {
    return 'Aprobada con observaciones';
  }
  if (event.result === 'accepted') return 'Tarea aceptada';
  if (event.result === 'rejected') return 'Devolución';
  return 'Revisada';
};

const matchesMember = (member: any, value?: string | null) => {
  if (!value) return false;
  const normalized = String(value).toLowerCase();
  return [member?.id, member?.authUserId, member?.uid, member?.email?.toLowerCase()]
    .filter(Boolean)
    .map(String)
    .includes(normalized);
};

const memberName = (members: any[], value?: string | null) => {
  if (!value) return 'Sin asignar';
  const member = members.find((item) => matchesMember(item, value));
  return member?.name || member?.email || value;
};

const getQualityGrade = (score: number | null) => {
  if (score == null) return { label: 'Sin datos', color: '#94a3b8', className: 'text-slate-600 bg-slate-100 ring-slate-200' };
  if (score >= 90) return { label: 'Excelente', color: '#10b981', className: 'text-emerald-700 bg-emerald-50 ring-emerald-100' };
  if (score >= 75) return { label: 'Estable', color: '#4f46e5', className: 'text-indigo-700 bg-indigo-50 ring-indigo-100' };
  if (score >= 60) return { label: 'En vigilancia', color: '#f59e0b', className: 'text-orange-700 bg-orange-50 ring-orange-100' };
  return { label: 'Crítico', color: '#ef4444', className: 'text-red-700 bg-red-50 ring-red-100' };
};

function ClockMetric({
  label,
  value,
  total,
  detail,
  color,
}: {
  label: string;
  value: number;
  total: number;
  detail: string;
  color: string;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{compactNumber(value)}</p>
          <p className="mt-1 text-sm font-bold text-slate-500">{detail}</p>
        </div>
        <div
          className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(${color} ${percent}%, #e2e8f0 0)` }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-sm font-black text-slate-800 shadow-inner">
            {percent}%
          </div>
        </div>
      </div>
    </div>
  );
}

function QualityOverviewContent() {
  const searchParams = useSearchParams();
  const initialResultParam = searchParams.get('result');
  const initialResultFilter: 'all' | 'accepted' | 'rejected' =
    initialResultParam === 'accepted' || initialResultParam === 'rejected' ? initialResultParam : 'all';
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [qualityEvents, setQualityEvents] = useState<QualityEvent[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('projectId') || 'all');
  const [resultFilter, setResultFilter] = useState<'all' | 'accepted' | 'rejected'>(initialResultFilter);
  const [searchTerm, setSearchTerm] = useState('');
  const [memberFilter, setMemberFilter] = useState(searchParams.get('memberId') || '');
  const [reviewerFilter, setReviewerFilter] = useState(searchParams.get('reviewerId') || '');
  const [loading, setLoading] = useState(true);

  const managedOrganizationIds = useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );

  const canAccessQuality = ACCESS_ROLES.has(userRole || '');
  const canSeeAllOrganizations = userRole === 'admin' && managedOrganizationIds.length === 0;

  useEffect(() => {
    if (!user || !canAccessQuality) return;

    const unsubscribeOrganizations = onSnapshot(
      query(collection(db, 'organizations')),
      (snapshot) => {
        setOrganizations(snapshot.docs.map((orgDoc) => ({ id: orgDoc.id, ...orgDoc.data() })));
      },
      (error) => console.error('Error loading quality organizations:', error)
    );

    const unsubscribeProjects = onSnapshot(
      query(collection(db, 'projects')),
      (snapshot) => {
        const data = snapshot.docs.map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }));
        data.sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
        setProjects(data);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading quality projects:', error);
        setLoading(false);
      }
    );

    const unsubscribeTeam = onSnapshot(
      query(collection(db, 'team_members')),
      (snapshot) => {
        setTeamMembers(snapshot.docs.map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() })));
      },
      (error) => console.error('Error loading quality team members:', error)
    );

    const unsubscribeQuality = onSnapshot(
      query(collectionGroup(db, 'qualityEvents')),
      (snapshot) => {
        const data = snapshot.docs.map((eventDoc) => {
          const eventData = eventDoc.data();
          return {
            id: eventDoc.id,
            projectId: getProjectIdFromSnapshot(eventDoc, eventData),
            ...eventData,
          } as QualityEvent;
        });
        setQualityEvents(data);
      },
      (error) => console.error('Error loading global quality events:', error)
    );

    const unsubscribeTasks = onSnapshot(
      query(collectionGroup(db, 'tasks')),
      (snapshot) => {
        const data = snapshot.docs.map((taskDoc) => {
          const taskData = taskDoc.data();
          return {
            id: taskDoc.id,
            projectId: getProjectIdFromSnapshot(taskDoc, taskData),
            ...taskData,
          } as TaskRow;
        });
        setTasks(data);
      },
      (error) => console.error('Error loading global quality tasks:', error)
    );

    return () => {
      unsubscribeOrganizations();
      unsubscribeProjects();
      unsubscribeTeam();
      unsubscribeQuality();
      unsubscribeTasks();
    };
  }, [canAccessQuality, user]);

  const scopedProjects = useMemo(() => {
    if (canSeeAllOrganizations) return projects;
    return projects.filter((project) => managedOrganizationIds.length > 0 && belongsToAnyOrganization(project, managedOrganizationIds));
  }, [canSeeAllOrganizations, managedOrganizationIds, projects]);

  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((project) => project.id)), [scopedProjects]);
  const projectById = useMemo(() => new Map(scopedProjects.map((project) => [project.id, project])), [scopedProjects]);
  const scopedTeamMembers = useMemo(() => {
    if (canSeeAllOrganizations) return teamMembers;
    return teamMembers.filter((member) => managedOrganizationIds.length > 0 && belongsToAnyOrganization(member, managedOrganizationIds));
  }, [canSeeAllOrganizations, managedOrganizationIds, teamMembers]);
  const taskByKey = useMemo(() => new Map(tasks.map((task) => [`${task.projectId}::${task.id}`, task])), [tasks]);

  const visibleEvents = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const matchesFilterMember = (value: string | undefined | null, filter: string) => {
      const member = scopedTeamMembers.find((item) => matchesMember(item, filter));
      return member ? matchesMember(member, value) : value === filter;
    };

    return qualityEvents
      .filter((event) => scopedProjectIds.has(event.projectId))
      .filter((event) => selectedProjectId === 'all' || event.projectId === selectedProjectId)
      .filter((event) => resultFilter === 'all' || event.result === resultFilter)
      .filter((event) => !memberFilter || matchesFilterMember(event.professionalId, memberFilter))
      .filter((event) => !reviewerFilter || matchesFilterMember(event.reviewerId, reviewerFilter) || matchesFilterMember(event.createdBy, reviewerFilter))
      .filter((event) => {
        if (!search) return true;
        const task = taskByKey.get(`${event.projectId}::${event.taskId}`);
        const project = projectById.get(event.projectId);
        return [
          getTaskTitle(task, event),
          project?.name,
          event.stepLabel,
          event.causeLabel,
          ...getEventCauseLabels(event),
          event.qualityStatus,
          event.comment,
          memberName(scopedTeamMembers, event.professionalId),
          memberName(scopedTeamMembers, event.reviewerId),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      })
      .sort((left, right) => getTime(right.createdAt) - getTime(left.createdAt));
  }, [memberFilter, projectById, qualityEvents, resultFilter, scopedProjectIds, scopedTeamMembers, searchTerm, selectedProjectId, taskByKey, reviewerFilter]);

  const acceptedEvents = visibleEvents.filter((event) => event.result === 'accepted');
  const rejectedEvents = visibleEvents.filter((event) => event.result === 'rejected');
  const acceptedWithObservationsEvents = visibleEvents.filter((event) => event.approvedWithObservations || event.qualityStatus === 'accepted_with_observations');
  const qualityScore = visibleEvents.length > 0 ? Math.round((acceptedEvents.length / visibleEvents.length) * 100) : null;
  const grade = getQualityGrade(qualityScore);
  const reviewerCount = new Set(visibleEvents.map((event) => event.reviewerId || event.createdBy).filter(Boolean)).size;
  const professionalCount = new Set(visibleEvents.map((event) => event.professionalId).filter(Boolean)).size;

  const projectStats = useMemo(() => {
    return scopedProjects
      .map((project) => {
        const projectEvents = qualityEvents.filter((event) => event.projectId === project.id);
        const accepted = projectEvents.filter((event) => event.result === 'accepted').length;
        const rejected = projectEvents.filter((event) => event.result === 'rejected').length;
        const total = accepted + rejected;
        return {
          project,
          total,
          accepted,
          rejected,
          score: total > 0 ? Math.round((accepted / total) * 100) : null,
        };
      })
      .sort((left, right) => right.total - left.total || String(left.project.name || '').localeCompare(String(right.project.name || '')));
  }, [qualityEvents, scopedProjects]);

  const professionalRows = useMemo(() => {
    const rows = new Map<string, any>();
    visibleEvents.forEach((event) => {
      const key = event.professionalId || 'unknown';
      const row = rows.get(key) || { id: key, name: memberName(scopedTeamMembers, key), accepted: 0, rejected: 0, total: 0 };
      row.total += 1;
      if (event.result === 'accepted') row.accepted += 1;
      if (event.result === 'rejected') row.rejected += 1;
      rows.set(key, row);
    });

    return Array.from(rows.values())
      .map((row) => ({ ...row, score: row.total > 0 ? Math.round((row.accepted / row.total) * 100) : null }))
      .sort((left, right) => (right.total - left.total) || ((right.score || 0) - (left.score || 0)))
      .slice(0, 8);
  }, [scopedTeamMembers, visibleEvents]);

  const reviewerRows = useMemo(() => {
    const rows = new Map<string, any>();
    visibleEvents.forEach((event) => {
      const key = event.reviewerId || event.createdBy || 'unknown';
      const row = rows.get(key) || { id: key, name: memberName(scopedTeamMembers, key), accepted: 0, rejected: 0, total: 0 };
      row.total += 1;
      if (event.result === 'accepted') row.accepted += 1;
      if (event.result === 'rejected') row.rejected += 1;
      rows.set(key, row);
    });

    return Array.from(rows.values()).sort((left, right) => right.total - left.total).slice(0, 8);
  }, [scopedTeamMembers, visibleEvents]);

  const causeRows = useMemo(() => {
    const rows = new Map<string, any>();
    visibleEvents.forEach((event) => {
      const labels = getEventCauseLabels(event);
      if (labels.length === 0) return;
      labels.forEach((label, index) => {
        const key = Array.isArray(event.causeIds) && event.causeIds[index] ? event.causeIds[index] : label;
        const row = rows.get(key) || { id: key, name: label || 'Sin causal', count: 0 };
        row.count += 1;
        rows.set(key, row);
      });
    });

    return Array.from(rows.values()).sort((left, right) => right.count - left.count).slice(0, 8);
  }, [visibleEvents]);

  if (!canAccessQuality) {
    return (
      <DashboardLayout>
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-12 w-12 text-slate-300" />
          <h1 className="mt-4 text-2xl font-black text-slate-950">Acceso restringido</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium text-slate-500">
            Este tablero global de calidad está disponible para coordinadores, gerentes y administradores.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="relative p-5">
            <div className="absolute right-6 top-5 hidden h-28 w-28 rounded-full bg-cyan-100/60 blur-2xl lg:block" />
            <div className="absolute right-24 top-12 hidden h-24 w-24 rounded-full bg-emerald-100/60 blur-2xl lg:block" />
            <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="max-w-4xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded bg-indigo-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-indigo-700 ring-1 ring-indigo-100">
                  <Sparkles size={14} />
                  Control global de entregables
                </div>
                <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight text-slate-950">
                  <ShieldCheck size={30} className="text-indigo-600" />
                  Calidad y revisión
                </h1>
                <p className="mt-2 text-base font-medium text-slate-500">
                  Mira la salud de calidad de todos los proyectos, detecta devoluciones y entra directo a la tarea que generó cada señal.
                </p>
              </div>
              <div className={`rounded-lg px-4 py-3 ring-1 ${grade.className}`}>
                <p className="text-[10px] font-black uppercase tracking-[0.16em]">Pulso de calidad</p>
                <p className="mt-1 text-2xl font-black">{qualityScore == null ? '--' : `${qualityScore}%`}</p>
                <p className="text-sm font-bold">{grade.label}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ClockMetric label="Revisiones" value={visibleEvents.length} total={Math.max(visibleEvents.length, 1)} detail={`${compactNumber(professionalCount)} profesionales evaluados`} color="#4f46e5" />
          <ClockMetric label="Aceptadas" value={acceptedEvents.length} total={Math.max(visibleEvents.length, 1)} detail={`${compactNumber(acceptedWithObservationsEvents.length)} con observaciones`} color="#10b981" />
          <ClockMetric label="Devueltas" value={rejectedEvents.length} total={Math.max(visibleEvents.length, 1)} detail="Requieren corrección" color="#ef4444" />
          <ClockMetric label="Revisores" value={reviewerCount} total={Math.max(reviewerCount, professionalCount, 1)} detail="Personas revisando calidad" color="#06b6d4" />
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedProjectId('all')}
                className={`inline-flex h-9 items-center gap-2 rounded border px-3 text-xs font-black uppercase tracking-[0.12em] transition ${
                  selectedProjectId === 'all'
                    ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50'
                }`}
              >
                Global
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${selectedProjectId === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {compactNumber(qualityEvents.filter((event) => scopedProjectIds.has(event.projectId)).length)}
                </span>
              </button>
              {projectStats.slice(0, 8).map((row) => (
                <button
                  key={row.project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(row.project.id)}
                  className={`inline-flex h-9 items-center gap-2 rounded border px-3 text-xs font-black uppercase tracking-[0.12em] transition ${
                    selectedProjectId === row.project.id
                      ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50'
                  }`}
                >
                  {row.project.name || 'Proyecto'}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${selectedProjectId === row.project.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {compactNumber(row.total)}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 lg:flex-row">
              <div className="relative lg:w-96">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  placeholder="Buscar tarea, proyecto, causal o persona..."
                />
              </div>
              <select
                value={resultFilter}
                onChange={(event) => setResultFilter(event.target.value as 'all' | 'accepted' | 'rejected')}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              >
                <option value="all">Todos los resultados</option>
                <option value="accepted">Solo aceptadas</option>
                <option value="rejected">Solo devueltas</option>
              </select>
            </div>
          </div>
          {(memberFilter || reviewerFilter) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {memberFilter && (
                <span className="rounded bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
                  Profesional: {memberName(scopedTeamMembers, memberFilter)}
                </span>
              )}
              {reviewerFilter && (
                <span className="rounded bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">
                  Revisor: {memberName(scopedTeamMembers, reviewerFilter)}
                </span>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => { setMemberFilter(''); setReviewerFilter(''); }} className="h-8 border-slate-200 text-slate-600">
                Limpiar persona
              </Button>
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.8fr)]">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-black tracking-tight text-slate-950">
                    <Activity size={20} className="text-indigo-600" />
                    Trazabilidad de calidad
                  </h2>
                  <p className="text-sm font-medium text-slate-500">Cada registro abre la tarea o el origen exacto de la alerta.</p>
                </div>
                <span className="rounded bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                  {compactNumber(visibleEvents.length)} eventos
                </span>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-14">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
              </div>
            ) : visibleEvents.length === 0 ? (
              <div className="py-14 text-center">
                <ShieldCheck className="mx-auto h-12 w-12 text-slate-300" />
                <h3 className="mt-3 text-lg font-black text-slate-950">No hay eventos de calidad para este filtro</h3>
                <p className="mt-1 text-sm font-medium text-slate-500">Cambia de proyecto o limpia los filtros activos.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibleEvents.slice(0, 80).map((event) => {
                  const project = projectById.get(event.projectId);
                  const task = taskByKey.get(`${event.projectId}::${event.taskId}`);
                  const isAccepted = event.result === 'accepted';
                  const isAcceptedWithObservations = event.approvedWithObservations || event.qualityStatus === 'accepted_with_observations';
                  const causeLabels = getEventCauseLabels(event);
                  const progress = Number(task?.progress || 0);

                  return (
                    <Link
                      key={`${event.projectId}-${event.id}`}
                      href={getTaskDeepLink(event)}
                      className={`grid gap-3 px-4 py-3 transition hover:bg-slate-50 md:grid-cols-[1fr_auto] md:items-center ${
                        isAccepted ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-red-500'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                            isAcceptedWithObservations ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-100' : isAccepted ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-red-50 text-red-700 ring-1 ring-red-100'
                          }`}>
                            {isAccepted ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                            {getEventStatusLabel(event)}
                          </span>
                          <span className="rounded bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-indigo-700 ring-1 ring-indigo-100">
                            {project?.name || 'Proyecto'}
                          </span>
                          {causeLabels.map((label) => (
                            <span key={label} className="rounded bg-orange-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-orange-700 ring-1 ring-orange-100">
                              {label}
                            </span>
                          ))}
                        </div>
                        <p className="truncate text-sm font-black text-slate-950">{getTaskTitle(task, event)}</p>
                        <p className="mt-1 text-xs font-bold text-slate-500">
                          {event.stepLabel || 'Control de calidad'} · {memberName(scopedTeamMembers, event.professionalId)} · {formatDate(event.createdAt)}
                        </p>
                        {event.comment && (
                          <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">{event.comment}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-28">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full ${isAccepted ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }} />
                          </div>
                          <p className="mt-1 text-right text-xs font-black text-slate-500">{progress}%</p>
                        </div>
                        <span className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 px-3 text-xs font-black text-slate-600">
                          Abrir
                          <ArrowRight size={14} />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <div className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <Gauge size={19} className="text-indigo-600" />
                Ranking de profesionales
              </h2>
              <div className="mt-4 space-y-3">
                {professionalRows.length === 0 ? (
                  <p className="rounded-md bg-slate-50 p-4 text-sm font-medium text-slate-500">Sin profesionales evaluados.</p>
                ) : (
                  professionalRows.map((row, index) => {
                    const rowGrade = getQualityGrade(row.score);
                    return (
                      <div key={row.id} className="rounded-md border border-slate-100 bg-slate-50/70 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-950">{index + 1}. {row.name}</p>
                            <p className="text-xs font-bold text-slate-500">{row.accepted} aceptadas · {row.rejected} devueltas</p>
                          </div>
                          <span className={`rounded px-2 py-1 text-xs font-black ring-1 ${rowGrade.className}`}>{row.score ?? 0}%</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <Medal size={19} className="text-indigo-600" />
                Revisores activos
              </h2>
              <div className="mt-4 space-y-3">
                {reviewerRows.length === 0 ? (
                  <p className="rounded-md bg-slate-50 p-4 text-sm font-medium text-slate-500">Sin revisores registrados.</p>
                ) : (
                  reviewerRows.map((row) => (
                    <div key={row.id} className="rounded-md border border-slate-100 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-black text-slate-950">{row.name}</p>
                        <span className="rounded bg-indigo-50 px-2 py-1 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">{row.total}</span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-500">{row.accepted} aceptadas · {row.rejected} devueltas</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <AlertTriangle size={19} className="text-orange-600" />
                Causales críticas
              </h2>
              <div className="mt-4 space-y-2">
                {causeRows.length === 0 ? (
                  <p className="rounded-md bg-emerald-50 p-4 text-sm font-bold text-emerald-700">Sin devoluciones en este alcance.</p>
                ) : (
                  causeRows.map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-3 rounded-md bg-orange-50 px-3 py-2 ring-1 ring-orange-100">
                      <span className="min-w-0 truncate text-sm font-black text-orange-900">{row.name}</span>
                      <span className="rounded bg-white px-2 py-1 text-xs font-black text-orange-700">{row.count}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-black text-slate-950">
                <Timer size={20} className="text-cyan-600" />
                Pulso por proyecto
              </h2>
              <p className="text-sm font-medium text-slate-500">Comparativo global para decidir dónde revisar primero.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {projectStats.slice(0, 8).map((row) => {
              const rowGrade = getQualityGrade(row.score);
              return (
                <button
                  key={row.project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(row.project.id)}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">{row.project.name || 'Proyecto'}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">{organizationNameFor(row.project, organizations)}</p>
                    </div>
                    <span className={`rounded px-2 py-1 text-xs font-black ring-1 ${rowGrade.className}`}>{row.score == null ? '--' : `${row.score}%`}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded bg-white p-2 ring-1 ring-slate-100">
                      <p className="text-[10px] font-black uppercase text-slate-400">Rev.</p>
                      <p className="text-sm font-black text-slate-950">{row.total}</p>
                    </div>
                    <div className="rounded bg-emerald-50 p-2 ring-1 ring-emerald-100">
                      <p className="text-[10px] font-black uppercase text-emerald-700">OK</p>
                      <p className="text-sm font-black text-emerald-700">{row.accepted}</p>
                    </div>
                    <div className="rounded bg-red-50 p-2 ring-1 ring-red-100">
                      <p className="text-[10px] font-black uppercase text-red-700">Dev.</p>
                      <p className="text-sm font-black text-red-700">{row.rejected}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

export default function QualityOverviewPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout>
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
          </div>
        </DashboardLayout>
      }
    >
      <QualityOverviewContent />
    </Suspense>
  );
}
