import { NextResponse } from 'next/server';
import { createS3PresignedUrl } from '@/lib/storage/s3-presign';
import {
  buildS3ObjectKey,
  authorizeProjectStorageAction,
  getAuthenticatedUser,
  getDocumentStorageSettings,
  getS3RuntimeConfig,
} from '@/lib/storage/server-config';
import { formatS3StoragePath, normalizeStorageKey } from '@/lib/storage/paths';

export const runtime = 'nodejs';

type UploadRequest = {
  path?: string;
  fileName?: string;
  contentType?: string;
  size?: number;
};

const json = (body: Record<string, any>, status = 200) => NextResponse.json(body, { status });

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UploadRequest;
    const settings = await getDocumentStorageSettings();

    if (settings.provider !== 's3') {
      return json({ provider: 'supabase' });
    }

    const cleanPath = normalizeStorageKey(body.path || body.fileName || '');
    if (!cleanPath) {
      return json({ error: 'Ruta de archivo inválida.' }, 400);
    }

    if (settings.maxFileSizeMb && Number(body.size || 0) > settings.maxFileSizeMb * 1024 * 1024) {
      return json({ error: `El archivo supera el límite de ${settings.maxFileSizeMb} MB.` }, 413);
    }

    if (
      settings.allowedContentTypes.length > 0 &&
      body.contentType &&
      !settings.allowedContentTypes.includes(body.contentType)
    ) {
      return json({ error: `Tipo de archivo no permitido: ${body.contentType}.` }, 415);
    }

    const s3 = await getS3RuntimeConfig();
    const key = buildS3ObjectKey(s3.prefix, cleanPath);
    if (cleanPath.split('/').includes('projects')) {
      const authorization = await authorizeProjectStorageAction({
        request,
        storageKey: cleanPath,
        permission: 'documentUpload',
      });
      if (!authorization.ok) return json({ error: authorization.error }, authorization.status);
    } else {
      const user = await getAuthenticatedUser(request);
      if (!user) return json({ error: 'Debes iniciar sesión para subir archivos.' }, 401);
      if (cleanPath.startsWith('profile_signatures/')) {
        const fileName = cleanPath.split('/').pop() || '';
        if (!fileName.startsWith(`${user.id}_`)) {
          return json({ error: 'Solo puedes cargar la firma asociada a tu propia cuenta.' }, 403);
        }
      }
    }
    const uploadUrl = createS3PresignedUrl({
      method: 'PUT',
      bucket: s3.bucket,
      key,
      region: s3.region,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      sessionToken: s3.sessionToken,
      expiresInSeconds: 900,
    });

    return json({
      provider: 's3',
      uploadUrl,
      bucket: s3.bucket,
      key,
      storagePath: formatS3StoragePath(s3.bucket, key),
      contentType: body.contentType || 'application/octet-stream',
    });
  } catch (error: any) {
    console.error('Error creating storage upload URL:', error);
    return json({ error: error?.message || 'No se pudo preparar la carga del archivo.' }, 500);
  }
}
