"use client"

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, clearLocalAuthState, signOut, signInWithEmailAndPassword, resetPasswordForEmail } from '@/lib/supabase/auth-shim';
import { doc, setDoc, serverTimestamp } from '@/lib/supabase/document-store';
import { auth, db } from '@/lib/backend';
import { isBootstrapAdminEmail } from '@/lib/bootstrap-admins';
import { getOrganizationIds, getPrimaryOrganizationId } from '@/lib/organizations';

const PROFILE_VERIFICATION_TIMEOUT_MS = 15000;
const SIGN_OUT_TIMEOUT_MS = 6000;

type AuthContextValue = {
  user: User | null;
  userRole: string | null;
  userOrganizationId: string | null;
  userOrganizationIds: string[];
  loading: boolean;
  accessError: string;
  login: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

function useAuthState(): AuthContextValue {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userOrganizationId, setUserOrganizationId] = useState<string | null>(null);
  const [userOrganizationIds, setUserOrganizationIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState('');

  useEffect(() => {
    const verifyUserProfile = async (currentUser: User) => {
      const userEmail = currentUser.email?.toLowerCase();
      const isBootstrapAdmin = isBootstrapAdminEmail(userEmail);
      
      let verifiedRole = isBootstrapAdmin ? 'admin' : 'user';
      let orgIds: string[] = [];

      const { collection, query, where, getDocs, deleteDoc } = await import('@/lib/supabase/document-store');

      const qUsers = query(collection(db, 'users'), where('email', '==', userEmail));
      const usersSnapshot = await getDocs(qUsers);
      
      if (!usersSnapshot.empty) {
        for (const docSnap of usersSnapshot.docs) {
          const data = docSnap.data();

          if (data.role) verifiedRole = data.role;
          orgIds = getOrganizationIds(data);

          if (docSnap.id !== currentUser.uid) {
            deleteDoc(docSnap.ref).catch((error) => {
              console.warn('No fue posible limpiar un perfil duplicado:', error);
            });
          }
        }
      }

      if (!isBootstrapAdmin && orgIds.length === 0 && verifiedRole !== 'admin') {
        const q = query(collection(db, 'team_members'), where('email', '==', userEmail));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
          throw new Error('Tu usuario existe en Supabase Auth, pero todavía no tiene perfil activo en la app. Pídele al administrador que lo cree en Usuarios del Sistema.');
        }

        querySnapshot.docs.forEach((docSnap) => {
          getOrganizationIds(docSnap.data()).forEach((id) => {
            if (!orgIds.includes(id)) orgIds.push(id);
          });
        });
      }

      const orgId = getPrimaryOrganizationId({ organizationIds: orgIds });

      const userRef = doc(db, 'users', currentUser.uid);
      await setDoc(userRef, {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName || currentUser.email?.split('@')[0],
        photoURL: currentUser.photoURL,
        lastLoginAt: serverTimestamp(),
        isPreRegistered: false,
        role: verifiedRole,
        organizationId: verifiedRole === 'admin' ? null : orgId,
        organizationIds: verifiedRole === 'admin' ? [] : orgIds,
      }, { merge: true });

      return { verifiedRole, orgId, orgIds };
    };

    const clearSessionAndShowLogin = async (message: string) => {
      setAccessError(message);

      try {
        await withTimeout(
          signOut(auth),
          SIGN_OUT_TIMEOUT_MS,
          'Supabase tardó demasiado cerrando la sesión.'
        );
      } catch (error) {
        console.warn('No fue posible cerrar la sesión remota. Se limpiará la sesión local.', error);
        clearLocalAuthState();
      }

      setUser(null);
      setUserRole(null);
      setUserOrganizationId(null);
      setUserOrganizationIds([]);
    };

    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setLoading(true);
      if (currentUser) {
        try {
          const { verifiedRole, orgId, orgIds } = await withTimeout(
            verifyUserProfile(currentUser),
            PROFILE_VERIFICATION_TIMEOUT_MS,
            'La verificación de tu sesión tardó demasiado. Cerramos la sesión local para evitar que la app quede cargando; vuelve a iniciar sesión.'
          );
          
          setUser(currentUser);
          setUserRole(verifiedRole);
          setUserOrganizationId(orgId);
          setUserOrganizationIds(orgIds);
          setAccessError('');
        } catch (error) {
          console.error("Error verifying user or saving profile:", error);
          await clearSessionAndShowLogin(
            error instanceof Error
              ? error.message
              : 'No fue posible verificar tu perfil en Supabase. Revisa que tu usuario exista en Usuarios del Sistema.'
          );
        }
      } else {
        setUser(null);
        setUserRole(null);
        setUserOrganizationId(null);
        setUserOrganizationIds([]);
      }
      
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async () => {
    throw new Error('El acceso con proveedores externos fue deshabilitado. Usa correo y contraseña con Supabase.');
  };

  const loginWithEmail = async (email: string, password: string) => {
    try {
      setAccessError('');
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error("Error signing in with email", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await withTimeout(
        signOut(auth),
        SIGN_OUT_TIMEOUT_MS,
        'Supabase tardó demasiado cerrando la sesión.'
      );
    } catch (error) {
      console.error("Error signing out", error);
      clearLocalAuthState();
    } finally {
      setUser(null);
      setUserRole(null);
      setUserOrganizationId(null);
      setUserOrganizationIds([]);
      setLoading(false);
    }
  };

  const requestPasswordReset = async (email: string) => {
    const redirectTo = `${window.location.origin}/reset-password`;
    await resetPasswordForEmail(auth, email, redirectTo);
  };

  return { user, userRole, userOrganizationId, userOrganizationIds, loading, accessError, login, loginWithEmail, requestPasswordReset, logout };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const value = useAuthState();

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider.');
  }

  return context;
}
