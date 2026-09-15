import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBootstrapAdminEmailSet } from '@/lib/bootstrap-admins';
import { getOrganizationIds, getPrimaryOrganizationId } from '@/lib/organizations';

export const runtime = 'nodejs';

const DOCUMENTS_TABLE = 'app_documents';
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

const getBearerToken = (request: NextRequest) => {
  const header = request.headers.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
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
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path, doc_id, data')
    .eq('collection_path', collectionPath)
    .eq('data->>email', email);

  if (error) throw error;
  return (data || []) as AppDocumentRow[];
};

const findRequesterProfile = async (
  supabase: AdminClient,
  userId: string,
  email: string
) => {
  const { data: byId, error: byIdError } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path, doc_id, data')
    .eq('collection_path', 'users')
    .eq('doc_id', userId)
    .maybeSingle();

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

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) {
    return { error: json({ error: 'Sesión inválida.' }, 401) };
  }

  const requesterEmail = normalizeEmail(data.user.email);
  const profile = await findRequesterProfile(supabase, data.user.id, requesterEmail);
  const profileRole = profile?.data?.role || profile?.data?.systemRole;
  const isGlobalAdmin = ADMIN_EMAILS.has(requesterEmail) || profileRole === 'admin';

  if (!isGlobalAdmin) {
    return { error: json({ error: 'Solo el administrador global puede administrar usuarios.' }, 403) };
  }

  return { user: data.user, email: requesterEmail };
};

const listAuthUsers = async (supabase: AdminClient) => {
  const users = [];
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    users.push(...data.users);
    if (data.users.length < perPage) return users;
    page += 1;
  }
};

const findAuthUserByEmail = async (
  supabase: AdminClient,
  email: string
) => {
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const match = data.users.find((user: { email?: string | null }) => normalizeEmail(user.email) === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
};

const listProfileDocuments = async (supabase: AdminClient) => {
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path, doc_id, data')
    .in('collection_path', ['users', 'team_members']);

  if (error) throw error;
  return (data || []) as AppDocumentRow[];
};

const listDocumentsByCollection = async (
  supabase: AdminClient,
  collectionPath: string
) => {
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path, doc_id, data')
    .eq('collection_path', collectionPath);

  if (error) throw error;
  return (data || []) as AppDocumentRow[];
};

const indexProfiles = (rows: AppDocumentRow[]) => {
  const usersById = new Map<string, AppDocumentRow>();
  const usersByEmail = new Map<string, AppDocumentRow>();
  const teamByAuthId = new Map<string, AppDocumentRow>();
  const teamByEmail = new Map<string, AppDocumentRow>();

  for (const row of rows) {
    const email = normalizeEmail(row.data?.email);
    const authUserId = typeof row.data?.authUserId === 'string' ? row.data.authUserId : '';

    if (row.collection_path === 'users') {
      usersById.set(row.doc_id, row);
      if (email) usersByEmail.set(email, row);
    }

    if (row.collection_path === 'team_members') {
      if (authUserId) teamByAuthId.set(authUserId, row);
      if (email) teamByEmail.set(email, row);
    }
  }

  return { usersById, usersByEmail, teamByAuthId, teamByEmail };
};

const authStatusFor = (user: any, profile?: AppDocumentRow, teamMember?: AppDocumentRow) => {
  const profileData = profile?.data || {};
  const teamData = teamMember?.data || {};
  const inviteStatus = profileData.inviteStatus || teamData.inviteStatus;

  if (user.email_confirmed_at || user.confirmed_at) return 'confirmed';
  if (user.invited_at || inviteStatus === 'invite_sent') return 'invite_sent';
  if (user.recovery_sent_at || inviteStatus === 'recovery_sent') return 'recovery_sent';
  if (user.confirmation_sent_at) return 'confirmation_sent';
  return 'pending';
};

const compactUser = (
  user: any,
  profile: AppDocumentRow | undefined,
  teamMember: AppDocumentRow | undefined
) => {
  const email = normalizeEmail(user.email);
  const metadata = user.user_metadata || {};
  const profileData = profile?.data || {};
  const teamData = teamMember?.data || {};
  const organizationIds = getOrganizationIds({
    organizationIds: profileData.organizationIds || teamData.organizationIds || metadata.organizationIds,
    organizationId: profileData.organizationId || teamData.organizationId || metadata.organizationId,
  });

  return {
    id: user.id,
    uid: user.id,
    email,
    displayName:
      profileData.displayName ||
      teamData.name ||
      metadata.displayName ||
      metadata.full_name ||
      metadata.name ||
      email.split('@')[0],
    photoURL: profileData.photoURL || teamData.photoURL || metadata.photoURL || metadata.avatar_url || null,
    role: profileData.role || metadata.role || 'user',
    organizationId: getPrimaryOrganizationId({ organizationIds }),
    organizationIds,
    isPreRegistered: Boolean(profileData.isPreRegistered) && !(user.email_confirmed_at || user.confirmed_at),
    inviteStatus: profileData.inviteStatus || null,
    authStatus: authStatusFor(user, profile, teamMember),
    emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
    emailConfirmedAt: user.email_confirmed_at || user.confirmed_at || null,
    confirmationSentAt: user.confirmation_sent_at || null,
    invitedAt: user.invited_at || profileData.invitedAt || null,
    inviteResentAt: profileData.inviteResentAt || teamData.inviteResentAt || null,
    lastInvitationSentAt: profileData.lastInvitationSentAt || teamData.lastInvitationSentAt || null,
    recoverySentAt: user.recovery_sent_at || profileData.recoverySentAt || teamData.recoverySentAt || null,
    lastSignInAt: user.last_sign_in_at || profileData.lastLoginAt || null,
    createdAt: user.created_at || profileData.createdAt || null,
    teamMemberId: teamMember?.doc_id || null,
  };
};

const deleteDocumentsForUser = async (
  supabase: AdminClient,
  userId: string,
  email: string
) => {
  const rows = await listProfileDocuments(supabase);
  const rowsToDelete = rows.filter((row) => {
    const rowEmail = normalizeEmail(row.data?.email);
    const authUserId = typeof row.data?.authUserId === 'string' ? row.data.authUserId : '';

    return row.doc_id === userId || authUserId === userId || (email && rowEmail === email);
  });

  await Promise.all(
    rowsToDelete.map((row) =>
      supabase
        .from(DOCUMENTS_TABLE)
        .delete()
        .eq('collection_path', row.collection_path)
        .eq('doc_id', row.doc_id)
    )
  );
};

const upsertDocumentData = async (
  supabase: AdminClient,
  collectionPath: string,
  docId: string,
  data: Record<string, any>
) => {
  const { error } = await supabase
    .from(DOCUMENTS_TABLE)
    .upsert(
      {
        collection_path: collectionPath,
        doc_id: docId,
        data,
      },
      { onConflict: 'collection_path,doc_id' }
    );

  if (error) throw error;
};

const updateProfileEmailReferences = async (
  supabase: AdminClient,
  targetAuthUser: any,
  oldEmail: string,
  newEmail: string,
  requesterEmail: string
) => {
  const now = new Date().toISOString();
  const rows = await listProfileDocuments(supabase);
  const targetRows = rows.filter((row) => {
    const rowEmail = normalizeEmail(row.data?.email);
    const authUserId = typeof row.data?.authUserId === 'string' ? row.data.authUserId : '';
    const uid = typeof row.data?.uid === 'string' ? row.data.uid : '';

    return (
      row.doc_id === targetAuthUser.id ||
      authUserId === targetAuthUser.id ||
      uid === targetAuthUser.id ||
      (oldEmail && rowEmail === oldEmail)
    );
  });

  if (targetRows.length === 0) {
    const displayName =
      targetAuthUser.user_metadata?.displayName ||
      targetAuthUser.user_metadata?.full_name ||
      targetAuthUser.user_metadata?.name ||
      newEmail.split('@')[0];

    await upsertDocumentData(supabase, 'users', targetAuthUser.id, {
      uid: targetAuthUser.id,
      authUserId: targetAuthUser.id,
      email: newEmail,
      displayName,
      role: targetAuthUser.user_metadata?.role || 'user',
      createdAt: now,
      updatedAt: now,
      emailUpdatedAt: now,
      emailUpdatedBy: requesterEmail,
      previousEmails: oldEmail ? [oldEmail] : [],
    });

    return { profileUpdates: 1 };
  }

  await Promise.all(
    targetRows.map((row) => {
      const rowPreviousEmails = Array.isArray(row.data?.previousEmails) ? row.data.previousEmails : [];
      const previousEmails = oldEmail
        ? Array.from(new Set([...rowPreviousEmails.map(normalizeEmail).filter(Boolean), oldEmail]))
        : rowPreviousEmails;
      const isUserProfile = row.collection_path === 'users';
      const displayName =
        row.data?.displayName ||
        row.data?.name ||
        targetAuthUser.user_metadata?.displayName ||
        targetAuthUser.user_metadata?.full_name ||
        newEmail.split('@')[0];

      return upsertDocumentData(supabase, row.collection_path, row.doc_id, {
        ...row.data,
        ...(isUserProfile
          ? {
              uid: targetAuthUser.id,
              authUserId: targetAuthUser.id,
              displayName,
            }
          : {
              authUserId: targetAuthUser.id,
              name: row.data?.name || displayName,
            }),
        email: newEmail,
        previousEmails,
        updatedAt: now,
        emailUpdatedAt: now,
        emailUpdatedBy: requesterEmail,
      });
    })
  );

  return { profileUpdates: targetRows.length };
};

const updateProjectEmailReferences = async (
  supabase: AdminClient,
  oldEmail: string,
  newEmail: string
) => {
  if (!oldEmail || oldEmail === newEmail) return { projectUpdates: 0 };

  const now = new Date().toISOString();
  const projects = await listDocumentsByCollection(supabase, 'projects');
  const projectsToUpdate = projects.filter((row) =>
    Array.isArray(row.data?.assignedEmails) &&
    row.data.assignedEmails.some((email: unknown) => normalizeEmail(email) === oldEmail)
  );

  await Promise.all(
    projectsToUpdate.map((row) => {
      const assignedEmails = Array.from(
        new Set(
          row.data.assignedEmails
            .map((email: unknown) => (normalizeEmail(email) === oldEmail ? newEmail : normalizeEmail(email)))
            .filter(Boolean)
        )
      );

      return upsertDocumentData(supabase, row.collection_path, row.doc_id, {
        ...row.data,
        assignedEmails,
        updatedAt: now,
      });
    })
  );

  return { projectUpdates: projectsToUpdate.length };
};

export async function GET(request: NextRequest) {
  try {
    const supabase = getAdminClient();
    const authResult = await ensureGlobalAdmin(supabase, getBearerToken(request));
    if ('error' in authResult) return authResult.error;

    const [authUsers, profileRows] = await Promise.all([
      listAuthUsers(supabase),
      listProfileDocuments(supabase),
    ]);
    const indexes = indexProfiles(profileRows);

    const users = authUsers
      .filter((user: any) => normalizeEmail(user.email))
      .map((user: any) => {
        const email = normalizeEmail(user.email);
        const profile = indexes.usersById.get(user.id) || indexes.usersByEmail.get(email);
        const teamMember = indexes.teamByAuthId.get(user.id) || indexes.teamByEmail.get(email);
        return compactUser(user, profile, teamMember);
      })
      .sort((left: any, right: any) => left.email.localeCompare(right.email));

    return json({ users });
  } catch (error: any) {
    console.error('Error listing admin users:', error);
    return json({ error: error.message || 'No fue posible listar los usuarios.' }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = getAdminClient();
    const authResult = await ensureGlobalAdmin(supabase, getBearerToken(request));
    if ('error' in authResult) return authResult.error;

    const payload = await request.json();
    const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
    const newEmail = normalizeEmail(payload.email);

    if (!userId) {
      return json({ error: 'Falta el ID del usuario.' }, 400);
    }

    if (!newEmail || !newEmail.includes('@')) {
      return json({ error: 'Correo electrónico inválido.' }, 400);
    }

    const { data: targetData, error: targetError } = await supabase.auth.admin.getUserById(userId);
    if (targetError) throw targetError;
    const targetAuthUser = targetData?.user;

    if (!targetAuthUser?.id) {
      return json({ error: 'El usuario no existe en Supabase Auth.' }, 404);
    }

    const oldEmail = normalizeEmail(targetAuthUser.email);
    if (oldEmail === newEmail) {
      return json({
        userId,
        email: newEmail,
        message: 'El correo ya estaba actualizado.',
        profileUpdates: 0,
        projectUpdates: 0,
      });
    }

    const existingAuthUser = await findAuthUserByEmail(supabase, newEmail);
    if (existingAuthUser && existingAuthUser.id !== userId) {
      return json({ error: 'Ese correo ya pertenece a otro usuario de Supabase Auth.' }, 409);
    }

    const existingProfileRows = await listProfileDocuments(supabase);
    const conflictingProfile = existingProfileRows.find((row) => {
      const rowEmail = normalizeEmail(row.data?.email);
      const authUserId = typeof row.data?.authUserId === 'string' ? row.data.authUserId : '';
      const uid = typeof row.data?.uid === 'string' ? row.data.uid : '';

      return rowEmail === newEmail && row.doc_id !== userId && authUserId !== userId && uid !== userId;
    });

    if (conflictingProfile) {
      return json({ error: 'Ese correo ya está registrado en otro perfil de la aplicación.' }, 409);
    }

    const mergedMetadata = {
      ...(targetAuthUser.user_metadata || {}),
      email: newEmail,
    };

    const { data: updatedData, error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      email: newEmail,
      email_confirm: true,
      user_metadata: mergedMetadata,
    });

    if (updateError) throw updateError;

    const updatedAuthUser = updatedData?.user || { ...targetAuthUser, email: newEmail, user_metadata: mergedMetadata };
    const profileResult = await updateProfileEmailReferences(
      supabase,
      updatedAuthUser,
      oldEmail,
      newEmail,
      authResult.email
    );
    const projectResult = await updateProjectEmailReferences(supabase, oldEmail, newEmail);

    return json({
      userId,
      previousEmail: oldEmail,
      email: newEmail,
      ...profileResult,
      ...projectResult,
      message: 'Correo actualizado en Supabase Auth, perfiles y proyectos asignados.',
    });
  } catch (error: any) {
    console.error('Error updating admin user email:', error);
    return json({ error: error.message || 'No fue posible actualizar el correo del usuario.' }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = getAdminClient();
    const authResult = await ensureGlobalAdmin(supabase, getBearerToken(request));
    if ('error' in authResult) return authResult.error;

    const payload = await request.json();
    const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
    const email = normalizeEmail(payload.email);

    if (!userId) {
      return json({ error: 'Falta el ID del usuario.' }, 400);
    }

    if (authResult.user.id === userId) {
      return json({ error: 'No puedes eliminar tu propio usuario desde esta pantalla.' }, 400);
    }

    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteAuthError) throw deleteAuthError;

    await deleteDocumentsForUser(supabase, userId, email);

    return json({
      userId,
      message: 'Usuario eliminado de Supabase Auth y de los perfiles de la app.',
    });
  } catch (error: any) {
    console.error('Error deleting admin user:', error);
    return json({ error: error.message || 'No fue posible eliminar el usuario.' }, 500);
  }
}
