import type { Song } from '../../types/domain';
import type { SheetSong } from './sheet-xlsx';

export function normalizeTitle(t: string): string {
  return t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Songs come straight from the SongList spreadsheet. The id is derived from the
 * title (not the row number), so saved plans still match when rows move.
 */
export function songId(title: string): string {
  return `song:${normalizeTitle(title)}`;
}

export function songsFromSheet(rows: SheetSong[]): Song[] {
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const r of rows) {
    const id = songId(r.title);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: r.title, artist: r.artist, themes: r.themes, lastSung: r.lastSung, lyricsLink: r.lyricsLink, chordsLink: r.chordsLink, sheetRow: r.sheetRow });
  }
  return out;
}

/** Search by title, writer or theme. Every word must match somewhere. */
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
  const seen = new Map<string, string>();
  for (const t of songs.flatMap((s) => s.themes)) {
    const k = t.trim().toLowerCase();
    if (k && !seen.has(k)) seen.set(k, t.trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
