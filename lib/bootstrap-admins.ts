const splitEmails = (value: string) =>
  value
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export const getBootstrapAdminEmails = () => {
  const rawValue =
    process.env.BOOTSTRAP_ADMIN_EMAILS ||
    process.env.NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAILS ||
    '';

  return splitEmails(rawValue);
};

export const getBootstrapAdminEmailSet = () => new Set(getBootstrapAdminEmails());

export const isBootstrapAdminEmail = (email: unknown) => {
  if (typeof email !== 'string') return false;
  return getBootstrapAdminEmailSet().has(email.trim().toLowerCase());
};
