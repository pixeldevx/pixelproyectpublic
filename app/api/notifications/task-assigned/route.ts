import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  buildTaskAssignmentEmailHtml,
  buildTaskAssignmentSubject,
  buildTaskAssignmentText,
  DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO,
  DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT,
} from '@/lib/email/task-assignment-template';
import { sendEmailWithResend } from '@/lib/email/resend';
import { sendPixelPushBatch, type PixelPushTarget } from '@/lib/push/web-push';
import {
  CONTRACTOR_ACCOUNT_STAGE_LABELS,
  type ContractorAccountStatus,
} from '@/lib/contractor-account-workflow';

export const runtime = 'nodejs';

const DOCUMENTS_TABLE = 'app_documents';

type AppDocumentRow = {
  collection_path: string;
  doc_id: string;
  data: Record<string, any>;
};

const json = (body: Record<string, any>, status = 200) =>
  NextResponse.json(body, { status });

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const getBearerToken = (request: NextRequest) => {
  const header = request.headers.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
};

const getAdminClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Falta configurar SUPABASE_SERVICE_ROLE_KEY en el entorno de Vercel.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

const appUrlFromRequest = (request: NextRequest) => {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    '';

  if (configuredUrl) {
    return configuredUrl.startsWith('http')
      ? configuredUrl.replace(/\/$/, '')
      : `https://${configuredUrl.replace(/\/$/, '')}`;
  }

  return new URL(request.url).origin.replace(/\/$/, '');
};

const getDocument = async (supabase: any, collectionPath: string, docId: string) => {
  if (!docId) return null;
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path, doc_id, data')
    .eq('collection_path', collectionPath)
    .eq('doc_id', docId)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as AppDocumentRow | null;
};

const findDocumentByEmail = async (supabase: any, collectionPath: string, email: string) => {
  if (!email) return null;
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path, doc_id, data')
    .eq('collection_path', collectionPath)
    .eq('data->>email', email)
    .limit(1);

  if (error) throw error;
  return ((data || [])[0] || null) as AppDocumentRow | null;
};

const upsertDocument = async (supabase: any, collectionPath: string, docId: string, data: Record<string, any>) => {
  const { error } = await supabase.from(DOCUMENTS_TABLE).upsert(
    {
      collection_path: collectionPath,
      doc_id: docId,
      data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'collection_path,doc_id' }
  );

  if (error) throw error;
};

const priorityLabel = (priority: string) => {
  if (priority === 'high') return 'Alta';
  if (priority === 'low') return 'Baja';
  return 'Media';
};

const statusLabel = (status: string) => {
  switch (status) {
    case 'in_progress':
    case 'en_curso':
      return 'En curso';
    case 'reproceso':
      return 'Reproceso';
    case 'detenido':
      return 'Detenido';
    case 'pending':
    case 'todo':
      return 'Pendiente';
    case 'stuck':
      return 'Estancada';
    default:
      return status || 'Pendiente';
  }
};

const contractorAccountStageLabel = (status: string) => {
  return CONTRACTOR_ACCOUNT_STAGE_LABELS[status as ContractorAccountStatus] || 'Revisión administrativa';
};

const supersedePreviousContractorAccountAlerts = async (
  supabase: any,
  projectId: string,
  taskId: string,
  nextAssigneeId: string,
  supersededAt: string,
) => {
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path, doc_id, data')
    .eq('collection_path', 'alerts')
    .eq('data->>projectId', projectId)
    .eq('data->>taskId', taskId)
    .eq('data->>type', 'administrative_approval');

  if (error) throw error;
  const activeAlerts = ((data || []) as AppDocumentRow[]).filter((row) =>
    !['read', 'superseded', 'dismissed'].includes(String(row.data?.status || 'unread'))
  );

  await Promise.all(activeAlerts.map((row) => upsertDocument(supabase, 'alerts', row.doc_id, {
    ...row.data,
    status: 'superseded',
    supersededAt,
    supersededByAssigneeId: nextAssigneeId,
    updatedAt: supersededAt,
  })));
};

const dateLabel = (value: unknown) => {
  if (!value) return 'Sin fecha límite';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return 'Sin fecha límite';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const shouldSendEmail = (preferences: any, projectId: string, organizationId: string) => {
  if (preferences?.taskAssignmentEmailEnabled === false) return false;
  if (Array.isArray(preferences?.disabledProjectIds) && preferences.disabledProjectIds.includes(projectId)) return false;
  if (organizationId && Array.isArray(preferences?.disabledOrganizationIds) && preferences.disabledOrganizationIds.includes(organizationId)) return false;
  return true;
};

const shouldSendPush = (preferences: any, projectId: string, organizationId: string) => {
  if (preferences?.taskAssignmentPushEnabled === false) return false;
  if (Array.isArray(preferences?.disabledProjectIds) && preferences.disabledProjectIds.includes(projectId)) return false;
  if (organizationId && Array.isArray(preferences?.disabledOrganizationIds) && preferences.disabledOrganizationIds.includes(organizationId)) return false;
  return true;
};

const normalizePushSubscriptionTarget = (row: AppDocumentRow): PixelPushTarget | null => {
  const subscription = row.data?.subscription;
  const endpoint = subscription?.endpoint || row.data?.endpoint;
  const keys = subscription?.keys;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return null;
  }

  return {
    id: row.doc_id,
    subscription: {
      ...subscription,
      endpoint,
      keys,
    },
  };
};

const findPushSubscriptions = async (supabase: any, userId: string, email: string) => {
  const queries = [];

  if (userId) {
    queries.push(
      supabase
        .from(DOCUMENTS_TABLE)
        .select('collection_path, doc_id, data')
        .eq('collection_path', 'push_subscriptions')
        .eq('data->>userId', userId)
    );
  }

  if (email) {
    queries.push(
      supabase
        .from(DOCUMENTS_TABLE)
        .select('collection_path, doc_id, data')
        .eq('collection_path', 'push_subscriptions')
        .eq('data->>email', email)
    );
  }

  const results = await Promise.all(queries);
  const byId = new Map<string, AppDocumentRow>();

  results.forEach(({ data, error }) => {
    if (error) throw error;
    (data || [])
      .filter((row: AppDocumentRow) => row.data?.isActive !== false)
      .forEach((row: AppDocumentRow) => byId.set(row.doc_id, row));
  });

  return Array.from(byId.values())
    .map(normalizePushSubscriptionTarget)
    .filter((target): target is PixelPushTarget => Boolean(target));
};

const deactivatePushSubscriptions = async (supabase: any, subscriptionIds: string[]) => {
  if (subscriptionIds.length === 0) return;
  const now = new Date().toISOString();

  await Promise.all(
    subscriptionIds.map(async (subscriptionId) => {
      const row = await getDocument(supabase, 'push_subscriptions', subscriptionId);
      if (!row) return;

      await upsertDocument(supabase, 'push_subscriptions', subscriptionId, {
        ...row.data,
        isActive: false,
        deactivatedAt: now,
        deactivationReason: 'push_subscription_expired',
        updatedAt: now,
      });
    })
  );
};

const resolveAssignee = async (supabase: any, assigneeId: string) => {
  const assigneeEmail = normalizeEmail(assigneeId.includes('@') ? assigneeId : '');
  const teamMemberById = await getDocument(supabase, 'team_members', assigneeId);
  const teamMember = teamMemberById || (
    assigneeEmail ? await findDocumentByEmail(supabase, 'team_members', assigneeEmail) : null
  );
  const teamData = teamMember?.data || {};
  const teamEmail = normalizeEmail(teamData.email || assigneeEmail);
  const authUserId = typeof teamData.authUserId === 'string' ? teamData.authUserId : '';

  const userById = authUserId
    ? await getDocument(supabase, 'users', authUserId)
    : await getDocument(supabase, 'users', assigneeId);
  const userByEmail = teamEmail ? await findDocumentByEmail(supabase, 'users', teamEmail) : null;
  const profile = userById || userByEmail;
  const profileData = profile?.data || {};
  const email = normalizeEmail(teamEmail || profileData.email);
  const displayName =
    teamData.name ||
    teamData.displayName ||
    profileData.displayName ||
    profileData.name ||
    email.split('@')[0] ||
    'Usuario';

  return {
    email,
    displayName,
    authUserId: profile?.doc_id || authUserId || assigneeId,
    teamMemberId: teamMember?.doc_id || assigneeId,
  };
};

export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminClient();
    const token = getBearerToken(request);
    const { data: requesterData, error: requesterError } = await supabase.auth.getUser(token);

    if (requesterError || !requesterData.user) {
      return json({ error: 'Sesión inválida.' }, 401);
    }

    const payload = await request.json();
    const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
    const taskId = typeof payload.taskId === 'string' ? payload.taskId.trim() : '';
    const requestedAssigneeId = typeof payload.assigneeId === 'string' ? payload.assigneeId.trim() : '';
    const stepIndex = Number.isFinite(Number(payload.stepIndex)) ? Number(payload.stepIndex) : null;
    const eventType = payload.eventType === 'workflow_step_assigned'
      ? 'workflow_step_assigned'
      : payload.eventType === 'contractor_account_assigned'
        ? 'contractor_account_assigned'
        : 'task_assigned';
    const isContractorAccountAssignment = eventType === 'contractor_account_assigned';
    const assignmentStage = typeof payload.assignmentStage === 'string' ? payload.assignmentStage.trim() : '';
    const requestedNotificationEventId = typeof payload.notificationEventId === 'string'
      ? payload.notificationEventId.trim().slice(0, 180)
      : '';

    if (!projectId || !taskId || !requestedAssigneeId || requestedAssigneeId === 'DYNAMIC') {
      return json({ skipped: true, reason: 'missing_required_data' });
    }

    const [projectRow, taskRow] = await Promise.all([
      getDocument(supabase, 'projects', projectId),
      getDocument(
        supabase,
        isContractorAccountAssignment
          ? `projects/${projectId}/contractorPaymentRequests`
          : `projects/${projectId}/tasks`,
        taskId
      ),
    ]);

    if (!taskRow) {
      return json({ error: isContractorAccountAssignment ? 'Cuenta de cobro no encontrada.' : 'Tarea no encontrada.' }, 404);
    }

    const task = taskRow.data || {};
    const authoritativeAccountStatus = String(task.status || 'submitted');
    const project = projectRow?.data || {};
    const authoritativeAccountStage = String(task.currentApprovalStage || task.status || 'submitted');
    const authoritativeAssignmentEventId = String(task.currentAssignmentEventId || '').trim().slice(0, 180);
    const persistedAccountAssignees = [
      task.currentApproverId,
      task.currentApproverMemberId,
      task.currentApproverAuthUserId,
      task.currentApproverEmail,
    ].map((value) => String(value || '').trim()).filter(Boolean);
    const requestedAssigneeKey = requestedAssigneeId.toLowerCase();

    if (isContractorAccountAssignment) {
      const stageIsCurrent = authoritativeAccountStage === authoritativeAccountStatus &&
        (!assignmentStage || assignmentStage === authoritativeAccountStage);
      const assigneeIsCurrent = persistedAccountAssignees.some(
        (value) => value.toLowerCase() === requestedAssigneeKey
      );
      const eventIsCurrent = !authoritativeAssignmentEventId ||
        requestedNotificationEventId === authoritativeAssignmentEventId;
      if (!stageIsCurrent || !assigneeIsCurrent || !eventIsCurrent) {
        return json({ skipped: true, reason: 'stale_contractor_account_assignment' });
      }
    }

    const assigneeId = isContractorAccountAssignment
      ? persistedAccountAssignees[0] || requestedAssigneeId
      : requestedAssigneeId;
    const notificationEventId = isContractorAccountAssignment
      ? authoritativeAssignmentEventId || authoritativeAccountStage
      : requestedNotificationEventId;
    const currentStep = eventType === 'workflow_step_assigned' && stepIndex !== null
      ? task.workflowSteps?.[stepIndex] || null
      : null;

    const resolvedAssignee = await resolveAssignee(supabase, assigneeId);
    const assignmentAttemptedAt = new Date().toISOString();
    if (!resolvedAssignee.email) {
      if (isContractorAccountAssignment) {
        await supersedePreviousContractorAccountAlerts(
          supabase,
          projectId,
          taskId,
          resolvedAssignee.authUserId || assigneeId,
          assignmentAttemptedAt
        );
      }
      return json({ skipped: true, reason: 'assignee_without_email' });
    }

    const eventKeyParts = [
      eventType,
      projectId,
      taskId,
      stepIndex ?? 'task',
      resolvedAssignee.email,
    ];
    if (isContractorAccountAssignment) {
      eventKeyParts.push(notificationEventId || assignmentStage || 'assignment');
    }
    const eventKey = eventKeyParts.join(':');

    const existingEvent = await getDocument(supabase, 'notification_events', eventKey);
    if (existingEvent) {
      return json({ skipped: true, reason: 'duplicate_event' });
    }

    const organizationId =
      task.organizationId ||
      project.organizationId ||
      (Array.isArray(project.organizationIds) ? project.organizationIds[0] : '') ||
      '';
    const organizationRow = organizationId ? await getDocument(supabase, 'organizations', organizationId) : null;
    const organizationName =
      task.organizationName ||
      project.organizationName ||
      organizationRow?.data?.name ||
      organizationRow?.data?.displayName ||
      'Sin organización';

    const preferenceById = await getDocument(supabase, 'alert_preferences', resolvedAssignee.authUserId);
    const preferenceByEmail = await findDocumentByEmail(supabase, 'alert_preferences', resolvedAssignee.email);
    const preferences = preferenceById?.data || preferenceByEmail?.data || {};
    const emailEnabled = shouldSendEmail(preferences, projectId, organizationId);
    const pushEnabled = shouldSendPush(preferences, projectId, organizationId);

    const appUrl = appUrlFromRequest(request);
    const actionUrl = isContractorAccountAssignment
      ? `${appUrl}/projects/${encodeURIComponent(projectId)}?tab=administration&workspace=contractorAccounts&contractorAccountId=${encodeURIComponent(taskId)}`
      : `${appUrl}/workflows?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`;
    const accountStage = isContractorAccountAssignment ? authoritativeAccountStage : assignmentStage;
    const taskTitle = isContractorAccountAssignment
      ? `${accountStage === 'returned' ? 'Corregir' : 'Revisar'} cuenta de cobro de ${task.contractorName || 'contratista'}`
      : `${task.externalWorkflowId ? `[${task.externalWorkflowId}] ` : ''}${task.title || task.name || 'Tarea sin nombre'}`;
    const status = isContractorAccountAssignment ? 'pending' : currentStep?.status || task.status || 'pending';
    const taskTypeLabel = isContractorAccountAssignment
      ? `Cuenta de cobro · ${contractorAccountStageLabel(accountStage)}`
      : eventType === 'workflow_step_assigned'
        ? `Workflow · Paso ${stepIndex !== null ? stepIndex + 1 : ''}`
        : 'Tarea asignada';
    const description = isContractorAccountAssignment
      ? accountStage === 'returned'
        ? `La cuenta del periodo ${dateLabel(task.periodStart)} al ${dateLabel(task.periodEnd)} fue devuelta y requiere corrección.`
        : `Tienes pendiente la etapa ${contractorAccountStageLabel(accountStage)} para la cuenta del periodo ${dateLabel(task.periodStart)} al ${dateLabel(task.periodEnd)}.`
      : task.initialObservation ||
        task.description ||
        currentStep?.label ||
        'Tienes una nueva actividad pendiente en tu bandeja.';
    const emailSubjectTemplate =
      typeof preferences.taskAssignmentEmailSubject === 'string' && preferences.taskAssignmentEmailSubject.trim()
        ? preferences.taskAssignmentEmailSubject.trim()
        : DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT;
    const emailIntroTemplate =
      typeof preferences.taskAssignmentEmailIntro === 'string' && preferences.taskAssignmentEmailIntro.trim()
        ? preferences.taskAssignmentEmailIntro.trim()
        : DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO;

    const emailData = {
      appUrl,
      assigneeName: resolvedAssignee.displayName,
      taskTitle,
      projectName: project.name || project.title || task.projectName || 'Proyecto',
      organizationName,
      priorityLabel: priorityLabel(isContractorAccountAssignment ? 'high' : task.priority || 'medium'),
      statusLabel: statusLabel(status),
      dueDateLabel: dateLabel(isContractorAccountAssignment ? task.periodEnd : task.endDate || task.end),
      taskTypeLabel,
      description,
      actionUrl,
      introTemplate: emailIntroTemplate,
    };

    const now = assignmentAttemptedAt;
    if (isContractorAccountAssignment) {
      await supersedePreviousContractorAccountAlerts(
        supabase,
        projectId,
        taskId,
        resolvedAssignee.authUserId || assigneeId,
        now
      );
    }
    const alertId = `${eventKey}:alert`;
    await upsertDocument(supabase, 'alerts', alertId, {
      userId: resolvedAssignee.authUserId,
      email: resolvedAssignee.email,
      type: isContractorAccountAssignment ? 'administrative_approval' : 'task_assignment',
      status: 'unread',
      title: isContractorAccountAssignment ? 'Cuenta de cobro pendiente' : 'Nueva tarea en tu bandeja',
      message: `${emailData.taskTitle} · ${emailData.projectName}`,
      projectId,
      taskId,
      organizationId: organizationId || null,
      eventType,
      stepIndex,
      actionUrl,
      createdAt: now,
      updatedAt: now,
    });

    let emailResult: any = { skipped: true, reason: 'disabled_by_preferences' };
    if (emailEnabled) {
      emailResult = await sendEmailWithResend({
        to: resolvedAssignee.email,
        subject: buildTaskAssignmentSubject(emailData, emailSubjectTemplate),
        html: buildTaskAssignmentEmailHtml(emailData),
        text: buildTaskAssignmentText(emailData),
        idempotencyKey: eventKey,
      });
    }

    let pushResult: any = { skipped: true, reason: 'disabled_by_preferences' };
    if (pushEnabled) {
      const pushTargets = await findPushSubscriptions(supabase, resolvedAssignee.authUserId, resolvedAssignee.email);
      pushResult = await sendPixelPushBatch(pushTargets, {
        title: isContractorAccountAssignment
          ? 'Cuenta de cobro pendiente'
          : eventType === 'workflow_step_assigned'
            ? 'Nuevo paso de workflow'
            : 'Nueva tarea asignada',
        body: `${emailData.taskTitle} · ${emailData.projectName}`,
        url: actionUrl,
        tag: eventKey,
        data: {
          eventType,
          projectId,
          taskId,
          stepIndex,
          organizationId: organizationId || null,
          assignmentStage: assignmentStage || null,
        },
      });

      if (Array.isArray(pushResult.expiredIds) && pushResult.expiredIds.length > 0) {
        await deactivatePushSubscriptions(supabase, pushResult.expiredIds);
      }
    }

    await upsertDocument(supabase, 'notification_events', eventKey, {
      eventKey,
      eventType,
      projectId,
      taskId,
      assigneeId,
      assigneeEmail: resolvedAssignee.email,
      assigneeUserId: resolvedAssignee.authUserId,
      stepIndex,
      assignmentStage: assignmentStage || null,
      notificationEventId: notificationEventId || null,
      source: payload.source || null,
      emailEnabled,
      emailResult,
      pushEnabled,
      pushResult,
      createdAt: now,
      createdBy: requesterData.user.id,
    });

    return json({
      ok: true,
      email: emailResult,
      push: pushResult,
    });
  } catch (error: any) {
    console.error('Error sending task assignment notification:', error);
    return json({ error: error.message || 'No fue posible enviar la notificación.' }, 500);
  }
}
