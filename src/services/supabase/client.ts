import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Only the public URL and anon key are read here. The anon key is safe in a
 * browser bundle by design; Row Level Security in supabase/migrations
 * protects the data. The service-role key and Google credentials live only
 * in Supabase Edge Function secrets.
 */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

let clientPromise: Promise<SupabaseClient> | null = null;

/** Lazily loads supabase-js so demo mode never downloads it. */
export function getSupabase(): Promise<SupabaseClient> {
  if (!isSupabaseConfigured) return Promise.reject(new Error('Supabase is not configured.'));
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'eccm-auth' },
    }),
  );
  return clientPromise;
}

export const supabaseUrl = url;
