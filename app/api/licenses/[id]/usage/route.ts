import { NextRequest } from 'next/server';
import {
  ensureLicenseAdmin,
  getServerSupabase,
  json,
  LICENSE_TABLE,
  LICENSE_USAGE_TABLE,
  type LicenseRecord,
  type LicenseUsageRecord,
} from '@/lib/license-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const supabase = getServerSupabase();
    const auth = await ensureLicenseAdmin(request, supabase);
    if ('error' in auth) return auth.error;

    const { id } = await context.params;
    const { data: license, error: licenseError } = await supabase
      .from(LICENSE_TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (licenseError) throw licenseError;
    if (!license) return json({ error: 'Licencia no encontrada.' }, 404);

    const licenseKey = (license as LicenseRecord).license_key;
    const { data, error } = await supabase
      .from(LICENSE_USAGE_TABLE)
      .select('*')
      .eq('license_key', licenseKey)
      .order('timestamp', { ascending: false })
      .limit(250);

    if (error) throw error;
    return json({ usage: (data || []) as LicenseUsageRecord[] });
  } catch (error: any) {
    console.error('Error listing license usage:', error);
    return json({ error: error?.message || 'No se pudo cargar el historial de uso.' }, 500);
  }
}
