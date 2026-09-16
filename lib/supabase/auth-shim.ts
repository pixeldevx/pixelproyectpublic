import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from './client';

const SESSION_LOAD_TIMEOUT_MS = 10000;

// Serialize cookie updates so an old refresh cannot overwrite a later sign-out.
let storageSessionQueue: Promise<void> = Promise.resolve();
const syncStorageSession = (token: string | null) => {
  storageSessionQueue = storageSessionQueue.catch(() => {}).then(async () => {
    if (typeof window === 'undefined') return;
    const response = await fetch('/api/storage/session', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('No se pudo actualizar el acceso privado a archivos.');
  });
  return storageSessionQueue;
};

export interface User {
  uid: string;
  id: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  tenantId: string | null;
  providerData: {
    providerId: string;
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
  }[];
}

const mapUser = (user: SupabaseUser | null): User | null => {
  if (!user) return null;

  const metadata = user.user_metadata || {};
  const displayName =
    metadata.displayName ||
    metadata.full_name ||
    metadata.name ||
    user.email?.split('@')[0] ||
    null;
  const photoURL = metadata.photoURL || metadata.avatar_url || metadata.picture || null;

  return {
    uid: user.id,
    id: user.id,
    email: user.email || null,
    displayName,
    photoURL,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    isAnonymous: Boolean(user.is_anonymous),
    tenantId: null,
    providerData:
      user.identities?.map((identity) => ({
        providerId: identity.provider,
        displayName,
        email: user.email || null,
        photoURL,
      })) || [],
  };
};

type AuthListener = (user: User | null) => void | Promise<void>;

const isSameAuthUser = (left: User | null, right: User | null) => {
  if (!left || !right) return left === right;

  return (
    left.uid === right.uid &&
    left.email === right.email &&
    left.displayName === right.displayName &&
    left.photoURL === right.photoURL &&
    left.emailVerified === right.emailVerified
  );
};

const withTimeout = async <T,>(
  promise: PromiseLike<T>,
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

const runAuthListener = (callback: AuthListener, user: User | null) => {
  try {
    void Promise.resolve(callback(user)).catch((error) => {
      console.error('Error running Supabase auth listener:', error);
    });
  } catch (error) {
    console.error('Error running Supabase auth listener:', error);
  }
};

class SupabaseAuthShim {
  currentUser: User | null = null;

  onAuthStateChanged(callback: AuthListener) {
    let active = true;
    let hasEmittedUser = false;
    let lastEmittedUser: User | null = null;
    let sessionVersion = 0;
    let pendingEmission: ReturnType<typeof setTimeout> | undefined;

    const emitUserIfChanged = (nextUser: User | null) => {
      if (!active) return;
      // The sign-in/update helpers also update currentUser. Compare against
      // what THIS subscriber received, or those helpers can hide the event.
      const changed = !isSameAuthUser(lastEmittedUser, nextUser);
      this.currentUser = nextUser;

      // Supabase can emit INITIAL_SESSION, SIGNED_IN and TOKEN_REFRESHED again
      // when a tab regains focus. Revalidating the same logical user remounts
      // project screens and discards forms that are still being edited.
      if (hasEmittedUser && !changed) return;
      hasEmittedUser = true;
      lastEmittedUser = nextUser;
      runAuthListener(callback, nextUser);
    };

    const scheduleSession = (session: Session | null) => {
      const version = ++sessionVersion;
      if (pendingEmission !== undefined) clearTimeout(pendingEmission);

      // Auth emits while holding its session lock. Consumers load profiles
      // through Supabase, so start them in a later task, outside that lock.
      pendingEmission = setTimeout(() => {
        pendingEmission = undefined;
        if (!active || version !== sessionVersion) return;
        void syncStorageSession(session?.access_token || null)
          .catch((error) => console.error('Private storage session failed:', error));
        // A slow/failed file-cookie request must not stall a valid login.
        emitUserIfChanged(mapUser(session?.user || null));
      }, 0);
    };

    const emitInitialSession = async () => {
      const initialVersion = sessionVersion;
      try {
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_LOAD_TIMEOUT_MS,
          'Supabase tardó demasiado cargando la sesión guardada.'
        );
        if (error) throw error;
        if (!active || sessionVersion !== initialVersion) return;
        scheduleSession(data.session);
      } catch (error) {
        console.error('Error loading Supabase session:', error);
        if (!active || sessionVersion !== initialVersion) return;
        scheduleSession(null);
      }
    };

    void emitInitialSession();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) scheduleSession(session);
    });

    return () => {
      active = false;
      if (pendingEmission !== undefined) clearTimeout(pendingEmission);
      data.subscription.unsubscribe();
    };
  }
}

export const auth = new SupabaseAuthShim();

export const signInWithEmailAndPassword = async (
  _auth: SupabaseAuthShim,
  email: string,
  password: string
) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  auth.currentUser = mapUser(data.user);
  return { user: auth.currentUser };
};

export const resetPasswordForEmail = async (
  _auth: SupabaseAuthShim,
  email: string,
  redirectTo: string
) => {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  if (error) throw error;
  return data;
};

export const signOut = async (_auth?: SupabaseAuthShim) => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  await syncStorageSession(null);
  auth.currentUser = null;
};

export const clearLocalAuthState = () => {
  auth.currentUser = null;

  if (typeof window === 'undefined') return;
  void syncStorageSession(null).catch(() => {});

  Object.keys(window.localStorage)
    .filter((key) => (key.startsWith('sb-') && key.includes('-auth-token')) || key === 'supabase.auth.token')
    .forEach((key) => window.localStorage.removeItem(key));
};

export const updateProfile = async (
  user: User,
  profile: { displayName?: string | null; photoURL?: string | null }
) => {
  const { data, error } = await supabase.auth.updateUser({
    data: {
      displayName: profile.displayName ?? user.displayName,
      photoURL: profile.photoURL ?? user.photoURL,
    },
  });
  if (error) throw error;
  auth.currentUser = mapUser(data.user);
};

export const updatePassword = async (password: string) => {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  auth.currentUser = mapUser(data.user);
  return { user: auth.currentUser };
};

export const deleteUser = async (_user?: User | null) => {
  throw new Error('La eliminación de usuarios de Auth debe realizarse desde el servidor de Supabase.');
};
