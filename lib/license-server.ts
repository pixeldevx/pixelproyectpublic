import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBootstrapAdminEmailSet } from '@/lib/bootstrap-admins';

export const LICENSE_TABLE = 'licenses';
export const LICENSE_USAGE_TABLE = 'license_usage_logs';
const DOCUMENTS_TABLE = 'app_documents';
const ADMIN_EMAILS = getBootstrapAdminEmailSet();

export type LicenseRecord = {
  id: string;
  license_key: string;
  client_name: string;
  plan_name: string | null;
  max_uses: number;
  used_count: number;
  active: boolean;
  expiration_date: string | null;
  created_at: string;
  updated_at: string;
};

export type LicenseUsageRecord = {
  id: string;
  license_key: string;
  machine_id: string;
  action: string;
  items_processed: number | null;
  os_info: string | null;
  client_ip: string | null;
  timestamp: string;
};

export const json = (body: Record<string, any>, status = 200) =>
  NextResponse.json(body, { status });

export const normalizeLicenseKey = (value: unknown) =>
  typeof value === 'string'
    ? value.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 64)
    : '';

export const normalizeText = (value: unknown, maxLength = 255) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export const normalizeInteger = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
};

export const getClientIp = (request: NextRequest) => {
  const forwardedFor = request.headers.get('x-forwarded-for') || '';
  const firstForwardedIp = forwardedFor.split(',')[0]?.trim();
  return (
    firstForwardedIp ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    ''
  ).slice(0, 45);
};

export const getBearerToken = (request: NextRequest) => {
  const header = request.headers.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
};

export const getServerSupabase = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Falta configurar SUPABASE_SERVICE_ROLE_KEY en el entorno de Vercel.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const findRequesterProfile = async (supabase: any, userId: string, email: string) => {
  const { data: byId, error: byIdError } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('data')
    .eq('collection_path', 'users')
    .eq('doc_id', userId)
    .maybeSingle();

  if (byIdError) throw byIdError;
  if (byId) return byId.data || {};

  const { data: byEmail, error: byEmailError } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('data')
    .eq('collection_path', 'users')
    .eq('data->>email', email)
    .limit(1);

  if (byEmailError) throw byEmailError;
  return (byEmail || [])[0]?.data || null;
};

export const ensureLicenseAdmin = async (request: NextRequest, supabase = getServerSupabase()) => {
  const token = getBearerToken(request);
  if (!token) return { error: json({ error: 'Sesión no encontrada.' }, 401) };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) {
    return { error: json({ error: 'Sesión inválida.' }, 401) };
  }

  const email = normalizeEmail(data.user.email);
  if (ADMIN_EMAILS.has(email)) return { user: data.user, email };

  const profile = await findRequesterProfile(supabase, data.user.id, email);
  const role = profile?.role || profile?.systemRole;
  if (role !== 'admin') {
    return { error: json({ error: 'Solo el administrador global puede administrar licencias.' }, 403) };
  }

  return { user: data.user, email };
};

export const serializeLicense = (license: LicenseRecord) => {
  const maxUses = normalizeInteger(license.max_uses);
  const usedCount = normalizeInteger(license.used_count);
  const remainingUses = Math.max(maxUses - usedCount, 0);

  return {
    id: license.id,
    license_key: license.license_key,
    client_name: license.client_name,
    plan: license.plan_name || 'Estándar',
    plan_name: license.plan_name || 'Estándar',
    max_uses: maxUses,
    used_count: usedCount,
    remaining_uses: remainingUses,
    active: Boolean(license.active),
    expiration_date: license.expiration_date,
    created_at: license.created_at,
    updated_at: license.updated_at,
  };
};

export const getLicenseRejection = (
  license: LicenseRecord | null,
  licenseKey: string,
  options: { requireRemainingUses?: boolean } = {},
) => {
  if (!license) {
    return {
      status: 404,
      body: {
        valid: false,
        license_key: licenseKey,
        message: 'La licencia no existe en Pixel.',
      },
    };
  }

  const serialized = serializeLicense(license);
  if (!license.active) {
    return {
      status: 400,
      body: {
        valid: false,
        license_key: license.license_key,
        client_name: license.client_name,
        message: 'La licencia está inactiva.',
      },
    };
  }

  if (license.expiration_date) {
    const expiresAt = new Date(`${license.expiration_date}T23:59:59`);
    if (expiresAt.getTime() < Date.now()) {
      return {
        status: 400,
        body: {
          valid: false,
          license_key: license.license_key,
          client_name: license.client_name,
          message: 'La licencia está vencida.',
        },
      };
    }
  }

  if ((options.requireRemainingUses ?? true) && serialized.remaining_uses <= 0) {
    return {
      status: 400,
      body: {
        valid: false,
        license_key: license.license_key,
        client_name: license.client_name,
        message: 'La licencia ha agotado el total de usos disponibles (0 restantes).',
      },
    };
  }

  return null;
};
