import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  canAccessProject,
  ensureProjectAccess,
  getAppBaseUrl,
  getServerSupabase,
  readDocument,
  writeDocument,
} from '@/lib/github/server';
import {
  buildAdvanceRequestNotificationHtml,
  buildAdvanceRequestNotificationSubject,
  buildAdvanceRequestNotificationText,
} from '@/lib/email/advance-request-template';
import { sendEmailWithResend } from '@/lib/email/resend';
import {
  ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE,
  getActorAdministrationPermissions,
  loadAdvanceRequestNotificationRule,
  loadRolePermissionSettings,
  normalizeAdvanceRequestNotificationRule,
  resolveAdvanceRequestNotificationCandidates,
  type AdvanceRequestNotificationCandidate,
} from '@/lib/notifications/advance-request-settings';
import { sendPixelPushBatch, type PixelPushTarget } from '@/lib/push/web-push';
import { verifyPushSubscriptionAttestation } from '@/lib/push/subscription-attestation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOCUMENTS_TABLE = 'app_documents';
const MAX_BODY_BYTES = 8 * 1024;
const DELIVERY_LEASE_MS = 5 * 60 * 1_000;
const DELIVERY_BATCH_SIZE = 5;
const DELIVERY_COLLECTION = 'administrativeNotificationDeliveries';

type AppDocumentRow = {
  collection_path: string;
  doc_id: string;
  data: Record<string, any>;
  created_at?: string;
  updated_at?: string;
};

type DeliveryClaim =
  | { claimed: true; claimId: string; state: Record<string, any> }
  | { claimed: false; reason: 'duplicate_event' | 'delivery_in_progress' };

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status });

const cleanText = (value: unknown, maxLength = 1_000) =>
  String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const cleanIdentifier = (value: unknown, maxLength = 180) => {
  const identifier = String(value || '').trim().slice(0, maxLength);
  return /^[A-Za-z0-9_-]+$/.test(identifier) ? identifier : '';
};

const secureEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isAuthorizedCronRequest = (request: NextRequest) => {
  const secret = String(process.env.CRON_SECRET || '');
  const authorization = request.headers.get('authorization') || '';
  return Boolean(secret) && secureEqual(authorization, `Bearer ${secret}`);
};

const normalizeEmail = (value: unknown) => cleanText(value, 320).toLowerCase();

const isMissingAuthUserError = (error: any) => {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = cleanText(error?.code, 80).toLowerCase();
  const message = cleanText(error?.message, 240).toLowerCase();
  return status === 404
    || code === 'user_not_found'
    || message === 'user not found';
};

const stableId = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

const withoutDocumentMetadata = (value: Record<string, any> | null | undefined) =>
  Object.fromEntries(
    Object.entries(value || {}).filter(([key]) => key !== 'id' && !key.startsWith('_')),
  );

const getDeliveryCollectionPath = (projectId: string) =>
  `projects/${projectId}/${DELIVERY_COLLECTION}`;

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

const getOrganizationIds = (value: Record<string, any>) =>
  Array.from(new Set([
    value?.organizationId,
    ...(Array.isArray(value?.organizationIds) ? value.organizationIds : []),
  ].map((entry) => cleanText(entry, 180)).filter(Boolean)));

const formatMoney = (value: unknown) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

const formatDate = (value: unknown) => {
  if (!value) return 'Sin fecha';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return cleanText(value, 80) || 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const getActorIdentitySet = (actor: any) => new Set([
  actor?.id,
  actor?.email,
  actor?.profile?.id,
  actor?.profile?.uid,
  actor?.profile?.authUserId,
].map((entry) => cleanText(entry, 320).toLowerCase()).filter(Boolean));

const actorCreatedAdvance = (actor: any, advance: Record<string, any>) => {
  const identities = getActorIdentitySet(actor);
  return [advance.createdBy, advance.requesterEmail]
    .map((entry) => cleanText(entry, 320).toLowerCase())
    .filter(Boolean)
    .some((entry) => identities.has(entry));
};

const isActiveProfile = (value: Record<string, any> | null | undefined) => {
  if (!value) return true;
  if (value.active === false || value.isActive === false || value.disabled === true) return false;
  const status = cleanText(value.status, 40).toLowerCase();
  return !['inactive', 'disabled', 'deleted', 'archived', 'suspended'].includes(status);
};

const readProfileByAuthIdentity = async (supabase: any, userId: string, email: string) => {
  const byId = await readDocument(supabase, 'users', userId);
  if (byId) return byId;
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('doc_id,data,created_at,updated_at')
    .eq('collection_path', 'users')
    .eq('data->>email', email)
    .limit(1);
  if (error) throw error;
  const row = (data || [])[0];
  return row
    ? { ...(row.data || {}), id: row.doc_id, _createdAt: row.created_at, _updatedAt: row.updated_at }
    : null;
};

const readCreatorMembership = async (
  supabase: any,
  authUserId: string,
  email: string,
) => {
  const matchesIdentity = (member: Record<string, any> | null | undefined) => {
    if (!member) return false;
    const memberIds = [member.authUserId, member.uid, member.userId]
      .map((value) => cleanIdentifier(value))
      .filter(Boolean);
    return memberIds.includes(authUserId) || normalizeEmail(member.email) === email;
  };
  const byId = await readDocument(supabase, 'team_members', authUserId);
  if (matchesIdentity(byId)) return byId;

  const queries = [
    ['authUserId', authUserId],
    ['uid', authUserId],
    ['email', email],
  ].map(([field, value]) => supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path,doc_id,data,created_at,updated_at')
    .eq('collection_path', 'team_members')
    .eq(`data->>${field}`, value)
    .limit(5));
  const queryResults = await Promise.all(queries);
  const rows: AppDocumentRow[] = [];
  queryResults.forEach(({ data, error }) => {
    if (error) throw error;
    rows.push(...(data || []));
  });
  const row = rows.find((candidate) => {
    const member = { ...(candidate.data || {}), id: candidate.doc_id };
    return matchesIdentity(member);
  });
  return row
    ? { ...(row.data || {}), id: row.doc_id, _createdAt: row.created_at, _updatedAt: row.updated_at }
    : null;
};

const getAttestedAdvanceSnapshot = async (
  supabase: any,
  projectId: string,
  advanceId: string,
) => {
  const { data, error } = await supabase.rpc(
    'app_get_attested_advance_request',
    {
      p_project_id: projectId,
      p_advance_id: advanceId,
    },
  );
  if (error) {
    console.error('Advance request attestation verification failed:', error);
    throw error;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { _notificationRule: ruleSnapshot, ...advance } = data as Record<string, any>;
  const rule = normalizeAdvanceRequestNotificationRule(
    ruleSnapshot && typeof ruleSnapshot === 'object' && !Array.isArray(ruleSnapshot)
      ? ruleSnapshot
      : null,
  );
  if (!rule.enabled || rule.recipientIds.length === 0) return null;
  return { advance, rule };
};

const resolveVerifiedAdvanceCreator = async (
  supabase: any,
  project: Record<string, any>,
  advance: Record<string, any>,
) => {
  const createdBy = cleanIdentifier(advance.createdBy);
  if (!createdBy) return null;

  const { data, error } = await supabase.auth.admin.getUserById(createdBy);
  if (error && !isMissingAuthUserError(error)) throw error;
  const authUser = data?.user;
  const email = normalizeEmail(authUser?.email);
  const bannedUntil = authUser?.banned_until
    ? new Date(String(authUser.banned_until)).getTime()
    : Number.NaN;
  const blocked = Number.isFinite(bannedUntil) && bannedUntil > Date.now();
  if (!authUser || !email || blocked || authUser.deleted_at) return null;
  if (normalizeEmail(advance.requesterEmail) !== email) return null;

  const [profile, member] = await Promise.all([
    readProfileByAuthIdentity(supabase, createdBy, email),
    readCreatorMembership(supabase, createdBy, email),
  ]);
  if (!isActiveProfile(profile) || !isActiveProfile(member)) return null;

  const role = cleanText(
    profile?.role || profile?.systemRole || member?.systemRole || member?.profileRole || member?.role || 'user',
    80,
  ).toLowerCase();
  const actor = {
    id: createdBy,
    email,
    role,
    profile: {
      ...(member || {}),
      ...(profile || {}),
      id: member?.id || profile?.id || createdBy,
      uid: createdBy,
      authUserId: createdBy,
    },
  };
  return canAccessProject(actor, project) ? actor : null;
};

const normalizePushSubscriptionTarget = (
  row: AppDocumentRow,
  expectedUserId: string,
): PixelPushTarget | null => {
  const subscription = row.data?.subscription;
  const endpoint = subscription?.endpoint || row.data?.endpoint;
  const keys = subscription?.keys;
  if (!endpoint || !keys?.p256dh || !keys?.auth) return null;
  if (String(row.data?.userId || '') !== expectedUserId) return null;
  if (!verifyPushSubscriptionAttestation(
    row.data?.serverAttestation,
    {
      subscriptionId: row.doc_id,
      userId: expectedUserId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  )) return null;
  return {
    id: row.doc_id,
    subscription: { ...subscription, endpoint, keys },
  };
};

const findPushSubscriptions = async (supabase: any, userId: string, email: string) => {
  const queries: PromiseLike<any>[] = [];
  if (userId) {
    queries.push(
      supabase
        .from(DOCUMENTS_TABLE)
        .select('collection_path,doc_id,data')
        .eq('collection_path', 'push_subscriptions')
        .eq('data->>userId', userId),
    );
  }
  if (email) {
    queries.push(
      supabase
        .from(DOCUMENTS_TABLE)
        .select('collection_path,doc_id,data')
        .eq('collection_path', 'push_subscriptions')
        .eq('data->>email', email),
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
    .map((row) => normalizePushSubscriptionTarget(row, userId))
    .filter((target): target is PixelPushTarget => Boolean(target));
};

const deactivatePushSubscriptions = async (supabase: any, subscriptionIds: string[]) => {
  const changedAt = new Date().toISOString();
  await Promise.all(subscriptionIds.map(async (subscriptionId) => {
    const current = await readDocument(supabase, 'push_subscriptions', subscriptionId);
    if (!current) return;
    const currentData = Object.fromEntries(
      Object.entries(current).filter(([key]) => key !== 'id' && !key.startsWith('_')),
    );
    await writeDocument(supabase, 'push_subscriptions', subscriptionId, {
      ...currentData,
      isActive: false,
      deactivatedAt: changedAt,
      deactivationReason: 'push_subscription_expired',
      updatedAt: changedAt,
    }, false);
  }));
};

const claimDeliveryEvent = async (
  supabase: any,
  collectionPath: string,
  eventId: string,
  data: Record<string, any>,
): Promise<DeliveryClaim> => {
  const now = new Date().toISOString();
  const claimId = crypto.randomUUID();
  const leaseUntil = new Date(Date.now() + DELIVERY_LEASE_MS).toISOString();
  const initialState = {
    ...data,
    status: 'processing',
    attempts: 1,
    claimId,
    leaseUntil,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase.from(DOCUMENTS_TABLE).insert({
    collection_path: collectionPath,
    doc_id: eventId,
    data: initialState,
    created_at: now,
    updated_at: now,
  });
  if (!error) return { claimed: true, claimId, state: initialState };
  if (error.code !== '23505') throw error;

  const existing = await readDocument(supabase, collectionPath, eventId);
  if (!existing) throw new Error('No fue posible recuperar la reserva de entrega.');
  if (existing.status === 'completed') {
    return { claimed: false, reason: 'duplicate_event' };
  }

  const leaseExpiresAt = new Date(String(existing.leaseUntil || '')).getTime();
  if (existing.status === 'processing' && Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now()) {
    return { claimed: false, reason: 'delivery_in_progress' };
  }

  const nextState = {
    ...withoutDocumentMetadata(existing),
    ...data,
    status: 'processing',
    attempts: Math.max(1, Number(existing.attempts) || 1) + 1,
    claimId,
    leaseUntil,
    lastAttemptAt: now,
    updatedAt: now,
  };
  const { data: claimedRow, error: claimError } = await supabase
    .from(DOCUMENTS_TABLE)
    .update({ data: nextState, updated_at: now })
    .eq('collection_path', collectionPath)
    .eq('doc_id', eventId)
    .eq('updated_at', existing._updatedAt)
    .select('data')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimedRow) return { claimed: false, reason: 'delivery_in_progress' };
  return { claimed: true, claimId, state: claimedRow.data || nextState };
};

const persistDeliveryState = async (
  supabase: any,
  collectionPath: string,
  eventId: string,
  claimId: string,
  currentState: Record<string, any>,
  patch: Record<string, any>,
) => {
  const updatedAt = new Date().toISOString();
  const nextState = {
    ...withoutDocumentMetadata(currentState),
    ...patch,
    claimId,
    updatedAt,
  };
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .update({ data: nextState, updated_at: updatedAt })
    .eq('collection_path', collectionPath)
    .eq('doc_id', eventId)
    .eq('data->>claimId', claimId)
    .select('data')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('La reserva de entrega expiró antes de completar el aviso.');
  return data.data || nextState;
};

const verifyRecipientIdentity = async (
  supabase: any,
  candidate: AdvanceRequestNotificationCandidate,
) => {
  const { data, error } = await supabase.auth.admin.getUserById(candidate.authUserId);
  if (error && !isMissingAuthUserError(error)) throw error;
  const authUser = data?.user;
  const email = normalizeEmail(authUser?.email);
  const bannedUntil = authUser?.banned_until
    ? new Date(String(authUser.banned_until)).getTime()
    : Number.NaN;
  const blocked = Number.isFinite(bannedUntil) && bannedUntil > Date.now();
  if (!authUser || !email || blocked || authUser.deleted_at) {
    console.warn('Advance notification recipient no longer has a valid Auth identity:', {
      recipientId: candidate.id,
      blocked,
      error: cleanText(error?.message, 300),
    });
    return null;
  }
  return {
    ...candidate,
    email,
    emailVerified: Boolean(authUser.email_confirmed_at || authUser.confirmed_at),
  };
};

type VerifiedAdvanceRequestNotificationCandidate = AdvanceRequestNotificationCandidate & {
  emailVerified: boolean;
};

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request);
    if (!body) return json({ error: 'La solicitud supera el límite permitido.' }, 413);
    const projectId = cleanIdentifier(body.projectId);
    const advanceId = cleanIdentifier(body.advanceId);
    if (!projectId || !advanceId) {
      return json({ error: 'El proyecto y el anticipo son obligatorios.' }, 400);
    }

    const cronInvocation = isAuthorizedCronRequest(request);
    let access: {
      supabase: any;
      actor: any;
      project: Record<string, any>;
    };
    let settings;
    let canValidateAdvance = false;

    if (cronInvocation) {
      const supabase = getServerSupabase();
      const project = await readDocument(supabase, 'projects', projectId);
      if (!project) return json({ error: 'El proyecto no existe.' }, 404);
      access = {
        supabase,
        project,
        actor: {
          id: 'system:advance-notification-reconciler',
          email: '',
          role: 'system',
          profile: {},
        },
      };
      settings = await loadRolePermissionSettings(supabase);
    } else {
      const userAccess = await ensureProjectAccess(request, projectId);
      if (userAccess.error) return userAccess.error;
      access = userAccess;
      const actorAdministration = await getActorAdministrationPermissions(
        access.supabase,
        access.actor,
      );
      settings = actorAdministration.settings;
      canValidateAdvance = actorAdministration.permissions.administrationProjectValidate;
    }

    const attestedSubmission = await getAttestedAdvanceSnapshot(
      access.supabase,
      projectId,
      advanceId,
    );
    if (!attestedSubmission) {
      if (cronInvocation) {
        return json({ skipped: true, reason: 'unattested_advance' });
      }
      const { stored, rule: currentRule } = await loadAdvanceRequestNotificationRule(
        access.supabase,
        projectId,
      );
      if (!stored || currentRule.recipientIds.length === 0) {
        return json({ ok: true, skipped: true, reason: 'no_configured_recipients' });
      }
      if (!currentRule.enabled) {
        return json({ ok: true, skipped: true, reason: 'rule_disabled' });
      }
      return json({ error: 'No fue posible verificar la radicación original del anticipo.' }, 409);
    }
    const { advance, rule } = attestedSubmission;
    if (cleanIdentifier(advance.projectId) !== projectId) {
      return cronInvocation
        ? json({ skipped: true, reason: 'invalid_advance_project' })
        : json({ error: 'La solicitud no pertenece al proyecto indicado.' }, 409);
    }
    if (cleanText(advance.status, 60).toLowerCase() !== 'submitted') {
      return json({ skipped: true, reason: 'advance_not_submitted' });
    }

    // Resolve the creator for both the immediate request and the reconciler.
    // Visible attribution and recipient exclusion never trust requesterId or a
    // display name supplied by the browser.
    const verifiedCreator = await resolveVerifiedAdvanceCreator(
      access.supabase,
      access.project,
      advance,
    );
    if (!verifiedCreator) {
      return json({ skipped: true, reason: 'unverified_advance_creator' });
    }
    if (!cronInvocation && !actorCreatedAdvance(access.actor, advance) && !canValidateAdvance) {
      return json({ error: 'Solo quien radicó el anticipo puede activar este aviso.' }, 403);
    }

    const candidates = await resolveAdvanceRequestNotificationCandidates(
      access.supabase,
      access.project,
      settings,
    );

    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const requesterEmail = normalizeEmail(verifiedCreator.email);
    const requesterUserId = cleanIdentifier(verifiedCreator.id);
    const configuredCandidates = rule.recipientIds
      .map((recipientId) => candidateById.get(recipientId))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    const verifiedCandidates: VerifiedAdvanceRequestNotificationCandidate[] = [];
    for (let index = 0; index < configuredCandidates.length; index += DELIVERY_BATCH_SIZE) {
      const batch = await Promise.all(
        configuredCandidates
          .slice(index, index + DELIVERY_BATCH_SIZE)
          .map((candidate) => verifyRecipientIdentity(access.supabase, candidate)),
      );
      verifiedCandidates.push(...batch.filter(
        (candidate): candidate is VerifiedAdvanceRequestNotificationCandidate => Boolean(candidate),
      ));
    }
    const recipients = verifiedCandidates.filter(
      (candidate) => candidate.email !== requesterEmail
        && candidate.authUserId !== requesterUserId
        && candidate.id !== requesterUserId,
    );
    if (recipients.length === 0) {
      return json({ skipped: true, reason: 'no_eligible_recipients' });
    }

    const organizationIds = getOrganizationIds(access.project);
    const organizationId = organizationIds[0] || '';
    const organization = organizationId
      ? await readDocument(access.supabase, 'organizations', organizationId)
      : null;
    const organizationName = cleanText(
      advance.organizationName || access.project.organizationName || organization?.name || organization?.displayName || 'Sin organización',
      240,
    );
    const projectName = cleanText(access.project.name || access.project.title || 'Proyecto', 240);
    const requesterName = cleanText(
      verifiedCreator.email || 'Una persona del equipo',
      240,
    );
    const actionUrl = `${getAppBaseUrl(request)}/projects/${encodeURIComponent(projectId)}?tab=administration&workspace=advances&advanceId=${encodeURIComponent(advanceId)}`;
    const now = new Date().toISOString();
    const requestEventKey = `${ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE}:${projectId}:${advanceId}`;
    const deliveryCollectionPath = getDeliveryCollectionPath(projectId);

    const deliverRecipient = async (recipient: (typeof recipients)[number]) => {
      const recipientKey = recipient.authUserId || recipient.email;
      const eventKey = `${requestEventKey}:${recipientKey}`;
      const eventId = `advance-request-${stableId(eventKey)}`;
      let activeClaim: Extract<DeliveryClaim, { claimed: true }> | null = null;
      let deliveryState: Record<string, any> | null = null;
      try {
        const claim = await claimDeliveryEvent(access.supabase, deliveryCollectionPath, eventId, {
          eventKey,
          eventType: ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE,
          projectId,
          advanceId,
          recipientId: recipient.id,
          recipientUserId: recipient.authUserId,
          recipientEmail: recipient.email,
          ruleVersion: rule.version,
          triggeredBy: access.actor.id,
          requesterUserId,
        });
        if (!claim.claimed) {
          return { recipientId: recipient.id, skipped: true, reason: claim.reason };
        }

        activeClaim = claim;
        deliveryState = claim.state;
        const saveState = async (patch: Record<string, any>) => {
          deliveryState = await persistDeliveryState(
            access.supabase,
            deliveryCollectionPath,
            eventId,
            claim.claimId,
            deliveryState || {},
            patch,
          );
        };

        const emailRequested = rule.channels.email;
        const emailEnabled = emailRequested && recipient.emailVerified;
        const pushEnabled = rule.channels.push;
        const alertId = `advance-request-${stableId(`${eventKey}:in-app`)}`;
        const emailData = {
          recipientName: recipient.name,
          requesterName,
          projectName,
          organizationName,
          amountLabel: formatMoney(advance.amountRequested),
          purpose: cleanText(advance.purpose || advance.description || 'Sin justificación registrada', 2_000),
          destination: cleanText(advance.destination || [advance.municipality, advance.department].filter(Boolean).join(', ') || 'Sin destino', 300),
          travelPeriod: `${formatDate(advance.travelStart)} – ${formatDate(advance.travelEnd)}`,
          costCenterName: cleanText(advance.costCenterName || 'Sin centro de costos', 240),
          actionUrl,
          appUrl: getAppBaseUrl(request),
        };

        let inAppResult: Record<string, any> = deliveryState.inAppResult || { ok: false };
        let inAppAlert: Record<string, any> = deliveryState.inAppAlert || {};
        let emailResult: Record<string, any> = deliveryState.emailResult || {
          skipped: true,
          reason: emailEnabled
            ? 'not_attempted'
            : emailRequested
              ? 'email_not_verified'
              : 'disabled',
        };
        let pushResult: Record<string, any> = deliveryState.pushResult || {
          skipped: true,
          reason: pushEnabled ? 'not_attempted' : 'disabled',
        };
        let inAppCompleted = deliveryState.inAppCompleted === true;
        let emailCompleted = !emailEnabled || deliveryState.emailCompleted === true;
        let pushCompleted = !pushEnabled || deliveryState.pushCompleted === true;

        if (!inAppCompleted) {
          inAppAlert = {
            userId: recipient.authUserId,
            type: 'advance_request_submitted',
            status: 'unread',
            title: 'Nueva solicitud de anticipo',
            message: `${requesterName} solicitó ${formatMoney(advance.amountRequested)} · ${projectName}`,
            projectId,
            advanceId,
            organizationId: organizationId || null,
            actionUrl,
            createdAt: deliveryState.createdAt || now,
            readAt: null,
          };
          inAppResult = { ok: true, alertId };
          inAppCompleted = true;
          await saveState({ inAppAlert, inAppCompleted, inAppResult });
        }

        if (emailEnabled && !emailCompleted) {
          try {
            emailResult = await sendEmailWithResend({
              to: recipient.email,
              subject: buildAdvanceRequestNotificationSubject(emailData),
              html: buildAdvanceRequestNotificationHtml(emailData),
              text: buildAdvanceRequestNotificationText(emailData),
              idempotencyKey: eventKey,
            });
            emailCompleted = emailResult.skipped === false && !emailResult.error;
          } catch (deliveryError: any) {
            emailResult = {
              skipped: false,
              error: cleanText(deliveryError?.message || 'No fue posible enviar el correo.', 500),
            };
          }
          await saveState({ emailEnabled, emailCompleted, emailResult });
        }

        if (pushEnabled && !pushCompleted) {
          try {
            const pushTargets = await findPushSubscriptions(
              access.supabase,
              recipient.authUserId,
              recipient.email,
            );
            pushResult = await sendPixelPushBatch(pushTargets, {
              title: 'Nueva solicitud de anticipo',
              body: `${requesterName} solicitó ${formatMoney(advance.amountRequested)} · ${projectName}`,
              url: actionUrl,
              tag: eventId,
              data: {
                eventType: ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE,
                projectId,
                advanceId,
                organizationId: organizationId || null,
              },
            });
            pushCompleted = Number(pushResult.sent || 0) > 0 || pushResult.reason === 'no_active_subscriptions';
            if (pushResult.expiredIds?.length > 0) {
              await deactivatePushSubscriptions(access.supabase, pushResult.expiredIds);
            }
          } catch (deliveryError: any) {
            pushResult = {
              skipped: false,
              error: cleanText(deliveryError?.message || 'No fue posible enviar la notificación push.', 500),
            };
          }
          await saveState({ pushEnabled, pushCompleted, pushResult });
        }

        const completedAt = new Date().toISOString();
        const reachedRecipient = inAppCompleted
          || (emailEnabled && emailCompleted)
          || (pushEnabled && Number(pushResult.sent || 0) > 0);
        const allChannelsCompleted = inAppCompleted && emailCompleted && pushCompleted;
        const status = allChannelsCompleted ? 'completed' : reachedRecipient ? 'partial' : 'failed';
        await saveState({
          status,
          inAppCompleted,
          inAppAlert,
          inAppResult,
          emailEnabled,
          emailRequested,
          emailCompleted,
          emailResult,
          pushEnabled,
          pushCompleted,
          pushResult,
          leaseUntil: null,
          completedAt: allChannelsCompleted ? completedAt : null,
          lastFailureAt: allChannelsCompleted ? null : completedAt,
        });

        return {
          recipientId: recipient.id,
          skipped: false,
          status,
          reachedRecipient,
          inApp: inAppResult,
          email: emailResult,
          push: pushResult,
        };
      } catch (deliveryError: any) {
        const errorMessage = cleanText(
          deliveryError?.message || 'No fue posible completar la entrega.',
          500,
        );
        const reachedRecipient = deliveryState?.inAppCompleted === true
          || deliveryState?.emailCompleted === true
          || Number(deliveryState?.pushResult?.sent || 0) > 0;
        const status = reachedRecipient ? 'partial' : 'failed';
        if (activeClaim && deliveryState) {
          try {
            deliveryState = await persistDeliveryState(
              access.supabase,
              deliveryCollectionPath,
              eventId,
              activeClaim.claimId,
              deliveryState,
              {
                status,
                leaseUntil: null,
                lastError: errorMessage,
                lastFailureAt: new Date().toISOString(),
              },
            );
          } catch (stateError) {
            console.error('Could not release advance notification delivery lease:', stateError);
          }
        }
        console.error('Advance request recipient delivery failed:', {
          projectId,
          advanceId,
          recipientId: recipient.id,
          error: errorMessage,
        });
        return {
          recipientId: recipient.id,
          skipped: false,
          status,
          reachedRecipient,
          error: errorMessage,
        };
      }
    };

    const results: Array<Record<string, any>> = [];
    for (let index = 0; index < recipients.length; index += DELIVERY_BATCH_SIZE) {
      const batch = await Promise.all(
        recipients.slice(index, index + DELIVERY_BATCH_SIZE).map(deliverRecipient),
      );
      results.push(...batch);
    }

    return json({
      ok: true,
      notified: results.filter((result) => !result.skipped && result.reachedRecipient).length,
      skipped: results.filter((result) => result.skipped).length,
      failed: results.filter((result) => !result.skipped && result.status === 'failed').length,
      partial: results.filter((result) => !result.skipped && result.status === 'partial').length,
      results,
    });
  } catch (error: any) {
    console.error('Error sending advance request notification:', error);
    return json({ error: error?.message || 'No fue posible enviar la alerta del anticipo.' }, 500);
  }
}
