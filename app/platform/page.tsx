'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PlatformDashboard } from '@/components/platform/PlatformDashboard';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, ShieldCheck } from 'lucide-react';

export default function PlatformPage() {
  const { workspace, user, loading } = useAuth();
  return (
    <DashboardLayout>
      {loading ? (
        <div className="flex min-h-72 items-center justify-center gap-3 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Verificando acceso…</div>
      ) : workspace?.is_platform_admin && user ? (
        <PlatformDashboard currentUserId={user.uid} currentWorkspaceId={workspace.id} />
      ) : (
        <section className="mx-auto mt-16 max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-slate-400" />
          <h1 className="text-xl font-semibold text-slate-900">Administración de la plataforma</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">Este panel está reservado al administrador global de Pixel.</p>
        </section>
      )}
    </DashboardLayout>
  );
}
