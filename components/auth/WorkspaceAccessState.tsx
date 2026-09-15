"use client"

import Link from 'next/link';
import { ArrowLeft, Building2, Clock3, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export function WorkspaceAccessState() {
  const { workspace, workspaceExpired, loading, accessError, retryWorkspace, logout } = useAuth();
  const expired = workspaceExpired && !loading;
  const opening = Boolean(workspace && !workspaceExpired && !loading);
  const busy = loading || opening;
  const suspended = expired && ['suspended', 'disabled'].includes(workspace?.status || '');

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#f6f7fb] px-5 py-12">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/40 sm:p-10">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600"><ArrowLeft size={16} /> Pixel Project</Link>
        <div className="mb-6 mt-9 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          {busy ? <Loader2 size={26} className="animate-spin" /> : expired ? <Clock3 size={26} /> : <Building2 size={26} />}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">
          {opening ? 'Abriendo tu espacio' : loading ? 'Preparando tu espacio' : suspended ? 'Tu espacio está pausado' : expired ? 'Tu prueba gratuita ha terminado' : 'Vamos a terminar de preparar tu espacio'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600" role={accessError ? 'alert' : 'status'}>
          {opening
            ? 'Todo está listo. Te estamos llevando a tu organización.'
            : loading
            ? 'Estamos verificando tu cuenta y preparando tu organización. Esto puede tomar unos segundos.'
            : suspended
              ? 'El acceso a esta organización está pausado. Tu cuenta sigue disponible.'
              : expired
                ? `La prueba de ${workspace?.name || 'tu organización'} ha finalizado. No se realizará ningún cobro automático.`
                : accessError || 'Tu cuenta ya está creada. Reintenta para abrir tu organización sin duplicar el registro.'}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          {!busy && (
            <button onClick={() => void retryWorkspace()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700">
              <RefreshCw size={16} /> {expired ? 'Comprobar acceso' : 'Reintentar'}
            </button>
          )}
          <button onClick={() => void logout()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-600 hover:bg-slate-50"><LogOut size={16} /> Cerrar sesión</button>
        </div>
      </section>
    </main>
  );
}
