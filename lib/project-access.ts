import { belongsToAnyOrganization } from '@/lib/organizations';

const ORGANIZATION_SCOPE_ROLES = new Set([
  'admin',
  'org_admin',
  'manager',
  'gerente',
  'project_manager',
  'coordinador',
  'coordinator',
]);

const normalizeIds = (ids: any[] = []) =>
  Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));

export const canLoadProjectForUser = (
  project: any,
  {
    assignedIds = [],
    managedOrganizationIds = [],
    userId = '',
    userRole = '',
  }: {
    assignedIds?: string[];
    managedOrganizationIds?: string[];
    userId?: string | null;
    userRole?: string | null;
  }
) => {
  const normalizedAssignedIds = normalizeIds([userId, ...assignedIds]);

  if (userRole === 'admin') return true;

  if (userRole === 'org_admin') {
    return managedOrganizationIds.length === 0 || belongsToAnyOrganization(project, managedOrganizationIds);
  }

  if (
    userRole &&
    ORGANIZATION_SCOPE_ROLES.has(userRole) &&
    managedOrganizationIds.length > 0 &&
    belongsToAnyOrganization(project, managedOrganizationIds)
  ) {
    return true;
  }

  const assignedUsers = Array.isArray(project?.assignedUsers) ? project.assignedUsers : [];
  const assignedTeamMembers = Array.isArray(project?.assignedTeamMembers) ? project.assignedTeamMembers : [];

  return Boolean(
    project?.ownerId === userId ||
    assignedUsers.some((id: string) => normalizedAssignedIds.includes(id)) ||
    assignedTeamMembers.some((id: string) => normalizedAssignedIds.includes(id))
  );
};
