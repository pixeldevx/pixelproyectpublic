import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import {
  authorizeEpaperRequest,
  getEpaperDashboardSnapshot,
} from '@/lib/epaper-dashboard';
import {
  DashboardImage,
  EPAPER_FONT_FAMILY,
  EPAPER_IMAGE_HEIGHT,
  EPAPER_IMAGE_WIDTH,
  StatusImage,
} from '@/lib/epaper-dashboard-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
};

const GOOGLE_FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@700&display=swap';

let fontPromise: Promise<ArrayBuffer | null> | null = null;

const getFontData = () => {
  fontPromise ||= (async () => {
    try {
      const css = await fetch(GOOGLE_FONT_CSS_URL, {
        cache: 'force-cache',
        signal: AbortSignal.timeout(2500),
      }).then((response) => (response.ok ? response.text() : ''));
      const fontUrl = css.match(/url\((https:[^)]+)\)/)?.[1];
      if (!fontUrl) return null;
      return await fetch(fontUrl, {
        cache: 'force-cache',
        signal: AbortSignal.timeout(2500),
      }).then((response) => (response.ok ? response.arrayBuffer() : null));
    } catch {
      return null;
    }
  })();

  return fontPromise;
};

const imageResponse = async (element: React.ReactElement, extraHeaders: Record<string, string> = {}) => {
  const fontData = await getFontData();

  return new ImageResponse(element, {
    width: EPAPER_IMAGE_WIDTH,
    height: EPAPER_IMAGE_HEIGHT,
    status: 200,
    headers: { ...noStoreHeaders, ...extraHeaders },
    ...(fontData
      ? {
          fonts: [
            {
              name: EPAPER_FONT_FAMILY,
              data: fontData,
              style: 'normal',
              weight: 700,
            },
          ],
        }
      : {}),
  });
};

const legacyImageResponse = (element: React.ReactElement) =>
  new ImageResponse(element, {
    width: EPAPER_IMAGE_WIDTH,
    height: EPAPER_IMAGE_HEIGHT,
    status: 200,
    headers: noStoreHeaders,
  });

export async function GET(request: NextRequest) {
  const auth = authorizeEpaperRequest(request);
  if (!auth.ok) {
    return legacyImageResponse(<StatusImage title="Sin acceso" message={auth.message} />);
  }

  let snapshot: Awaited<ReturnType<typeof getEpaperDashboardSnapshot>>;
  try {
    snapshot = await getEpaperDashboardSnapshot();
  } catch (error: any) {
    return legacyImageResponse(
      <StatusImage
        title="Dashboard en pausa"
        message={error?.message || 'No se pudo preparar la información del dashboard ePaper.'}
      />,
    );
  }

  const dashboardElement = <DashboardImage snapshot={snapshot} />;
  try {
    return await imageResponse(dashboardElement, {
      'X-Pixel-Epaper-State': snapshot.delivery.state,
      'X-Pixel-Epaper-Version': snapshot.version,
    });
  } catch (error: any) {
    return legacyImageResponse(
      <StatusImage
        title="Dashboard en pausa"
        message={error?.message || 'No se pudo crear el dashboard ePaper.'}
      />,
    );
  }
}
