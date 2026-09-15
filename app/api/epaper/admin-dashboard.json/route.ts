import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeEpaperRequest,
  createEpaperFallbackSnapshot,
  getEpaperDashboardSnapshot,
  getEpaperImageUrl,
  summarizeEpaperSnapshot,
} from '@/lib/epaper-dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
};

export async function GET(request: NextRequest) {
  const auth = authorizeEpaperRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status, headers: noStoreHeaders });
  }

  try {
    const snapshot = await getEpaperDashboardSnapshot();
    const includeFullSnapshot = request.nextUrl.searchParams.get('format') === 'full';

    return NextResponse.json(
      {
        ok: true,
        degraded: snapshot.delivery.state === 'stale' || snapshot.delivery.state === 'fallback',
        ...summarizeEpaperSnapshot(snapshot),
        ...(includeFullSnapshot ? { snapshot } : {}),
        image_url: getEpaperImageUrl(request, auth),
        authorization: auth.tokenSource === 'header' ? 'bearer' : 'query',
      },
      {
        headers: {
          ...noStoreHeaders,
          'X-Pixel-Epaper-State': snapshot.delivery.state,
          'X-Pixel-Epaper-Version': snapshot.version,
        },
      },
    );
  } catch (error: any) {
    const warning = error?.message || 'No se pudo generar el dashboard ePaper.';
    const snapshot = createEpaperFallbackSnapshot(warning);
    const includeFullSnapshot = request.nextUrl.searchParams.get('format') === 'full';
    return NextResponse.json(
      {
        ok: true,
        degraded: true,
        ...summarizeEpaperSnapshot(snapshot),
        ...(includeFullSnapshot ? { snapshot } : {}),
        image_url: getEpaperImageUrl(request, auth),
        authorization: auth.tokenSource === 'header' ? 'bearer' : 'query',
      },
      {
        status: 200,
        headers: {
          ...noStoreHeaders,
          'X-Pixel-Epaper-State': 'fallback',
          'X-Pixel-Epaper-Version': snapshot.version,
        },
      },
    );
  }
}
