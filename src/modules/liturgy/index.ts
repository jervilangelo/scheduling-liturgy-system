import type { LiturgyItem, LiturgyItemKind, Plan, Song, TeamLine } from '../../types/domain';
import { addDays, daysBetween } from '../../utils/dates';
import { COMMUNION_SONG_TITLE, CPP_TITLE, READING_TITLE } from '../sunday-rules';

/* ------------------------------------------------------------------
 * Sections that can be added to an order of worship
 * ------------------------------------------------------------------ */

export const SECTION_TYPES: { kind: LiturgyItemKind; label: string; hideInText?: boolean }[] = [
  { kind: 'singing', label: 'Congregational Singing', hideInText: true },
  { kind: 'song', label: 'Song with a label (e.g. Response Song)' },
  { kind: 'call_to_worship', label: 'Call to Worship' },
  { kind: 'scripture', label: 'Scripture Reading' },
  { kind: 'prayer', label: 'Prayer' },
  { kind: 'confession', label: 'Prayer of Confession' },
  { kind: 'announcements', label: 'Welcome and Announcements', hideInText: true },
  { kind: 'sermon', label: 'Sermon' },
  { kind: 'reflection', label: 'Moment of Silence and Reflection', hideInText: true },
  { kind: 'benediction', label: 'Benediction' },
  { kind: 'custom', label: 'Other' },
];

export function kindLabel(kind: LiturgyItemKind): string {
  return SECTION_TYPES.find((k) => k.kind === kind)?.label ?? kind.replace(/_/g, ' ');
}

/**
 * ECCM's normal Sunday order (a starting point; every section can be renamed,
 * removed, added or moved). Sections hidden from the shared text are the ones
 * the church does not print in its Messenger version.
 */
export function defaultTemplateItems(makeId: () => string): LiturgyItem[] {
  const sec = (title: string, kind: LiturgyItemKind, extra: Partial<LiturgyItem> = {}): LiturgyItem => ({ id: makeId(), kind, title, detail: '', ...extra });
  const song = (): LiturgyItem => ({ id: makeId(), kind: 'song', title: '', detail: '', songId: null });
  return [
    sec('Preparatory', 'song'),
    sec('Welcome and Announcements', 'announcements', { hideInText: true }),
    sec('Call to Worship', 'call_to_worship'),
    sec('Congregational Singing', 'singing', { hideInText: true }), song(), song(),
    sec('Scripture Reading', 'scripture'),
    sec('Prayer of Confession', 'confession'),
    sec('Congregational Singing', 'singing', { hideInText: true }), song(),
    sec(READING_TITLE, 'scripture', { slot: 'congregational_reading' }),
    sec('Prayer of Thanksgiving', 'prayer'),
    sec('Congregational Singing', 'singing', { hideInText: true }), song(),
    sec('Pastoral Prayer', 'prayer'),
    sec('Congregational Singing and Giving', 'singing', { hideInText: true }), song(),
    sec('Sermon', 'sermon'),
    sec('Response Song', 'song', { slot: 'response_song' }),
    sec('Moment of Silence and Reflection', 'reflection', { hideInText: true }),
    sec('Doxology', 'benediction', { hideInText: true }),
  ];
}

export function newSection(kind: LiturgyItemKind, makeId: () => string): LiturgyItem {
  const def = SECTION_TYPES.find((k) => k.kind === kind);
  const title = kind === 'song' ? 'Song' : def?.label ?? 'Section';
  return { id: makeId(), kind, title, detail: '', hideInText: def?.hideInText || undefined };
}

export function newSongLine(makeId: () => string): LiturgyItem {
  return { id: makeId(), kind: 'song', title: '', detail: '', songId: null };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/** The team lines at the foot of the church's plan. */
export const DEFAULT_TEAM_ROLES = ['Service Leader', 'Scripture Reader', 'Music'];

export function defaultTeam(): TeamLine[] {
  return DEFAULT_TEAM_ROLES.map((role) => ({ role, names: '' }));
}

/* ------------------------------------------------------------------
 * Lines
 * ------------------------------------------------------------------ */

/** A song inside a singing section, printed as "- Song". CPP songs are printed numbered. */
export function isBullet(i: LiturgyItem): boolean {
  return i.kind === 'song' && !i.title.trim();
}

/** Infers the section type from its label so the rules (creed, communion…) still apply. */
export function inferKind(label: string, bullet: boolean): LiturgyItemKind {
  if (bullet) return 'song';
  const l = label.toLowerCase();
  if (/congregational singing/.test(l)) return 'singing';
  if (/creed/.test(l)) return 'creed';
  if (/communion song/.test(l)) return 'song';
  if (/communion|lord.?s supper/.test(l)) return 'communion';
  if (/\bcpp\b|congregational prayer and praise/.test(l)) return 'cpp';
  if (/sermon|message|preaching/.test(l)) return 'sermon';
  if (/song|hymn|preparatory|prelude|postlude|response/.test(l)) return 'song';
  if (/call to worship/.test(l)) return 'call_to_worship';
  if (/confession/.test(l)) return 'confession';
  if (/prayer/.test(l)) return 'prayer';
  if (/scripture|reading|psalm/.test(l)) return 'scripture';
  if (/offering|tithe|giving/.test(l)) return 'offering';
  if (/announcement|welcome/.test(l)) return 'announcements';
  if (/silence|reflection/.test(l)) return 'reflection';
  if (/benediction|blessing|doxology/.test(l)) return 'benediction';
  return 'custom';
}

export function normalizeTitle(t: string): string {
  return t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchSong(text: string, songs: Song[]): Song | undefined {
  const n = normalizeTitle(text);
  return n ? songs.find((s) => normalizeTitle(s.title) === n) : undefined;
}

/** The text after the colon. A catalog song shows its catalog title. */
export function itemDetail(i: LiturgyItem, songs: Map<string, Song>): string {
  const song = i.songId ? songs.get(i.songId) : undefined;
  if (song) return song.title;
  if (i.detail !== undefined) return i.detail;
  return i.scripture ?? '';
}

/** Brings older saved items into the current shape (idempotent). */
export function normalizeItems(items: LiturgyItem[], songs: Map<string, Song>): LiturgyItem[] {
  return items.map((i) => {
    let x = i;
    if (x.detail === undefined) {
      if (x.kind === 'song') {
        const song = x.songId ? songs.get(x.songId) : undefined;
        x = { ...x, title: '', detail: song?.title ?? x.title };
      } else {
        x = { ...x, detail: x.scripture ?? '' };
      }
    }
    if (!x.slot && /congregational reading/i.test(x.title)) x = { ...x, slot: 'congregational_reading' };
    if (!x.slot && x.kind === 'song' && /response song/i.test(x.title)) x = { ...x, slot: 'response_song' };
    if (x.kind === 'singing' && x.hideInText === undefined) x = { ...x, hideInText: true };
    return x;
  });
}

/** One line in the church's format. */
export function formatLine(i: LiturgyItem, songs: Map<string, Song>): string {
  const detail = itemDetail(i, songs).trim();
  if (isBullet(i)) return `- ${detail}`;
  const label = i.title.trim() || kindLabel(i.kind);
  return detail ? `${label}: ${detail}` : label;
}

export function itemLine(i: LiturgyItem, songs: Map<string, Song>): string {
  return formatLine(normalizeItems([i], songs)[0], songs);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "November 29" */
export function monthDay(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

const isCppLine = (i: LiturgyItem) => i.kind === 'cpp' || i.slot === 'cpp_song';

/**
 * The plain text the church shares on Messenger:
 *
 *   November 29
 *   Preparatory: …
 *   - song …
 *   Response Song: …
 *   Communion Proper            (first Sunday)
 *   Communion Song: …
 *
 *   Service Leader: …
 *   Scripture Reader: …
 *   Music: …
 *
 *   Congregational Prayer and Praise:   (second Sunday)
 *   1. …
 *   2. …
 */
export function liturgyToText(date: string, items: LiturgyItem[], songs: Map<string, Song>, team: TeamLine[] = []): string {
  const main = items.filter((i) => !isCppLine(i) && !i.hideInText);
  const lines = [monthDay(date), ...main.map((i) => formatLine(i, songs))];
  const teamLines = team.filter((t) => t.role.trim());
  if (teamLines.length) lines.push('', ...teamLines.map((t) => `${t.role.trim()}: ${t.names.trim()}`.trimEnd()));
  const cppSongs = items.filter((i) => i.slot === 'cpp_song');
  if (items.some((i) => i.kind === 'cpp') || cppSongs.length) {
    const header = items.find((i) => i.kind === 'cpp')?.title.trim() || CPP_TITLE;
    lines.push('', `${header.replace(/:$/, '')}:`, ...cppSongs.map((s, n) => `${n + 1}. ${itemDetail(s, songs).trim()}`.trimEnd()));
  }
  return lines.join('\n');
}

const DATE_LINE = /^((sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+)?((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(,?\s+\d{4})?|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?)$/i;

/**
 * Parses the church's text format back into lines. The date line and team
 * lines ("Service Leader: Angelo") are skipped; dash lines become songs inside
 * a singing section; lines after "Congregational Prayer and Praise:" become CPP songs.
 */
export function parseLiturgyText(text: string, songs: Song[], roleNames: string[], makeId: () => string): { items: LiturgyItem[]; skipped: string[] } {
  const roles = new Set(roleNames.map((r) => r.trim().toLowerCase()).filter(Boolean));
  const items: LiturgyItem[] = [];
  const skipped: string[] = [];
  let first = true;
  let inCpp = false;
  const songLine = (detail: string, extra: Partial<LiturgyItem> = {}): LiturgyItem => ({ id: makeId(), kind: 'song', title: '', detail, songId: matchSong(detail, songs)?.id ?? null, ...extra });

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (first && DATE_LINE.test(line)) { first = false; continue; }
    first = false;

    if (inCpp) {
      const n = line.match(/^(\d+[.)]|[-–—•*·])\s*(.*)$/);
      if (n) { items.push(songLine(n[2].trim(), { slot: 'cpp_song' })); continue; }
      inCpp = false;
    }
    const bullet = line.match(/^[-–—•*·]\s*(.*)$/);
    if (bullet) {
      const prev = items[items.length - 1];
      if (!prev || !(prev.kind === 'singing' || isBullet(prev))) {
        items.push({ id: makeId(), kind: 'singing', title: 'Congregational Singing', detail: '', hideInText: true });
      }
      items.push(songLine(bullet[1].trim()));
      continue;
    }
    // Split on the first colon followed by a space or the line end, so "Psalm 89:5" keeps its colon.
    const idx = line.search(/:(\s|$)/);
    const label = (idx >= 0 ? line.slice(0, idx) : line).trim();
    const detail = idx >= 0 ? line.slice(idx + 1).trim() : '';
    if (roles.has(label.toLowerCase())) { skipped.push(line); continue; }
    const kind = inferKind(label, false);
    if (kind === 'cpp') { items.push({ id: makeId(), kind: 'cpp', title: CPP_TITLE, detail: '' }); inCpp = true; continue; }
    const item: LiturgyItem = { id: makeId(), kind, title: label, detail, songId: kind === 'song' ? matchSong(detail, songs)?.id ?? null : null };
    if (/congregational reading/i.test(label)) { item.slot = 'congregational_reading'; if (/creed/i.test(detail)) item.kind = 'creed'; }
    if (/response song/i.test(label)) item.slot = 'response_song';
    if (normalizeTitle(label) === normalizeTitle(COMMUNION_SONG_TITLE)) item.slot = 'communion_song';
    if (kind === 'singing') item.hideInText = true;
    items.push(item);
  }
  return { items, skipped };
}

/* ------------------------------------------------------------------
 * Song warnings (never block a choice)
 * ------------------------------------------------------------------ */

export interface SongWarning {
  itemId: string;
  level: 'warning' | 'info';
  message: string;
}

/**
 * - the same song twice in one service
 * - sung (or planned) within the last `recentWeeks` weeks
 * - used three or more times in the last eight weeks
 */
export function songWarnings(items: LiturgyItem[], date: string, songs: Map<string, Song>, plans: Plan[], planId: string | null, recentWeeks = 4): SongWarning[] {
  const out: SongWarning[] = [];
  const seen = new Map<string, string>();
  const others = plans.filter((s) => s.id !== planId);
  for (const it of items) {
    if (it.kind !== 'song') continue;
    const key = it.songId ?? (it.detail ? `t:${normalizeTitle(it.detail)}` : '');
    if (!key) continue;
    if (seen.has(key)) out.push({ itemId: it.id, level: 'warning', message: 'Already in this service' });
    seen.set(key, it.id);
    if (!it.songId) continue;
    const song = songs.get(it.songId);
    const uses = others.filter((s) => s.liturgy.some((x) => x.songId === it.songId)).map((s) => s.date);
    const recentFrom = addDays(date, -7 * recentWeeks);
    const near = uses.filter((d) => d < date && d >= recentFrom).sort().pop()
      ?? (song?.lastSung && song.lastSung < date && song.lastSung >= recentFrom ? song.lastSung : undefined);
    if (near) {
      const weeks = Math.max(1, Math.round(daysBetween(near, date) / 7));
      out.push({ itemId: it.id, level: 'warning', message: `Sung ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago` });
    }
    const eightWeeks = uses.filter((d) => d >= addDays(date, -56) && d <= addDays(date, 56) && d !== date);
    if (eightWeeks.length >= 2) out.push({ itemId: it.id, level: 'warning', message: `Used ${eightWeeks.length + 1} times within 8 weeks` });
  }
  return out;
}

/* ------------------------------------------------------------------
 * Comparison and Scripture helpers
 * ------------------------------------------------------------------ */

export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'removed', text: a[i++] });
    else out.push({ type: 'added', text: b[j++] });
  }
  while (i < n) out.push({ type: 'removed', text: a[i++] });
  while (j < m) out.push({ type: 'added', text: b[j++] });
  return out;
}

/** Scripture reference check, e.g. "John 3:16-21", "Psalm 23", "1 Cor 13:4-7; Rom 8:28". */
export function isPlausibleScripture(ref: string): boolean {
  if (!ref.trim()) return true;
  return ref.split(';').every((part) => /^\s*([1-3]\s?)?[A-Za-z][A-Za-z .']+\s+\d+(:\d+([-–]\d+(:\d+)?)?(,\s*\d+([-–]\d+)?)*)?([-–]\d+)?\s*$/.test(part));
}

export const BIBLE_BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings',
  '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalm', 'Proverbs', 'Ecclesiastes', 'Song of Songs', 'Isaiah',
  'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah',
  'Haggai', 'Zechariah', 'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians',
  'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
  'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];
