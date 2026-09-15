import { NextRequest } from 'next/server';
import {
  getClientIp,
  getLicenseRejection,
  getServerSupabase,
  json,
  LICENSE_TABLE,
  normalizeInteger,
  normalizeLicenseKey,
  normalizeText,
  type LicenseRecord,
} from '@/lib/license-server';
import { isUuid, sha256Hex, stableStringify } from '@/lib/ai/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const errorMessageFor = (message: string, action: string) => {
  if (message.includes('LICENSE_NOT_FOUND')) return 'La licencia no existe en Pixel.';
  if (message.includes('LICENSE_INACTIVE')) return 'La licencia está inactiva.';
  if (message.includes('LICENSE_EXPIRED')) return 'La licencia está vencida.';
  if (message.includes('LICENSE_EXHAUSTED')) return 'La licencia ha agotado el total de usos disponibles (0 restantes).';
  if (message.includes('LICENSE_OPERATION_CONFLICT')) return 'El operation_id ya fue usado con datos diferentes.';
  return `No se pudo registrar el uso (${action}).`;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const licenseKey = normalizeLicenseKey(body.license_key);
    const machineId = normalizeText(body.machine_id, 64);
    const action = normalizeText(body.action, 100);
    const osInfo = normalizeText(body.os || body.os_info, 100);
    const itemsProcessed = normalizeInteger(body.items_processed, 1);
    const operationId = normalizeText(body.operation_id, 64);

    if (!licenseKey || !machineId || !action) {
      return json({
        success: false,
        license_key: licenseKey,
        message: 'Debes enviar license_key, machine_id y action.',
      }, 400);
    }

    if (operationId && !isUuid(operationId)) {
      return json({
        success: false,
        license_key: licenseKey,
        message: 'operation_id debe ser un UUID válido.',
      }, 400);
    }

    const supabase = getServerSupabase();
    const rpcName = operationId ? 'consume_license_use_v2' : 'consume_license_use';
    const operationHash = operationId
      ? sha256Hex(stableStringify({
          action,
          items_processed: itemsProcessed,
          machine_id: machineId,
          os_info: osInfo || null,
        }))
      : null;

    if (!operationId) {
      const { data: currentLicense, error: currentLicenseError } = await supabase
        .from(LICENSE_TABLE)
        .select('*')
        .eq('license_key', licenseKey)
        .maybeSingle();

      if (currentLicenseError) throw currentLicenseError;

      const rejection = getLicenseRejection((currentLicense || null) as LicenseRecord | null, licenseKey);
      if (rejection) {
        return json({ success: false, ...rejection.body }, rejection.status);
      }
    }

    const { data, error } = await supabase.rpc(rpcName, {
      p_license_key: licenseKey,
      p_machine_id: machineId,
      p_action: action,
      p_items_processed: itemsProcessed,
      p_os_info: osInfo || null,
      p_client_ip: getClientIp(request) || null,
      ...(operationId
        ? {
            p_operation_id: operationId,
            p_operation_hash: operationHash,
          }
        : {}),
    });

    if (error) {
      const message = errorMessageFor(error.message || '', action);
      return json({
        success: false,
        license_key: licenseKey,
        message,
      }, message.includes('no existe') ? 404 : message.includes('operation_id') ? 409 : 400);
    }

    const updated = Array.isArray(data) ? data[0] : data;
    const remainingUses = Number(updated?.remaining_uses ?? 0);

    return json({
      success: true,
      remaining_uses: remainingUses,
      message: `Uso registrado correctamente (${action}). Usos restantes: ${remainingUses}.`,
    });
  } catch (error: any) {
    console.error('Error registering cloud license use:', error);
    return json({
      success: false,
      message: error?.message || 'No se pudo registrar el uso de la licencia.',
    }, 500);
  }
}
