import { auth } from './supabase/auth-shim';
import { db, storage, supabase, isSupabaseConfigured } from './supabase/client';

export { auth, db, storage, supabase, isSupabaseConfigured };

export const getBackendServices = () => ({
  db,
  auth,
  storage,
});
