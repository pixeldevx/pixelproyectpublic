import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPixelPushBatch, type PixelPushTarget } from '@/lib/push/web-push';

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

export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminClient();
    const token = getBearerToken(request);
    const { data: requesterData, error: requesterError } = await supabase.auth.getUser(token);

    if (requesterError || !requesterData.user) {
      return json({ error: 'Sesión inválida.' }, 401);
    }

    const user = requesterData.user;
    const targets = await findPushSubscriptions(supabase, user.id, user.email || '');
    const pushResult = await sendPixelPushBatch(targets, {
      title: 'Prueba de Pixel Project',
      body: 'Tu dispositivo ya puede recibir notificaciones push de tareas.',
      url: `${appUrlFromRequest(request)}/workflows`,
      tag: `pixel-project-test-${user.id}`,
      data: {
        eventType: 'test_push',
        userId: user.id,
      },
    });

    if (Array.isArray(pushResult.expiredIds) && pushResult.expiredIds.length > 0) {
      await deactivatePushSubscriptions(supabase, pushResult.expiredIds);
    }

    return json({
      ok: true,
      subscriptions: targets.length,
      push: pushResult,
    });
  } catch (error: any) {
    console.error('Error sending test push notification:', error);
    return json({ error: error.message || 'No fue posible enviar la prueba push.' }, 500);
  }
}
