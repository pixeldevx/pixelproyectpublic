"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Edit, Bell, Mail, Clock, AlertTriangle, CheckCircle2, Settings } from 'lucide-react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, getDocs, where, setDoc } from '@/lib/supabase/document-store';
import { db, supabase } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import { ensurePixelPushSubscription } from '@/lib/push/client-subscription';
import { toast } from 'sonner';
import {
  DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO,
  DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT,
} from '@/lib/email/task-assignment-template';
import { AdvanceRequestNotificationRule } from '@/components/alerts/AdvanceRequestNotificationRule';
import { canLoadProjectForUser } from '@/lib/project-access';

type AlertPreferences = {
  taskAssignmentEmailEnabled: boolean;
  taskAssignmentPushEnabled: boolean;
  taskAssignmentEmailSubject: string;
  taskAssignmentEmailIntro: string;
  disabledOrganizationIds: string[];
  disabledProjectIds: string[];
};

const defaultPreferences: AlertPreferences = {
  taskAssignmentEmailEnabled: true,
  taskAssignmentPushEnabled: true,
  taskAssignmentEmailSubject: DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT,
  taskAssignmentEmailIntro: DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO,
  disabledOrganizationIds: [],
  disabledProjectIds: [],
};

const normalizePreferences = (data: any = {}): AlertPreferences => ({
  taskAssignmentEmailEnabled: data.taskAssignmentEmailEnabled !== false,
  taskAssignmentPushEnabled: data.taskAssignmentPushEnabled !== false,
  taskAssignmentEmailSubject:
    typeof data.taskAssignmentEmailSubject === 'string' && data.taskAssignmentEmailSubject.trim()
      ? data.taskAssignmentEmailSubject
      : DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT,
  taskAssignmentEmailIntro:
    typeof data.taskAssignmentEmailIntro === 'string' && data.taskAssignmentEmailIntro.trim()
      ? data.taskAssignmentEmailIntro
      : DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO,
  disabledOrganizationIds: Array.isArray(data.disabledOrganizationIds) ? data.disabledOrganizationIds : [],
  disabledProjectIds: Array.isArray(data.disabledProjectIds) ? data.disabledProjectIds : [],
});

const alertCreatedAtMillis = (value: any) => {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const millis = new Date(String(value || '')).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

const alertCreatedAtLabel = (value: any) => {
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString();
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleString();
};

const normalizeInternalAlertUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return null;

  try {
    const internalOrigin = 'https://pixel-project.internal';
    const parsed = new URL(candidate, internalOrigin);
    if (parsed.origin !== internalOrigin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
};

const getAlertActionUrl = (alert: any) => {
  if (alert?.source === 'advance_request_delivery') {
    return normalizeInternalAlertUrl(alert.actionUrl);
  }

  const projectId = typeof alert?.projectId === 'string' ? alert.projectId.trim() : '';
  const taskId = typeof alert?.taskId === 'string' ? alert.taskId.trim() : '';
  if (!projectId || !taskId) return null;

  if (alert.eventType === 'contractor_account_assigned') {
    return `/projects/${encodeURIComponent(projectId)}?tab=administration&workspace=contractorAccounts&contractorAccountId=${encodeURIComponent(taskId)}`;
  }

  return `/workflows?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`;
};

type ScopeToggleRowProps = {
  title: string;
  subtitle?: string;
  active: boolean;
  muted: boolean;
  saving: boolean;
  onToggle: () => void;
};

function ScopeToggleRow({ title, subtitle, active, muted, saving, onToggle }: ScopeToggleRowProps) {
  const isAvailable = active && !muted;
  const rowClass = muted
    ? 'border-slate-700 bg-slate-900/70 opacity-70'
    : active
      ? 'border-emerald-400/40 bg-emerald-400/10 shadow-[0_0_0_1px_rgba(52,211,153,.08)]'
      : 'border-rose-400/35 bg-rose-500/10';
  const statusClass = isAvailable
    ? 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/25'
    : muted
      ? 'bg-slate-700/80 text-slate-300 ring-1 ring-white/10'
      : 'bg-rose-400/15 text-rose-200 ring-1 ring-rose-300/25';
  const statusLabel = muted ? 'Regla apagada' : active ? 'Activo' : 'Apagado';

  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 transition-colors ${rowClass}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-50">{title}</p>
        {subtitle && <p className="truncate text-[11px] text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${statusClass}`}>
          {statusLabel}
        </span>
        <Switch
          checked={active}
          disabled={saving || muted}
          onCheckedChange={onToggle}
        />
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const { user, userRole, userOrganizationIds } = useAuth();
  const [rules, setRules] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [advanceAlerts, setAdvanceAlerts] = useState<any[]>([]);
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [isSendingTestPush, setIsSendingTestPush] = useState(false);
  const [isEditingAssignmentRule, setIsEditingAssignmentRule] = useState(false);
  const [assignmentDraft, setAssignmentDraft] = useState({
    subject: DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT,
    intro: DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO,
  });

  // Form state for new rule
  const [newRule, setNewRule] = useState({
    title: '',
    description: '',
    type: 'overdue',
    condition: 'greater_than',
    threshold: 1,
    thresholdUnit: 'days',
    targetProjects: [] as string[],
    notificationChannels: ['in_app'],
    isActive: true
  });

  useEffect(() => {
    if (!user) return;

    // Fetch alert rules
    const rulesQuery = query(collection(db, 'alert_rules'));
    const unsubscribeRules = onSnapshot(rulesQuery, (snapshot) => {
      const rulesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRules(rulesData);
    }, (error) => {
      console.error("Error fetching alert rules:", error);
    });

    // Fetch user's alerts
    const alertsQuery = query(collection(db, 'alerts'), where('userId', '==', user.uid));
    const unsubscribeAlerts = onSnapshot(alertsQuery, (snapshot) => {
      const alertsData = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }));
      setAlerts(alertsData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching alerts:", error);
      setLoading(false);
    });

    const fetchAdvanceAlerts = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const response = await fetch('/api/alerts/advance-requests', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'No fue posible cargar las alertas de anticipos.');
        setAdvanceAlerts(Array.isArray(body.alerts) ? body.alerts : []);
      } catch (error) {
        console.error('Error fetching advance request alerts:', error);
      }
    };
    void fetchAdvanceAlerts();

    // Fetch projects for dropdown
    const fetchProjects = async () => {
      const normalizedEmail = String(user.email || '').trim().toLowerCase();
      const memberQueries = [
        getDocs(query(collection(db, 'team_members'), where('authUserId', '==', user.uid))),
        getDocs(query(collection(db, 'team_members'), where('uid', '==', user.uid))),
        ...(normalizedEmail
          ? [getDocs(query(collection(db, 'team_members'), where('email', '==', normalizedEmail)))]
          : []),
        ...(user.email && user.email !== normalizedEmail
          ? [getDocs(query(collection(db, 'team_members'), where('email', '==', user.email)))]
          : []),
      ];
      const [projectsSnapshot, memberSnapshots] = await Promise.all([
        getDocs(collection(db, 'projects')),
        Promise.all(memberQueries),
      ]);
      const assignedIds = new Set<string>([user.uid, user.email || ''].filter(Boolean));
      memberSnapshots.forEach((memberSnapshot) => {
        memberSnapshot.docs.forEach((memberDocument) => {
          const member = memberDocument.data();
          [memberDocument.id, member.uid, member.authUserId, member.email]
            .filter(Boolean)
            .forEach((id) => assignedIds.add(String(id)));
        });
      });
      const projectsData = projectsSnapshot.docs
        .map(projectDocument => ({ id: projectDocument.id, ...projectDocument.data() }))
        .filter((project) => canLoadProjectForUser(project, {
          userId: user.uid,
          userRole,
          assignedIds: Array.from(assignedIds),
          managedOrganizationIds: userOrganizationIds,
        }));
      setProjects(projectsData);
    };
    fetchProjects();

    const fetchOrganizations = async () => {
      const organizationsSnapshot = await getDocs(collection(db, 'organizations'));
      const organizationsData = organizationsSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((organization) => userRole === 'admin' || userOrganizationIds.includes(organization.id))
        .sort((left: any, right: any) => String(left.name || '').localeCompare(String(right.name || '')));
      setOrganizations(organizationsData);
    };
    fetchOrganizations();

    const unsubscribePreferences = onSnapshot(doc(db, 'alert_preferences', user.uid), (snapshot) => {
      const normalizedPreferences = normalizePreferences(snapshot.exists() ? snapshot.data() : {});
      setPreferences(normalizedPreferences);
      setAssignmentDraft({
        subject: normalizedPreferences.taskAssignmentEmailSubject,
        intro: normalizedPreferences.taskAssignmentEmailIntro,
      });
    }, (error) => {
      console.error("Error fetching alert preferences:", error);
    });

    return () => {
      unsubscribeRules();
      unsubscribeAlerts();
      unsubscribePreferences();
    };
  }, [user, userOrganizationIds, userRole]);

  const savePreferences = async (nextPreferences: typeof defaultPreferences) => {
    if (!user) return;
    setPreferences(nextPreferences);
    setSavingPreferences(true);
    try {
      await setDoc(doc(db, 'alert_preferences', user.uid), {
        ...nextPreferences,
        userId: user.uid,
        email: user.email || null,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      toast.success("Preferencias de alertas actualizadas.");
    } catch (error) {
      console.error("Error saving alert preferences:", error);
      toast.error("No se pudieron guardar las preferencias.");
    } finally {
      setSavingPreferences(false);
    }
  };

  const visibleAlerts = useMemo(
    () => [...alerts, ...advanceAlerts]
      .filter((alert) => !['superseded', 'dismissed'].includes(String(alert.status || 'unread')))
      .sort((left, right) => alertCreatedAtMillis(right.createdAt) - alertCreatedAtMillis(left.createdAt)),
    [advanceAlerts, alerts],
  );

  const toggleDisabledPreference = (field: 'disabledOrganizationIds' | 'disabledProjectIds', id: string) => {
    const current = preferences[field];
    const nextValues = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    void savePreferences({ ...preferences, [field]: nextValues });
  };

  const handleSaveAssignmentTemplate = async () => {
    const subject = assignmentDraft.subject.trim() || DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT;
    const intro = assignmentDraft.intro.trim() || DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO;
    await savePreferences({
      ...preferences,
      taskAssignmentEmailSubject: subject,
      taskAssignmentEmailIntro: intro,
    });
    setIsEditingAssignmentRule(false);
  };

  const handleResetAssignmentTemplate = () => {
    setAssignmentDraft({
      subject: DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT,
      intro: DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO,
    });
  };

  const assignmentRuleEnabled = preferences.taskAssignmentEmailEnabled || preferences.taskAssignmentPushEnabled;

  const getPushProviderErrorMessage = (providerError: any) => {
    const statusText = providerError?.statusCode ? ` (${providerError.statusCode})` : '';
    const providerDetail = providerError?.body || providerError?.message || '';

    if (providerError?.reason === 'vapid_auth_rejected') {
      return `El proveedor push rechazó la autenticación VAPID${statusText}. Revisa que NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY y WEB_PUSH_PRIVATE_KEY sean del mismo par, y que WEB_PUSH_SUBJECT sea un mailto: o https:// válido.`;
    }

    if (providerError?.reason === 'invalid_push_request') {
      return `El proveedor push rechazó la solicitud${statusText}. ${providerDetail || 'Vuelve a registrar el dispositivo y prueba de nuevo.'}`;
    }

    if (providerError?.reason === 'payload_too_large') {
      return 'El contenido de la notificación es demasiado grande para el proveedor push.';
    }

    if (providerError?.reason === 'provider_rate_limited') {
      return 'El proveedor push está limitando temporalmente los envíos. Espera unos minutos y prueba de nuevo.';
    }

    if (providerError?.reason === 'provider_unavailable') {
      return 'El proveedor push no está disponible temporalmente. Intenta nuevamente en unos minutos.';
    }

    return `Encontré el dispositivo, pero el proveedor push rechazó el envío${statusText}. ${providerDetail || 'Revisa WEB_PUSH_PRIVATE_KEY y WEB_PUSH_SUBJECT en Vercel.'}`;
  };

  const sendTestPushRequest = async (token: string) => {
    const response = await fetch('/api/notifications/test-push', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const body = await response.json().catch(() => null);
    return { response, body };
  };

  const handleSendTestPush = async () => {
    setIsSendingTestPush(true);
    try {
      const subscriptionResult = await ensurePixelPushSubscription({
        user,
        organizationIds: userOrganizationIds || [],
      });

      if (!subscriptionResult.ok) {
        if (subscriptionResult.reason === 'permission_denied') {
          toast.error('Las notificaciones están bloqueadas en este dispositivo. Revisa permisos del navegador o de la PWA.');
        } else if (subscriptionResult.reason === 'unsupported_browser') {
          toast.error('Este navegador no soporta push PWA. En iPhone abre Pixel Project instalada desde la pantalla de inicio.');
        } else if (subscriptionResult.reason === 'missing_public_key') {
          toast.error('Falta NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY en Vercel o el despliegue no tomó la variable.');
        } else {
          toast.error(subscriptionResult.message);
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        toast.warning('Inicia sesión nuevamente para probar las notificaciones push.');
        return;
      }

      let { response, body } = await sendTestPushRequest(token);

      if (
        response.ok &&
        Number(body?.push?.attempted || 0) > 0 &&
        Number(body?.push?.failed || 0) > 0 &&
        body?.push?.providerErrors?.[0]?.reason === 'vapid_auth_rejected'
      ) {
        const renewalResult = await ensurePixelPushSubscription({
          user,
          organizationIds: userOrganizationIds || [],
          forceRenew: true,
        });

        if (renewalResult.ok) {
          ({ response, body } = await sendTestPushRequest(token));
        }
      }

      if (!response.ok) {
        toast.error(body?.error || 'No fue posible enviar la prueba push.');
        return;
      }

      if (body?.push?.sent > 0) {
        toast.success('Prueba push enviada. Revisa tu dispositivo.');
        return;
      }

      if (body?.push?.reason === 'missing_web_push_config') {
        toast.error('Faltan variables VAPID en Vercel o el despliegue no las tomó todavía.');
        return;
      }

      if (body?.push?.reason === 'no_active_subscriptions') {
        toast.warning('El dispositivo se registró, pero el backend no encontró una suscripción activa. Espera unos segundos y prueba de nuevo.');
        return;
      }

      if (Array.isArray(body?.push?.expiredIds) && body.push.expiredIds.length > 0) {
        toast.warning('Había una suscripción push vencida. La limpiamos; vuelve a enviar la prueba para registrar una nueva.');
        return;
      }

      if (Number(body?.push?.attempted || 0) > 0 && Number(body?.push?.failed || 0) > 0) {
        toast.error(getPushProviderErrorMessage(body?.push?.providerErrors?.[0]));
        return;
      }

      toast.warning('La prueba no llegó a ningún dispositivo activo.');
    } catch (error) {
      console.error('Error sending test push:', error);
      toast.error('No fue posible enviar la prueba push.');
    } finally {
      setIsSendingTestPush(false);
    }
  };

  const handleCreateRule = async () => {
    if (!user || !newRule.title) return;

    try {
      await addDoc(collection(db, 'alert_rules'), {
        ...newRule,
        recipients: [user.uid], // Default to current user
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid
      });
      setIsCreatingRule(false);
      setNewRule({
        title: '',
        description: '',
        type: 'overdue',
        condition: 'greater_than',
        threshold: 1,
        thresholdUnit: 'days',
        targetProjects: [],
        notificationChannels: ['in_app'],
        isActive: true
      });
      toast.success("Regla de alerta creada exitosamente.");
    } catch (error) {
      console.error("Error creating rule:", error);
      toast.error("Error al crear la regla de alerta.");
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (confirm("¿Estás seguro de que deseas eliminar esta regla?")) {
      try {
        await deleteDoc(doc(db, 'alert_rules', ruleId));
        toast.success("Regla eliminada exitosamente.");
      } catch (error) {
        console.error("Error deleting rule:", error);
        toast.error("Error al eliminar la regla.");
      }
    }
  };

  const toggleRuleActive = async (ruleId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'alert_rules', ruleId), {
        isActive: !currentStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error updating rule:", error);
    }
  };

  const markAlertAsRead = async (alert: any) => {
    try {
      if (alert.source === 'advance_request_delivery') {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
        const response = await fetch('/api/alerts/advance-requests', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectId: alert.projectId,
            deliveryId: alert.deliveryId,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'No fue posible marcar la alerta como leída.');
        setAdvanceAlerts((current) => current.map((item) => (
          item.id === alert.id ? { ...item, status: 'read', readAt: body.readAt } : item
        )));
        return;
      }
      await updateDoc(doc(db, 'alerts', alert.id), {
        status: 'read',
        readAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error marking alert as read:", error);
    }
  };

  if (loading) {
    return <DashboardLayout><div className="p-8">Cargando alertas...</div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Centro de Alertas</h1>
            <p className="text-slate-500 mt-2">Configura reglas y gestiona tus notificaciones</p>
          </div>
          <Button onClick={() => setIsCreatingRule(!isCreatingRule)} className="bg-indigo-600 hover:bg-indigo-700">
            {isCreatingRule ? 'Cancelar' : <><Plus className="w-4 h-4 mr-2" /> Nueva Regla</>}
          </Button>
        </div>

        <Card className="overflow-hidden border-slate-200 bg-slate-950 text-white shadow-xl">
          <CardHeader className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,.30),_transparent_36%),linear-gradient(135deg,#0f172a,#111827)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl text-white">
                  <Mail className="h-5 w-5 text-cyan-300" />
                  Asignación de tareas y workflows
                </CardTitle>
                <CardDescription className="mt-1 text-slate-300">
                  Regla predefinida que avisa por correo y push móvil cuando una tarea o workflow entra a la bandeja.
                </CardDescription>
              </div>
              <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                assignmentRuleEnabled
                  ? 'border-emerald-300/35 bg-emerald-400/10'
                  : 'border-rose-300/35 bg-rose-500/10'
              }`}>
                <div className="text-right">
                  <p className="text-sm font-bold text-white">Regla predefinida</p>
                  <p className={`text-xs font-semibold ${assignmentRuleEnabled ? 'text-emerald-200' : 'text-rose-200'}`}>
                    {assignmentRuleEnabled ? 'Activa' : 'Apagada'}
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 bg-slate-950 p-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-indigo-400/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-200 ring-1 ring-indigo-300/20">
                      Regla predefinida
                    </span>
                    <span className="rounded-full bg-cyan-400/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200 ring-1 ring-cyan-300/20">
                      Correo + Push
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ring-1 ${
                      assignmentRuleEnabled
                        ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/20'
                        : 'bg-rose-400/15 text-rose-200 ring-rose-300/20'
                    }`}>
                      {assignmentRuleEnabled ? 'Activa' : 'Apagada'}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-black text-white">Asignación de tarea o workflow</h3>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
                    Se dispara cuando una persona recibe una tarea en su bandeja. Puedes apagarla completa,
                    excluir organizaciones o proyectos, y personalizar el asunto o mensaje inicial del correo.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className={`rounded-2xl border p-3 transition-colors ${
                      preferences.taskAssignmentEmailEnabled
                        ? 'border-cyan-300/30 bg-cyan-400/10'
                        : 'border-slate-700 bg-slate-900/70'
                    }`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <Mail className="h-4 w-4 shrink-0 text-cyan-200" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-white">Correo moderno</p>
                            <p className="truncate text-xs text-slate-400">Plantilla Pixel Project por email.</p>
                          </div>
                        </div>
                        <Switch
                          checked={preferences.taskAssignmentEmailEnabled}
                          disabled={savingPreferences}
                          onCheckedChange={(checked) => void savePreferences({ ...preferences, taskAssignmentEmailEnabled: checked })}
                        />
                      </div>
                    </div>
                    <div className={`rounded-2xl border p-3 transition-colors ${
                      preferences.taskAssignmentPushEnabled
                        ? 'border-violet-300/30 bg-violet-400/10'
                        : 'border-slate-700 bg-slate-900/70'
                    }`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <Bell className="h-4 w-4 shrink-0 text-violet-200" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-white">Push móvil PWA</p>
                            <p className="truncate text-xs text-slate-400">Notificación directa al celular.</p>
                          </div>
                        </div>
                        <Switch
                          checked={preferences.taskAssignmentPushEnabled}
                          disabled={savingPreferences}
                          onCheckedChange={(checked) => void savePreferences({ ...preferences, taskAssignmentPushEnabled: checked })}
                        />
                      </div>
                      <div className="mt-3 flex justify-end border-t border-white/10 pt-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleSendTestPush()}
                          disabled={isSendingTestPush}
                          className="h-8 border-white/15 bg-white/10 text-xs font-black text-white hover:bg-white/15 hover:text-white"
                        >
                          {isSendingTestPush ? 'Enviando...' : 'Enviar prueba'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setIsEditingAssignmentRule(!isEditingAssignmentRule)}
                  className="border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                >
                  <Edit className="mr-2 h-4 w-4" />
                  {isEditingAssignmentRule ? 'Cerrar edición' : 'Personalizar'}
                </Button>
              </div>

              {isEditingAssignmentRule && (
                <div className="mt-4 grid gap-4 rounded-2xl border border-indigo-300/20 bg-indigo-500/10 p-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-slate-200">Asunto del correo</Label>
                      <Input
                        value={assignmentDraft.subject}
                        onChange={(event) => setAssignmentDraft({ ...assignmentDraft, subject: event.target.value })}
                        className="border-white/10 bg-slate-950/70 text-white placeholder:text-slate-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-200">Mensaje inicial</Label>
                      <textarea
                        value={assignmentDraft.intro}
                        onChange={(event) => setAssignmentDraft({ ...assignmentDraft, intro: event.target.value })}
                        className="min-h-[84px] w-full rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white shadow-sm outline-none transition-colors placeholder:text-slate-500 focus:border-indigo-300"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 border-t border-white/10 pt-3 lg:flex-row lg:items-center lg:justify-between">
                    <p className="text-xs leading-5 text-slate-400">
                      Variables disponibles: {'{assigneeName}'}, {'{taskTitle}'}, {'{projectName}'}, {'{organizationName}'}, {'{dueDateLabel}'}.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={handleResetAssignmentTemplate} className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                        Restaurar plantilla
                      </Button>
                      <Button onClick={() => void handleSaveAssignmentTemplate()} disabled={savingPreferences} className="bg-indigo-500 hover:bg-indigo-400">
                        Guardar personalización
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-200">Organizaciones</h3>
                <p className="mt-1 text-xs text-slate-400">Define en qué organizaciones se envía esta regla.</p>
                <div className="mt-4 space-y-2">
                  {organizations.length === 0 ? (
                    <p className="text-sm text-slate-500">No hay organizaciones disponibles.</p>
                  ) : (
                    organizations.map((organization) => {
                      const isActive = !preferences.disabledOrganizationIds.includes(organization.id);
                      return (
                        <ScopeToggleRow
                          key={organization.id}
                          title={organization.name || organization.displayName || 'Organización'}
                          active={isActive}
                          muted={!assignmentRuleEnabled}
                          saving={savingPreferences}
                          onToggle={() => toggleDisabledPreference('disabledOrganizationIds', organization.id)}
                        />
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-200">Proyectos</h3>
                <p className="mt-1 text-xs text-slate-400">Controla notificaciones por cada proyecto asignado.</p>
                <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {projects.length === 0 ? (
                    <p className="text-sm text-slate-500">No hay proyectos disponibles.</p>
                  ) : (
                    projects.map((project) => {
                      const isActive = !preferences.disabledProjectIds.includes(project.id);
                      return (
                        <ScopeToggleRow
                          key={project.id}
                          title={project.name || project.title || 'Proyecto'}
                          subtitle={organizations.find((organization) => organization.id === project.organizationId)?.name || project.organizationName || 'Sin organización'}
                          active={isActive}
                          muted={!assignmentRuleEnabled}
                          saving={savingPreferences}
                          onToggle={() => toggleDisabledPreference('disabledProjectIds', project.id)}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <AdvanceRequestNotificationRule projects={projects} organizations={organizations} />

        {isCreatingRule && (
          <Card className="border-indigo-100 shadow-md">
            <CardHeader className="bg-indigo-50/50 border-b border-indigo-100 pb-4">
              <CardTitle className="text-lg text-indigo-900">Crear Nueva Regla de Alerta</CardTitle>
              <CardDescription>Define las condiciones para generar alertas automáticas.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Nombre de la Regla</Label>
                  <Input 
                    value={newRule.title} 
                    onChange={(e) => setNewRule({...newRule, title: e.target.value})} 
                    placeholder="Ej: Tareas atrasadas más de 2 días"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tipo de Alerta</Label>
                  <Select value={newRule.type || ''} onValueChange={(value) => setNewRule({...newRule, type: value || ''})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona el tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="overdue">Tareas Atrasadas</SelectItem>
                      <SelectItem value="inactive">Inactividad (Sin actualización)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Condición</Label>
                  <div className="flex gap-2 items-center">
                    <span className="text-sm text-slate-500">Si el tiempo es</span>
                    <Select value={newRule.condition} onValueChange={(value) => setNewRule({...newRule, condition: value || ''})}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="greater_than">Mayor a</SelectItem>
                        <SelectItem value="equals">Igual a</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input 
                      type="number" 
                      className="w-20" 
                      value={newRule.threshold} 
                      onChange={(e) => setNewRule({...newRule, threshold: parseInt(e.target.value) || 0})}
                      min={1}
                    />
                    <Select value={newRule.thresholdUnit} onValueChange={(value) => setNewRule({...newRule, thresholdUnit: value || ''})}>
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="days">Días</SelectItem>
                        <SelectItem value="hours">Horas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Proyectos (Opcional - Deja vacío para todos)</Label>
                  <Select 
                    value={newRule.targetProjects[0] || 'all'} 
                    onValueChange={(value) => setNewRule({...newRule, targetProjects: value === 'all' || !value ? [] : [value]})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Todos los proyectos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los proyectos</SelectItem>
                      {projects.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Canales de Notificación</Label>
                  <div className="flex gap-4 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={newRule.notificationChannels.includes('in_app')}
                        onChange={(e) => {
                          const channels = e.target.checked 
                            ? [...newRule.notificationChannels, 'in_app']
                            : newRule.notificationChannels.filter(c => c !== 'in_app');
                          setNewRule({...newRule, notificationChannels: channels});
                        }}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <Bell className="w-4 h-4 text-slate-500" />
                      <span className="text-sm">En la App</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={newRule.notificationChannels.includes('email')}
                        onChange={(e) => {
                          const channels = e.target.checked 
                            ? [...newRule.notificationChannels, 'email']
                            : newRule.notificationChannels.filter(c => c !== 'email');
                          setNewRule({...newRule, notificationChannels: channels});
                        }}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <Mail className="w-4 h-4 text-slate-500" />
                      <span className="text-sm">Email</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <Button variant="outline" onClick={() => setIsCreatingRule(false)}>Cancelar</Button>
                <Button onClick={handleCreateRule} className="bg-indigo-600 hover:bg-indigo-700" disabled={!newRule.title}>
                  Guardar Regla
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Active Alerts Section */}
          <Card className="shadow-sm border-slate-200">
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-500" />
                <CardTitle className="text-lg">Tus Alertas Activas</CardTitle>
                {visibleAlerts.filter(a => a.status === 'unread').length > 0 && (
                  <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                    {visibleAlerts.filter(a => a.status === 'unread').length} nuevas
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {visibleAlerts.length === 0 ? (
                <div className="p-8 text-center text-slate-500 flex flex-col items-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3 opacity-50" />
                  <p>No tienes alertas activas en este momento.</p>
                  <p className="text-sm mt-1">¡Todo está al día!</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                  {visibleAlerts.map(alert => {
                    const safeActionUrl = getAlertActionUrl(alert);
                    return (
                      <div key={alert.id} className={`p-4 flex gap-4 transition-colors ${alert.status === 'unread' ? 'bg-amber-50/30' : 'hover:bg-slate-50'}`}>
                        <div className="mt-1 shrink-0">
                          {alert.type === 'overdue' ? (
                            <AlertTriangle className={`w-5 h-5 ${alert.status === 'unread' ? 'text-red-500' : 'text-slate-400'}`} />
                          ) : (
                            <Clock className={`w-5 h-5 ${alert.status === 'unread' ? 'text-amber-500' : 'text-slate-400'}`} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className={`text-sm font-medium ${alert.status === 'unread' ? 'text-slate-900' : 'text-slate-700'}`}>
                            {alert.title}
                          </h4>
                          <p className="text-sm text-slate-500 mt-1 line-clamp-2">{alert.message}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                            <span>{alertCreatedAtLabel(alert.createdAt)}</span>
                            {alert.status === 'unread' && (
                              <button
                                onClick={() => markAlertAsRead(alert)}
                                className="text-indigo-600 hover:text-indigo-800 font-medium"
                              >
                                Marcar como leída
                              </button>
                            )}
                            {safeActionUrl && (
                              <a
                                href={safeActionUrl}
                                onClick={() => {
                                  if (alert.status === 'unread') void markAlertAsRead(alert);
                                }}
                                className="font-bold text-cyan-700 hover:text-cyan-900"
                              >
                                Abrir solicitud
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Configured Rules Section */}
          <Card className="shadow-sm border-slate-200">
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-500" />
                <CardTitle className="text-lg">Reglas Configuradas</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/50">
                    <TableHead>Regla</TableHead>
                    <TableHead>Condición</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-indigo-50/35">
                    <TableCell>
                      <div className="font-medium text-slate-900">Correo por asignación de tarea</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-bold text-indigo-700">Predefinida</span>
                        <span className="rounded-full bg-cyan-100 px-2 py-0.5 font-bold text-cyan-700">Plantilla Pixel Project</span>
                        <Mail className="h-3 w-3" />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      Cuando una tarea o workflow entra a la bandeja del responsable.
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                          preferences.taskAssignmentEmailEnabled
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}>
                          {preferences.taskAssignmentEmailEnabled ? 'Activa' : 'Apagada'}
                        </span>
                        <Switch
                          checked={preferences.taskAssignmentEmailEnabled}
                          disabled={savingPreferences}
                          onCheckedChange={(checked) => void savePreferences({ ...preferences, taskAssignmentEmailEnabled: checked })}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsEditingAssignmentRule(true)}
                        className="text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-violet-50/35">
                    <TableCell>
                      <div className="font-medium text-slate-900">Push móvil por asignación de tarea</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 font-bold text-violet-700">Predefinida</span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">PWA</span>
                        <Bell className="h-3 w-3" />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      Cuando una tarea o workflow entra a la bandeja del responsable con la PWA instalada.
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                          preferences.taskAssignmentPushEnabled
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}>
                          {preferences.taskAssignmentPushEnabled ? 'Activa' : 'Apagada'}
                        </span>
                        <Switch
                          checked={preferences.taskAssignmentPushEnabled}
                          disabled={savingPreferences}
                          onCheckedChange={(checked) => void savePreferences({ ...preferences, taskAssignmentPushEnabled: checked })}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                        Automática
                      </span>
                    </TableCell>
                  </TableRow>
                  {rules.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                        No hay reglas adicionales configuradas.
                        <Button variant="link" onClick={() => setIsCreatingRule(true)} className="ml-1 text-indigo-600">
                          Crear otra regla
                        </Button>
                      </TableCell>
                    </TableRow>
                  ) : (
                    rules.map(rule => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div className="font-medium text-slate-900">{rule.title}</div>
                          <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                            {rule.type === 'overdue' ? 'Atraso' : 'Inactividad'}
                            <span className="text-slate-300">•</span>
                            <div className="flex gap-1">
                              {rule.notificationChannels.includes('in_app') && <Bell className="w-3 h-3" />}
                              {rule.notificationChannels.includes('email') && <Mail className="w-3 h-3" />}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {rule.condition === 'greater_than' ? '>' : '='} {rule.threshold} {rule.thresholdUnit === 'days' ? 'días' : 'horas'}
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch 
                            checked={rule.isActive} 
                            onCheckedChange={() => toggleRuleActive(rule.id, rule.isActive)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteRule(rule.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
