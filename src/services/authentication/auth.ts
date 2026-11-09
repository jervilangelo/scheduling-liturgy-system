import type { Permission, Profile } from '../../types/domain';
import { permissionsFor } from '../../modules/permissions';
import { backend } from '../api/backend';
import { getSupabase, isSupabaseConfigured } from '../supabase/client';

/**
 * Authentication shared by every page. Sessions persist in localStorage on
 * this origin, so a sign-in on login.html carries to every other page.
 *
 * - Supabase mode: Supabase Auth (email + password, or emailed sign-in link);
 *   the user's role comes from the `profiles` table (set by an admin).
 * - Demo mode (no Supabase configured): choose a sample account. No password,
 *   no real security — clearly labelled in the UI and meant for evaluation.
 */

const DEMO_SESSION_KEY = 'eccm:demo-session';

export interface Session {
  profile: Profile;
  permissions: Set<Permission>;
  can: (p: Permission) => boolean;
}

function withPerms(profile: Profile, perms: Set<Permission>): Session {
  return { profile, permissions: perms, can: (p) => perms.has(p) };
}

async function buildSession(profile: Profile): Promise<Session> {
  const rows = await backend.list('role_permissions');
  return withPerms(profile, permissionsFor(profile.role, rows));
}

export async function currentSession(): Promise<Session | null> {
  if (isSupabaseConfigured) {
    const sb = await getSupabase();
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const { data: row } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    const profile: Profile = row
      ? { id: row.id, email: row.email, displayName: row.display_name || row.email, role: row.role }
      : { id: user.id, email: user.email ?? '', displayName: user.email ?? '', role: 'viewer' };
    return buildSession(profile);
  }
  let id: string | null = null;
  try { id = localStorage.getItem(DEMO_SESSION_KEY); } catch { /* blocked */ }
  if (!id) return null;
  const profiles = await backend.list('profiles');
  const p = profiles.find((x) => x.id === id);
  return p ? buildSession(p) : null;
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const sb = await getSupabase();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function sendSignInLink(email: string, redirectTo: string): Promise<void> {
  const sb = await getSupabase();
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
  if (error) throw new Error(error.message);
}

export function signInDemo(profileId: string): void {
  try { localStorage.setItem(DEMO_SESSION_KEY, profileId); } catch { /* blocked */ }
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured) {
    const sb = await getSupabase();
    await sb.auth.signOut();
  }
  try { localStorage.removeItem(DEMO_SESSION_KEY); } catch { /* blocked */ }
}
