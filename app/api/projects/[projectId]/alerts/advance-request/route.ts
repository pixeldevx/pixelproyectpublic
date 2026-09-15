import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ensureProjectAccess, writeDocument } from '@/lib/github/server';
import { getBootstrapAdminEmailSet } from '@/lib/bootstrap-admins';
import {
  ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE,
  ADVANCE_REQUEST_NOTIFICATION_RULE_ID,
  MAX_ADVANCE_NOTIFICATION_RECIPIENTS,
  getActorAdministrationPermissions,
  getAdvanceRequestNotificationCollectionPath,
  loadAdvanceRequestNotificationRule,
  normalizeAdvanceRequestNotificationRule,
  resolveAdvanceRequestNotificationCandidates,
} from '@/lib/notifications/advance-request-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;
const TRUSTED_NOTIFICATION_ADMIN_EMAILS = getBootstrapAdminEmailSet();

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status });

const cleanText = (value: unknown, maxLength = 300) =>
  String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const cleanIdentifier = (value: unknown, maxLength = 180) => {
  const identifier = String(value || '').trim().slice(0, maxLength);
  return /^[A-Za-z0-9_-]+$/.test(identifier) ? identifier : '';
};

const getActorName = (actor: any) => cleanText(
  actor?.profile?.displayName || actor?.profile?.name || actor?.profile?.fullName || actor?.email || 'Usuario',
  240,
);

const parseBody = async (request: Request) => {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : {};
  } catch {
    return {};
  }
};

const isProtectedNotificationAdministrator = async (supabase: any, actor: any) => {
  const actorId = cleanIdentifier(actor?.id);
  const actorEmail = cleanText(actor?.email, 320).toLowerCase();
  if (!actorId || !actorEmail) return false;

  const { data, error } = await supabase
    .from('app_documents')
    .select('data')
    .eq('collection_path', 'notification_configuration_admins')
    .eq('doc_id', actorId)
    .maybeSingle();
  if (error) throw error;

  return data?.data?.active !== false
    && cleanText(data?.data?.userId, 180) === actorId
    && cleanText(data?.data?.email, 320).toLowerCase() === actorEmail;
};

const authorize = async (request: NextRequest, projectId: string) => {
  const access = await ensureProjectAccess(request, projectId);
  if (access.error) return { error: access.error } as const;
  const { settings, permissions } = await getActorAdministrationPermissions(access.supabase, access.actor);
  const actorEmail = String(access.actor.email || '').trim().toLowerCase();
  const canManage = TRUSTED_NOTIFICATION_ADMIN_EMAILS.has(actorEmail)
    || await isProtectedNotificationAdministrator(access.supabase, access.actor);
  if (!canManage && permissions.administrationProjectView !== true) {
    return {
      error: json({ error: 'No tienes permiso para consultar la configuración administrativa de este proyecto.' }, 403),
    } as const;
  }
  return { access, settings, canManage } as const;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId: rawProjectId } = await context.params;
    const projectId = cleanIdentifier(rawProjectId);
    if (!projectId) return json({ error: 'El proyecto es obligatorio.' }, 400);

    const authorized = await authorize(request, projectId);
    if ('error' in authorized) return authorized.error;
    const { access, settings, canManage } = authorized;
    const [{ rule }, candidates] = await Promise.all([
      loadAdvanceRequestNotificationRule(access.supabase, projectId),
      resolveAdvanceRequestNotificationCandidates(access.supabase, access.project, settings),
    ]);
    const visibleCandidates = canManage
      ? candidates
      : candidates
        .filter((candidate) => rule.recipientIds.includes(candidate.id))
        .map((candidate) => ({
          id: candidate.id,
          authUserId: candidate.authUserId,
          name: candidate.name,
          roleName: candidate.roleName,
          email: null,
        }));

    return json({
      rule,
      candidates: visibleCandidates,
      canManage,
    });
  } catch (error: any) {
    console.error('Error loading advance notification settings:', error);
    return json({ error: error?.message || 'No fue posible cargar la configuración.' }, 500);
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId: rawProjectId } = await context.params;
    const projectId = cleanIdentifier(rawProjectId);
    if (!projectId) return json({ error: 'El proyecto es obligatorio.' }, 400);

    const authorized = await authorize(request, projectId);
    if ('error' in authorized) return authorized.error;
    const { access, settings, canManage } = authorized;
    if (!canManage) {
      return json({ error: 'Solo un administrador global autorizado puede configurar estos destinatarios.' }, 403);
    }

    const body = await parseBody(request);
    if (!body) return json({ error: 'La configuración supera el límite permitido.' }, 413);
    if (!Array.isArray(body.recipientIds)) {
      return json({ error: 'La lista de destinatarios no es válida.' }, 400);
    }

    const requestedRecipientIds = Array.from(
      new Set(body.recipientIds.map((value: unknown) => cleanText(value, 180)).filter(Boolean)),
    );
    if (requestedRecipientIds.length > MAX_ADVANCE_NOTIFICATION_RECIPIENTS) {
      return json({ error: `Puedes seleccionar hasta ${MAX_ADVANCE_NOTIFICATION_RECIPIENTS} personas.` }, 400);
    }

    const candidates = await resolveAdvanceRequestNotificationCandidates(
      access.supabase,
      access.project,
      settings,
    );
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const recipientIds = requestedRecipientIds.filter((recipientId) => candidateIds.has(recipientId));
    const removedRecipientCount = requestedRecipientIds.length - recipientIds.length;
    const { stored, rule: previousRule } = await loadAdvanceRequestNotificationRule(access.supabase, projectId);
    const changedAt = new Date().toISOString();
    const actorName = getActorName(access.actor);
    const version = previousRule.version + 1;
    const nextRule = normalizeAdvanceRequestNotificationRule({
      enabled: body.enabled !== false,
      recipientIds,
      channels: {
        inApp: true,
        email: body.channels?.email !== false,
        push: body.channels?.push !== false,
      },
      version,
    });
    const previousHistory = Array.isArray(stored?.history) ? stored.history.slice(-49) : [];

    await writeDocument(
      access.supabase,
      getAdvanceRequestNotificationCollectionPath(projectId),
      ADVANCE_REQUEST_NOTIFICATION_RULE_ID,
      {
        projectId,
        eventType: ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE,
        ...nextRule,
        createdAt: stored?.createdAt || changedAt,
        createdBy: stored?.createdBy || access.actor.id,
        createdByName: stored?.createdByName || actorName,
        createdByEmail: stored?.createdByEmail || access.actor.email,
        updatedAt: changedAt,
        updatedBy: access.actor.id,
        updatedByName: actorName,
        updatedByEmail: access.actor.email,
        history: [
          ...previousHistory,
          {
            version,
            at: changedAt,
            actorId: access.actor.id,
            actorName,
            actorEmail: access.actor.email,
            enabled: nextRule.enabled,
            recipientIds: nextRule.recipientIds,
            channels: nextRule.channels,
            removedRecipientCount,
          },
        ],
      },
      false,
    );

    return json({
      rule: nextRule,
      candidates,
      canManage: true,
      removedRecipientCount,
    });
  } catch (error: any) {
    console.error('Error saving advance notification settings:', error);
    return json({ error: error?.message || 'No fue posible guardar la configuración.' }, 500);
  }
}
