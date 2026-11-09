// Supabase Edge Function: songlist-sync (Deno runtime)
//
// Reads the existing Google Sheet `SongList` and writes ONLY the "Last Sung"
// cells of existing rows. It never inserts/deletes rows or columns, renames
// tabs or changes formatting.
//
// Secrets (set with `supabase secrets set ...`, never in the frontend):
//   GOOGLE_SERVICE_ACCOUNT_JSON  — the service account key JSON; share the
//                                  sheet with the service account's email (Editor).
// SUPABASE_URL / SUPABASE_ANON_KEY are provided by the platform.
//
// Actions (POST JSON):
//   { "action": "pull" } → { rows: [{ sheetRow, title, artist, themes, lastSung }] }   (needs 'view')
//   { "action": "push-last-sung", "updates": [{ sheetRow, title, lastSung }] } → { updated } (needs manage_songs or publish)

import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface Settings {
  sheet_spreadsheet_id: string;
  sheet_name: string;
  sheet_title_header: string;
  sheet_last_sung_header: string;
  sheet_theme_header: string;
  sheet_artist_header: string;
}

/* ---------- Google service-account auth (RS256 JWT → access token) ---------- */

function b64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function googleToken(): Promise<string> {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON secret is not set');
  const sa = JSON.parse(raw) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google auth failed: ${res.status}`);
  return (await res.json()).access_token as string;
}

/* ---------- Sheet helpers ---------- */

const quoteTab = (name: string) => `'${name.replace(/'/g, "''")}'`;

function colLetter(i: number): string {
  let s = '';
  i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function toISODate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function readGrid(token: string, s: Settings): Promise<unknown[][]> {
  const range = encodeURIComponent(quoteTab(s.sheet_name));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(s.sheet_spreadsheet_id)}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Could not read ${s.sheet_name}: ${res.status} ${await res.text()}`);
  return ((await res.json()).values ?? []) as unknown[][];
}

function headerIndex(grid: unknown[][], name: string): number {
  const head = (grid[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase());
  return head.indexOf(name.trim().toLowerCase());
}

/* ---------- Handler ---------- */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user) return json({ error: 'Sign in required' }, 401);

  const can = async (p: string) => (await sb.rpc('has_permission', { p })).data === true;

  try {
    const body = await req.json() as { action?: string; updates?: { sheetRow: number; title: string; lastSung: string }[] };
    const { data: settings, error } = await sb.from('app_settings').select('*').eq('id', 'global').single<Settings>();
    if (error || !settings) return json({ error: 'Settings not readable' }, 403);
    if (!settings.sheet_spreadsheet_id) return json({ error: 'No spreadsheet ID is configured in Settings' }, 400);

    const token = await googleToken();
    const grid = await readGrid(token, settings);
    const ti = headerIndex(grid, settings.sheet_title_header);
    if (ti < 0) return json({ error: `Header "${settings.sheet_title_header}" not found in ${settings.sheet_name}` }, 422);
    const li = headerIndex(grid, settings.sheet_last_sung_header);

    if (body.action === 'pull') {
      if (!(await can('view'))) return json({ error: 'Not allowed' }, 403);
      const thi = headerIndex(grid, settings.sheet_theme_header);
      const ai = headerIndex(grid, settings.sheet_artist_header);
      const rows = grid.slice(1).map((r, i) => ({
        sheetRow: i + 2,
        title: String(r[ti] ?? '').trim(),
        artist: ai >= 0 ? String(r[ai] ?? '').trim() : '',
        themes: thi >= 0 ? String(r[thi] ?? '').split(/[,;/]/).map((t) => t.trim()).filter(Boolean) : [],
        lastSung: li >= 0 ? toISODate(r[li]) : null,
      })).filter((r) => r.title);
      return json({ rows });
    }

    if (body.action === 'push-last-sung') {
      if (!(await can('manage_songs')) && !(await can('publish'))) return json({ error: 'Not allowed' }, 403);
      if (li < 0) return json({ error: `Header "${settings.sheet_last_sung_header}" not found; the sheet is not modified` }, 422);
      const updates = (body.updates ?? []).filter((u) => Number.isInteger(u.sheetRow) && u.sheetRow >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(u.lastSung));
      const col = colLetter(li);
      const data: { range: string; values: string[][] }[] = [];
      for (const u of updates) {
        const row = grid[u.sheetRow - 1];
        // Safety: only write if the row still holds the same song (rows may have been re-sorted).
        if (!row || norm(String(row[ti] ?? '')) !== norm(u.title)) continue;
        const current = toISODate(row[li]);
        if (current && current >= u.lastSung) continue; // never move a date backwards
        data.push({ range: `${quoteTab(settings.sheet_name)}!${col}${u.sheetRow}`, values: [[u.lastSung]] });
      }
      if (!data.length) return json({ updated: 0 });
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(settings.sheet_spreadsheet_id)}/values:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        // USER_ENTERED lets Sheets store a real date while keeping the column's existing number format.
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
      });
      if (!res.ok) throw new Error(`Sheet update failed: ${res.status} ${await res.text()}`);
      return json({ updated: data.length });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
