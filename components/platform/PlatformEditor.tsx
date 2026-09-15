'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Copy, Loader2, Mail, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlatformAccessResult, PlatformUser, PlatformWorkspaceDetail } from '@/lib/platform/types';
import { displayDate, fieldClass, platformRequest, platformRoles } from './platform-client';

export type PlatformEditTarget =
  | { kind: 'workspace'; detail: PlatformWorkspaceDetail }
  | { kind: 'organization'; detail: PlatformWorkspaceDetail; organization: { id: string; name: string } }
  | { kind: 'user'; detail: PlatformWorkspaceDetail | null; user: PlatformUser }
  | { kind: 'invite'; detail: PlatformWorkspaceDetail };

export function PlatformEditor({ target, currentUserId, currentWorkspaceId, onClose, onSaved }: {
  target: PlatformEditTarget;
  currentUserId: string;
  currentWorkspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const detail = target.detail;
  const editingUser = target.kind === 'user' ? target.user : null;
  const self = editingUser?.id === currentUserId;
  const owner = editingUser?.membership_role === 'owner';
  const protectedWorkspace = detail?.workspace.id === currentWorkspaceId || detail?.workspace.legacy_storage === true;
  const [name, setName] = useState(target.kind === 'workspace' ? target.detail.workspace.name : target.kind === 'organization' ? target.organization.name : editingUser?.displayName || '');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState(detail?.workspace.status || 'trial');
  const [trialEnd, setTrialEnd] = useState(detail?.workspace.trial_ends_at?.slice(0, 10) || '');
  const [role, setRole] = useState(editingUser?.systemRole || 'user');
  const [organizations, setOrganizations] = useState<string[]>(editingUser?.organizationIds || (detail?.organizations.some((item) => item.id === detail.workspace.id) ? [detail.workspace.id] : detail?.organizations.slice(0, 1).map((item) => item.id) || []));
  const [suspended, setSuspended] = useState(Boolean(editingUser?.suspended_at));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PlatformAccessResult | null>(null);
  const [copied, setCopied] = useState(false);
  const canSave = target.kind !== 'user' || Boolean(detail);
  const title = target.kind === 'workspace' ? 'Administrar espacio' : target.kind === 'organization' ? 'Editar organización' : target.kind === 'invite' ? 'Crear e invitar usuario' : 'Administrar usuario';

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const requireReason = () => {
    if (reason.trim().length < 10) throw new Error('Describe el motivo con al menos 10 caracteres.');
    return reason.trim();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const auditReason = requireReason();
      if (target.kind === 'workspace') {
        await platformRequest(`/api/platform/workspaces/${encodeURIComponent(target.detail.workspace.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim(), status, ...(trialEnd !== (target.detail.workspace.trial_ends_at?.slice(0, 10) || '') ? { trialEndsAt: trialEnd ? new Date(`${trialEnd}T23:59:59-05:00`).toISOString() : null } : {}), reason: auditReason }),
        });
      } else if (target.kind === 'organization') {
        await platformRequest(`/api/platform/organizations/${encodeURIComponent(target.organization.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ workspaceId: target.detail.workspace.id, name: name.trim(), reason: auditReason }),
        });
      } else if (target.kind === 'user') {
        await platformRequest(`/api/platform/users/${encodeURIComponent(target.user.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ displayName: name.trim(), systemRole: role, organizationIds: organizations, ...(!self ? { suspended } : {}), reason: auditReason }),
        });
      } else {
        const response = await platformRequest<PlatformAccessResult>(`/api/platform/workspaces/${encodeURIComponent(target.detail.workspace.id)}/users`, {
          method: 'POST',
          body: JSON.stringify({ email: email.trim(), displayName: name.trim(), systemRole: role, organizationIds: organizations, reason: auditReason }),
        });
        setResult(response);
        onSaved();
        return;
      }
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos guardar los cambios.');
    } finally {
      setBusy(false);
    }
  };

  const sendAccess = async () => {
    if (!editingUser || busy) return;
    setError('');
    setBusy(true);
    try {
      const response = await platformRequest<PlatformAccessResult>(`/api/platform/users/${encodeURIComponent(editingUser.id)}/access`, {
        method: 'POST',
        body: JSON.stringify({ mode: editingUser.email_confirmed_at ? 'recovery' : 'invite', reason: requireReason() }),
      });
      setResult(response);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos preparar el acceso.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50">
      <form onSubmit={save}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
          <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-800"><ShieldCheck className="h-4 w-4" />Soporte Pixel</div><h2 id={titleId} className="text-xl font-semibold">{title}</h2><p className="mt-1 break-words text-sm text-slate-500">{detail?.workspace.name || editingUser?.email || 'Registro pendiente'}</p></div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={busy} aria-label="Cerrar edición"><X className="h-5 w-5" /></Button>
        </header>
        <div className="space-y-5 p-6">
          {result ? (
            <div className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5" role="status">
              <CheckCircle2 className="h-7 w-7 text-emerald-700" />
              <h3 className="font-semibold">{result.delivery === 'email' ? 'Correo enviado' : 'Enlace listo para compartir'}</h3>
              <p className="text-sm leading-6 text-emerald-950">{result.message}</p>
              {result.delivery === 'manual' && result.actionLink && <>
                <p className="text-xs leading-5 text-slate-600">El correo no se envió automáticamente. Comparte este enlace únicamente con la persona titular de la cuenta.</p>
                <label className="block text-xs font-medium">Enlace de acceso<input readOnly value={result.actionLink} className={`${fieldClass} mt-2`} onFocus={(event) => event.target.select()} /></label>
                <Button type="button" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(result.actionLink!); setCopied(true); } catch { setError('No pudimos copiar. Selecciona y copia el enlace de arriba.'); } }}><Copy className="mr-2 h-4 w-4" />{copied ? 'Copiado' : 'Copiar enlace'}</Button>
              </>}
            </div>
          ) : <>
            {editingUser && <div className="rounded-xl bg-slate-50 p-4 text-sm"><p className="break-all font-medium">{editingUser.email || 'Sin correo'}</p><p className="mt-1 text-xs text-slate-500">Último acceso: {displayDate(editingUser.last_sign_in_at, true)}</p>{owner && <p className="mt-2 text-xs font-medium text-emerald-800">Propietario del espacio. Su acceso de administrador se conserva.</p>}</div>}
            {canSave ? <>
              <label className="block text-sm font-medium">{target.kind === 'user' || target.kind === 'invite' ? 'Nombre completo' : 'Nombre'}<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className={`${fieldClass} mt-2`} /></label>
              {target.kind === 'invite' && <label className="block text-sm font-medium">Correo electrónico<input required type="email" maxLength={254} autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} className={`${fieldClass} mt-2`} /></label>}
              {target.kind === 'workspace' && <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Estado<select value={status} disabled={protectedWorkspace} onChange={(event) => setStatus(event.target.value as typeof status)} className={`${fieldClass} mt-2`}><option value="trial">En exploración</option><option value="active">Activo</option><option value="suspended" disabled={protectedWorkspace}>Suspendido</option></select>{protectedWorkspace && <span className="mt-1 block text-xs font-normal text-slate-500">El espacio del administrador global conserva su acceso.</span>}</label><label className="block text-sm font-medium">Fin de la prueba<input type="date" disabled={protectedWorkspace} required={status === 'trial'} value={trialEnd} onChange={(event) => setTrialEnd(event.target.value)} className={`${fieldClass} mt-2`} /><span className="mt-1 block text-xs font-normal text-slate-500">Hasta las 23:59, hora de Colombia.</span></label></div>}
              {(target.kind === 'user' || target.kind === 'invite') && <>
                <label className="block text-sm font-medium">Rol dentro del espacio<select value={role} disabled={owner || self} onChange={(event) => setRole(event.target.value)} className={`${fieldClass} mt-2`}>{platformRoles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <fieldset><legend className="mb-2 text-sm font-medium">Organizaciones del usuario</legend><div className="max-h-36 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">{detail?.organizations.map((organization) => <label key={organization.id} className="flex cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={organizations.includes(organization.id)} disabled={self || organization.id === detail?.workspace.id} onChange={(event) => setOrganizations((current) => event.target.checked ? [...current, organization.id] : current.filter((id) => id !== organization.id))} className="h-4 w-4 accent-emerald-800" />{organization.name}{organization.id === detail?.workspace.id && <span className="text-xs text-slate-400">Principal</span>}</label>)}{!detail?.organizations.length && <p className="text-sm text-slate-500">Este espacio todavía no tiene organizaciones.</p>}</div></fieldset>
                {editingUser && !self && <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><input type="checkbox" checked={suspended} onChange={(event) => setSuspended(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-700" /><span><strong className="block font-medium">Suspender acceso</strong><span className="mt-1 block text-xs leading-5 text-slate-600">Impide que esta persona use el espacio hasta que reactives su acceso.</span></span></label>}
              </>}
            </> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">Esta persona aún no tiene un espacio asignado. Debe confirmar su correo y completar su primer ingreso.</div>}
            {(canSave || editingUser?.email_confirmed_at || editingUser?.invited_at) && <label className="block text-sm font-medium">Motivo de la intervención<textarea required minLength={10} maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. El usuario solicitó ampliar su prueba mientras resolvemos su acceso." className={`${fieldClass} mt-2 resize-y`} /><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">El cambio y tu identidad quedarán en el historial de soporte.</span></label>}
            {editingUser && (editingUser.email_confirmed_at || editingUser.invited_at) && <div className="border-t border-slate-100 pt-4"><Button type="button" variant="outline" className="w-full" disabled={busy || reason.trim().length < 10 || Boolean(editingUser.suspended_at)} onClick={sendAccess}><Mail className="mr-2 h-4 w-4" />{editingUser.email_confirmed_at ? 'Enviar recuperación de acceso' : 'Reenviar invitación'}</Button><p className="mt-2 text-xs leading-5 text-slate-500">La persona establecerá su propia contraseña desde el enlace.</p></div>}
          </>}
          {error && <div role="alert" className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm leading-5 text-red-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        </div>
        <footer className="flex flex-wrap justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>{result ? 'Listo' : 'Cancelar'}</Button>{!result && canSave && <Button type="submit" disabled={busy || reason.trim().length < 10 || ((target.kind === 'user' || target.kind === 'invite') && !organizations.length)} className="bg-emerald-950 hover:bg-emerald-900">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{target.kind === 'invite' ? 'Crear e invitar' : 'Guardar cambios'}</Button>}</footer>
      </form>
    </dialog>
  );
}
