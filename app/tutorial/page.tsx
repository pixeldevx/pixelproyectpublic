"use client";

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TutorialWorkspace } from '@/components/tutorial/TutorialWorkspace';
import { useAuth } from '@/hooks/useAuth';
import { tutorialStorageKey } from '@/lib/tutorial/learning';

export default function TutorialPage() {
  const { user, workspace, userRole, loading, workspaceExpired } = useAuth();
  // A new component instance prevents another account from seeing the previous
  // user's in-memory exercises or progress during a session transition.
  const key = user && workspace ? tutorialStorageKey(user.uid, workspace.id) : null;
  return <DashboardLayout>
    {!loading && !workspaceExpired && key && <TutorialWorkspace key={key} storageKey={key} canManageUsers={userRole === 'admin' || userRole === 'org_admin'} />}
  </DashboardLayout>;
}
