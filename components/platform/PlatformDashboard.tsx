'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDownRight, Building2, ChevronLeft, ChevronRight, Clock3, Edit3, History, Layers3, Loader2, RefreshCw, Search, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlatformList, PlatformOrganization, PlatformUser, PlatformView, PlatformWorkspace, PlatformWorkspaceDetail } from '@/lib/platform/types';
import { PlatformEditor, type PlatformEditTarget } from './PlatformEditor';
import { displayDate, fieldClass, platformRequest, roleLabel } from './platform-client';

const views: { id: PlatformView; label: string; icon: typeof Layers3 }[] = [
  { id: 'workspaces', label: 'Espacios', icon: Layers3 },
  { id: 'organizations', label: 'Organizaciones', icon: Building2 },
  { id: 'users', label: 'Usuarios', icon: Users },
];

const number = (value: number | undefined) => value === undefined ? '—' : new Intl.NumberFormat('es-CO').format(value);

function WorkspaceStatus({ workspace }: { workspace: PlatformWorkspace }) {
  const expired = workspace.status === 'trial' && (!workspace.trial_ends_at || new Date(workspace.trial_ends_at).getTime() <= Date.now());
  const label = workspace.status === 'suspended' ? 'Suspendido' : workspace.status === 'active' ? 'Activo' : expired ? 'Prueba vencida' : 'Prueba gratuita';
  const colors = workspace.status === 'suspended' ? 'bg-rose-50 text-rose-800 ring-rose-200' : workspace.status === 'active' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : expired ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-blue-50 text-blue-800 ring-blue-200';
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${colors}`}>{label}</span>;
}

function UserStatus({ user }: { user: PlatformUser }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${user.suspended_at ? 'bg-rose-50 text-rose-800' : user.email_confirmed_at ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{user.suspended_at ? 'Suspendido' : user.email_confirmed_at ? 'Correo confirmado' : user.invited_at ? 'Invitación pendiente' : 'Por confirmar'}</span>;
}

const auditLabels: Record<string, string> = {
  'workspace.update': 'Espacio actualizado',
  'workspace.updated': 'Espacio actualizado',
  'workspace_update': 'Espacio actualizado',
  'organization.update': 'Organización actualizada',
  'organization.updated': 'Organización actualizada',
  'organization_update': 'Organización actualizada',
  'user.update': 'Usuario actualizado',
  'user.updated': 'Usuario actualizado',
  'user_update': 'Usuario actualizado',
  'user.invite': 'Usuario invitado',
  'user.invited': 'Usuario invitado',
  'user_invite': 'Usuario invitado',
  'user.recovery': 'Recuperación de acceso',
  'user.access': 'Asistencia de acceso',
  'user_access': 'Asistencia de acceso',
  'access.invite': 'Invitación reenviada',
  'access.recovery': 'Recuperación de acceso',
  'user.invite.request': 'Creación de usuario iniciada',
  'user.invite.complete': 'Usuario creado e invitado',
};

export function PlatformDashboard({ currentUserId, currentWorkspaceId }: { currentUserId: string; currentWorkspaceId: string }) {
  const [view, setView] = useState<PlatformView>('workspaces');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [workspaceFilter, setWorkspaceFilter] = useState<{ id: string; name: string } | null>(null);
  const [result, setResult] = useState<PlatformList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformWorkspaceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [editor, setEditor] = useState<PlatformEditTarget | null>(null);
  const [openingUser, setOpeningUser] = useState<string | null>(null);
  const detailSection = useRef<HTMLElement>(null);
  const directorySection = useRef<HTMLElement>(null);
  const openRequest = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const parameters = new URLSearchParams({ view, page: String(page), query });
    if (workspaceFilter) parameters.set('workspaceId', workspaceFilter.id);
    platformRequest<PlatformList>(`/api/platform?${parameters}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((caught) => { if (!controller.signal.aborted) { setResult(null); setError(caught instanceof Error ? caught.message : 'No pudimos cargar el panel.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, page, query, revision, workspaceFilter]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetail(null);
    setDetailError('');
    platformRequest<PlatformWorkspaceDetail>(`/api/platform/workspaces/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setDetail(data); })
      .catch((caught) => { if (!controller.signal.aborted) setDetailError(caught instanceof Error ? caught.message : 'No pudimos cargar este espacio.'); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, revision]);

  useEffect(() => () => { openRequest.current += 1; }, []);

  const selectWorkspace = (id: string) => {
    setSelectedId(id);
    window.requestAnimationFrame(() => detailSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const editUser = useCallback(async (user: PlatformUser, existingDetail?: PlatformWorkspaceDetail) => {
    const request = ++openRequest.current;
    setOpeningUser(user.id);
    try {
      const data = existingDetail || (user.workspace_id ? await platformRequest<PlatformWorkspaceDetail>(`/api/platform/workspaces/${encodeURIComponent(user.workspace_id)}`) : null);
      if (openRequest.current === request) setEditor({ kind: 'user', user, detail: data });
    } catch (caught) {
      if (openRequest.current === request) setError(caught instanceof Error ? caught.message : 'No pudimos cargar el usuario.');
    } finally {
      if (openRequest.current === request) setOpeningUser(null);
    }
  }, []);

  const editOrganization = async (organization: PlatformOrganization) => {
    const request = ++openRequest.current;
    setOpeningUser(organization.id);
    try {
      const data = await platformRequest<PlatformWorkspaceDetail>(`/api/platform/workspaces/${encodeURIComponent(organization.workspace_id)}`);
      if (openRequest.current === request) setEditor({ kind: 'organization', detail: data, organization });
    } catch (caught) {
      if (openRequest.current === request) setError(caught instanceof Error ? caught.message : 'No pudimos cargar la organización.');
    } finally {
      if (openRequest.current === request) setOpeningUser(null);
    }
  };

  const summary = result?.summary;
  const totalPages = Math.max(1, Math.ceil((result?.total || 0) / (result?.pageSize || 20)));
  const selectedView = views.find((item) => item.id === view)!;

  return (
    <main className="mx-auto max-w-7xl space-y-7 pb-12">
      <section className="relative overflow-hidden rounded-3xl bg-[#123d32] px-6 py-8 text-white sm:px-8">
        <div className="pointer-events-none absolute -right-12 -top-16 h-64 w-64 rounded-full border-[36px] border-white/5" aria-hidden="true" />
        <div className="relative flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-2xl"><div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200"><ShieldCheck className="h-4 w-4" />Administración global</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Cada espacio, acompañado.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-emerald-50/80">Una vista de toda la comunidad de Pixel para gestionar cuentas, organizaciones y pruebas, y resolver solicitudes de soporte.</p></div>
          <div className="flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs text-emerald-50"><span className="h-2 w-2 rounded-full bg-[#f0ad8e]" />Acceso exclusivo del administrador</div>
        </div>
      </section>

      <section aria-label="Resumen de la plataforma" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Espacios de trabajo', value: summary?.workspaces, note: `${number(summary?.activeWorkspaces)} activos`, icon: Layers3 },
          { label: 'Usuarios registrados', value: summary?.users, note: 'Todas las cuentas', icon: Users },
          { label: 'Organizaciones', value: summary?.organizations, note: 'Dentro de sus espacios', icon: Building2 },
          { label: 'En prueba gratuita', value: summary?.trialWorkspaces, note: `${number(summary?.suspendedWorkspaces)} espacios suspendidos`, icon: Clock3 },
        ].map((item) => <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div className="mb-4 flex items-center justify-between gap-2"><p className="text-xs font-medium text-slate-500 sm:text-sm">{item.label}</p><item.icon className="h-4 w-4 shrink-0 text-emerald-800" /></div><p className="text-3xl font-semibold tracking-tight text-slate-900">{number(item.value)}</p><p className="mt-2 text-xs text-slate-500">{item.note}</p></article>)}
      </section>

      <section ref={directorySection} className="scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Directorio global">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 p-4 sm:p-5 lg:flex-row lg:items-center">
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" aria-label="Tipo de registro">
            {views.map((item) => <button type="button" key={item.id} aria-pressed={view === item.id} onClick={() => { setView(item.id); setPage(1); }} className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${view === item.id ? 'bg-white text-emerald-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}><item.icon className="h-4 w-4" />{item.label}</button>)}
          </div>
          <div className="flex items-center gap-2"><label className="relative block w-full lg:w-72"><span className="sr-only">Buscar {selectedView.label.toLowerCase()}</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input type="search" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === 'users' ? 'Buscar por nombre o correo…' : 'Buscar por nombre…'} className={`${fieldClass} pl-9`} /></label><Button type="button" variant="outline" size="icon" disabled={loading} onClick={() => setRevision((current) => current + 1)} aria-label="Actualizar directorio"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button></div>
        </div>

        {workspaceFilter && <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-emerald-50/60 px-5 py-3 text-sm text-emerald-900"><span>Espacio: <strong>{workspaceFilter.name}</strong></span><button type="button" onClick={() => { setWorkspaceFilter(null); setPage(1); }} className="flex items-center gap-1 text-xs font-medium">Ver todos<X className="h-3 w-3" /></button></div>}
        {error && <div role="alert" className="m-5 flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-800"><AlertCircle className="h-5 w-5 shrink-0" /><div><p>{error}</p><button type="button" className="mt-2 font-semibold underline" onClick={() => setRevision((current) => current + 1)}>Reintentar</button></div></div>}
        {loading ? <div role="status" className="flex min-h-64 items-center justify-center gap-3 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Cargando {selectedView.label.toLowerCase()}…</div> : !error && !result?.rows.length ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center"><Search className="h-8 w-8 text-slate-300" /><h2 className="font-semibold text-slate-800">{query ? 'No hay coincidencias' : 'Todavía no hay registros'}</h2><p className="text-sm text-slate-500">{query ? 'Prueba con otro nombre o correo.' : 'Los registros aparecerán aquí cuando lleguen nuevos usuarios.'}</p></div> : !error && <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Directorio de {selectedView.label.toLowerCase()} de Pixel</caption>
            <thead className="border-b border-slate-100 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500"><tr>{(view === 'workspaces' ? ['Espacio / propietario', 'Estado', 'Usuarios', 'Organizaciones', 'Fin de prueba', ''] : view === 'users' ? ['Usuario', 'Espacio', 'Rol', 'Acceso', ''] : ['Organización', 'Espacio de trabajo', 'Usuarios', '']).map((heading, index) => <th scope="col" key={heading || index} className="px-5 py-3.5 font-medium">{heading || <span className="sr-only">Acciones</span>}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {view === 'workspaces' && (result?.rows as PlatformWorkspace[]).map((item) => <tr key={item.id} className="hover:bg-slate-50/70"><td className="max-w-xs px-5 py-4"><p className="break-words font-semibold text-slate-900">{item.name}</p><p className="mt-1 break-all text-xs text-slate-500">{item.owner_email || 'Propietario sin correo'}</p></td><td className="px-5 py-4"><WorkspaceStatus workspace={item} /></td><td className="px-5 py-4 text-slate-600">{number(item.member_count)}</td><td className="px-5 py-4 text-slate-600">{number(item.organization_count)}</td><td className="px-5 py-4 text-xs text-slate-600">{item.status === 'active' ? 'Sin vencimiento' : displayDate(item.trial_ends_at)}</td><td className="px-5 py-4 text-right"><Button type="button" variant="ghost" size="sm" onClick={() => selectWorkspace(item.id)} className="text-emerald-800">Ver espacio<ArrowDownRight className="ml-2 h-4 w-4" /></Button></td></tr>)}
              {view === 'users' && (result?.rows as PlatformUser[]).map((item) => <tr key={item.id} className="hover:bg-slate-50/70"><td className="max-w-xs px-5 py-4"><p className="break-words font-semibold text-slate-900">{item.displayName || 'Nombre pendiente'}</p><p className="mt-1 break-all text-xs text-slate-500">{item.email || 'Sin correo'}</p></td><td className="max-w-[200px] px-5 py-4 text-slate-600">{item.workspace_id ? <button type="button" onClick={() => selectWorkspace(item.workspace_id!)} className="text-left text-emerald-800 hover:underline">{item.workspace_name || 'Ver espacio'}</button> : <span className="text-xs text-slate-400">Por crear</span>}</td><td className="px-5 py-4 text-xs text-slate-600">{item.membership_role === 'owner' ? 'Propietario' : roleLabel(item.systemRole)}</td><td className="px-5 py-4"><UserStatus user={item} /></td><td className="px-5 py-4 text-right"><Button type="button" variant="ghost" size="sm" disabled={Boolean(openingUser)} onClick={() => void editUser(item)} className="text-emerald-800">{openingUser === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Edit3 className="mr-2 h-4 w-4" />}Administrar</Button></td></tr>)}
              {view === 'organizations' && (result?.rows as PlatformOrganization[]).map((item) => <tr key={`${item.workspace_id}:${item.id}`} className="hover:bg-slate-50/70"><td className="max-w-xs px-5 py-4 font-semibold text-slate-900">{item.name}</td><td className="px-5 py-4"><button type="button" onClick={() => selectWorkspace(item.workspace_id)} className="text-left text-emerald-800 hover:underline">{item.workspace_name}</button></td><td className="px-5 py-4 text-slate-600">{number(item.member_count)}</td><td className="px-5 py-4 text-right"><Button type="button" variant="ghost" size="sm" disabled={Boolean(openingUser)} onClick={() => void editOrganization(item)} className="text-emerald-800">{openingUser === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Edit3 className="mr-2 h-4 w-4" />}Editar</Button></td></tr>)}
            </tbody>
          </table>
        </div>}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500"><p role="status">{number(result?.total)} registros{query ? ' encontrados' : ''}</p><div className="flex items-center gap-3"><Button type="button" size="icon" variant="outline" aria-label="Página anterior" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="h-4 w-4" /></Button><span>Página {page} de {totalPages}</span><Button type="button" size="icon" variant="outline" aria-label="Página siguiente" disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)}><ChevronRight className="h-4 w-4" /></Button></div></footer>
      </section>

      {selectedId && <section ref={detailSection} className="scroll-mt-6 overflow-hidden rounded-3xl border border-emerald-900/15 bg-white" aria-label="Detalle del espacio">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 bg-[#f4f7f3] p-6"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-emerald-800">Ficha de soporte</p><h2 className="text-2xl font-semibold tracking-tight text-slate-900">{detail?.workspace.name || 'Espacio de trabajo'}</h2>{detail && <p className="mt-2 text-sm text-slate-500">Creado el {displayDate(detail.workspace.created_at)} · {detail.workspace.owner_email}</p>}</div><Button type="button" variant="ghost" size="icon" aria-label="Cerrar detalle" onClick={() => setSelectedId(null)}><X className="h-5 w-5" /></Button></header>
        {detailLoading ? <div role="status" className="flex min-h-60 items-center justify-center gap-3 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Abriendo el espacio…</div> : detailError ? <div className="p-6 text-sm text-red-800" role="alert">{detailError}<button type="button" onClick={() => setRevision((current) => current + 1)} className="ml-3 font-semibold underline">Reintentar</button></div> : detail && <div className="space-y-7 p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div className="flex flex-wrap items-center gap-3"><WorkspaceStatus workspace={detail.workspace} /><span className="text-xs text-slate-500">{detail.workspace.status === 'active' ? 'Acceso sin vencimiento' : `Fin de prueba: ${displayDate(detail.workspace.trial_ends_at)}`}</span></div><div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" onClick={() => { setWorkspaceFilter({ id: detail.workspace.id, name: detail.workspace.name }); setView('users'); setPage(1); setSearch(''); setQuery(''); directorySection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Ver todos los usuarios</Button><Button type="button" variant="outline" onClick={() => setEditor({ kind: 'workspace', detail })}><Edit3 className="mr-2 h-4 w-4" />Administrar espacio</Button></div></div>
          <div className="grid gap-7 lg:grid-cols-[1.3fr_1fr]">
            <div className="space-y-7">
              <section>{detail.workspace.member_count > detail.users.length && <p className="mb-3 text-xs text-slate-500">Vista de los primeros {detail.users.length} usuarios. Abre «Ver todos los usuarios» para consultar el directorio completo.</p>}<div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold text-slate-900"><Users className="h-4 w-4 text-emerald-800" />Usuarios del espacio <span className="text-sm font-normal text-slate-400">({detail.workspace.member_count})</span></h3><Button type="button" size="sm" className="bg-emerald-950 hover:bg-emerald-900" disabled={detail.workspace.status === 'suspended'} onClick={() => setEditor({ kind: 'invite', detail })}><UserPlus className="mr-2 h-4 w-4" />Crear / invitar</Button></div><div className="divide-y divide-slate-100 rounded-xl border border-slate-200">{detail.users.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="break-words text-sm font-semibold text-slate-800">{item.displayName || 'Nombre pendiente'}{item.membership_role === 'owner' && <span className="ml-2 text-xs font-normal text-emerald-800">Propietario</span>}</p><p className="mt-1 break-all text-xs text-slate-500">{item.email}</p><div className="mt-2"><UserStatus user={item} /></div></div><Button type="button" variant="ghost" size="icon" aria-label={`Administrar a ${item.displayName || item.email}`} onClick={() => void editUser(item, detail)}><Edit3 className="h-4 w-4 text-emerald-800" /></Button></div>)}{!detail.users.length && <p className="p-4 text-sm text-slate-500">No hay usuarios asignados.</p>}</div></section>
              <section><h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900"><Building2 className="h-4 w-4 text-emerald-800" />Organizaciones</h3><div className="divide-y divide-slate-100 rounded-xl border border-slate-200">{detail.organizations.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 p-4"><p className="text-sm font-medium text-slate-800">{item.name}</p><Button type="button" variant="ghost" size="icon" aria-label={`Editar ${item.name}`} onClick={() => setEditor({ kind: 'organization', detail, organization: item })}><Edit3 className="h-4 w-4 text-emerald-800" /></Button></div>)}{!detail.organizations.length && <p className="p-4 text-sm text-slate-500">No hay organizaciones creadas.</p>}</div></section>
            </div>
            <section><h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900"><History className="h-4 w-4 text-emerald-800" />Historial de soporte</h3><div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">{detail.audit.length ? <ol className="space-y-5">{detail.audit.map((item) => <li key={item.id} className="border-l-2 border-emerald-200 pl-4"><p className="text-sm font-semibold text-slate-800">{auditLabels[item.action] || 'Intervención de soporte'}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{item.reason}</p><p className="mt-2 break-all text-xs leading-5 text-slate-400">{item.actor_email || 'Administrador'}<br />{displayDate(item.created_at, true)}</p></li>)}</ol> : <div className="py-5 text-center"><ShieldCheck className="mx-auto mb-3 h-8 w-8 text-slate-300" /><p className="text-sm font-medium text-slate-600">Sin intervenciones registradas</p><p className="mt-2 text-xs leading-5 text-slate-400">Cada cambio de soporte guardará el motivo, la fecha y la persona responsable.</p></div>}</div></section>
          </div>
        </div>}
      </section>}
      <p className="flex items-start gap-2 px-1 text-xs leading-5 text-slate-400"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />La información de este panel es de uso exclusivo para administración y soporte de Pixel.</p>
      {editor && <PlatformEditor target={editor} currentUserId={currentUserId} currentWorkspaceId={currentWorkspaceId} onClose={() => setEditor(null)} onSaved={() => setRevision((current) => current + 1)} />}
    </main>
  );
}
