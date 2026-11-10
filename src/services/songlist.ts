import type { Song } from '../types/domain';
import { parseSongListXlsx, songListExportUrl, type SongListHeaders } from '../modules/song-library/sheet-xlsx';
import { songsFromSheet } from '../modules/song-library';
import { todayISO } from '../utils/dates';
import snapshot from './songlist-snapshot.json';

/**
 * The church's SongList Google Sheet is the source of songs. It is read
 * (never written) through the sheet's public .xlsx export, which Google serves
 * with CORS headers, so the browser can fetch it directly. A bundled snapshot
 * (scripts/fetch-songlist.ts) is used until the first live read succeeds.
 */

export const SPREADSHEET_ID = '1_ksiD3P4ClBijGepPI7jqtGwxqKtt9oARny3V_VZlqM';
export const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;

export const SONGLIST_HEADERS: SongListHeaders = {
  table: 'SongList',
  title: 'TITLE OF SONGS',
  lastSung: 'Last Sung',
  theme: 'THEME',
  artist: 'WORDS AND MUSIC BY',
  lyrics: 'Lyrics Link',
  chords: 'Chords Link',
};

const CACHE_KEY = 'eccm:songlist:v1';
/** Refresh automatically when the cached list is older than this. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface SongList {
  songs: Song[];
  fetchedAt: string;
  source: 'live' | 'cache' | 'snapshot';
}

function readCache(): SongList | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { songs: Song[]; fetchedAt: string };
    return Array.isArray(v.songs) && v.songs.length ? { songs: v.songs, fetchedAt: v.fetchedAt, source: 'cache' } : null;
  } catch {
    return null;
  }
}

export function cachedSongList(): SongList {
  return readCache() ?? { songs: songsFromSheet(snapshot.songs), fetchedAt: snapshot.fetchedAt, source: 'snapshot' };
}

export function isStale(list: SongList): boolean {
  return list.source === 'snapshot' || Date.now() - Date.parse(list.fetchedAt) > MAX_AGE_MS;
}

/** Reads the SongList from the spreadsheet now and caches it in this browser. */
export async function fetchSongList(): Promise<SongList> {
  const res = await fetch(songListExportUrl(SPREADSHEET_ID));
  if (!res.ok) throw new Error(`The spreadsheet could not be read (HTTP ${res.status}). Is it still shared as "Anyone with the link"?`);
  const rows = parseSongListXlsx(new Uint8Array(await res.arrayBuffer()), SONGLIST_HEADERS, todayISO());
  if (!rows.length) throw new Error('No songs were found in the SongList table.');
  const list: SongList = { songs: songsFromSheet(rows), fetchedAt: new Date().toISOString(), source: 'live' };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ songs: list.songs, fetchedAt: list.fetchedAt })); } catch { /* storage blocked */ }
  return list;
}
