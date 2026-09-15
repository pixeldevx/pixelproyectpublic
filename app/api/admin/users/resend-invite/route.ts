import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBootstrapAdminEmailSet } from '@/lib/bootstrap-admins';
import { getOrganizationIds, getPrimaryOrganizationId } from '@/lib/organizations';
import { sendEmailWithResend } from '@/lib/email/resend';
import {
  buildUserAccessEmailHtml,
  buildUserAccessSubject,
  buildUserAccessText,
  getOrganizationAccessLabel,
  getUserAccessRoleLabel,
  type UserAccessEmailMode,
} from '@/lib/email/user-access-template';

export const runtime = 'nodejs';

const DOCUMENTS_TABLE = 'app_documents';
const AUTH_OPERATION_TIMEOUT_MS = 25000;
const DB_OPERATION_TIMEOUT_MS = 15000;
const ADMIN_EMAILS = getBootstrapAdminEmailSet();

type AdminClient = any;

type AppDocumentRow = {
  collection_path: string;
  doc_id: string;
  data: Record<string, any>;
};

const json = (body: Record<string, any>, status = 200) =>
  NextResponse.json(body, { status });

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const withTimeout = async (
  promise: PromiseLike<any>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<any> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const getBearerToken = (request: NextRequest) => {
  const header = request.headers.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
};

const getRedirectTo = (request: NextRequest) => {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    '';

  const origin = configuredUrl.startsWith('http')
    ? configuredUrl
    : request.headers.get('origin') || new URL(request.url).origin;

  return `${origin.replace(/\/$/, '')}/reset-password`;
};

const getAppUrlFromRedirect = (redirectTo: string) => {
  try {
    return new URL(redirectTo).origin;
  } catch {
    return redirectTo.replace(/\/reset-password.*$/, '').replace(/\/$/, '');
  }
};

const getAdminClient = () => {
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

const findDocumentsByEmail = async (
  supabase: AdminClient,
  collectionPath: string,
  email: string
) => {
  const { data, error } = await withTimeout(
    supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path, doc_id, data')
      .eq('collection_path', collectionPath)
      .eq('data->>email', email),
    DB_OPERATION_TIMEOUT_MS,
    'Supabase tardó demasiado consultando perfiles de usuario.'
  );

  if (error) throw error;
  return (data || []) as AppDocumentRow[];
};

const findRequesterProfile = async (
  supabase: AdminClient,
  userId: string,
  email: string
) => {
  const { data: byId, error: byIdError } = await withTimeout(
    supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path, doc_id, data')
      .eq('collection_path', 'users')
      .eq('doc_id', userId)
      .maybeSingle(),
    DB_OPERATION_TIMEOUT_MS,
    'Supabase tardó demasiado validando el perfil administrador.'
  );

  if (byIdError) throw byIdError;
  if (byId) return byId as AppDocumentRow;

  const byEmail = await findDocumentsByEmail(supabase, 'users', email);
  return byEmail[0] || null;
};

const ensureGlobalAdmin = async (
  supabase: AdminClient,
  token: string
) => {
  if (!token) {
    return { error: json({ error: 'Sesión no encontrada.' }, 401) };
  }

  const { data, error } = await withTimeout(
    supabase.auth.getUser(token),
    AUTH_OPERATION_TIMEOUT_MS,
    'Supabase Auth tardó demasiado validando la sesión.'
  );
  if (error || !data.user?.email) {
    return { error: json({ error: 'Sesión inválida.' }, 401) };
  }

  const requesterEmail = normalizeEmail(data.user.email);
  const profile = await findRequesterProfile(supabase, data.user.id, requesterEmail);
  const profileRole = profile?.data?.role || profile?.data?.systemRole;
  const isGlobalAdmin = ADMIN_EMAILS.has(requesterEmail) || profileRole === 'admin';

  if (!isGlobalAdmin) {
    return { error: json({ error: 'Solo el administrador global puede reenviar invitaciones.' }, 403) };
  }

  return { user: data.user, email: requesterEmail };
};

const findAuthUserByEmail = async (
  supabase: AdminClient,
  email: string
) => {
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await withTimeout(
      supabase.auth.admin.listUsers({ page, perPage }),
      AUTH_OPERATION_TIMEOUT_MS,
      'Supabase Auth tardó demasiado buscando usuarios existentes.'
    );
    if (error) throw error;

    const match = data.users.find((user: { email?: string | null }) => normalizeEmail(user.email) === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
};

const findAuthUser = async (
  supabase: AdminClient,
  userId: string,
  email: string
) => {
  if (userId) {
    const { data } = await withTimeout(
      supabase.auth.admin.getUserById(userId),
      AUTH_OPERATION_TIMEOUT_MS,
      'Supabase Auth tardó demasiado buscando el usuario.'
    );

    if (data?.user) return data.user;
  }

  return findAuthUserByEmail(supabase, email);
};

const listMatchingProfileDocuments = async (
  supabase: AdminClient,
  userId: string,
  email: string
) => {
  const { data, error } = await withTimeout(
    supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path, doc_id, data')
      .in('collection_path', ['users', 'team_members']),
    DB_OPERATION_TIMEOUT_MS,
    'Supabase tardó demasiado consultando los perfiles vinculados.'
  );

  if (error) throw error;

  return ((data || []) as AppDocumentRow[]).filter((row) => {
    const rowEmail = normalizeEmail(row.data?.email);
    const authUserId = typeof row.data?.authUserId === 'string' ? row.data.authUserId : '';

    return row.doc_id === userId || authUserId === userId || (email && rowEmail === email);
  });
};

const buildMetadata = (
  authUser: any,
  profile: AppDocumentRow | undefined,
  teamMember: AppDocumentRow | undefined,
  invitedBy: string,
  now: string
) => {
  const profileData = profile?.data || {};
  const teamData = teamMember?.data || {};
  const metadata = authUser.user_metadata || {};
  const organizationIds = getOrganizationIds({
    organizationIds: profileData.organizationIds || teamData.organizationIds || metadata.organizationIds,
    organizationId: profileData.organizationId || teamData.organizationId || metadata.organizationId,
  });
  const role = profileData.role || metadata.role || 'user';

  return {
    ...(metadata || {}),
    displayName:
      profileData.displayName ||
      teamData.name ||
      metadata.displayName ||
      metadata.full_name ||
      metadata.name ||
      normalizeEmail(authUser.email).split('@')[0],
    role,
    organizationId: role === 'admin' ? null : getPrimaryOrganizationId({ organizationIds }),
    organizationIds: role === 'admin' ? [] : organizationIds,
    invitedBy: profileData.invitedBy || invitedBy,
    inviteResentAt: now,
    lastInvitedBy: invitedBy,
  };
};

const generateAccessLink = async (
  supabase: AdminClient,
  email: string,
  metadata: Record<string, any>,
  redirectTo: string,
  mode: UserAccessEmailMode
) => {
  const params =
    mode === 'invite'
      ? {
          type: 'invite' as const,
          email,
          options: {
            data: metadata,
            redirectTo,
          },
        }
      : {
          type: 'recovery' as const,
          email,
          options: {
            redirectTo,
          },
        };

  const { data, error } = await withTimeout(
    supabase.auth.admin.generateLink(params),
    AUTH_OPERATION_TIMEOUT_MS,
    mode === 'invite'
      ? 'Supabase Auth tardó demasiado generando la invitación.'
      : 'Supabase Auth tardó demasiado generando el enlace de acceso.'
  );

  if (error) throw error;

  const actionUrl = data?.properties?.action_link;
  if (!actionUrl) {
    throw new Error('Supabase no retornó un enlace válido para reenviar la invitación.');
  }

  return actionUrl;
};

const sendUserAccessEmail = async ({
  email,
  metadata,
  invitedBy,
  redirectTo,
  actionUrl,
  mode,
}: {
  email: string;
  metadata: Record<string, any>;
  invitedBy: string;
  redirectTo: string;
  actionUrl: string;
  mode: UserAccessEmailMode;
}) => {
  const role = String(metadata.role || 'user');
  const organizationIds = getOrganizationIds({
    organizationIds: metadata.organizationIds,
    organizationId: metadata.organizationId,
  });
  const displayName =
    metadata.displayName ||
    metadata.full_name ||
    metadata.name ||
    email.split('@')[0];
  const emailData = {
    appUrl: getAppUrlFromRedirect(redirectTo),
    actionUrl,
    recipientName: displayName,
    recipientEmail: email,
    invitedBy,
    roleLabel: getUserAccessRoleLabel(role),
    organizationLabel: role === 'admin' ? 'Acceso global' : getOrganizationAccessLabel(organizationIds),
    mode,
  };

  const result = await sendEmailWithResend({
    to: email,
    subject: buildUserAccessSubject(emailData),
    html: buildUserAccessEmailHtml(emailData),
    text: buildUserAccessText(emailData),
  });

  if (result.skipped) {
    throw new Error('Falta configurar RESEND_API_KEY para reenviar invitaciones personalizadas.');
  }

  return result;
};

const sendAccessLink = async (
  supabase: AdminClient,
  email: string,
  metadata: Record<string, any>,
  redirectTo: string,
  invitedBy: string
) => {
  try {
    const actionUrl = await generateAccessLink(supabase, email, metadata, redirectTo, 'invite');
    await sendUserAccessEmail({
      email,
      metadata,
      invitedBy,
      redirectTo,
      actionUrl,
      mode: 'invite',
    });
    return 'invite_sent' as const;
  } catch (error: any) {
    const alreadyExists = /already|registered|exists/i.test(error?.message || '');
    if (!alreadyExists) {
      throw error;
    }

    const actionUrl = await generateAccessLink(supabase, email, metadata, redirectTo, 'recovery');
    await sendUserAccessEmail({
      email,
      metadata,
      invitedBy,
      redirectTo,
      actionUrl,
      mode: 'recovery',
    });

    return 'recovery_sent' as const;
  }
};

const updateProfileDocuments = async (
  supabase: AdminClient,
  rows: AppDocumentRow[],
  authUser: any,
  email: string,
  inviteStatus: 'invite_sent' | 'recovery_sent',
  invitedBy: string,
  now: string
) => {
  const hasUserProfile = rows.some((row) => row.collection_path === 'users');
  const baseUpdate = {
    authUserId: authUser.id,
    email,
    inviteStatus,
    inviteResentAt: now,
    lastInvitationSentAt: now,
    lastInvitedBy: invitedBy,
    updatedAt: now,
    ...(inviteStatus === 'recovery_sent' ? { recoverySentAt: now } : {}),
  };

  const upserts: Array<{
    collection_path: string;
    doc_id: string;
    data: Record<string, any>;
  }> = rows.map((row) => ({
    collection_path: row.collection_path,
    doc_id: row.doc_id,
    data: {
      ...(row.data || {}),
      ...baseUpdate,
      invitedAt: row.data?.invitedAt || now,
      invitedBy: row.data?.invitedBy || invitedBy,
      ...(row.collection_path === 'users'
        ? {
            uid: authUser.id,
            isPreRegistered: !(authUser.email_confirmed_at || authUser.confirmed_at),
          }
        : {}),
    },
  }));

  if (!hasUserProfile) {
    upserts.push({
      collection_path: 'users',
      doc_id: authUser.id,
      data: {
        uid: authUser.id,
        role: authUser.user_metadata?.role || 'user',
        displayName: authUser.user_metadata?.displayName || email.split('@')[0],
        isPreRegistered: !(authUser.email_confirmed_at || authUser.confirmed_at),
        invitedAt: now,
        invitedBy,
        ...baseUpdate,
      },
    });
  }

  const { error } = await withTimeout(
    supabase.from(DOCUMENTS_TABLE).upsert(upserts, { onConflict: 'collection_path,doc_id' }),
    DB_OPERATION_TIMEOUT_MS,
    'Supabase tardó demasiado actualizando el estado de invitación.'
  );
  if (error) throw error;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminClient();
    const authResult = await ensureGlobalAdmin(supabase, getBearerToken(request));
    if ('error' in authResult) return authResult.error;

    const payload = await request.json();
    const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
    const email = normalizeEmail(payload.email);

    if (!userId && !email) {
      return json({ error: 'Falta el usuario o el correo electrónico.' }, 400);
    }

    const authUser = await findAuthUser(supabase, userId, email);
    const targetEmail = normalizeEmail(authUser?.email || email);

    if (!authUser?.id || !targetEmail) {
      return json({ error: 'No encontramos el usuario en Supabase Auth.' }, 404);
    }

    if (authUser.email_confirmed_at || authUser.confirmed_at) {
      return json({ error: 'Este usuario ya confirmó su correo. No necesita reenvío de invitación.' }, 400);
    }

    const now = new Date().toISOString();
    const rows = await listMatchingProfileDocuments(supabase, authUser.id, targetEmail);
    const profile = rows.find((row) => row.collection_path === 'users');
    const teamMember = rows.find((row) => row.collection_path === 'team_members');
    const metadata = buildMetadata(authUser, profile, teamMember, authResult.email, now);

    const { error: updateError } = await withTimeout(
      supabase.auth.admin.updateUserById(authUser.id, {
        user_metadata: metadata,
      }),
      AUTH_OPERATION_TIMEOUT_MS,
      'Supabase Auth tardó demasiado actualizando la invitación.'
    );
    if (updateError) throw updateError;

    const inviteStatus = await sendAccessLink(
      supabase,
      targetEmail,
      metadata,
      getRedirectTo(request),
      authResult.email
    );

    await updateProfileDocuments(
      supabase,
      rows,
      authUser,
      targetEmail,
      inviteStatus,
      authResult.email,
      now
    );

    return json({
      userId: authUser.id,
      email: targetEmail,
      inviteStatus,
      inviteResentAt: now,
      message:
        inviteStatus === 'invite_sent'
          ? 'Invitación reenviada correctamente.'
          : 'Enlace de acceso reenviado correctamente.',
    });
  } catch (error: any) {
    console.error('Error resending user invite:', error);
    return json({ error: error.message || 'No fue posible reenviar la invitación.' }, 500);
  }
}
