import { NextRequest } from 'next/server';
import {
  ensureLicenseAdmin,
  getServerSupabase,
  json,
  LICENSE_TABLE,
  LICENSE_USAGE_TABLE,
  normalizeInteger,
  normalizeLicenseKey,
  normalizeText,
  serializeLicense,
  type LicenseRecord,
} from '@/lib/license-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = getServerSupabase();
    const auth = await ensureLicenseAdmin(request, supabase);
    if ('error' in auth) return auth.error;

    const { data: licenses, error: licensesError } = await supabase
      .from(LICENSE_TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    if (licensesError) throw licensesError;

    const { data: usageRows, error: usageError } = await supabase
      .from(LICENSE_USAGE_TABLE)
      .select('license_key, timestamp')
      .order('timestamp', { ascending: false })
      .limit(1000);

    if (usageError) throw usageError;

    const usageSummary = new Map<string, { count: number; lastUsedAt: string | null }>();
    (usageRows || []).forEach((row: any) => {
      const key = String(row.license_key || '');
      if (!key) return;
      const current = usageSummary.get(key) || { count: 0, lastUsedAt: null };
      usageSummary.set(key, {
        count: current.count + 1,
        lastUsedAt: current.lastUsedAt || row.timestamp || null,
      });
    });

    return json({
      licenses: ((licenses || []) as LicenseRecord[]).map((license) => ({
        ...serializeLicense(license),
        usage_log_count: usageSummary.get(license.license_key)?.count || 0,
        last_used_at: usageSummary.get(license.license_key)?.lastUsedAt || null,
      })),
    });
  } catch (error: any) {
    console.error('Error listing licenses:', error);
    return json({ error: error?.message || 'No se pudieron cargar las licencias.' }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getServerSupabase();
    const auth = await ensureLicenseAdmin(request, supabase);
    if ('error' in auth) return auth.error;

    const body = await request.json().catch(() => ({}));
    const licenseKey = normalizeLicenseKey(body.license_key);
    const clientName = normalizeText(body.client_name);
    const planName = normalizeText(body.plan_name || body.plan, 100) || 'Estándar';
    const maxUses = normalizeInteger(body.max_uses, 100);
    const usedCount = normalizeInteger(body.used_count, 0);
    const expirationDate = normalizeText(body.expiration_date, 10) || null;

    if (!licenseKey || !clientName) {
      return json({ error: 'Completa la clave de licencia y el cliente.' }, 400);
    }
    if (usedCount > maxUses) {
      return json({ error: 'Los usos consumidos no pueden superar los usos máximos.' }, 400);
    }

    const { data, error } = await supabase
      .from(LICENSE_TABLE)
      .insert({
        license_key: licenseKey,
        client_name: clientName,
        plan_name: planName,
        max_uses: maxUses,
        used_count: usedCount,
        active: body.active !== false,
        expiration_date: expirationDate,
      })
      .select('*')
      .single();

    if (error) throw error;
    return json({ license: serializeLicense(data as LicenseRecord) }, 201);
  } catch (error: any) {
    console.error('Error creating license:', error);
    const message = String(error?.message || '');
    const isConflict = message.includes('duplicate') || message.includes('unique');
    return json({
      error: isConflict
        ? 'Ya existe una licencia con esa clave.'
        : message || 'No se pudo crear la licencia.',
    }, isConflict ? 400 : 500);
  }
}
