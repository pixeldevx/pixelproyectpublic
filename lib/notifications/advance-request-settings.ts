import {
  canAccessProject,
  listDocuments,
  readDocument,
  type PixelActor,
} from '@/lib/github/server';
import {
  DEFAULT_ROLE_PERMISSIONS,
  normalizeRolePermissions,
  resolveRolePermissions,
  type RolePermissionSettings,
} from '@/lib/permissions';

export const ADVANCE_REQUEST_NOTIFICATION_COLLECTION = 'administrativeNotificationSettings';
export const ADVANCE_REQUEST_NOTIFICATION_RULE_ID = 'advanceRequestSubmitted';
export const ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE = 'advance_request_submitted';
export const MAX_ADVANCE_NOTIFICATION_RECIPIENTS = 25;

export type AdvanceRequestNotificationChannels = {
  inApp: true;
  email: boolean;
  push: boolean;
};

export type AdvanceRequestNotificationRule = {
  enabled: boolean;
  recipientIds: string[];
  channels: AdvanceRequestNotificationChannels;
  version: number;
};

export type AdvanceRequestNotificationCandidate = {
  id: string;
  authUserId: string;
  teamMemberId: string | null;
  email: string;
  name: string;
  roleName: string;
};

const SYSTEM_ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador Global',
  org_admin: 'Administrador de Organización',
  manager: 'Gerente',
  gerente: 'Gerente',
  project_manager: 'Gerente de proyecto',
  coordinador: 'Coordinador',
  coordinator: 'Coordinador',
  administrativo: 'Administrativo',
  user: 'Usuario',
};

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

const cleanText = (value: unknown, maxLength = 300) =>
  String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const normalizeIds = (value: unknown, limit = MAX_ADVANCE_NOTIFICATION_RECIPIENTS) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((entry) => cleanText(entry, 180))
        .filter(Boolean),
    ),
  ).slice(0, limit);

const isActiveProfile = (value: Record<string, any> | null | undefined) => {
  if (!value) return true;
  if (value.active === false || value.isActive === false || value.disabled === true) return false;
  const status = cleanText(value.status, 40).toLowerCase();
  return !['inactive', 'disabled', 'deleted', 'archived', 'suspended'].includes(status);
};

const isActiveAuthUser = (value: Record<string, any> | null | undefined) => {
  if (!value || value.deleted_at) return false;
  const bannedUntil = value.banned_until
    ? new Date(String(value.banned_until)).getTime()
    : Number.NaN;
  return !Number.isFinite(bannedUntil) || bannedUntil <= Date.now();
};

const getOrganizationIds = (value: Record<string, any> | null | undefined) =>
  Array.from(
    new Set(
      [value?.organizationId, ...(Array.isArray(value?.organizationIds) ? value.organizationIds : [])]
        .map((entry) => cleanText(entry, 180))
        .filter(Boolean),
    ),
  );

const comparableCandidateKey = (candidate: Pick<AdvanceRequestNotificationCandidate, 'authUserId' | 'email'>) =>
  candidate.authUserId ? `user:${candidate.authUserId}` : `email:${candidate.email}`;

const listAuthUsers = async (supabase: any, maxUsers = 2_000) => {
  const users: Array<Record<string, any>> = [];
  const perPage = 1_000;
  for (let page = 1; users.length < maxUsers; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const pageUsers = Array.isArray(data?.users) ? data.users : [];
    users.push(...pageUsers.slice(0, maxUsers - users.length));
    if (pageUsers.length < perPage) break;
  }
  return users;
};

export const getAdvanceRequestNotificationCollectionPath = (projectId: string) =>
  `projects/${projectId}/${ADVANCE_REQUEST_NOTIFICATION_COLLECTION}`;

export const normalizeAdvanceRequestNotificationRule = (
  value: Record<string, any> | null | undefined,
): AdvanceRequestNotificationRule => ({
  enabled: value?.enabled !== false,
  recipientIds: normalizeIds(value?.recipientIds),
  channels: {
    inApp: true,
    email: value?.channels?.email !== false,
    push: value?.channels?.push !== false,
  },
  version: Math.max(0, Math.floor(Number(value?.version) || 0)),
});

export const loadAdvanceRequestNotificationRule = async (
  supabase: any,
  projectId: string,
) => {
  const stored = await readDocument(
    supabase,
    getAdvanceRequestNotificationCollectionPath(projectId),
    ADVANCE_REQUEST_NOTIFICATION_RULE_ID,
  );
  return {
    stored,
    rule: normalizeAdvanceRequestNotificationRule(stored),
  };
};

export const loadRolePermissionSettings = async (supabase: any): Promise<RolePermissionSettings> => {
  const stored = await readDocument(supabase, 'settings', 'rolePermissions');
  return normalizeRolePermissions(stored || DEFAULT_ROLE_PERMISSIONS);
};

const buildCandidateActor = ({
  user,
  member,
}: {
  user?: Record<string, any> | null;
  member?: Record<string, any> | null;
}) => {
  const email = normalizeEmail(member?.email || user?.email);
  const authUserId = cleanText(
    member?.authUserId || member?.uid || user?.authUserId || user?.uid || user?.id,
    180,
  );
  const teamMemberId = cleanText(member?.id, 180) || null;
  const systemRole = cleanText(
    user?.role || user?.systemRole || member?.systemRole || member?.profileRole || member?.role || 'user',
    80,
  ).toLowerCase();
  const name = cleanText(
    member?.displayName || member?.name || user?.displayName || user?.name || email.split('@')[0] || 'Usuario',
    240,
  );
  const roleName = cleanText(
    member?.roleName || user?.roleName || user?.position || user?.jobTitle || SYSTEM_ROLE_LABELS[systemRole] || 'Usuario',
    160,
  );
  const organizationIds = Array.from(new Set([
    ...getOrganizationIds(user),
    ...getOrganizationIds(member),
  ]));
  const profileId = teamMemberId || cleanText(user?.id, 180) || authUserId;

  const actor: PixelActor = {
    id: authUserId || profileId,
    email,
    role: systemRole,
    profile: {
      ...(member || {}),
      ...(user || {}),
      id: profileId,
      uid: cleanText(user?.uid || authUserId, 180),
      authUserId,
      teamMemberId,
      organizationId: organizationIds[0] || null,
      organizationIds,
    },
  };

  return {
    actor,
    candidate: {
      id: authUserId,
      authUserId,
      teamMemberId,
      email,
      name,
      roleName,
    } satisfies AdvanceRequestNotificationCandidate,
  };
};

export const resolveAdvanceRequestNotificationCandidates = async (
  supabase: any,
  project: Record<string, any>,
  permissionSettings?: RolePermissionSettings,
) => {
  const [members, users, authUsers, resolvedPermissionSettings] = await Promise.all([
    listDocuments(supabase, 'team_members', 2_000),
    listDocuments(supabase, 'users', 2_000),
    listAuthUsers(supabase),
    permissionSettings ? Promise.resolve(permissionSettings) : loadRolePermissionSettings(supabase),
  ]);

  const authUsersById = new Map<string, Record<string, any>>();
  authUsers.forEach((authUser: Record<string, any>) => {
    const id = cleanText(authUser.id, 180);
    if (id) authUsersById.set(id, authUser);
  });

  const usersById = new Map<string, Record<string, any>>();
  const usersByEmail = new Map<string, Record<string, any>>();
  users.forEach((user: Record<string, any>) => {
    [user.id, user.uid, user.authUserId]
      .map((entry) => cleanText(entry, 180))
      .filter(Boolean)
      .forEach((id) => usersById.set(id, user));
    const email = normalizeEmail(user.email);
    if (email) usersByEmail.set(email, user);
  });

  const mergedCandidates: Array<{ user?: Record<string, any>; member?: Record<string, any> }> = [];
  const linkedUserIds = new Set<string>();
  const linkedUserEmails = new Set<string>();

  members.forEach((member: Record<string, any>) => {
    const email = normalizeEmail(member.email);
    const user =
      usersById.get(cleanText(member.authUserId, 180)) ||
      usersById.get(cleanText(member.uid, 180)) ||
      usersById.get(cleanText(member.id, 180)) ||
      usersByEmail.get(email);
    if (user?.id) linkedUserIds.add(String(user.id));
    if (email) linkedUserEmails.add(email);
    mergedCandidates.push({ user, member });
  });

  users.forEach((user: Record<string, any>) => {
    const email = normalizeEmail(user.email);
    if (linkedUserIds.has(String(user.id)) || (email && linkedUserEmails.has(email))) return;
    mergedCandidates.push({ user });
  });

  const byIdentity = new Map<string, AdvanceRequestNotificationCandidate>();
  mergedCandidates.forEach(({ user, member }) => {
    if (!isActiveProfile(user) || !isActiveProfile(member)) return;
    const { actor, candidate } = buildCandidateActor({ user, member });
    // A real Auth identity is required because every configured recipient must
    // be able to receive and open the in-app alert under their own session.
    if (!candidate.id || !candidate.authUserId) return;
    const authUser = authUsersById.get(candidate.authUserId);
    const verifiedEmail = normalizeEmail(authUser?.email);
    if (!isActiveAuthUser(authUser) || !verifiedEmail) return;
    const verifiedActor: PixelActor = {
      ...actor,
      id: candidate.authUserId,
      email: verifiedEmail,
      profile: {
        ...actor.profile,
        uid: candidate.authUserId,
        authUserId: candidate.authUserId,
      },
    };
    if (!canAccessProject(verifiedActor, project)) return;
    const permissions = resolveRolePermissions(resolvedPermissionSettings, verifiedActor.role);
    if (!permissions.administrationProjectView) return;
    const verifiedCandidate = { ...candidate, email: verifiedEmail };
    byIdentity.set(comparableCandidateKey(verifiedCandidate), verifiedCandidate);
  });

  return Array.from(byIdentity.values()).sort((left, right) =>
    left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }),
  );
};

export const getActorAdministrationPermissions = async (supabase: any, actor: PixelActor) => {
  const settings = await loadRolePermissionSettings(supabase);
  return {
    settings,
    permissions: resolveRolePermissions(settings, actor.role),
  };
};
