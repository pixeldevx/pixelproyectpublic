"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitBranch,
  Github,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Unplug,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";

type ProjectGitHubPanelProps = {
  projectId: string;
  canManage?: boolean;
};

type GithubData = {
  appConfiguration: Record<string, boolean | string>;
  canManage: boolean;
  installation: any | null;
  selectedRepositories: string[];
  githubSettings: any;
  userIdentity: any | null;
  events: any[];
  tasks: any[];
};

const eventLabel: Record<string, string> = {
  branch: "Rama",
  commit: "Commit",
  pull_request: "Pull request",
  check: "Verificación",
  workflow: "Automatización",
  deployment: "Despliegue",
  validation_request: "Validación solicitada",
};

const relationshipLabel: Record<string, string> = {
  main: "PR principal",
  required: "PR requerido",
  complementary: "PR complementario",
};

const getEventUrl = (event: any) =>
  event.pullRequest?.url || event.check?.url || event.deployment?.url || event.commits?.[0]?.url || event.repositoryUrl || "";

const formatDateTime = (value: any) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export function ProjectGitHubPanel({ projectId, canManage = false }: ProjectGitHubPanelProps) {
  const [data, setData] = useState<GithubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [repositorySelection, setRepositorySelection] = useState<string[]>([]);
  const [taskFilter, setTaskFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");

  const authorizedFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Tu sesión de Pixel expiró. Vuelve a iniciar sesión.");
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || "La operación no pudo completarse.");
    return body;
  }, []);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await authorizedFetch(`/api/github/projects/${projectId}`);
      setData(result);
      setRepositorySelection(result.selectedRepositories || []);
    } catch (error: any) {
      console.error("Error loading GitHub panel:", error);
      toast.error(error?.message || "No se pudo cargar GitHub.");
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch, projectId]);

  useEffect(() => {
    // The panel fetch is the external synchronization source for this view.
    loadData();
  }, [loadData]);

  const startFlow = async (endpoint: string, name: string) => {
    setBusy(name);
    try {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const body = endpoint.includes("install") ? { projectId, returnTo } : { returnTo };
      const result = await authorizedFetch(endpoint, { method: "POST", body: JSON.stringify(body) });
      window.location.assign(result.url);
    } catch (error: any) {
      toast.error(error?.message || "No se pudo abrir GitHub.");
      setBusy("");
    }
  };

  const saveRepositories = async () => {
    setBusy("repositories");
    try {
      await authorizedFetch(`/api/github/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ repositoryFullNames: repositorySelection }),
      });
      toast.success("Repositorios autorizados para este proyecto.");
      await loadData(true);
    } catch (error: any) {
      toast.error(error?.message || "No se pudieron guardar los repositorios.");
    } finally {
      setBusy("");
    }
  };

  const repairSync = async () => {
    setBusy("sync");
    try {
      const result = await authorizedFetch(`/api/github/projects/${projectId}/sync`, { method: "POST", body: "{}" });
      toast.success(`Sincronización terminada: ${result.createdEvents || 0} evidencias recuperadas.`);
      await loadData(true);
    } catch (error: any) {
      toast.error(error?.message || "No se pudo reparar la sincronización.");
    } finally {
      setBusy("");
    }
  };

  const classifyPullRequest = async (eventId: string, relationship: string) => {
    setBusy(`event-${eventId}`);
    try {
      await authorizedFetch(`/api/github/projects/${projectId}/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        body: JSON.stringify({ relationship }),
      });
      await loadData(true);
    } catch (error: any) {
      toast.error(error?.message || "No se pudo clasificar el pull request.");
    } finally {
      setBusy("");
    }
  };

  const requestValidation = async (task: any) => {
    setBusy(`validate-${task.id}`);
    try {
      await authorizedFetch(`/api/github/tasks/${task.id}/request-validation`, {
        method: "POST",
        body: JSON.stringify({ projectId }),
      });
      toast.success(`${task.scrumCode}: entrega enviada a validación.`);
      await loadData(true);
    } catch (error: any) {
      toast.error(error?.message || "La entrega todavía no cumple las condiciones.");
    } finally {
      setBusy("");
    }
  };

  const filteredEvents = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    return data.events
      .filter((event) => {
        if (taskFilter !== "all" && event.taskId !== taskFilter) return false;
        if (kindFilter !== "all" && event.kind !== kindFilter) return false;
        return true;
      })
      .filter((event) => {
        const logicalKey = event.kind === "pull_request"
          ? `${event.taskId}:pr:${event.repositoryFullName}:${event.pullRequest?.number || event.pullRequest?.id}`
          : ["check", "workflow", "deployment"].includes(event.kind)
            ? `${event.taskId}:${event.kind}:${event.check?.name || event.deployment?.environment || "evidence"}:${event.commitSha || "no-sha"}:${event.status}`
            : event.id;
        if (seen.has(logicalKey)) return false;
        seen.add(logicalKey);
        return true;
      });
  }, [data, kindFilter, taskFilter]);

  const validationCandidates = useMemo(
    () => (data?.tasks || []).filter((task) => {
      const main = task.githubMainPullRequest;
      return main && (main.merged || main.status === "merged") && !["validation", "done"].includes(task.scrumStatus);
    }),
    [data],
  );

  if (loading) {
    return (
      <section className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="text-center text-slate-500">
          <Loader2 size={28} className="mx-auto animate-spin text-indigo-600" />
          <p className="mt-3 text-sm font-bold">Cargando evidencia de ingeniería…</p>
        </div>
      </section>
    );
  }

  if (!data) return null;
  const configurationComplete = Object.entries(data.appConfiguration || {})
    .filter(([key]) => key !== "appSlug")
    .every(([, value]) => Boolean(value));
  const effectiveCanManage = canManage && data.canManage;
  const repositories = data.installation?.repositories || [];

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-950 p-6 text-white lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-200">
              <Github size={15} /> Evidencia técnica
            </div>
            <h3 className="mt-2 text-2xl font-black">Pixel + GitHub</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">
              Solo las tareas configuradas como “GitHub · Automático” aparecen aquí. Las tareas manuales avanzan desde la Bandeja de entrada y no reaccionan a estos códigos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => loadData(true)}
              className="border-slate-600 bg-slate-900 text-white hover:bg-slate-800"
            >
              <RefreshCw size={15} className="mr-2" /> Actualizar
            </Button>
            {effectiveCanManage && data.installation && (
              <Button type="button" onClick={repairSync} disabled={busy === "sync"} className="bg-indigo-500 text-white hover:bg-indigo-400">
                {busy === "sync" ? <Loader2 size={15} className="mr-2 animate-spin" /> : <ShieldCheck size={15} className="mr-2" />}
                Reparar sincronización
              </Button>
            )}
          </div>
        </div>

        {!configurationComplete && (
          <div className="flex gap-3 border-b border-amber-200 bg-amber-50 p-4 text-amber-900">
            <AlertCircle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-black">La GitHub App requiere variables en Vercel.</p>
              <p className="mt-1 text-xs leading-5">
                Configura App ID, slug, clave privada, secreto de webhook, Client ID, Client Secret y secreto de estado antes de conectarla.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Aplicación de la organización</p>
                <h4 className="mt-1 text-lg font-black text-slate-950">
                  {data.installation ? data.installation.account?.login : "GitHub App sin instalar"}
                </h4>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {data.installation
                    ? `${repositories.length} repositorios disponibles en la instalación.`
                    : "La organización decide exactamente a cuáles repositorios puede acceder Pixel."}
                </p>
              </div>
              <div className={`rounded-full p-2 ${data.installation ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                {data.installation ? <CheckCircle2 size={18} /> : <Unplug size={18} />}
              </div>
            </div>
            {effectiveCanManage && (
              <Button
                type="button"
                variant="outline"
                disabled={!configurationComplete || busy === "install"}
                onClick={() => startFlow("/api/github/install/start", "install")}
                className="mt-4 w-full"
              >
                {busy === "install" ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Github size={15} className="mr-2" />}
                {data.installation ? "Revisar instalación en GitHub" : "Instalar GitHub App"}
              </Button>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Identidad del desarrollador</p>
                <h4 className="mt-1 text-lg font-black text-slate-950">
                  {data.userIdentity ? `@${data.userIdentity.login}` : "Cuenta personal sin vincular"}
                </h4>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Pixel conserva únicamente la identidad verificada; el token personal se descarta después de la vinculación.
                </p>
              </div>
              <div className={`rounded-full p-2 ${data.userIdentity ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-400"}`}>
                <UserCheck size={18} />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!configurationComplete || busy === "identity"}
              onClick={() => startFlow("/api/github/user/connect", "identity")}
              className="mt-4 w-full"
            >
              {busy === "identity" ? <Loader2 size={15} className="mr-2 animate-spin" /> : <UserCheck size={15} className="mr-2" />}
              {data.userIdentity ? "Actualizar identidad" : "Vincular mi GitHub"}
            </Button>
          </div>
        </div>
      </section>

      {data.installation && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-600">Repositorios del proyecto</p>
              <h3 className="mt-1 text-lg font-black text-slate-950">Selecciona únicamente el alcance necesario</h3>
            </div>
            {effectiveCanManage && (
              <Button type="button" onClick={saveRepositories} disabled={busy === "repositories"} className="bg-slate-950 text-white hover:bg-slate-800">
                {busy === "repositories" ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
                Guardar selección
              </Button>
            )}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {repositories.map((repository: any) => {
              const selected = repositorySelection.includes(repository.fullName);
              return (
                <label
                  key={repository.id || repository.fullName}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                    selected ? "border-indigo-300 bg-indigo-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!effectiveCanManage}
                    onChange={(event) => setRepositorySelection((current) =>
                      event.target.checked
                        ? [...current, repository.fullName]
                        : current.filter((name) => name !== repository.fullName),
                    )}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-slate-900">{repository.fullName}</p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      {repository.private ? "Privado" : "Público"} · {repository.defaultBranch}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </section>
      )}

      {validationCandidates.length > 0 && (
        <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-700">Entregas listas técnicamente</p>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {validationCandidates.map((task) => (
              <div key={task.id} className="flex min-w-0 flex-col items-stretch justify-between gap-3 rounded-xl border border-cyan-200 bg-white p-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">{task.scrumCode}</p>
                  <p className="line-clamp-2 break-words text-sm font-black text-slate-900">{task.title}</p>
                  <p className="mt-1 text-[11px] text-slate-500">PR principal integrado · Pixel no la cerrará automáticamente</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy === `validate-${task.id}`}
                  onClick={() => requestValidation(task)}
                  className="w-full shrink-0 bg-cyan-700 text-white hover:bg-cyan-800 sm:w-auto"
                >
                  {busy === `validate-${task.id}` ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Check size={14} className="mr-1" />}
                  Solicitar validación
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-600">Línea de evidencia</p>
            <h3 className="mt-1 text-xl font-black text-slate-950">Actividad vinculada a historias de Pixel</h3>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)} className="h-10 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold">
              <option value="all">Todas las historias</option>
              {data.tasks.map((task) => <option key={task.id} value={task.id}>{task.scrumCode} · {task.title}</option>)}
            </select>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} className="h-10 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold">
              <option value="all">Toda la evidencia</option>
              <option value="branch">Ramas</option>
              <option value="commit">Commits</option>
              <option value="pull_request">Pull requests</option>
              <option value="check">Verificaciones</option>
              <option value="workflow">Automatizaciones</option>
              <option value="deployment">Despliegues</option>
              <option value="validation_request">Solicitudes de validación</option>
            </select>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredEvents.length === 0 ? (
            <div className="p-10 text-center">
              <CircleDot size={28} className="mx-auto text-slate-300" />
              <p className="mt-3 text-sm font-black text-slate-700">Todavía no hay evidencia para este filtro.</p>
              <p className="mt-1 text-xs text-slate-500">Incluye el código de Pixel en la rama, el commit o el pull request.</p>
            </div>
          ) : filteredEvents.map((event) => {
            const url = getEventUrl(event);
            return (
              <article key={event.id} className="flex flex-col gap-3 p-4 transition hover:bg-slate-50 lg:flex-row lg:items-center">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${event.kind === "pull_request" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                  {event.kind === "pull_request" ? <GitPullRequest size={18} /> : <GitBranch size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-indigo-600">{event.taskCode}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{eventLabel[event.kind] || event.kind}</span>
                    {event.relationship && <span className="rounded bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">{relationshipLabel[event.relationship]}</span>}
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{event.status}</span>
                  </div>
                  <p className="mt-1 break-words text-sm font-black text-slate-900 [overflow-wrap:anywhere]">
                    {event.pullRequest?.title || event.check?.name || event.commits?.[0]?.message || event.branch || event.repositoryFullName}
                  </p>
                  <p className="mt-1 break-words text-[11px] text-slate-500 [overflow-wrap:anywhere]">
                    {event.repositoryFullName} · {formatDateTime(event.occurredAt)} · {event.pixelActor?.name || (event.sender?.login ? `@${event.sender.login}` : "GitHub")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {event.kind === "pull_request" && effectiveCanManage && (
                    <select
                      value={event.relationship || "complementary"}
                      disabled={busy === `event-${event.id}`}
                      onChange={(changeEvent) => classifyPullRequest(event.id, changeEvent.target.value)}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-bold"
                    >
                      <option value="main">Principal</option>
                      <option value="required">Requerido</option>
                      <option value="complementary">Complementario</option>
                    </select>
                  )}
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-white hover:text-indigo-700">
                      Ver <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
