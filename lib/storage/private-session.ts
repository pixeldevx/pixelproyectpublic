import { createClient } from '@supabase/supabase-js';

export const STORAGE_SESSION_COOKIE = 'pixel-storage-session';

export function storageClientForToken(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase no está configurado.');
  // Use the visitor's token so Storage applies RLS to every download.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
