"use client"

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User, clearLocalAuthState, signOut, signInWithEmailAndPassword, resetPasswordForEmail } from '@/lib/supabase/auth-shim';
import { doc, getDoc } from '@/lib/supabase/document-store';
import { auth, db } from '@/lib/backend';
import { supabase } from '@/lib/supabase/client';
import { getOrganizationIds } from '@/lib/organizations';
import { isWorkspaceExpired, type Workspace } from '@/lib/workspaces/types';
import { setClientWorkspace } from '@/lib/workspaces/client-context';

const PROFILE_VERIFICATION_TIMEOUT_MS = 20000;
const SIGN_OUT_TIMEOUT_MS = 6000;

type AuthContextValue = {
  user: User | null;
  userRole: string | null;
  userOrganizationId: string | null;
  userOrganizationIds: string[];
  workspace: Workspace | null;
  workspaceExpired: boolean;
  loading: boolean;
  accessError: string;
  retryWorkspace: () => Promise<void>;
  login: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

function useAuthState(): AuthContextValue {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userOrganizationId, setUserOrganizationId] = useState<string | null>(null);
  const [userOrganizationIds, setUserOrganizationIds] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const verificationVersion = useRef(0);

  const clearProfile = useCallback(() => {
    setClientWorkspace(null);
    setUserRole(null);
    setUserOrganizationId(null);
    setUserOrganizationIds([]);
    setWorkspace(null);
  }, []);

  const verifyProfile = useCallback(async (currentUser: User, version: number) => {
    // These names are presentation data only. The database derives membership,
    // ownership and role from the authenticated identity, never from metadata.
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user || authData.user.id !== currentUser.uid) {
      throw new Error('No pudimos verificar tu acceso. Reintenta o vuelve a iniciar sesión.');
    }
    const metadata = authData.user.user_metadata || {};
    const { data, error } = await supabase.rpc('ensure_trial_workspace', {
      workspace_name: String(metadata.workspaceName || 'Mi espacio de trabajo').trim().slice(0, 100),
      display_name: String(metadata.displayName || currentUser.displayName || 'Usuario').trim().slice(0, 100),
    });
    if (error || !data?.id || !data?.organization_id) {
      console.error('Workspace provisioning failed:', error?.code || 'missing_workspace');
      throw new Error('No pudimos preparar tu espacio de trabajo. Tu cuenta sigue activa; puedes reintentar en un momento.');
    }
    if (verificationVersion.current !== version) throw new Error('Verificación cancelada.');
    setClientWorkspace(String(data.id));
    const profile = await getDoc(doc(db, 'users', currentUser.uid));
    if (!profile.exists() || !profile.data().role) {
      throw new Error('Tu espacio se está preparando. Reintenta para completar el acceso.');
    }
    const profileData = profile.data();
    const orgIds = getOrganizationIds(profileData);
    if (!orgIds.includes(String(data.organization_id))) {
      throw new Error('No pudimos verificar la organización de tu perfil. Reintenta en un momento.');
    }
    return { workspace: data as Workspace, role: String(profileData.role), orgIds };
  }, []);

  const loadProfile = useCallback(async (currentUser: User) => {
    const version = ++verificationVersion.current;
    setLoading(true);
    setAccessError('');
    clearProfile();
    try {
      const profile = await withTimeout(
        verifyProfile(currentUser, version),
        PROFILE_VERIFICATION_TIMEOUT_MS,
        'La preparación de tu espacio está tardando más de lo esperado. Reintenta; no necesitas crear otra cuenta.'
      );
      if (verificationVersion.current !== version) return;
      setUser(currentUser);
      setUserRole(profile.role);
      setWorkspace(profile.workspace);
      setUserOrganizationId(profile.workspace.organization_id);
      setUserOrganizationIds(profile.orgIds);
    } catch (error) {
      if (verificationVersion.current !== version) return;
      setUser(currentUser);
      setAccessError(error instanceof Error ? error.message : 'No pudimos preparar tu espacio. Reintenta en un momento.');
    } finally {
      if (verificationVersion.current === version) setLoading(false);
    }
  }, [clearProfile, verifyProfile]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        await loadProfile(currentUser);
      } else {
        verificationVersion.current += 1;
        setUser(null);
        clearProfile();
        setLoading(false);
      }
    });
    return () => {
      verificationVersion.current += 1;
      unsubscribe();
    };
  }, [clearProfile, loadProfile]);

  useEffect(() => {
    if (!workspace?.trial_ends_at) return;
    const updateClock = () => setClock(Date.now());
    const interval = window.setInterval(updateClock, 30000);
    window.addEventListener('focus', updateClock);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', updateClock);
    };
  }, [workspace?.trial_ends_at]);

  const retryWorkspace = useCallback(async () => {
    const currentUser = auth.currentUser || user;
    if (currentUser) await loadProfile(currentUser);
  }, [loadProfile, user]);

  const login = async () => {
    throw new Error('Usa tu correo y contraseña para iniciar sesión.');
  };

  const loginWithEmail = async (email: string, password: string) => {
    setAccessError('');
    await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  };

  const logout = async () => {
    verificationVersion.current += 1;
    setClientWorkspace(null);
    try {
      await withTimeout(signOut(auth), SIGN_OUT_TIMEOUT_MS, 'El cierre de sesión está tardando demasiado.');
    } catch {
      clearLocalAuthState();
    } finally {
      setUser(null);
      clearProfile();
      setAccessError('');
      setLoading(false);
    }
  };

  const requestPasswordReset = async (email: string) => {
    await resetPasswordForEmail(auth, email.trim().toLowerCase(), `${window.location.origin}/reset-password`);
  };

  return {
    user, userRole, userOrganizationId, userOrganizationIds, workspace,
    workspaceExpired: isWorkspaceExpired(workspace, clock),
    loading, accessError, retryWorkspace, login, loginWithEmail, requestPasswordReset, logout,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const value = useAuthState();
  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return context;
}
