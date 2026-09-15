"use client";

import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Layers3,
  PackageCheck,
  PlayCircle,
  Radio,
  TimerReset,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SCRUM_WORK_STATUSES,
  getScrumScopeMetrics,
  getScrumStatusLabel,
  getSprintMetrics,
  getSprintStatus,
  normalizeScrumStatus,
  toDateValue,
} from "@/lib/scrum";

type ProjectScrumControlCenterProps = {
  project: any;
  releases: any[];
  groups: any[];
  epics: any[];
  sprints: any[];
  items: any[];
  now: Date;
  canManageLifecycle?: boolean;
  onOpenSprint: (sprint: any) => void;
  onStartSprint: (sprint: any) => void;
  onCloseSprint: (sprint: any) => void;
  onOpenArchitecture: () => void;
};

const STATUS_COLORS: Record<string, string> = {
  backlog: "#64748b",
  ready: "#3b82f6",
  in_progress: "#f59e0b",
  review: "#8b5cf6",
  validation: "#06b6d4",
  done: "#10b981",
};

const getEntityTitle = (entity: any, fallback: string) => entity?.name || entity?.title || fallback;

const formatShortDate = (value: any) => {
  const date = toDateValue(value);
  if (!date) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(date);
};

const getCountdown = (endValue: any, now: Date) => {
  const endDate = toDateValue(endValue);
  if (!endDate) return { label: "Sin fecha final", overdue: false, days: null };
  const difference = endDate.getTime() - now.getTime();
  const overdue = difference < 0;
  const absolute = Math.abs(difference);
  const days = Math.floor(absolute / 86400000);
  const hours = Math.floor((absolute % 86400000) / 3600000);
  const minutes = Math.max(0, Math.floor((absolute % 3600000) / 60000));
  const duration = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return {
    label: overdue ? `Vencido hace ${duration}` : `Quedan ${duration}`,
    overdue,
    days: overdue ? -days : days,
  };
};

function ProgressRing({ value, label }: { value: number; label: string }) {
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, value)) / 100) * circumference;

  return (
    <div className="relative h-32 w-32 shrink-0" role="img" aria-label={`${label}: ${value}%`}>
      <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(148,163,184,.2)" strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <strong className="font-mono text-2xl font-black tabular-nums text-white">{value}%</strong>
        <span className="mt-0.5 text-[8px] font-black uppercase tracking-[0.16em] text-cyan-200">{label}</span>
      </div>
    </div>
  );
}

export function ProjectScrumControlCenter({
  project,
  releases,
  groups,
  epics,
  sprints,
  items,
  now,
  canManageLifecycle = false,
  onOpenSprint,
  onStartSprint,
  onCloseSprint,
  onOpenArchitecture,
}: ProjectScrumControlCenterProps) {
  const [releaseFilter, setReleaseFilter] = useState("all");
  const workItems = useMemo(() => items.filter((item) => item.scrumKind !== "epic"), [items]);
  const epicById = useMemo(() => new Map(epics.map((epic) => [epic.id, epic])), [epics]);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  const getSprintReleaseId = (sprint: any) => {
    if (sprint?.scrumReleaseId) return sprint.scrumReleaseId;
    const group = groupById.get(sprint?.scrumGroupId);
    if (group?.scrumReleaseId) return group.scrumReleaseId;
    return epicById.get(sprint?.scrumEpicId)?.scrumReleaseId || null;
  };

  const getTaskReleaseId = (item: any) => {
    if (item?.scrumReleaseId) return item.scrumReleaseId;
    const group = groupById.get(item?.scrumGroupId);
    if (group?.scrumReleaseId) return group.scrumReleaseId;
    const sprint = sprints.find((candidate) => candidate.id === item?.sprintId);
    return getSprintReleaseId(sprint) || epicById.get(item?.scrumEpicId)?.scrumReleaseId || null;
  };

  const filteredWorkItems = releaseFilter === "all"
    ? workItems
    : workItems.filter((item) => getTaskReleaseId(item) === releaseFilter);
  const portfolioMetrics = getScrumScopeMetrics(filteredWorkItems);
  const activeSprints = sprints
    .filter((sprint) => getSprintStatus(sprint) === "active")
    .filter((sprint) => releaseFilter === "all" || getSprintReleaseId(sprint) === releaseFilter)
    .sort((left, right) => (toDateValue(left.endDate)?.getTime() || Infinity) - (toDateValue(right.endDate)?.getTime() || Infinity));
  const planningSprints = sprints
    .filter((sprint) => getSprintStatus(sprint) === "planning")
    .filter((sprint) => releaseFilter === "all" || getSprintReleaseId(sprint) === releaseFilter);
  const overdueActiveSprints = activeSprints.filter((sprint) => getCountdown(sprint.endDate, now).overdue).length;

  const releaseRows = releases.map((release) => {
    const releaseEpics = epics.filter((epic) => epic.scrumReleaseId === release.id);
    const epicIds = new Set(releaseEpics.map((epic) => epic.id));
    const releaseItems = workItems.filter((item) => getTaskReleaseId(item) === release.id || epicIds.has(item.scrumEpicId));
    const releaseSprints = sprints.filter((sprint) => getSprintReleaseId(sprint) === release.id);
    const metrics = getScrumScopeMetrics(releaseItems);
    const lifecycle = releaseSprints.some((sprint) => getSprintStatus(sprint) === "active")
      ? "active"
      : releaseSprints.length > 0 && releaseSprints.every((sprint) => getSprintStatus(sprint) === "completed")
        ? "completed"
        : "planning";
    return { release, releaseEpics, releaseSprints, metrics, lifecycle };
  });

  const visibleEpicRows = epics
    .filter((epic) => releaseFilter === "all" || epic.scrumReleaseId === releaseFilter)
    .map((epic) => {
      const epicItems = workItems.filter((item) => item.scrumEpicId === epic.id);
      const epicGroups = groups.filter((group) => group.scrumEpicId === epic.id);
      return { epic, groups: epicGroups, metrics: getScrumScopeMetrics(epicItems) };
    })
    .sort((left, right) => right.metrics.progress - left.metrics.progress);

  const statusRows = SCRUM_WORK_STATUSES.map((status) => {
    const count = filteredWorkItems.filter(
      (item) => normalizeScrumStatus(item.scrumStatus || item.status) === status.value,
    ).length;
    return {
      ...status,
      count,
      share: filteredWorkItems.length > 0 ? Math.round((count / filteredWorkItems.length) * 100) : 0,
    };
  });

  const orphanEpics = epics.filter((epic) => !epic.scrumReleaseId).length;
  const orphanSprints = sprints.filter((sprint) => !sprint.scrumGroupId).length;
  const orphanStories = workItems.filter((item) => {
    const refined = item.scrumRefinementStatus
      ? item.scrumRefinementStatus === "refined"
      : Boolean(item.sprintId || item.scrumEpicId);
    if (item.scrumKind !== "story" || !refined) return false;
    const sprint = sprints.find((candidate) => candidate.id === item.sprintId);
    return !groupById.has(item.scrumGroupId || sprint?.scrumGroupId);
  }).length;
  const selectedReleaseName = releaseFilter === "all"
    ? "Todos los Releases"
    : getEntityTitle(releases.find((release) => release.id === releaseFilter), "Release");

  return (
    <div className="min-w-0 space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-slate-950 text-white shadow-2xl">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(34,211,238,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.8)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative border-b border-white/10 p-4 sm:p-6">
          <div className="flex min-w-0 flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">
                  <Radio size={12} className={activeSprints.length > 0 ? "animate-pulse" : ""} /> Control de entrega en vivo
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold text-slate-300">
                  {selectedReleaseName}
                </span>
              </div>
              <h3 className="mt-3 break-words text-xl font-black tracking-tight sm:text-2xl">Panel de control tecnológico</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-300 sm:text-sm">
                Avance ponderado por puntos y etapa. La misma base alimenta cada sprint, épica y Release para que todos los porcentajes concilien.
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <label className="sr-only" htmlFor="release-control-filter">Filtrar por Release</label>
              <select
                id="release-control-filter"
                value={releaseFilter}
                onChange={(event) => setReleaseFilter(event.target.value)}
                className="h-10 min-w-0 rounded-lg border border-white/15 bg-slate-900 px-3 text-xs font-bold text-white outline-none focus:border-cyan-400 sm:min-w-56"
              >
                <option value="all">Todos los Releases</option>
                {releases.map((release) => (
                  <option key={release.id} value={release.id}>{getEntityTitle(release, "Release")}</option>
                ))}
              </select>
              <Button type="button" variant="outline" onClick={onOpenArchitecture} className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                <Boxes size={15} className="mr-2" /> Organizar arquitectura
              </Button>
            </div>
          </div>
        </div>

        <div className="relative grid gap-4 p-4 sm:p-6 xl:grid-cols-[auto_1fr]">
          <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <ProgressRing value={portfolioMetrics.progress} label="Avance" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Sprints activos", value: activeSprints.length, detail: `${planningSprints.length} por iniciar`, Icon: Zap, tone: "text-cyan-300" },
              { label: "Entrega", value: `${portfolioMetrics.completedItems}/${portfolioMetrics.totalItems}`, detail: `${portfolioMetrics.completedPoints}/${portfolioMetrics.totalPoints || 0} puntos`, Icon: PackageCheck, tone: "text-emerald-300" },
              { label: "Bloqueos", value: portfolioMetrics.blockedItems, detail: "Tareas detenidas", Icon: AlertTriangle, tone: "text-amber-300" },
              { label: "Riesgo temporal", value: overdueActiveSprints, detail: "Sprints vencidos activos", Icon: CalendarClock, tone: overdueActiveSprints > 0 ? "text-rose-300" : "text-slate-300" },
            ].map(({ label, value, detail, Icon, tone }) => (
              <div key={label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 break-words text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
                  <Icon size={15} className={`shrink-0 ${tone}`} />
                </div>
                <p className="mt-2 font-mono text-2xl font-black tabular-nums text-white">{value}</p>
                <p className="mt-1 break-words text-[10px] font-semibold text-slate-400">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {(orphanEpics > 0 || orphanSprints > 0 || orphanStories > 0) && (
        <button
          type="button"
          onClick={onOpenArchitecture}
          className="flex w-full min-w-0 flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left transition hover:border-amber-300 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="flex min-w-0 items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <span className="min-w-0">
              <span className="block text-sm font-black text-amber-950">Arquitectura pendiente de completar</span>
              <span className="mt-0.5 block break-words text-xs text-amber-800">{orphanEpics} épica(s) sin Release, {orphanStories} historia(s) sin submódulo y {orphanSprints} sprint(s) sin submódulo. Los datos actuales se conservan hasta que los organices.</span>
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center text-xs font-black text-amber-800">Organizar <ChevronRight size={15} className="ml-1" /></span>
        </button>
      )}

      <div className="grid min-w-0 gap-5 2xl:grid-cols-[1.15fr_.85fr]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-700">Operación simultánea</p>
              <h4 className="mt-1 text-lg font-black text-slate-950">Sprints activos y cuenta regresiva</h4>
            </div>
            <span className="text-xs font-semibold text-slate-500">Actualiza cada minuto</span>
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            {activeSprints.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
                <PlayCircle className="mx-auto text-slate-300" size={30} />
                <p className="mt-3 text-sm font-black text-slate-900">No hay sprints activos</p>
                <p className="mt-1 text-xs text-slate-500">Puedes iniciar varios sprints y ejecutarlos en paralelo.</p>
                {canManageLifecycle && planningSprints[0] && (
                  <Button type="button" size="sm" onClick={() => onStartSprint(planningSprints[0])} className="mt-4 bg-cyan-700 text-white hover:bg-cyan-800">
                    <PlayCircle size={14} className="mr-2" /> Iniciar {getEntityTitle(planningSprints[0], "sprint")}
                  </Button>
                )}
              </div>
            ) : activeSprints.map((sprint) => {
              const sprintItems = workItems.filter((item) => item.sprintId === sprint.id);
              const metrics = getSprintMetrics(sprint, sprintItems);
              const countdown = getCountdown(sprint.endDate, now);
              const group = groupById.get(sprint.scrumGroupId);
              const epic = epicById.get(sprint.scrumEpicId || group?.scrumEpicId);
              return (
                <article key={sprint.id} className={`min-w-0 rounded-xl border p-4 ${countdown.overdue ? "border-rose-200 bg-rose-50/60" : "border-cyan-200 bg-cyan-50/40"}`}>
                  <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <button type="button" onClick={() => onOpenSprint(sprint)} className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-200"><Activity size={10} /> Activo</span>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-black ${countdown.overdue ? "bg-rose-100 text-rose-700" : "bg-white text-cyan-800 ring-1 ring-cyan-200"}`}><TimerReset size={10} /> {countdown.label}</span>
                      </div>
                      <h5 className="mt-2 break-words text-base font-black text-slate-950">{getEntityTitle(sprint, "Sprint")}</h5>
                      <p className="mt-1 break-words text-[11px] font-semibold text-slate-500">{getEntityTitle(epic, "Épica pendiente")} · {getEntityTitle(group, "Submódulo pendiente")}</p>
                    </button>
                    <div className="flex min-w-0 items-center gap-3 lg:w-[46%]">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex items-center justify-between text-[10px] font-black text-slate-600">
                          <span>{metrics.completedItems}/{metrics.totalItems} tareas</span>
                          <span className="font-mono tabular-nums">{metrics.progress}%</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
                          <div className="h-full rounded-full bg-cyan-600" style={{ width: `${metrics.progress}%` }} />
                        </div>
                      </div>
                      {canManageLifecycle && (
                        <Button type="button" size="sm" variant="outline" onClick={() => onCloseSprint(sprint)} className="shrink-0 border-slate-300 bg-white font-bold text-slate-700">
                          Cerrar
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">Distribución operativa</p>
            <h4 className="mt-1 text-lg font-black text-slate-950">Carga por etapa</h4>
            <p className="mt-1 text-xs text-slate-500">{filteredWorkItems.length} tareas dentro del alcance seleccionado.</p>
          </div>
          <div className="p-4 sm:p-5">
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100" aria-label="Distribución de tareas por etapa">
              {statusRows.filter((row) => row.count > 0).map((row) => (
                <div key={row.value} title={`${row.label}: ${row.count}`} style={{ width: `${row.share}%`, backgroundColor: STATUS_COLORS[row.value] }} />
              ))}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {statusRows.map((row) => (
                <div key={row.value} className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                  <div className="flex items-center gap-2">
                    <CircleDot size={11} style={{ color: STATUS_COLORS[row.value] }} className="shrink-0" />
                    <span className="min-w-0 truncate text-[9px] font-black uppercase tracking-wide text-slate-500">{getScrumStatusLabel(row.value)}</span>
                  </div>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <strong className="font-mono text-lg font-black tabular-nums text-slate-900">{row.count}</strong>
                    <span className="text-[10px] font-bold text-slate-400">{row.share}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">Portafolio de producto</p>
              <h4 className="mt-1 break-words text-lg font-black text-slate-950">Avance por Release</h4>
            </div>
            <PackageCheck size={20} className="shrink-0 text-indigo-600" />
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            {releaseRows.length === 0 ? (
              <button type="button" onClick={onOpenArchitecture} className="w-full rounded-xl border border-dashed border-indigo-200 p-8 text-center transition hover:bg-indigo-50">
                <PackageCheck className="mx-auto text-indigo-300" size={30} />
                <p className="mt-3 text-sm font-black text-slate-900">Crea el primer Release</p>
                <p className="mt-1 text-xs text-slate-500">Será el nivel superior que agrupa las épicas de la entrega.</p>
              </button>
            ) : releaseRows.map(({ release, releaseEpics, releaseSprints, metrics, lifecycle }) => (
              <button
                key={release.id}
                type="button"
                onClick={() => setReleaseFilter(release.id === releaseFilter ? "all" : release.id)}
                className={`w-full min-w-0 rounded-xl border p-3 text-left transition ${releaseFilter === release.id ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 hover:border-indigo-200"}`}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-[9px] font-black uppercase ${lifecycle === "active" ? "bg-cyan-100 text-cyan-800" : lifecycle === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {lifecycle === "active" ? "En ejecución" : lifecycle === "completed" ? "Completado" : "Planificación"}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400">Hasta {formatShortDate(release.targetDate || release.endDate)}</span>
                    </div>
                    <p className="mt-1.5 break-words text-sm font-black text-slate-950">{getEntityTitle(release, "Release")}</p>
                    <p className="mt-1 text-[10px] font-semibold text-slate-500">{releaseEpics.length} épicas · {releaseSprints.length} sprints · {metrics.totalItems} tareas</p>
                  </div>
                  <span className="shrink-0 font-mono text-lg font-black tabular-nums text-indigo-700">{metrics.progress}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-indigo-600" style={{ width: `${metrics.progress}%` }} />
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">Resultados funcionales</p>
              <h4 className="mt-1 break-words text-lg font-black text-slate-950">Avance por épica</h4>
            </div>
            <Layers3 size={20} className="shrink-0 text-violet-600" />
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            {visibleEpicRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No hay épicas en este alcance.</div>
            ) : visibleEpicRows.slice(0, 8).map(({ epic, groups: epicGroups, metrics }) => (
              <div key={epic.id} className="min-w-0 rounded-xl border border-slate-200 p-3">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[9px] font-black uppercase tracking-[0.12em] text-violet-600">{epic.scrumCode || "ÉPICA"}</p>
                    <p className="mt-0.5 line-clamp-2 break-words text-sm font-black text-slate-950">{getEntityTitle(epic, "Épica")}</p>
                    <p className="mt-1 text-[10px] font-semibold text-slate-500">{epicGroups.length} submódulos · {metrics.completedItems}/{metrics.totalItems} tareas terminadas</p>
                  </div>
                  <span className="shrink-0 font-mono text-lg font-black tabular-nums text-violet-700">{metrics.progress}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-violet-600" style={{ width: `${metrics.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {planningSprints.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Siguiente ventana de ejecución</p>
              <h4 className="mt-1 text-base font-black text-slate-950">{planningSprints.length} sprint(s) listos para iniciar</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {planningSprints.slice(0, 3).map((sprint) => (
                <Button key={sprint.id} type="button" size="sm" variant="outline" onClick={() => onOpenSprint(sprint)} className="min-w-0 font-bold">
                  <span className="max-w-40 truncate">{getEntityTitle(sprint, "Sprint")}</span>
                  <ChevronRight size={14} className="ml-1 shrink-0" />
                </Button>
              ))}
            </div>
          </div>
        </section>
      )}

      <p className="px-1 text-[10px] font-semibold text-slate-400">
        Fuente: tareas, sprints, submódulos y Releases del proyecto “{project?.name || "tecnológico"}”. Actualización en tiempo real.
      </p>
    </div>
  );
}
