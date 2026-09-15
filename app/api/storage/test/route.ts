import { NextResponse } from 'next/server';
import { getBootstrapAdminEmailSet } from '@/lib/bootstrap-admins';
import { createS3PresignedUrl } from '@/lib/storage/s3-presign';
import {
  buildS3ObjectKey,
  getAuthenticatedUser,
  getS3RuntimeConfig,
  getServerSupabaseClient,
  getStorageConfigStatus,
} from '@/lib/storage/server-config';

export const runtime = 'nodejs';

const DOCUMENTS_TABLE = 'app_documents';
const BOOTSTRAP_ADMINS = getBootstrapAdminEmailSet();

const json = (body: Record<string, any>, status = 200) => NextResponse.json(body, { status });

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const ensureGlobalAdmin = async (request: Request) => {
  const user = await getAuthenticatedUser(request);
  if (!user?.email) return false;

  const email = normalizeEmail(user.email);
  if (BOOTSTRAP_ADMINS.has(email)) return true;

  const supabase = getServerSupabaseClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('data')
    .eq('collection_path', 'users')
    .eq('doc_id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (data?.data?.role === 'admin' || data?.data?.systemRole === 'admin') return true;

  const { data: byEmail, error: byEmailError } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('data')
    .eq('collection_path', 'users')
    .eq('data->>email', email)
    .limit(1);

  if (byEmailError) throw byEmailError;
  const profile = (byEmail || [])[0]?.data;
  return profile?.role === 'admin' || profile?.systemRole === 'admin';
};

export async function GET(request: Request) {
  try {
    const status = await getStorageConfigStatus();
    const isAdmin = await ensureGlobalAdmin(request);

    if (!isAdmin) {
      return json({ error: 'Solo el administrador global puede probar el gestor documental.' }, 403);
    }

    return json({
      ok: true,
      provider: status.provider,
      s3Ready: status.s3Ready,
      missingS3Variables: status.missingS3Variables,
      settings: {
        provider: status.settings.provider,
        s3Bucket: status.settings.s3Bucket,
        s3Region: status.settings.s3Region,
        s3Prefix: status.settings.s3Prefix,
        maxFileSizeMb: status.settings.maxFileSizeMb,
        allowedContentTypes: status.settings.allowedContentTypes,
        updatedAt: status.settings.updatedAt || null,
      },
    });
  } catch (error: any) {
    console.error('Error reading storage status:', error);
    return json({ error: error?.message || 'No se pudo leer el estado del gestor documental.' }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const isAdmin = await ensureGlobalAdmin(request);
    if (!isAdmin) {
      return json({ error: 'Solo el administrador global puede probar el gestor documental.' }, 403);
    }

    const status = await getStorageConfigStatus();
    if (status.provider !== 's3') {
      return json({
        ok: true,
        provider: status.provider,
        message: 'Supabase Storage está activo. No se requiere prueba de Amazon S3.',
      });
    }

    if (!status.s3Ready) {
      return json({
        ok: false,
        provider: 's3',
        missingS3Variables: status.missingS3Variables,
        error: `Faltan variables de entorno: ${status.missingS3Variables.join(', ')}`,
      }, 400);
    }

    const s3 = await getS3RuntimeConfig();
    const key = buildS3ObjectKey(
      s3.prefix,
      `diagnostics/pixel-storage-test-${Date.now()}.txt`
    );

    const putUrl = createS3PresignedUrl({
      method: 'PUT',
      bucket: s3.bucket,
      key,
      region: s3.region,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      sessionToken: s3.sessionToken,
      expiresInSeconds: 120,
    });

    const getUrl = createS3PresignedUrl({
      method: 'GET',
      bucket: s3.bucket,
      key,
      region: s3.region,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      sessionToken: s3.sessionToken,
      expiresInSeconds: 120,
    });

    const deleteUrl = createS3PresignedUrl({
      method: 'DELETE',
      bucket: s3.bucket,
      key,
      region: s3.region,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      sessionToken: s3.sessionToken,
      expiresInSeconds: 120,
    });

    const payload = `Pixel Project storage test ${new Date().toISOString()}`;
    const putResponse = await fetch(putUrl, {
      method: 'PUT',
      body: payload,
      headers: { 'content-type': 'text/plain' },
    });

    if (!putResponse.ok) {
      const message = await putResponse.text().catch(() => '');
      return json({ ok: false, error: `S3 rechazó la carga (${putResponse.status}). ${message}` }, 502);
    }

    const getResponse = await fetch(getUrl);
    const text = await getResponse.text().catch(() => '');
    if (!getResponse.ok || text !== payload) {
      return json({ ok: false, error: `S3 no devolvió correctamente el archivo de prueba (${getResponse.status}).` }, 502);
    }

    await fetch(deleteUrl, { method: 'DELETE' }).catch(() => null);

    return json({
      ok: true,
      provider: 's3',
      bucket: s3.bucket,
      region: s3.region,
      prefix: s3.prefix,
      message: 'Amazon S3 respondió correctamente a carga, lectura y limpieza.',
    });
  } catch (error: any) {
    console.error('Error testing S3 storage:', error);
    return json({ ok: false, error: error?.message || 'No se pudo probar Amazon S3.' }, 500);
  }
}
