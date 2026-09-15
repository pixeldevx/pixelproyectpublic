import { NextRequest, NextResponse } from 'next/server';
import { createS3PresignedUrl } from '@/lib/storage/s3-presign';
import { authorizeProjectStorageAction, getAuthenticatedUser, getS3RuntimeConfig, isDocumentStoragePathRestricted } from '@/lib/storage/server-config';
import { parseS3StoragePath } from '@/lib/storage/paths';

export const runtime = 'nodejs';

const json = (body: Record<string, any>, status = 200) => NextResponse.json(body, { status });

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const path = String(body.path || '');
    const proxyDownload = body.proxy === true;
    const parsed = parseS3StoragePath(path);
    if (!parsed) {
      return json({ error: 'Ruta S3 inválida.' }, 400);
    }

    const s3 = await getS3RuntimeConfig();
    if (parsed.bucket !== s3.bucket) {
      return json({ error: 'El bucket del documento no corresponde al gestor configurado.' }, 403);
    }

    const isProfileSignature = parsed.key.split('/').includes('profile_signatures');
    if (isProfileSignature) {
      if (!(await getAuthenticatedUser(request))) return json({ error: 'Debes iniciar sesión para abrir una firma.' }, 401);
    } else {
      const authorization = await authorizeProjectStorageAction({
        request,
        storagePath: path,
        storageKey: parsed.key,
        permission: 'documentView',
      });
      if (!authorization.ok) return json({ error: authorization.error }, authorization.status);
    }

    const downloadUrl = createS3PresignedUrl({
      method: 'GET',
      bucket: s3.bucket,
      key: parsed.key,
      region: s3.region,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      sessionToken: s3.sessionToken,
      expiresInSeconds: 300,
    });

    if (proxyDownload) {
      const upstream = await fetch(downloadUrl, { cache: 'no-store' });
      if (!upstream.ok || !upstream.body) {
        return json({ error: `Amazon S3 no permitió descargar el documento (${upstream.status}).` }, 502);
      }

      const headers = new Headers({
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': 'inline',
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      });
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) headers.set('Content-Length', contentLength);
      return new NextResponse(upstream.body, { status: 200, headers });
    }

    return json({ url: downloadUrl, expiresInSeconds: 300 });
  } catch (error: any) {
    console.error('Error creating storage download URL:', error);
    return json({ error: error?.message || 'No se pudo abrir el documento.' }, 500);
  }
}

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path') || '';
  const parsed = parseS3StoragePath(path);
  if (!parsed) return json({ error: 'Ruta S3 inválida.' }, 400);

  try {
    if (parsed.key.split('/').includes('profile_signatures')) {
      return json({ error: 'Las firmas solo pueden abrirse desde una sesión autenticada de Pixel.' }, 401);
    }
    if (await isDocumentStoragePathRestricted(path)) {
      return json({ error: 'Por seguridad, abre este documento desde Pixel Project.' }, 401);
    }
    const s3 = await getS3RuntimeConfig();
    if (parsed.bucket !== s3.bucket) return json({ error: 'Bucket inválido.' }, 403);
    return NextResponse.redirect(createS3PresignedUrl({
      method: 'GET',
      bucket: s3.bucket,
      key: parsed.key,
      region: s3.region,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      sessionToken: s3.sessionToken,
      expiresInSeconds: 300,
    }));
  } catch (error: any) {
    return json({ error: error?.message || 'No se pudo abrir el archivo.' }, 500);
  }
}
