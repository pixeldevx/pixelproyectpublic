import { NextRequest } from 'next/server';
import {
  getLicenseRejection,
  getServerSupabase,
  json,
  LICENSE_TABLE,
  normalizeLicenseKey,
  normalizeText,
  serializeLicense,
  type LicenseRecord,
} from '@/lib/license-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const licenseKey = normalizeLicenseKey(body.license_key);
    const machineId = normalizeText(body.machine_id, 64);

    if (!licenseKey || !machineId) {
      return json({
        valid: false,
        license_key: licenseKey,
        message: 'Debes enviar license_key y machine_id.',
      }, 400);
    }

    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from(LICENSE_TABLE)
      .select('*')
      .eq('license_key', licenseKey)
      .maybeSingle();

    if (error) throw error;

    const license = (data || null) as LicenseRecord | null;
    const rejection = getLicenseRejection(license, licenseKey);
    if (rejection) return json(rejection.body, rejection.status);

    const serialized = serializeLicense(license as LicenseRecord);
    return json({
      valid: true,
      license_key: serialized.license_key,
      client_name: serialized.client_name,
      plan: serialized.plan,
      max_uses: serialized.max_uses,
      used_count: serialized.used_count,
      remaining_uses: serialized.remaining_uses,
      expiration_date: serialized.expiration_date,
      message: 'Licencia válida y activa.',
    });
  } catch (error: any) {
    console.error('Error verifying cloud license:', error);
    return json({
      valid: false,
      message: error?.message || 'No se pudo verificar la licencia.',
    }, 500);
  }
}
