export type PlatformView = 'workspaces' | 'organizations' | 'users';

export type PlatformSummary = {
  workspaces: number;
  trialWorkspaces: number;
  activeWorkspaces: number;
  suspendedWorkspaces: number;
  users: number;
  organizations: number;
};

export type PlatformWorkspace = {
  id: string;
  name: string;
  status: 'trial' | 'active' | 'suspended';
  trial_ends_at: string | null;
  owner_email: string | null;
  owner_id?: string;
  legacy_storage?: boolean;
  member_count: number;
  organization_count: number;
  created_at: string;
};

export type PlatformUser = {
  id: string;
  email: string | null;
  displayName: string;
  workspace_id: string | null;
  workspace_name: string | null;
  membership_role: string | null;
  systemRole: string | null;
  organizationIds: string[];
  suspended_at: string | null;
  email_confirmed_at: string | null;
  invited_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
};

export type PlatformOrganization = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  name: string;
  member_count: number;
};

export type PlatformAudit = {
  id: string;
  action: string;
  reason: string;
  created_at: string;
  actor_email: string | null;
  target_id: string | null;
};

export type PlatformList<T = PlatformWorkspace | PlatformUser | PlatformOrganization> = {
  summary: PlatformSummary;
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type PlatformWorkspaceDetail = {
  workspace: PlatformWorkspace;
  organizations: Array<{ id: string; name: string }>;
  users: PlatformUser[];
  audit: PlatformAudit[];
};

export type PlatformAccessResult = {
  message: string;
  delivery: 'email' | 'manual';
  actionLink?: string;
};
