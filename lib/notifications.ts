import { supabase } from '@/lib/backend';

export type TaskAssignmentNotificationPayload = {
  projectId: string;
  taskId: string;
  assigneeId?: string | null;
  stepIndex?: number | null;
  eventType?: 'task_assigned' | 'workflow_step_assigned' | 'contractor_account_assigned';
  assignmentStage?: string | null;
  notificationEventId?: string | null;
  source?: string;
};

export type TaskAssignmentNotificationResult = {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  status?: number;
  email?: any;
  push?: any;
};

export type AdvanceRequestNotificationPayload = {
  projectId: string;
  advanceId: string;
};

export type AdvanceRequestNotificationResult = {
  ok?: boolean;
  skipped?: boolean | number;
  reason?: string;
  error?: string;
  status?: number;
  notified?: number;
  failed?: number;
  partial?: number;
  results?: any[];
};

export const notifyTaskAssignment = async (payload: TaskAssignmentNotificationPayload) => {
  if (!payload.projectId || !payload.taskId || !payload.assigneeId || payload.assigneeId === 'DYNAMIC') {
    return { skipped: true, reason: 'missing_required_data' } satisfies TaskAssignmentNotificationResult;
  }

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      return { skipped: true, reason: 'missing_session' } satisfies TaskAssignmentNotificationResult;
    }

    const response = await fetch('/api/notifications/task-assigned', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      console.warn('Task assignment notification skipped:', body?.error || response.statusText);
      return {
        ...(body || {}),
        ok: false,
        status: response.status,
        error: body?.error || response.statusText,
      } satisfies TaskAssignmentNotificationResult;
    }

    return {
      ...(body || {}),
      ok: true,
      status: response.status,
    } satisfies TaskAssignmentNotificationResult;
  } catch (error) {
    console.warn('Task assignment notification failed:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'notification_failed',
    } satisfies TaskAssignmentNotificationResult;
  }
};

export const notifyAdvanceRequestSubmitted = async (
  payload: AdvanceRequestNotificationPayload,
) => {
  if (!payload.projectId || !payload.advanceId) {
    return { skipped: true, reason: 'missing_required_data' } satisfies AdvanceRequestNotificationResult;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      return { skipped: true, reason: 'missing_session' } satisfies AdvanceRequestNotificationResult;
    }

    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch('/api/notifications/advance-requested', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn('Advance request notification skipped:', body?.error || response.statusText);
      return {
        ...(body || {}),
        ok: false,
        status: response.status,
        error: body?.error || response.statusText,
      } satisfies AdvanceRequestNotificationResult;
    }

    return {
      ...(body || {}),
      ok: body?.ok === true,
      status: response.status,
    } satisfies AdvanceRequestNotificationResult;
  } catch (error) {
    console.warn('Advance request notification failed:', error);
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        reason: 'notification_timeout',
        error: 'notification_timeout',
      } satisfies AdvanceRequestNotificationResult;
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'notification_failed',
    } satisfies AdvanceRequestNotificationResult;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
};
