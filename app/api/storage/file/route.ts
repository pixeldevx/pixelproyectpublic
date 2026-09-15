import { NextRequest, NextResponse } from 'next/server';
import { STORAGE_SESSION_COOKIE, storageClientForToken } from '@/lib/storage/private-session';

export const dynamic = 'force-dynamic';

const reject = (status: number) => NextResponse.json(
  { error: 'Archivo no disponible para esta sesión.' },
  { status, headers: { 'Cache-Control': 'private, no-store' } },
);

export async function GET(request: NextRequest) {
  const token = request.cookies.get(STORAGE_SESSION_COOKIE)?.value;
  if (!token) return reject(401);
  const path = request.nextUrl.searchParams.get('path') || '';
  if (!path || path.startsWith('/') || path.split('/').includes('..')) return reject(400);
  try {
    const client = storageClientForToken(token);
    const { data: user, error: authError } = await client.auth.getUser(token);
    if (authError || !user.user) return reject(401);
    const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'pixel-project-files';
    const { data, error } = await client.storage.from(bucket).download(path);
    if (error || !data) return reject(404);
    const type = data.type || 'application/octet-stream';
    const inline = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf)$/.test(type);
    return new NextResponse(data, { headers: {
      'Content-Type': type,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.split('/').pop() || 'archivo')}`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    } });
  } catch {
    return reject(502);
  }
}
