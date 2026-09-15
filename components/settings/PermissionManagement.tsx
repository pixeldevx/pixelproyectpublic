"use client"

import React, { useEffect, useMemo, useState } from 'react';
import { LockKeyhole, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { doc, onSnapshot, serverTimestamp, setDoc } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  PermissionKey,
  RolePermissionSettings,
  SYSTEM_ROLE_OPTIONS,
  normalizeRolePermissions,
} from '@/lib/permissions';
import { toast } from 'sonner';

interface PermissionManagementProps {
  currentUser: any;
}

const permissionCount = (permissions: Record<PermissionKey, boolean>) =>
  Object.values(permissions).filter(Boolean).length;

export function PermissionManagement({ currentUser }: PermissionManagementProps) {
  const [permissions, setPermissions] = useState<RolePermissionSettings>(() =>
    normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS)
  );
  const [savedPermissions, setSavedPermissions] = useState<RolePermissionSettings>(() =>
    normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS)
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'settings', 'rolePermissions'),
      (snapshot) => {
        const normalized = normalizeRolePermissions(snapshot.exists() ? snapshot.data() : null);
        setPermissions(normalized);
        setSavedPermissions(normalized);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading permissions:', error);
        toast.error('No se pudieron cargar los permisos.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const hasChanges = useMemo(
    () => JSON.stringify(permissions) !== JSON.stringify(savedPermissions),
    [permissions, savedPermissions]
  );

  const togglePermission = (roleId: string, key: PermissionKey) => {
    setPermissions((current) => ({
      ...current,
      [roleId]: {
        ...current[roleId],
        [key]: !current[roleId]?.[key],
      },
    }));
  };

  const resetToDefaults = () => {
    setPermissions(normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'settings', 'rolePermissions'),
        {
          roles: permissions,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.uid || null,
        },
        { merge: true }
      );
      setSavedPermissions(permissions);
      toast.success('Permisos actualizados.');
    } catch (error: any) {
      console.error('Error saving permissions:', error);
      toast.error(error?.message || 'No se pudieron guardar los permisos.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <LockKeyhole size={18} className="text-indigo-500" />
            Panel de permisos
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Controla por rol las acciones disponibles en tareas, documentos, administración, inventario y talento humano.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={resetToDefaults}
            disabled={loading || saving}
            className="border-slate-200 text-slate-700"
          >
            <RotateCcw size={16} className="mr-2" />
            Restaurar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={loading || saving || !hasChanges}
            className="bg-indigo-600 text-white hover:bg-indigo-700"
          >
            <Save size={16} className="mr-2" />
            {saving ? 'Guardando...' : 'Guardar permisos'}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Cargando permisos...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {SYSTEM_ROLE_OPTIONS.map((role) => {
            const rolePermissions = permissions[role.id];
            const enabledCount = permissionCount(rolePermissions);

            return (
              <div key={role.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{role.name}</h3>
                    <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                      {enabledCount} permisos activos
                    </p>
                  </div>
                  <span className="rounded bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-600">
                    {role.id}
                  </span>
                </div>

                <div className="space-y-4">
                  {PERMISSION_GROUPS.map((group) => (
                    <div key={`${role.id}-${group.title}`}>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                        {group.title}
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {group.permissions.map((permission) => (
                          <label
                            key={`${role.id}-${permission.key}`}
                            className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(rolePermissions?.[permission.key])}
                              onChange={() => togglePermission(role.id, permission.key)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>{permission.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
