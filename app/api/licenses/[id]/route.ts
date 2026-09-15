import { NextRequest } from 'next/server';
import {
  ensureLicenseAdmin,
  getServerSupabase,
  json,
  LICENSE_TABLE,
  normalizeInteger,
  normalizeLicenseKey,
  normalizeText,
  serializeLicense,
  type LicenseRecord,
} from '@/lib/license-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const supabase = getServerSupabase();
    const auth = await ensureLicenseAdmin(request, supabase);
    if ('error' in auth) return auth.error;

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const patch: Record<string, any> = {};

    if ('license_key' in body) {
      const licenseKey = normalizeLicenseKey(body.license_key);
      if (!licenseKey) return json({ error: 'La clave de licencia no puede quedar vacía.' }, 400);
      patch.license_key = licenseKey;
    }
    if ('client_name' in body) {
      const clientName = normalizeText(body.client_name);
      if (!clientName) return json({ error: 'El cliente no puede quedar vacío.' }, 400);
      patch.client_name = clientName;
    }
    if ('plan_name' in body || 'plan' in body) {
      patch.plan_name = normalizeText(body.plan_name || body.plan, 100) || 'Estándar';
    }
    if ('max_uses' in body) patch.max_uses = normalizeInteger(body.max_uses, 0);
    if ('used_count' in body) patch.used_count = normalizeInteger(body.used_count, 0);
    if ('active' in body) patch.active = body.active !== false;
    if ('expiration_date' in body) patch.expiration_date = normalizeText(body.expiration_date, 10) || null;

    if (patch.max_uses !== undefined || patch.used_count !== undefined) {
      const { data: current, error: currentError } = await supabase
        .from(LICENSE_TABLE)
        .select('max_uses, used_count')
        .eq('id', id)
        .maybeSingle();

      if (currentError) throw currentError;
      const maxUses = patch.max_uses ?? normalizeInteger(current?.max_uses, 0);
      const usedCount = patch.used_count ?? normalizeInteger(current?.used_count, 0);
      if (usedCount > maxUses) {
        return json({ error: 'Los usos consumidos no pueden superar los usos máximos.' }, 400);
      }
    }

    const { data, error } = await supabase
      .from(LICENSE_TABLE)
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return json({ license: serializeLicense(data as LicenseRecord) });
  } catch (error: any) {
    console.error('Error updating license:', error);
    const message = String(error?.message || '');
    const isConflict = message.includes('duplicate') || message.includes('unique');
    return json({
      error: isConflict
        ? 'Ya existe una licencia con esa clave.'
        : message || 'No se pudo actualizar la licencia.',
    }, isConflict ? 400 : 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const supabase = getServerSupabase();
    const auth = await ensureLicenseAdmin(request, supabase);
    if ('error' in auth) return auth.error;

    const { id } = await context.params;
    const { error } = await supabase.from(LICENSE_TABLE).delete().eq('id', id);
    if (error) throw error;

    return json({ ok: true });
  } catch (error: any) {
    console.error('Error deleting license:', error);
    return json({ error: error?.message || 'No se pudo eliminar la licencia.' }, 500);
  }
}
