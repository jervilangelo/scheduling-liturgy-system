import type { ISODate, Service, Song } from '../../types/domain';

export function normalizeTitle(t: string): string {
  return t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Search by title, artist or theme. Every word must match somewhere. */
export function searchSongs(songs: Song[], query: string, theme = ''): Song[] {
  const words = normalizeTitle(query).split(' ').filter(Boolean);
  const th = theme.trim().toLowerCase();
  return songs.filter((s) => {
    if (th && !s.themes.some((x) => x.toLowerCase() === th)) return false;
    if (!words.length) return true;
    const hay = normalizeTitle(`${s.title} ${s.artist} ${s.themes.join(' ')}`);
    return words.every((w) => hay.includes(w));
  });
}

export function allThemes(songs: Song[]): string[] {
  return [...new Set(songs.flatMap((s) => s.themes.map((t) => t.trim())).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export interface SongUse {
  songId: string;
  date: ISODate;
  serviceId: string;
  status: Service['status'];
}

/** Every use of every song across service liturgies. */
export function songUsage(services: Service[]): SongUse[] {
  const out: SongUse[] = [];
  for (const s of services) {
    for (const item of s.liturgy) {
      if (item.kind === 'song' && item.songId) out.push({ songId: item.songId, date: s.date, serviceId: s.id, status: s.status });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * New `Last Sung` values implied by published services up to `asOf`.
 * Only ever moves a date forward; never clears or rewinds an existing value.
 */
export function computeLastSungUpdates(songs: Song[], services: Service[], asOf: ISODate): { song: Song; lastSung: ISODate }[] {
  const latest = new Map<string, ISODate>();
  for (const u of songUsage(services)) {
    if (u.status !== 'published' || u.date > asOf) continue;
    const cur = latest.get(u.songId);
    if (!cur || u.date > cur) latest.set(u.songId, u.date);
  }
  const out: { song: Song; lastSung: ISODate }[] = [];
  for (const song of songs) {
    const d = latest.get(song.id);
    if (d && (!song.lastSung || d > song.lastSung)) out.push({ song, lastSung: d });
  }
  return out;
}

/** Minimal RFC 4180 CSV/TSV parser (handles quotes, escaped quotes, CRLF). */
export function parseDelimited(text: string): string[][] {
  const delim = text.split('\n', 1)[0].includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export interface SheetHeaders {
  title: string;
  lastSung: string;
  theme: string;
  artist: string;
}

export interface SheetRowSong {
  sheetRow: number;
  title: string;
  artist: string;
  themes: string[];
  lastSung: string | null;
}

/**
 * Maps a SongList grid (first row = headers) to song rows by header NAME,
 * so column order in the existing sheet does not matter and nothing about
 * the sheet's structure is assumed or changed.
 */
export function mapSheetRows(grid: string[][], headers: SheetHeaders, parseDate: (s: string) => string | null): SheetRowSong[] {
  if (!grid.length) return [];
  const head = grid[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name.trim().toLowerCase());
  const ti = col(headers.title);
  if (ti === -1) throw new Error(`Column "${headers.title}" was not found in the sheet header row.`);
  const li = col(headers.lastSung);
  const thi = col(headers.theme);
  const ai = col(headers.artist);
  const out: SheetRowSong[] = [];
  grid.slice(1).forEach((r, i) => {
    const title = (r[ti] ?? '').trim();
    if (!title) return;
    out.push({
      sheetRow: i + 2,
      title,
      artist: ai >= 0 ? (r[ai] ?? '').trim() : '',
      themes: thi >= 0 ? (r[thi] ?? '').split(/[,;/]/).map((t) => t.trim()).filter(Boolean) : [],
      lastSung: li >= 0 ? parseDate((r[li] ?? '').trim()) : null,
    });
  });
  return out;
}

/** Merges sheet rows into the library, matching by sheet row then by title. */
export function mergeSheetSongs(existing: Song[], rows: SheetRowSong[], makeId: () => string): { upserts: Song[]; added: number; updated: number } {
  const byRow = new Map(existing.filter((s) => s.sheetRow).map((s) => [s.sheetRow!, s]));
  const byTitle = new Map(existing.map((s) => [normalizeTitle(s.title), s]));
  const upserts: Song[] = [];
  let added = 0;
  let updated = 0;
  for (const r of rows) {
    const match = byRow.get(r.sheetRow) ?? byTitle.get(normalizeTitle(r.title));
    if (match) {
      const lastSung = [match.lastSung, r.lastSung].filter(Boolean).sort().pop() ?? null;
      upserts.push({ ...match, title: r.title, artist: r.artist || match.artist, themes: r.themes.length ? r.themes : match.themes, lastSung, sheetRow: r.sheetRow });
      updated++;
    } else {
      upserts.push({ id: makeId(), title: r.title, artist: r.artist, themes: r.themes, songKey: '', lastSung: r.lastSung, sheetRow: r.sheetRow, notes: '' });
      added++;
    }
  }
  return { upserts, added, updated };
}
