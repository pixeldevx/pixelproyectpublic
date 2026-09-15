import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBootstrapAdminEmailSet } from '@/lib/bootstrap-admins';
import { getPrimaryOrganizationId } from '@/lib/organizations';
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
const SYSTEM_ROLES = new Set([
  'admin',
  'org_admin',
  'manager',
  'coordinador',
  'administrativo',
  'user',
]);

type AppDocumentRow = {
  collection_path: string;
  doc_id: string;
  data: Record<string, any>;
};

type AdminClient = any;

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

const displayNameFor = (displayName: unknown, email: string) => {
  if (typeof displayName === 'string' && displayName.trim()) {
    return displayName.trim();
  }
  return email.split('@')[0];
};

const normalizeOrganizationIds = (payload: any) => {
  const ids = new Set<string>();

  if (Array.isArray(payload.organizationIds)) {
    payload.organizationIds.forEach((id: unknown) => {
      if (typeof id === 'string' && id.trim()) ids.add(id.trim());
    });
  }

  if (typeof payload.organizationId === 'string' && payload.organizationId.trim()) {
    ids.add(payload.organizationId.trim());
  }

  return Array.from(ids);
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
    'Supabase tardó demasiado consultando los perfiles de usuario.'
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
    return { error: json({ error: 'Solo el administrador global puede invitar usuarios.' }, 403) };
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

const removeDuplicateUserProfiles = async (
  supabase: AdminClient,
  email: string,
  keepDocId: string
) => {
  const matches = await findDocumentsByEmail(supabase, 'users', email);

  await Promise.all(
    matches
      .filter((row) => row.doc_id !== keepDocId)
      .map((row) =>
        supabase
          .from(DOCUMENTS_TABLE)
          .delete()
          .eq('collection_path', row.collection_path)
          .eq('doc_id', row.doc_id)
      )
  );
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
      : 'Supabase Auth tardó demasiado generando el enlace de contraseña.'
  );

  if (error) throw error;

  const actionUrl = data?.properties?.action_link;
  const authUser = data?.user;

  if (!actionUrl || !authUser?.id) {
    throw new Error('Supabase no retornó un enlace válido para enviar la invitación.');
  }

  return { actionUrl, authUser };
};

const sendUserAccessEmail = async ({
  email,
  displayName,
  invitedBy,
  systemRole,
  organizationIds,
  redirectTo,
  actionUrl,
  mode,
}: {
  email: string;
  displayName: string;
  invitedBy: string;
  systemRole: string;
  organizationIds: string[];
  redirectTo: string;
  actionUrl: string;
  mode: UserAccessEmailMode;
}) => {
  const emailData = {
    appUrl: getAppUrlFromRedirect(redirectTo),
    actionUrl,
    recipientName: displayName || email.split('@')[0],
    recipientEmail: email,
    invitedBy,
    roleLabel: getUserAccessRoleLabel(systemRole),
    organizationLabel: systemRole === 'admin' ? 'Acceso global' : getOrganizationAccessLabel(organizationIds),
    mode,
  };

  const result = await sendEmailWithResend({
    to: email,
    subject: buildUserAccessSubject(emailData),
    html: buildUserAccessEmailHtml(emailData),
    text: buildUserAccessText(emailData),
  });

  if (result.skipped) {
    throw new Error('Falta configurar RESEND_API_KEY para enviar invitaciones personalizadas.');
  }

  return result;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminClient();
    const authResult = await ensureGlobalAdmin(supabase, getBearerToken(request));
    if ('error' in authResult) return authResult.error;

    const payload = await request.json();
    const email = normalizeEmail(payload.email);
    const displayName = displayNameFor(payload.displayName, email);
    const systemRole = SYSTEM_ROLES.has(payload.systemRole) ? payload.systemRole : 'user';
    const organizationIds = normalizeOrganizationIds(payload);
    const organizationId = getPrimaryOrganizationId({ organizationIds });
    const projectRoleId =
      typeof payload.projectRoleId === 'string' && payload.projectRoleId.trim()
        ? payload.projectRoleId.trim()
        : 'system_created';
    const projectRoleName =
      typeof payload.projectRoleName === 'string' && payload.projectRoleName.trim()
        ? payload.projectRoleName.trim()
        : 'Usuario del Sistema';
    const photoURL =
      typeof payload.photoURL === 'string' && payload.photoURL.trim()
        ? payload.photoURL.trim()
        : null;

    if (!email || !email.includes('@')) {
      return json({ error: 'Correo electrónico inválido.' }, 400);
    }

    if (systemRole !== 'admin' && organizationIds.length === 0) {
      return json({ error: 'Selecciona al menos una organización para usuarios no administradores globales.' }, 400);
    }

    const redirectTo = getRedirectTo(request);
    const metadata = {
      displayName,
      role: systemRole,
      organizationId: systemRole === 'admin' ? null : organizationId,
      organizationIds: systemRole === 'admin' ? [] : organizationIds,
      invitedBy: authResult.email,
    };

    let inviteMode: 'invite_sent' | 'recovery_sent' = 'invite_sent';
    let authUser = null;

    let actionUrl = '';

    try {
      const inviteLink = await generateAccessLink(supabase, email, metadata, redirectTo, 'invite');
      authUser = inviteLink.authUser;
      actionUrl = inviteLink.actionUrl;
    } catch (error: any) {
      const alreadyExists = /already|registered|exists/i.test(error?.message || '');
      if (!alreadyExists) {
        throw error;
      }

      authUser = await findAuthUserByEmail(supabase, email);
      if (!authUser) {
        throw error;
      }

      const { error: updateError } = await withTimeout(
        supabase.auth.admin.updateUserById(authUser.id, {
          user_metadata: {
            ...(authUser.user_metadata || {}),
            ...metadata,
          },
        }),
        AUTH_OPERATION_TIMEOUT_MS,
        'Supabase Auth tardó demasiado actualizando el usuario existente.'
      );
      if (updateError) throw updateError;

      const recoveryLink = await generateAccessLink(supabase, email, metadata, redirectTo, 'recovery');
      actionUrl = recoveryLink.actionUrl;
      inviteMode = 'recovery_sent';
    }

    if (!authUser?.id) {
      return json({ error: 'Supabase no retornó el usuario invitado.' }, 502);
    }

    const now = new Date().toISOString();
    const existingTeamMembers = await findDocumentsByEmail(supabase, 'team_members', email);
    const teamMemberDocId = existingTeamMembers[0]?.doc_id || authUser.id;

    const userProfile = {
      uid: authUser.id,
      authUserId: authUser.id,
      email,
      displayName,
      role: systemRole,
      isPreRegistered: true,
      inviteStatus: inviteMode,
      invitedAt: now,
      lastInvitationSentAt: now,
      invitedBy: authResult.email,
      updatedAt: now,
      ...(photoURL ? { photoURL } : {}),
      organizationId: systemRole === 'admin' ? null : organizationId,
      organizationIds: systemRole === 'admin' ? [] : organizationIds,
    };

    const teamMemberProfile = {
      email,
      name: displayName,
      roleId: projectRoleId,
      roleName: projectRoleName,
      authUserId: authUser.id,
      inviteStatus: inviteMode,
      invitedAt: now,
      lastInvitationSentAt: now,
      invitedBy: authResult.email,
      updatedAt: now,
      ...(photoURL ? { photoURL } : {}),
      organizationId: systemRole === 'admin' ? null : organizationId,
      organizationIds: systemRole === 'admin' ? [] : organizationIds,
    };

    const { error: upsertError } = await withTimeout(
      supabase.from(DOCUMENTS_TABLE).upsert(
        [
          {
            collection_path: 'users',
            doc_id: authUser.id,
            data: userProfile,
          },
          {
            collection_path: 'team_members',
            doc_id: teamMemberDocId,
            data: {
              ...(existingTeamMembers[0]?.data || {}),
              ...teamMemberProfile,
              createdAt: existingTeamMembers[0]?.data?.createdAt || now,
            },
          },
        ],
        { onConflict: 'collection_path,doc_id' }
      ),
      DB_OPERATION_TIMEOUT_MS,
      'Supabase tardó demasiado guardando el perfil del usuario invitado.'
    );

    if (upsertError) throw upsertError;
    await removeDuplicateUserProfiles(supabase, email, authUser.id);

    await sendUserAccessEmail({
      email,
      displayName,
      invitedBy: authResult.email,
      systemRole,
      organizationIds,
      redirectTo,
      actionUrl,
      mode: inviteMode === 'invite_sent' ? 'invite' : 'recovery',
    });

    return json({
      userId: authUser.id,
      email,
      inviteStatus: inviteMode,
      message:
        inviteMode === 'invite_sent'
          ? 'Usuario creado e invitación enviada.'
          : 'Usuario actualizado y enlace de contraseña enviado.',
    });
  } catch (error: any) {
    console.error('Error inviting user:', error);
    return json(
      {
        error: error.message || 'No fue posible invitar el usuario.',
      },
      500
    );
  }
}
