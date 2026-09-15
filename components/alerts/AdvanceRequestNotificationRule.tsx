"use client";

import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  BellRing,
  Check,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/backend';

type AdvanceRequestNotificationRuleProps = {
  projects: any[];
  organizations: any[];
};

type NotificationChannels = {
  inApp: true;
  email: boolean;
  push: boolean;
};

type AdvanceRequestRule = {
  enabled: boolean;
  recipientIds: string[];
  channels: NotificationChannels;
};

type RecipientCandidate = {
  id: string;
  authUserId?: string | null;
  email?: string | null;
  name: string;
  roleName?: string | null;
};

type RuleResponse = {
  rule?: Partial<AdvanceRequestRule> & {
    channels?: Partial<NotificationChannels>;
  };
  candidates?: RecipientCandidate[];
  canManage?: boolean;
  error?: string;
};

const EMPTY_RULE: AdvanceRequestRule = {
  enabled: true,
  recipientIds: [],
  channels: {
    inApp: true,
    email: true,
    push: true,
  },
};
const MAX_RECIPIENTS = 25;

const normalizeText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const normalizeRule = (value?: RuleResponse['rule']): AdvanceRequestRule => ({
  enabled: value?.enabled !== false,
  recipientIds: Array.from(
    new Set(
      (Array.isArray(value?.recipientIds) ? value.recipientIds : [])
        .map((recipientId) => String(recipientId || '').trim())
        .filter(Boolean),
    ),
  ).sort(),
  channels: {
    inApp: true,
    email: value?.channels?.email !== false,
    push: value?.channels?.push !== false,
  },
});

const normalizeCandidates = (value: unknown): RecipientCandidate[] => {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, RecipientCandidate>();

  value.forEach((candidate) => {
    const id = String(candidate?.id || '').trim();
    if (!id || byId.has(id)) return;
    byId.set(id, {
      id,
      authUserId: candidate?.authUserId ? String(candidate.authUserId) : null,
      email: candidate?.email ? String(candidate.email) : null,
      name: String(candidate?.name || candidate?.email || 'Usuario'),
      roleName: candidate?.roleName ? String(candidate.roleName) : null,
    });
  });

  return Array.from(byId.values()).sort((left, right) =>
    left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }),
  );
};

const comparableRule = (rule: AdvanceRequestRule) => ({
  ...rule,
  recipientIds: [...rule.recipientIds].sort(),
});

const getApiUrl = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/alerts/advance-request`;

const getOrganizationLabel = (project: any, organizations: any[]) => {
  const organizationIds = [project?.organizationId, ...(Array.isArray(project?.organizationIds) ? project.organizationIds : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const organization = organizations.find((candidate) => organizationIds.includes(String(candidate?.id || '')));
  return organization?.name || organization?.displayName || project?.organizationName || 'Sin organización';
};

export function AdvanceRequestNotificationRule({
  projects,
  organizations,
}: AdvanceRequestNotificationRuleProps) {
  const searchInputId = useId();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [savedRule, setSavedRule] = useState<AdvanceRequestRule>(EMPTY_RULE);
  const [draftRule, setDraftRule] = useState<AdvanceRequestRule>(EMPTY_RULE);
  const [candidates, setCandidates] = useState<RecipientCandidate[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const availableProjects = useMemo(
    () => projects
      .filter((project) => String(project?.id || '').trim())
      .map((project) => ({ ...project, id: String(project.id) }))
      .slice()
      .sort((left, right) =>
        String(left?.name || left?.title || '').localeCompare(
          String(right?.name || right?.title || ''),
          'es',
          { sensitivity: 'base' },
        ),
      ),
    [projects],
  );

  useEffect(() => {
    if (availableProjects.length === 0) {
      setSelectedProjectId('');
      return;
    }
    if (!availableProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(availableProjects[0].id);
    }
  }, [availableProjects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;

    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    setSearch('');
    setCandidates([]);
    setCanManage(false);

    const loadRule = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Tu sesión expiró. Inicia sesión nuevamente para consultar esta regla.');

        const response = await fetch(getApiUrl(selectedProjectId), {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as RuleResponse;
        if (!response.ok) throw new Error(body.error || 'No fue posible cargar la configuración.');
        if (!active) return;

        const nextRule = normalizeRule(body.rule);
        setSavedRule(nextRule);
        setDraftRule(nextRule);
        setCandidates(normalizeCandidates(body.candidates));
        setCanManage(body.canManage === true);
      } catch (requestError) {
        if (!active || controller.signal.aborted) return;
        setCandidates([]);
        setCanManage(false);
        setError(requestError instanceof Error ? requestError.message : 'No fue posible cargar la configuración.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadRule();
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey, selectedProjectId]);

  const selectedProject = useMemo(
    () => availableProjects.find((project) => project.id === selectedProjectId) || null,
    [availableProjects, selectedProjectId],
  );
  const candidateById = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate])),
    [candidates],
  );
  const filteredCandidates = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    if (!normalizedSearch) return candidates;
    return candidates.filter((candidate) =>
      normalizeText([candidate.name, candidate.email, candidate.roleName].filter(Boolean).join(' ')).includes(normalizedSearch),
    );
  }, [candidates, search]);
  const missingSelectedIds = useMemo(
    () => draftRule.recipientIds.filter((recipientId) => !candidateById.has(recipientId)),
    [candidateById, draftRule.recipientIds],
  );
  const ruleDirty = useMemo(
    () => JSON.stringify(comparableRule(draftRule)) !== JSON.stringify(comparableRule(savedRule)),
    [draftRule, savedRule],
  );

  const toggleRecipient = (recipientId: string) => {
    if (!canManage || loading || saving) return;
    if (!draftRule.recipientIds.includes(recipientId) && draftRule.recipientIds.length >= MAX_RECIPIENTS) {
      toast.error(`Puedes seleccionar hasta ${MAX_RECIPIENTS} personas.`);
      return;
    }
    setDraftRule((current) => ({
      ...current,
      recipientIds: current.recipientIds.includes(recipientId)
        ? current.recipientIds.filter((id) => id !== recipientId)
        : [...current.recipientIds, recipientId].sort(),
    }));
  };

  const handleSave = async () => {
    if (!selectedProjectId || !canManage || !ruleDirty || saving) return;
    setSaving(true);
    setError('');

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Tu sesión expiró. Inicia sesión nuevamente para guardar esta regla.');

      const response = await fetch(getApiUrl(selectedProjectId), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: draftRule.enabled,
          recipientIds: draftRule.recipientIds,
          channels: {
            email: draftRule.channels.email,
            push: draftRule.channels.push,
          },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as RuleResponse;
      if (!response.ok) throw new Error(body.error || 'No fue posible guardar la configuración.');

      const nextRule = body.rule ? normalizeRule(body.rule) : normalizeRule(draftRule);
      setSavedRule(nextRule);
      setDraftRule(nextRule);
      if (Array.isArray(body.candidates)) setCandidates(normalizeCandidates(body.candidates));
      if (typeof body.canManage === 'boolean') setCanManage(body.canManage);
      toast.success('Notificaciones de solicitudes de anticipo actualizadas.');
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'No fue posible guardar la configuración.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (availableProjects.length === 0) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="flex min-h-44 flex-col items-center justify-center gap-2 p-6 text-center">
          <BellRing className="h-8 w-8 text-slate-300" aria-hidden="true" />
          <p className="font-black text-slate-800">No hay proyectos disponibles</p>
          <p className="max-w-xl text-sm text-slate-500">
            Cuando tengas acceso a un proyecto podrás definir quién recibe avisos adicionales por solicitudes de anticipo.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-cyan-200 bg-white shadow-md">
      <CardHeader className="border-b border-cyan-100 bg-gradient-to-r from-cyan-50 via-white to-indigo-50">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] text-cyan-800">
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Regla predefinida
              </span>
              {!loading && !error && (
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] ${
                  savedRule.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                }`}>
                  {savedRule.enabled ? 'Activa' : 'Apagada'}
                </span>
              )}
              {!loading && !error && !canManage && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] text-slate-600">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  Solo consulta
                </span>
              )}
            </div>
            <CardTitle className="mt-3 flex items-center gap-2 text-xl text-slate-950">
              <BellRing className="h-5 w-5 text-cyan-700" aria-hidden="true" />
              Solicitud de anticipo
            </CardTitle>
            <CardDescription className="mt-1 max-w-3xl leading-6 text-slate-600">
              Avisa a las personas seleccionadas cuando alguien radica un anticipo. Estos destinatarios reciben información y no reemplazan al responsable de aprobarlo.
            </CardDescription>
          </div>

          <div className="w-full lg:w-80">
            <Label htmlFor="advance-alert-project" className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              Proyecto
            </Label>
            <Select value={selectedProjectId} onValueChange={(value) => setSelectedProjectId(value || '')} disabled={loading || saving}>
              <SelectTrigger id="advance-alert-project" className="mt-2 h-11 bg-white font-bold text-slate-800">
                <SelectValue placeholder="Selecciona un proyecto" />
              </SelectTrigger>
              <SelectContent>
                {availableProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name || project.title || 'Proyecto sin nombre'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProject && (
              <p className="mt-1.5 truncate text-xs font-semibold text-slate-500">
                {getOrganizationLabel(selectedProject, organizations)}
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5">
        {loading ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center" role="status" aria-live="polite">
            <Loader2 className="h-7 w-7 animate-spin text-cyan-600" aria-hidden="true" />
            <div>
              <p className="font-black text-slate-800">Cargando configuración</p>
              <p className="mt-1 text-sm text-slate-500">Consultando regla y personas con acceso al proyecto.</p>
            </div>
          </div>
        ) : error && candidates.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-rose-100 bg-rose-50 p-6 text-center" role="alert">
            <BellRing className="h-8 w-8 text-rose-400" aria-hidden="true" />
            <div>
              <p className="font-black text-rose-900">No pudimos cargar esta regla</p>
              <p className="mt-1 max-w-xl text-sm text-rose-700">{error}</p>
            </div>
            <Button type="button" variant="outline" onClick={() => setReloadKey((value) => value + 1)} className="border-rose-200 bg-white text-rose-700 hover:bg-rose-100">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700" role="alert">
                {error}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <div className={`rounded-2xl border p-4 ${draftRule.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-900">Regla activa</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Envía avisos en nuevas solicitudes.</p>
                  </div>
                  <Switch
                    aria-label="Activar notificaciones de solicitudes de anticipo"
                    checked={draftRule.enabled}
                    disabled={!canManage || saving}
                    onCheckedChange={(enabled) => setDraftRule((current) => ({ ...current, enabled }))}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Mail className="h-4 w-4 shrink-0 text-cyan-700" aria-hidden="true" />
                    <div>
                      <p className="font-black text-slate-900">Correo</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Resumen y acceso al anticipo.</p>
                    </div>
                  </div>
                  <Switch
                    aria-label="Enviar correo por solicitudes de anticipo"
                    checked={draftRule.channels.email}
                    disabled={!canManage || saving}
                    onCheckedChange={(email) => setDraftRule((current) => ({
                      ...current,
                      channels: { ...current.channels, email },
                    }))}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Smartphone className="h-4 w-4 shrink-0 text-violet-700" aria-hidden="true" />
                    <div>
                      <p className="font-black text-slate-900">Push móvil</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Aviso en dispositivos registrados.</p>
                    </div>
                  </div>
                  <Switch
                    aria-label="Enviar push por solicitudes de anticipo"
                    checked={draftRule.channels.push}
                    disabled={!canManage || saving}
                    onCheckedChange={(push) => setDraftRule((current) => ({
                      ...current,
                      channels: { ...current.channels, push },
                    }))}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                    <h3 className="font-black text-slate-950">Personas adicionales a notificar</h3>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {draftRule.recipientIds.length} persona{draftRule.recipientIds.length === 1 ? '' : 's'} seleccionada{draftRule.recipientIds.length === 1 ? '' : 's'}.
                  </p>
                </div>
                {canManage && draftRule.recipientIds.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => setDraftRule((current) => ({ ...current, recipientIds: [] }))}
                    className="text-slate-600 hover:text-rose-700"
                  >
                    Limpiar selección
                  </Button>
                )}
              </div>

              <div className="relative mt-4">
                <Label htmlFor={searchInputId} className="sr-only">Buscar persona para notificar</Label>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  id={searchInputId}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por nombre, correo o cargo..."
                  className="h-11 pl-10"
                  disabled={candidates.length === 0}
                />
              </div>

              {missingSelectedIds.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" role="status">
                  {missingSelectedIds.length} destinatario{missingSelectedIds.length === 1 ? '' : 's'} configurado{missingSelectedIds.length === 1 ? '' : 's'} ya no tiene{missingSelectedIds.length === 1 ? '' : 'n'} acceso válido. Se retirará{missingSelectedIds.length === 1 ? '' : 'n'} al guardar para proteger la entrega.
                </div>
              )}

              {candidates.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                  <Users className="mx-auto h-7 w-7 text-slate-300" aria-hidden="true" />
                  <p className="mt-2 font-black text-slate-700">No hay personas disponibles</p>
                  <p className="mt-1 text-sm text-slate-500">Asigna personas o acceso administrativo al proyecto para poder seleccionarlas.</p>
                </div>
              ) : filteredCandidates.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center" role="status">
                  <p className="font-black text-slate-700">No encontramos coincidencias</p>
                  <p className="mt-1 text-sm text-slate-500">Prueba con otro nombre, correo o cargo.</p>
                </div>
              ) : (
                <div className="mt-4 grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Destinatarios adicionales">
                  {filteredCandidates.map((candidate) => {
                    const selected = draftRule.recipientIds.includes(candidate.id);
                    const inputId = `${searchInputId}-${candidate.id}`;
                    const limitReached = !selected && draftRule.recipientIds.length >= MAX_RECIPIENTS;
                    return (
                      <label
                        key={candidate.id}
                        htmlFor={inputId}
                        className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 transition-colors ${
                          canManage ? 'cursor-pointer' : 'cursor-default'
                        } ${
                          selected
                            ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-100'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={selected}
                          disabled={!canManage || saving || limitReached}
                          onChange={() => toggleRecipient(candidate.id)}
                          className="sr-only"
                        />
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                          selected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                        }`} aria-hidden="true">
                          {selected ? <Check className="h-4 w-4" /> : candidate.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black text-slate-900">{candidate.name}</span>
                          <span className="block truncate text-xs font-semibold text-slate-500">
                            {[candidate.roleName, candidate.email].filter(Boolean).join(' · ') || 'Acceso al proyecto'}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1.5 text-xs font-semibold leading-5 text-slate-500">
                <div className="flex items-start gap-2">
                  <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600" aria-hidden="true" />
                  <span>La alerta dentro de Pixel permanece activa; correo y push se envían según los canales elegidos para este proyecto.</span>
                </div>
              </div>
              {canManage ? (
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!ruleDirty || saving}
                    onClick={() => {
                      setDraftRule(savedRule);
                      setSearch('');
                      setError('');
                    }}
                  >
                    Descartar
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!ruleDirty || saving}
                    className="min-w-36 bg-cyan-700 font-black text-white hover:bg-cyan-800"
                  >
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
                    {saving ? 'Guardando...' : 'Guardar cambios'}
                  </Button>
                </div>
              ) : (
                <p className="shrink-0 text-xs font-bold text-slate-500">
                  Puedes consultar la regla, pero no modificarla.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
