import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPushSubscriptionAttestation } from '@/lib/push/subscription-attestation';
import { validateWebPushEndpoint } from '@/lib/push/endpoint-security';

export const runtime = 'nodejs';

const DOCUMENTS_TABLE = 'app_documents';

type AppDocumentRow = {
  collection_path: string;
  doc_id: string;
  data: Record<string, any>;
};

const json = (body: Record<string, any>, status = 200) =>
  NextResponse.json(body, { status });

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

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : [];

const normalizeOptionalString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const hashEndpoint = (endpoint: string) =>
  createHash('sha256').update(endpoint).digest('hex');

const hashValue = (value: string) =>
  value ? createHash('sha256').update(value).digest('hex') : null;

const getDocument = async (supabase: any, docId: string) => {
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path, doc_id, data')
    .eq('collection_path', 'push_subscriptions')
    .eq('doc_id', docId)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as AppDocumentRow | null;
};

const deactivatePreviousDeviceSubscriptions = async (
  supabase: any,
  userId: string,
  deviceId: string,
  currentSubscriptionId: string,
  userAgent: string | null,
  platform: string | null
) => {
  if (!userId || !deviceId) return;

  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path, doc_id, data')
    .eq('collection_path', 'push_subscriptions')
    .eq('data->>userId', userId);

  if (error) throw error;

  const now = new Date().toISOString();
  const previousSubscriptions = (data || []).filter(
    (row: AppDocumentRow) => {
      if (row.doc_id === currentSubscriptionId || row.data?.isActive === false) return false;
      if (row.data?.deviceId === deviceId) return true;
      return !row.data?.deviceId && row.data?.userAgent === userAgent && row.data?.platform === platform;
    }
  );

  await Promise.all(
    previousSubscriptions.map((row: AppDocumentRow) =>
      supabase.from(DOCUMENTS_TABLE).upsert(
        {
          collection_path: 'push_subscriptions',
          doc_id: row.doc_id,
          data: {
            ...row.data,
            isActive: false,
            deactivatedAt: now,
            deactivationReason: 'replaced_by_new_vapid_subscription',
            updatedAt: now,
          },
          updated_at: now,
        },
        { onConflict: 'collection_path,doc_id' }
      )
    )
  );
};

export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminClient();
    const token = getBearerToken(request);
    const { data: requesterData, error: requesterError } = await supabase.auth.getUser(token);

    if (requesterError || !requesterData.user) {
      return json({ error: 'Sesión inválida.' }, 401);
    }

    const payload = await request.json().catch(() => null);
    const subscription = payload?.subscription || null;
    const rawEndpoint =
      typeof subscription?.endpoint === 'string'
        ? subscription.endpoint
        : typeof payload?.endpoint === 'string'
          ? payload.endpoint
          : '';
    const keys = subscription?.keys || {};

    if (!rawEndpoint || !keys?.p256dh || !keys?.auth) {
      return json({ error: 'La suscripción push está incompleta.', reason: 'invalid_subscription' }, 400);
    }
    const endpointValidation = validateWebPushEndpoint(rawEndpoint);
    if (!endpointValidation.ok) {
      return json({
        error: 'El proveedor de la suscripción push no está permitido.',
        reason: 'untrusted_push_endpoint',
        detail: endpointValidation.reason,
      }, 400);
    }
    const endpoint = endpointValidation.endpoint;

    const now = new Date().toISOString();
    const subscriptionId = hashEndpoint(endpoint);
    const existing = await getDocument(supabase, subscriptionId);
    const serverAttestation = createPushSubscriptionAttestation({
      subscriptionId,
      userId: requesterData.user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });
    if (!serverAttestation) {
      return json({ error: 'No fue posible validar de forma segura la suscripción push.' }, 503);
    }
    const organizationIds = normalizeStringArray(payload?.organizationIds);
    const deviceId = normalizeOptionalString(payload?.deviceId);
    const vapidPublicKey = normalizeOptionalString(payload?.vapidPublicKey);
    const replaceExistingForDevice = payload?.replaceExistingForDevice === true;
    const userAgent = typeof payload?.userAgent === 'string' ? payload.userAgent : null;
    const platform = typeof payload?.platform === 'string' ? payload.platform : null;

    const { error } = await supabase.from(DOCUMENTS_TABLE).upsert(
      {
        collection_path: 'push_subscriptions',
        doc_id: subscriptionId,
        data: {
          ...(existing?.data || {}),
          userId: requesterData.user.id,
          email: requesterData.user.email || null,
          serverAttestation,
          organizationIds,
          endpoint,
          subscription: {
            ...subscription,
            endpoint,
            keys,
          },
          permission: payload?.permission || 'granted',
          isActive: true,
          deviceId: deviceId || existing?.data?.deviceId || null,
          vapidPublicKey: vapidPublicKey || existing?.data?.vapidPublicKey || null,
          vapidPublicKeyHash: vapidPublicKey ? hashValue(vapidPublicKey) : existing?.data?.vapidPublicKeyHash || null,
          userAgent,
          platform,
          deactivatedAt: null,
          deactivationReason: null,
          createdAt: existing?.data?.createdAt || now,
          updatedAt: now,
        },
        updated_at: now,
      },
      { onConflict: 'collection_path,doc_id' }
    );

    if (error) throw error;

    if (replaceExistingForDevice && deviceId) {
      await deactivatePreviousDeviceSubscriptions(
        supabase,
        requesterData.user.id,
        deviceId,
        subscriptionId,
        userAgent,
        platform
      );
    }

    return json({
      ok: true,
      subscriptionId,
    });
  } catch (error: any) {
    console.error('Error saving push subscription:', error);
    return json({ error: error.message || 'No fue posible guardar la suscripción push.' }, 500);
  }
}
