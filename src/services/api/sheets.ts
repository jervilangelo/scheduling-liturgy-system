import { getSupabase, isSupabaseConfigured } from '../supabase/client';

/**
 * Google Sheets `SongList` bridge. All Google API access happens in the
 * `songlist-sync` Supabase Edge Function, which holds the service-account
 * credentials as a secret. The browser never sees them.
 *
 * The function only READS the sheet and WRITES existing cells in the
 * `Last Sung` column — it never adds/removes rows, columns, tabs or formatting.
 */

export interface SheetSongRow {
  sheetRow: number;
  title: string;
  artist: string;
  themes: string[];
  lastSung: string | null;
}

export const sheetsAvailable = isSupabaseConfigured;

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const sb = await getSupabase();
  const { data, error } = await sb.functions.invoke('songlist-sync', { body });
  if (error) {
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) detail = ((await ctx.json()) as { error?: string }).error ?? detail;
    } catch { /* keep message */ }
    throw new Error(detail);
  }
  return data as T;
}

export async function pullSongList(): Promise<SheetSongRow[]> {
  const res = await invoke<{ rows: SheetSongRow[] }>({ action: 'pull' });
  return res.rows;
}

/** Writes Last Sung dates to existing rows. Returns how many cells were updated. */
export async function pushLastSung(updates: { sheetRow: number; title: string; lastSung: string }[]): Promise<number> {
  if (!updates.length) return 0;
  const res = await invoke<{ updated: number }>({ action: 'push-last-sung', updates });
  return res.updated;
}
