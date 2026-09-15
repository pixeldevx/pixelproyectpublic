export type Workspace = {
  id: string;
  name: string;
  organization_id: string;
  role: string;
  is_platform_admin?: boolean;
  status: string;
  trial_ends_at: string | null;
};

export function isWorkspaceExpired(workspace: Workspace | null, now = Date.now()): boolean {
  if (!workspace) return false;
  if (!['active', 'trial', 'trialing'].includes(workspace.status)) return true;
  if (workspace.status === 'active') return false;
  if (!workspace.trial_ends_at) return true;
  const end = new Date(workspace.trial_ends_at).getTime();
  return !Number.isFinite(end) || end <= now;
}

export function trialDaysRemaining(workspace: Workspace | null, now = Date.now()): number | null {
  if (!workspace?.trial_ends_at || workspace.status === 'active') return null;
  return Math.max(0, Math.ceil((new Date(workspace.trial_ends_at).getTime() - now) / 86400000));
}
