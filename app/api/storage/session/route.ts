import { NextRequest, NextResponse } from 'next/server';
import { STORAGE_SESSION_COOKIE, storageClientForToken } from '@/lib/storage/private-session';

export async function POST(request: NextRequest) {
  const allowedOrigins = new Set([request.nextUrl.origin]);
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    allowedOrigins.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).origin);
  }
  // Next's local server may normalize 127.0.0.1 to localhost internally.
  const host = request.headers.get('host');
  if (process.env.NODE_ENV === 'development' && host && /^(localhost|127\.0\.0\.1):\d+$/.test(host)) {
    allowedOrigins.add(`http://${host}`);
  }
  if (!allowedOrigins.has(request.headers.get('origin') || '')) {
    return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403 });
  }
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  let maxAge = 0;
  if (token) {
    try {
      const { data, error } = await storageClientForToken(token).auth.getUser(token);
      if (error || !data.user) return NextResponse.json({ error: 'Sesión inválida.' }, { status: 401 });
      // Decode expiry only after Supabase has verified the token.
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      maxAge = Math.max(0, Math.min(3600, Number(claims.exp) - Math.floor(Date.now() / 1000)));
      if (!Number.isFinite(maxAge) || maxAge === 0) throw new Error('Expired token');
    } catch {
      return NextResponse.json({ error: 'Sesión inválida.' }, { status: 401 });
    }
  }
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(STORAGE_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'strict',
    path: '/api/storage',
    maxAge,
  });
  return response;
}
