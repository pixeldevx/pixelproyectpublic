"use client"

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import {
  DEFAULT_ROLE_PERMISSIONS,
  RolePermissionSettings,
  normalizeRolePermissions,
  resolveRolePermissions,
} from '@/lib/permissions';

export function useRolePermissions(role?: string | null) {
  const { user, workspace, loading: authLoading, workspaceExpired } = useAuth();
  const scope = user && workspace && !authLoading && !workspaceExpired
    ? `${user.uid}:${workspace.id}`
    : null;
  const [snapshotState, setSnapshotState] = useState<{
    scope: string | null;
    settings: RolePermissionSettings;
    loading: boolean;
  }>(() => ({ scope: null, settings: normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS), loading: true }));

  useEffect(() => {
    setSnapshotState({ scope, settings: normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS), loading: true });
    if (!scope) return;

    let active = true;
    let unsubscribe: (() => void) | undefined;
    const handleError = (error: unknown) => {
      if (!active) return;
      console.error('Error loading role permissions:', error);
      setSnapshotState({ scope, settings: normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS), loading: false });
    };
    try {
      unsubscribe = onSnapshot(
        doc(db, 'settings', 'rolePermissions'),
        (snapshot) => {
          if (!active) return;
          setSnapshotState({ scope, settings: normalizeRolePermissions(snapshot.exists() ? snapshot.data() : null), loading: false });
        },
        handleError
      );
    } catch (error) {
      handleError(error);
    }

    return () => { active = false; unsubscribe?.(); };
  }, [scope]);

  // Hide the previous workspace's settings immediately, before the new effect
  // runs, and ignore late notifications from its cancelled subscription.
  const settings = useMemo(
    () => scope && snapshotState.scope === scope
      ? snapshotState.settings
      : normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS),
    [scope, snapshotState.scope, snapshotState.settings]
  );
  const loading = !scope || snapshotState.scope !== scope || snapshotState.loading;

  const permissions = useMemo(
    () => resolveRolePermissions(settings, role),
    [role, settings]
  );

  return { permissions, settings, loading };
}
