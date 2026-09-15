"use client"

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import {
  DEFAULT_ROLE_PERMISSIONS,
  RolePermissionSettings,
  normalizeRolePermissions,
  resolveRolePermissions,
} from '@/lib/permissions';

export function useRolePermissions(role?: string | null) {
  const [settings, setSettings] = useState<RolePermissionSettings>(() =>
    normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS)
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'settings', 'rolePermissions'),
      (snapshot) => {
        setSettings(normalizeRolePermissions(snapshot.exists() ? snapshot.data() : null));
        setLoading(false);
      },
      (error) => {
        console.error('Error loading role permissions:', error);
        setSettings(normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const permissions = useMemo(
    () => resolveRolePermissions(settings, role),
    [role, settings]
  );

  return { permissions, settings, loading };
}
