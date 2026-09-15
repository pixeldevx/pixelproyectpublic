import { NextResponse } from 'next/server';
import { createS3PresignedUrl } from '@/lib/storage/s3-presign';
import { authorizeProjectStorageAction, getS3RuntimeConfig } from '@/lib/storage/server-config';
import { parseS3StoragePath } from '@/lib/storage/paths';

export const runtime = 'nodejs';

const json = (body: Record<string, any>, status = 200) => NextResponse.json(body, { status });

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = parseS3StoragePath(String(body.path || ''));
    if (!parsed) {
      return json({ error: 'Ruta S3 inválida.' }, 400);
    }

    const s3 = await getS3RuntimeConfig();
    if (parsed.bucket !== s3.bucket) {
      return json({ error: 'El bucket del documento no corresponde al gestor configurado.' }, 403);
    }

    const authorization = await authorizeProjectStorageAction({
      request,
      storagePath: String(body.path || ''),
      storageKey: parsed.key,
      permission: 'documentDelete',
    });
    if (!authorization.ok) return json({ error: authorization.error }, authorization.status);

    const deleteUrl = createS3PresignedUrl({
      method: 'DELETE',
      bucket: s3.bucket,
      key: parsed.key,
      region: s3.region,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      sessionToken: s3.sessionToken,
      expiresInSeconds: 120,
    });

    const response = await fetch(deleteUrl, { method: 'DELETE' });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      return json({
        error: `Amazon S3 rechazó la eliminación (${response.status}). ${message}`.trim(),
      }, 502);
    }

    return json({ ok: true });
  } catch (error: any) {
    console.error('Error deleting S3 object:', error);
    return json({ error: error?.message || 'No se pudo eliminar el archivo.' }, 500);
  }
}
