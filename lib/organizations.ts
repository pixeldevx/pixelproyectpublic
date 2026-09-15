export const getOrganizationIds = (value: any): string[] => {
  const ids = new Set<string>();

  if (Array.isArray(value?.organizationIds)) {
    value.organizationIds.forEach((id: unknown) => {
      if (typeof id === 'string' && id.trim()) {
        ids.add(id.trim());
      }
    });
  }

  if (typeof value?.organizationId === 'string' && value.organizationId.trim()) {
    ids.add(value.organizationId.trim());
  }

  return Array.from(ids);
};

export const getPrimaryOrganizationId = (value: any): string | null => {
  return getOrganizationIds(value)[0] || null;
};

export const belongsToAnyOrganization = (
  value: any,
  allowedOrganizationIds: string[]
) => {
  if (allowedOrganizationIds.length === 0) return true;
  const valueOrganizationIds = getOrganizationIds(value);
  return valueOrganizationIds.some((id) => allowedOrganizationIds.includes(id));
};

export const organizationNameFor = (
  value: any,
  organizations: Array<{ id: string; name?: string }>
) => {
  const ids = getOrganizationIds(value);
  if (ids.length === 0) return 'Sin organización';

  const names = ids
    .map((id) => organizations.find((organization) => organization.id === id)?.name || id)
    .filter(Boolean);

  return names.length > 0 ? names.join(', ') : 'Sin organización';
};
