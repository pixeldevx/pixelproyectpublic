"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Copy,
  Edit3,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/backend';

type License = {
  id: string;
  license_key: string;
  client_name: string;
  plan: string;
  plan_name: string;
  max_uses: number;
  used_count: number;
  remaining_uses: number;
  active: boolean;
  expiration_date: string | null;
  created_at: string;
  updated_at: string;
  usage_log_count?: number;
  last_used_at?: string | null;
};

type UsageLog = {
  id: string;
  license_key: string;
  machine_id: string;
  action: string;
  items_processed: number | null;
  os_info: string | null;
  client_ip: string | null;
  timestamp: string;
};

type LicenseForm = {
  license_key: string;
  client_name: string;
  plan_name: string;
  max_uses: string;
  used_count: string;
  active: boolean;
  expiration_date: string;
};

const emptyForm = (): LicenseForm => ({
  license_key: '',
  client_name: '',
  plan_name: 'Estándar',
  max_uses: '100',
  used_count: '0',
  active: true,
  expiration_date: '',
});

const formatNumber = (value: number) =>
  new Intl.NumberFormat('es-CO').format(Number.isFinite(value) ? value : 0);

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin registro';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const normalizeLicenseKey = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').slice(0, 64);

const randomSegment = () => {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
};

const generateLicenseKey = () => `VANTI-${new Date().getFullYear()}-${randomSegment()}-${randomSegment()}`;

const getLicenseState = (license: License) => {
  if (!license.active) return { label: 'Inactiva', variant: 'destructive' as const };
  if (license.expiration_date && new Date(`${license.expiration_date}T23:59:59`).getTime() < Date.now()) {
    return { label: 'Vencida', variant: 'warning' as const };
  }
  if (license.remaining_uses <= 0) return { label: 'Sin usos', variant: 'warning' as const };
  return { label: 'Activa', variant: 'success' as const };
};

export default function LicensesPage() {
  const { userRole, loading } = useAuth();
  const [licenses, setLicenses] = useState<License[]>([]);
  const [usage, setUsage] = useState<UsageLog[]>([]);
  const [selectedLicenseId, setSelectedLicenseId] = useState('');
  const [form, setForm] = useState<LicenseForm>(() => emptyForm());
  const [editingLicenseId, setEditingLicenseId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState('');
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);

  const isAdmin = userRole === 'admin';

  const authHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Tu sesión no está disponible. Vuelve a iniciar sesión.');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }, []);

  const loadLicenses = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/licenses', {
        headers: await authHeaders(),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar las licencias.');
      setLicenses(payload.licenses || []);
      setSelectedLicenseId((current) => {
        if (current && (payload.licenses || []).some((license: License) => license.id === current)) return current;
        return payload.licenses?.[0]?.id || '';
      });
    } catch (error: any) {
      console.error('Error loading licenses:', error);
      toast.error(error?.message || 'No se pudieron cargar las licencias.');
    } finally {
      setIsLoading(false);
    }
  }, [authHeaders, isAdmin]);

  const loadUsage = useCallback(async (licenseId: string) => {
    if (!licenseId || !isAdmin) {
      setUsage([]);
      return;
    }

    setIsLoadingUsage(true);
    try {
      const response = await fetch(`/api/licenses/${licenseId}/usage`, {
        headers: await authHeaders(),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo cargar el historial.');
      setUsage(payload.usage || []);
    } catch (error: any) {
      console.error('Error loading license usage:', error);
      toast.error(error?.message || 'No se pudo cargar el historial de uso.');
    } finally {
      setIsLoadingUsage(false);
    }
  }, [authHeaders, isAdmin]);

  useEffect(() => {
    if (!loading && isAdmin) void loadLicenses();
    if (!loading && !isAdmin) setIsLoading(false);
  }, [isAdmin, loadLicenses, loading]);

  useEffect(() => {
    void loadUsage(selectedLicenseId);
  }, [loadUsage, selectedLicenseId]);

  const selectedLicense = licenses.find((license) => license.id === selectedLicenseId) || null;

  const metrics = useMemo(() => {
    const active = licenses.filter((license) => getLicenseState(license).label === 'Activa').length;
    const used = licenses.reduce((sum, license) => sum + license.used_count, 0);
    const remaining = licenses.reduce((sum, license) => sum + license.remaining_uses, 0);
    const machines = new Set(usage.map((log) => log.machine_id).filter(Boolean)).size;
    return { active, used, remaining, machines };
  }, [licenses, usage]);

  const resetForm = () => {
    setForm(emptyForm());
    setEditingLicenseId('');
  };

  const editLicense = (license: License) => {
    setEditingLicenseId(license.id);
    setForm({
      license_key: license.license_key,
      client_name: license.client_name,
      plan_name: license.plan_name || license.plan || 'Estándar',
      max_uses: String(license.max_uses),
      used_count: String(license.used_count),
      active: license.active,
      expiration_date: license.expiration_date || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveLicense = async (event: React.FormEvent) => {
    event.preventDefault();
    const licenseKey = normalizeLicenseKey(form.license_key);
    const clientName = form.client_name.trim();
    if (!licenseKey || !clientName) {
      toast.error('Completa la clave y el cliente.');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(editingLicenseId ? `/api/licenses/${editingLicenseId}` : '/api/licenses', {
        method: editingLicenseId ? 'PATCH' : 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          ...form,
          license_key: licenseKey,
          client_name: clientName,
          max_uses: Number(form.max_uses || 0),
          used_count: Number(form.used_count || 0),
          expiration_date: form.expiration_date || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar la licencia.');
      toast.success(editingLicenseId ? 'Licencia actualizada.' : 'Licencia creada.');
      resetForm();
      await loadLicenses();
    } catch (error: any) {
      console.error('Error saving license:', error);
      toast.error(error?.message || 'No se pudo guardar la licencia.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteLicense = async (license: License) => {
    const confirmed = window.confirm(`¿Eliminar la licencia ${license.license_key}? También se eliminará su historial de uso.`);
    if (!confirmed) return;

    setIsDeleting(license.id);
    try {
      const response = await fetch(`/api/licenses/${license.id}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo eliminar la licencia.');
      toast.success('Licencia eliminada.');
      if (selectedLicenseId === license.id) setSelectedLicenseId('');
      if (editingLicenseId === license.id) resetForm();
      await loadLicenses();
    } catch (error: any) {
      console.error('Error deleting license:', error);
      toast.error(error?.message || 'No se pudo eliminar la licencia.');
    } finally {
      setIsDeleting('');
    }
  };

  const copyEndpoint = async (path: string) => {
    const url = `${window.location.origin}${path}`;
    await navigator.clipboard.writeText(url);
    toast.success('Endpoint copiado.');
  };

  if (!loading && !isAdmin) {
    return (
      <DashboardLayout>
        <div className="flex h-full items-center justify-center">
          <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <KeyRound className="mx-auto mb-4 h-12 w-12 text-slate-300" />
            <h1 className="text-xl font-black text-slate-950">Acceso denegado</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              Solo el administrador global puede administrar licencias de scripts.
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="min-h-full space-y-6 overflow-y-auto p-4 md:p-6">
        <section className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-xl shadow-slate-900/10">
          <div className="grid gap-6 p-6 lg:grid-cols-[1.25fr_0.75fr] lg:p-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-indigo-100">
                <KeyRound size={14} />
                Licenciamiento cloud
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight">Licencias para scripts Python</h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
                Crea claves, controla usos disponibles y audita cada ejecución de VANTI Suite desde Pixel.
                Los scripts consumen los endpoints REST definidos en la especificación.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Activas" value={formatNumber(metrics.active)} />
              <MetricCard label="Usos consumidos" value={formatNumber(metrics.used)} />
              <MetricCard label="Usos restantes" value={formatNumber(metrics.remaining)} />
              <MetricCard label="Máquinas vistas" value={formatNumber(metrics.machines)} />
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {editingLicenseId ? <Edit3 size={18} /> : <Plus size={18} />}
                {editingLicenseId ? 'Editar licencia' : 'Nueva licencia'}
              </CardTitle>
              <CardDescription>La clave se normaliza en mayúsculas para que el script la use sin errores.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={saveLicense}>
                <div>
                  <label className="mb-1 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Clave</label>
                  <div className="flex gap-2">
                    <Input
                      value={form.license_key}
                      onChange={(event) => setForm((current) => ({ ...current, license_key: normalizeLicenseKey(event.target.value) }))}
                      placeholder="VANTI-2026-CLIENTE"
                      className="h-11 font-mono font-bold"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setForm((current) => ({ ...current, license_key: generateLicenseKey() }))}
                      className="h-11"
                    >
                      Generar
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Cliente</label>
                  <Input
                    value={form.client_name}
                    onChange={(event) => setForm((current) => ({ ...current, client_name: event.target.value }))}
                    placeholder="Empresa o persona"
                    className="h-11"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Plan</label>
                    <Input
                      value={form.plan_name}
                      onChange={(event) => setForm((current) => ({ ...current, plan_name: event.target.value }))}
                      placeholder="Estándar"
                      className="h-11"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Vence</label>
                    <Input
                      type="date"
                      value={form.expiration_date}
                      onChange={(event) => setForm((current) => ({ ...current, expiration_date: event.target.value }))}
                      className="h-11"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Usos máximos</label>
                    <Input
                      type="number"
                      min="0"
                      value={form.max_uses}
                      onChange={(event) => setForm((current) => ({ ...current, max_uses: event.target.value }))}
                      className="h-11"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Consumidos</label>
                    <Input
                      type="number"
                      min="0"
                      value={form.used_count}
                      onChange={(event) => setForm((current) => ({ ...current, used_count: event.target.value }))}
                      className="h-11"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">Licencia activa</p>
                    <p className="text-xs font-semibold text-slate-500">Si se desactiva, el script no podrá iniciar procesos.</p>
                  </div>
                  <Switch
                    checked={form.active}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, active: Boolean(checked) }))}
                  />
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {editingLicenseId && (
                    <Button type="button" variant="outline" onClick={resetForm}>
                      <X size={16} className="mr-2" />
                      Cancelar edición
                    </Button>
                  )}
                  <Button type="submit" disabled={isSaving} className="bg-indigo-600 text-white hover:bg-indigo-700">
                    {isSaving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <CheckCircle2 size={16} className="mr-2" />}
                    {editingLicenseId ? 'Guardar cambios' : 'Crear licencia'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>Licencias emitidas</CardTitle>
                  <CardDescription>Controla estado, saldo y vencimiento de cada cliente.</CardDescription>
                </div>
                <Button type="button" variant="outline" onClick={() => void loadLicenses()} disabled={isLoading}>
                  {isLoading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <RefreshCw size={16} className="mr-2" />}
                  Actualizar
                </Button>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-16 text-sm font-bold text-slate-500">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Cargando licencias...
                  </div>
                ) : licenses.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center">
                    <KeyRound className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                    <p className="text-sm font-black text-slate-900">Aún no hay licencias</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Crea la primera clave para conectar VANTI Suite.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-slate-200">
                    <div className="max-h-[620px] overflow-auto">
                      <table className="w-full min-w-[920px] text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Licencia</th>
                            <th className="px-4 py-3">Cliente</th>
                            <th className="px-4 py-3">Uso</th>
                            <th className="px-4 py-3">Vencimiento</th>
                            <th className="px-4 py-3">Estado</th>
                            <th className="px-4 py-3 text-right">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {licenses.map((license) => {
                            const state = getLicenseState(license);
                            const usagePercent = license.max_uses > 0 ? Math.min(100, Math.round((license.used_count / license.max_uses) * 100)) : 0;
                            return (
                              <tr
                                key={license.id}
                                className={`cursor-pointer transition hover:bg-indigo-50/50 ${selectedLicenseId === license.id ? 'bg-indigo-50' : ''}`}
                                onClick={() => setSelectedLicenseId(license.id)}
                              >
                                <td className="px-4 py-4">
                                  <p className="font-mono text-xs font-black text-slate-950">{license.license_key}</p>
                                  <p className="mt-1 text-[11px] font-bold text-slate-400">{license.plan}</p>
                                </td>
                                <td className="px-4 py-4">
                                  <p className="font-black text-slate-900">{license.client_name}</p>
                                  <p className="mt-1 text-xs font-semibold text-slate-500">Último uso: {formatDateTime(license.last_used_at)}</p>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                                      <div className="h-full rounded-full bg-indigo-600" style={{ width: `${usagePercent}%` }} />
                                    </div>
                                    <span className="font-black text-slate-900">
                                      {formatNumber(license.used_count)} / {formatNumber(license.max_uses)}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs font-bold text-slate-500">{formatNumber(license.remaining_uses)} disponibles</p>
                                </td>
                                <td className="px-4 py-4 text-sm font-bold text-slate-600">{license.expiration_date || 'Sin vencimiento'}</td>
                                <td className="px-4 py-4">
                                  <Badge variant={state.variant}>{state.label}</Badge>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                                    <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(license.license_key).then(() => toast.success('Clave copiada.'))}>
                                      <Copy size={14} />
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" onClick={() => editLicense(license)}>
                                      <Edit3 size={14} />
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => void deleteLicense(license)}
                                      disabled={isDeleting === license.id}
                                      className="border-red-200 text-red-600 hover:bg-red-50"
                                    >
                                      {isDeleting === license.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Activity size={18} />
                    Historial de uso
                  </CardTitle>
                  <CardDescription>
                    {selectedLicense ? `Últimas ejecuciones para ${selectedLicense.license_key}.` : 'Selecciona una licencia para ver su auditoría.'}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void copyEndpoint('/api/v1/license/verify')}>
                    <Copy size={14} className="mr-2" />
                    Endpoint verify
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void copyEndpoint('/api/v1/license/use')}>
                    <Copy size={14} className="mr-2" />
                    Endpoint use
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!selectedLicense ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm font-semibold text-slate-500">
                    Selecciona una licencia para revisar sus máquinas y ejecuciones.
                  </div>
                ) : isLoadingUsage ? (
                  <div className="flex items-center justify-center py-12 text-sm font-bold text-slate-500">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Cargando historial...
                  </div>
                ) : usage.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
                    <AlertCircle className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                    <p className="text-sm font-black text-slate-900">Sin ejecuciones registradas</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Cuando el script termine un proceso exitoso aparecerá aquí.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-slate-200">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Fecha</th>
                          <th className="px-4 py-3">Acción</th>
                          <th className="px-4 py-3">Máquina</th>
                          <th className="px-4 py-3">Ítems</th>
                          <th className="px-4 py-3">SO / IP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {usage.map((log) => (
                          <tr key={log.id}>
                            <td className="px-4 py-3 font-bold text-slate-700">{formatDateTime(log.timestamp)}</td>
                            <td className="px-4 py-3">
                              <Badge variant="secondary">{log.action}</Badge>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs font-black text-slate-700">{log.machine_id}</td>
                            <td className="px-4 py-3 font-black text-slate-900">{formatNumber(Number(log.items_processed || 0))}</td>
                            <td className="px-4 py-3 text-xs font-semibold text-slate-500">
                              {log.os_info || 'Sin SO'} · {log.client_ip || 'Sin IP'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-indigo-100">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
    </div>
  );
}
