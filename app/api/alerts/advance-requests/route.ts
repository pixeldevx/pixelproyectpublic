import { workspaceErrorStatus } from '@/lib/workspaces/server';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ensurePixelUser, getServerSupabase } from '@/lib/github/server';
import { ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE } from '@/lib/notifications/advance-request-settings';
import { canLoadProjectForUser } from '@/lib/project-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOCUMENTS_TABLE = 'app_documents';
const DELIVERY_COLLECTION = 'administrativeNotificationDeliveries';
const MAX_BODY_BYTES = 4 * 1024;
const DELIVERY_PATH_PATTERN = /^projects\/([A-Za-z0-9_-]+)\/administrativeNotificationDeliveries$/;
const LOOKUP_BATCH_SIZE = 50;
const DOCUMENT_PAGE_SIZE = 1_000;
const INBOX_LIMIT = 200;

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status });

const cleanIdentifier = (value: unknown, maxLength = 180) => {
  const identifier = String(value || '').trim();
  if (identifier.length === 0 || identifier.length > maxLength) return '';
  return /^[A-Za-z0-9_-]+$/.test(identifier) ? identifier : '';
};

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

const cleanValues = (values: unknown[]) => Array.from(new Set(
  values.map((value) => String(value || '').trim()).filter(Boolean),
));

const getOrganizationIds = (value: Record<string, any> | null | undefined) => cleanValues([
  value?.organizationId,
  ...(Array.isArray(value?.organizationIds) ? value.organizationIds : []),
]);

const loadActorProjectScope = async (supabase: any, actor: any) => {
  const normalizedEmail = String(actor.email || '').trim().toLowerCase();
  const profileEmail = String(actor.profile?.email || '').trim();
  const queries = [
    supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data')
      .eq('collection_path', 'team_members')
      .eq('doc_id', actor.id)
      .limit(5),
    ...['authUserId', 'uid', 'userId'].map((field) => supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data')
      .eq('collection_path', 'team_members')
      .eq(`data->>${field}`, actor.id)
      .limit(5)),
    ...(normalizedEmail ? [supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data')
      .eq('collection_path', 'team_members')
      .eq('data->>email', normalizedEmail)
      .limit(5)] : []),
    ...(profileEmail && profileEmail !== normalizedEmail ? [supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data')
      .eq('collection_path', 'team_members')
      .eq('data->>email', profileEmail)
      .limit(5)] : []),
  ];
  const results = await Promise.all(queries);
  const members = new Map<string, any>();
  results.forEach(({ data, error }) => {
    if (error) throw error;
    (data || []).forEach((row: any) => {
      if (row.collection_path === 'team_members') members.set(row.doc_id, row);
    });
  });
  const memberRows = Array.from(members.values());
  return {
    assignedIds: cleanValues([
      actor.id,
      actor.email,
      actor.profile?.id,
      actor.profile?.uid,
      actor.profile?.authUserId,
      ...memberRows.flatMap((row) => [
        row.doc_id,
        row.data?.id,
        row.data?.uid,
        row.data?.userId,
        row.data?.authUserId,
        row.data?.email,
      ]),
    ]),
    managedOrganizationIds: cleanValues([
      ...getOrganizationIds(actor.profile),
      ...memberRows.flatMap((row) => getOrganizationIds(row.data)),
    ]),
    userId: actor.id,
    userRole: actor.role,
  };
};

const loadAccessibleProjectIds = async (
  supabase: any,
  accessScope: Awaited<ReturnType<typeof loadActorProjectScope>>,
) => {
  const projectIds: string[] = [];
  for (let offset = 0; ; offset += DOCUMENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data')
      .eq('collection_path', 'projects')
      .order('doc_id', { ascending: true })
      .range(offset, offset + DOCUMENT_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data || [];
    rows.forEach((row: any) => {
      const projectId = cleanIdentifier(row.doc_id);
      if (
        row.collection_path === 'projects'
        && projectId
        && canLoadProjectForUser({ ...(row.data || {}), id: projectId }, accessScope)
      ) projectIds.push(projectId);
    });
    if (rows.length < DOCUMENT_PAGE_SIZE) break;
  }
  return Array.from(new Set(projectIds));
};

const loadDeliveryRows = async (
  supabase: any,
  recipientUserId: string,
  projectIds: string[],
) => {
  const rows: any[] = [];
  for (let index = 0; index < projectIds.length; index += LOOKUP_BATCH_SIZE) {
    const collectionPaths = projectIds
      .slice(index, index + LOOKUP_BATCH_SIZE)
      .map((projectId) => `projects/${projectId}/${DELIVERY_COLLECTION}`);
    if (collectionPaths.length === 0) continue;
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data,created_at,updated_at')
      .eq('collection_group', DELIVERY_COLLECTION)
      .in('collection_path', collectionPaths)
      .eq('data->>eventType', ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE)
      .eq('data->>recipientUserId', recipientUserId)
      .eq('data->>inAppCompleted', 'true')
      .order('updated_at', { ascending: false })
      .limit(INBOX_LIMIT);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
    .slice(0, INBOX_LIMIT);
};

export async function GET(request: NextRequest) {
  try {
    const supabase = await getServerSupabase(request);
    const auth = await ensurePixelUser(request, supabase);
    if (auth.error) return auth.error;
    const accessScope = await loadActorProjectScope(supabase, auth.actor);
    const accessibleProjectIds = await loadAccessibleProjectIds(supabase, accessScope);
    if (accessibleProjectIds.length === 0) return json({ alerts: [] });
    const data = await loadDeliveryRows(supabase, auth.actor.id, accessibleProjectIds);

    const candidateRows = (data || []).flatMap((row: any) => {
      const pathMatch = DELIVERY_PATH_PATTERN.exec(String(row.collection_path || ''));
      const deliveryId = cleanIdentifier(row.doc_id);
      const payload = row.data || {};
      const projectId = cleanIdentifier(payload.projectId);
      const advanceId = cleanIdentifier(payload.advanceId);
      if (
        !pathMatch
        || !deliveryId
        || !projectId
        || !advanceId
        || projectId !== pathMatch[1]
        || String(payload.recipientUserId || '') !== auth.actor.id
      ) return [];
      const inAppAlert = payload.inAppAlert;
      if (
        !inAppAlert
        || typeof inAppAlert !== 'object'
        || Array.isArray(inAppAlert)
        || payload.inAppCompleted !== true
      ) return [];
      const deliveryStatus = String(payload.status || '');
      const leaseExpiresAt = new Date(String(payload.leaseUntil || '')).getTime();
      const activeDelivery = deliveryStatus === 'processing'
        && Number.isFinite(leaseExpiresAt)
        && leaseExpiresAt > Date.now();
      if (activeDelivery) return [];
      return [{
        row,
        payload,
        deliveryId,
        projectId,
        advanceId,
        inAppAlert,
      }];
    });

    const allowedProjectIds = new Set(accessibleProjectIds);
    const alerts = candidateRows.flatMap((candidate) => {
      if (!allowedProjectIds.has(candidate.projectId)) return [];
      const actionUrl = `/projects/${encodeURIComponent(candidate.projectId)}?tab=administration&workspace=advances&advanceId=${encodeURIComponent(candidate.advanceId)}`;
      return [{
        id: `advance:${candidate.projectId}:${candidate.deliveryId}`,
        deliveryId: candidate.deliveryId,
        projectId: candidate.projectId,
        type: 'advance_request_submitted',
        status: candidate.inAppAlert.status === 'read' ? 'read' : 'unread',
        title: String(candidate.inAppAlert.title || 'Nueva solicitud de anticipo'),
        message: String(candidate.inAppAlert.message || ''),
        actionUrl,
        createdAt: String(candidate.inAppAlert.createdAt || candidate.row.created_at),
        readAt: candidate.inAppAlert.readAt ? String(candidate.inAppAlert.readAt) : null,
        source: 'advance_request_delivery',
      }];
    });

    return json({ alerts });
  } catch (error: any) {
    console.error('Error loading advance request alerts:', error);
    return json({ error: 'No fue posible cargar las alertas de anticipos.' }, workspaceErrorStatus(error));
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await getServerSupabase(request);
    const auth = await ensurePixelUser(request, supabase);
    if (auth.error) return auth.error;
    const body = await parseBody(request);
    if (!body) return json({ error: 'La solicitud supera el límite permitido.' }, 413);
    const projectId = cleanIdentifier(body.projectId);
    const deliveryId = cleanIdentifier(body.deliveryId);
    if (!projectId || !deliveryId) {
      return json({ error: 'La alerta indicada no es válida.' }, 400);
    }

    const { data, error } = await supabase.rpc('mark_advance_notification_read', {
      p_project_id: projectId,
      p_delivery_id: deliveryId,
      p_recipient_user_id: auth.actor.id,
    });
    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.marked && result?.result === 'delivery_processing') {
      return json({ error: 'La alerta todavía se está procesando. Intenta nuevamente en unos segundos.' }, 409);
    }
    if (!result?.marked && result?.result !== 'already_read') {
      return json({ error: 'La alerta ya no existe o no está disponible.' }, 404);
    }

    const readAt = String(result?.read_at || new Date().toISOString());

    return json({ ok: true, status: 'read', readAt });
  } catch (error: any) {
    console.error('Error marking advance request alert as read:', error);
    return json({ error: 'No fue posible actualizar la alerta.' }, workspaceErrorStatus(error));
  }
}
