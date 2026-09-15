'use client';

import { supabase } from '@/lib/backend';

export async function platformRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error('Tu sesión ha terminado. Vuelve a iniciar sesión.');
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
      Authorization: `Bearer ${data.session.access_token}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || 'No pudimos completar la operación. Reintenta.');
  return body as T;
}

export const platformRoles = [
  { id: 'admin', name: 'Administrador del espacio' },
  { id: 'org_admin', name: 'Administrador de organización' },
  { id: 'manager', name: 'Gerente' },
  { id: 'coordinador', name: 'Coordinador' },
  { id: 'administrativo', name: 'Administrativo' },
  { id: 'user', name: 'Usuario' },
];

export const roleLabel = (role: string | null) => platformRoles.find((item) => item.id === role)?.name || 'Sin perfil';

export const displayDate = (value: string | null | undefined, includeTime = false) => {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin registro';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
  }).format(date);
};

export const fieldClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15 disabled:bg-slate-100 disabled:text-slate-500';
