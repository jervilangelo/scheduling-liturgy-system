import type { LiturgyItem, LiturgyItemKind, LiturgyTemplate, Sermon, Song } from '../../types/domain';

export const ITEM_KINDS: { kind: LiturgyItemKind; label: string; minutes: number }[] = [
  { kind: 'call_to_worship', label: 'Call to worship', minutes: 3 },
  { kind: 'song', label: 'Song', minutes: 5 },
  { kind: 'scripture', label: 'Scripture reading', minutes: 4 },
  { kind: 'prayer', label: 'Prayer', minutes: 4 },
  { kind: 'confession', label: 'Confession and assurance', minutes: 4 },
  { kind: 'creed', label: 'Creed', minutes: 3 },
  { kind: 'communion', label: 'Communion', minutes: 15 },
  { kind: 'cpp', label: 'CPP', minutes: 10 },
  { kind: 'offering', label: 'Offering', minutes: 5 },
  { kind: 'announcements', label: 'Announcements', minutes: 4 },
  { kind: 'sermon', label: 'Sermon', minutes: 35 },
  { kind: 'benediction', label: 'Benediction', minutes: 2 },
  { kind: 'custom', label: 'Other element', minutes: 3 },
];

export function kindLabel(kind: LiturgyItemKind): string {
  return ITEM_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

export function newItem(kind: LiturgyItemKind, makeId: () => string): LiturgyItem {
  const def = ITEM_KINDS.find((k) => k.kind === kind)!;
  return { id: makeId(), kind, title: kind === 'song' ? '' : def.label, durationMin: def.minutes };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

export function totalMinutes(items: LiturgyItem[]): number {
  return items.reduce((n, i) => n + (i.durationMin ?? 0), 0);
}

export function fromTemplate(t: LiturgyTemplate, makeId: () => string): LiturgyItem[] {
  return t.items.map((i) => ({ ...i, id: makeId() }));
}

export function emptySermon(): Sermon {
  return { title: '', preacher: '', scripture: '', series: '', notes: '' };
}

/** Line-by-line comparison between two versions of a liturgy. */
export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

export function itemLine(i: LiturgyItem, songs: Map<string, Song>): string {
  return formatLine(normalizeItems([i], songs)[0], songs);
}

/* ------------------------------------------------------------------
 * Plain-text order of worship, in the church's own format:
 *
 *   November 8
 *   Preparatory: God Rest Ye Merry Gentlemen
 *   Call to Worship: Psalm 89:5
 *   - Here Is Love
 *   Prayer of Confession
 *   Sermon: Nehemiah 9
 *
 *   Service Leader: Angelo
 * ------------------------------------------------------------------ */

/** True for a song line with no label ("- Here Is Love"). */
export function isBullet(i: LiturgyItem): boolean {
  return i.kind === 'song' && !i.title.trim();
}

/** Infers the element type from its label so rules (creed, communion…) still apply. */
export function inferKind(label: string, bullet: boolean): LiturgyItemKind {
  if (bullet) return 'song';
  const l = label.toLowerCase();
  if (/creed/.test(l)) return 'creed';
  if (/communion|lord.?s supper/.test(l)) return 'communion';
  if (/\bcpp\b/.test(l)) return 'cpp';
  if (/sermon|message|preaching/.test(l)) return 'sermon';
  if (/song|hymn|preparatory|prelude|postlude|response|doxology|special number/.test(l)) return 'song';
  if (/call to worship/.test(l)) return 'call_to_worship';
  if (/confession/.test(l)) return 'confession';
  if (/prayer/.test(l)) return 'prayer';
  if (/scripture|reading|psalm/.test(l)) return 'scripture';
  if (/offering|tithe/.test(l)) return 'offering';
  if (/announcement/.test(l)) return 'announcements';
  if (/benediction|blessing/.test(l)) return 'benediction';
  return 'custom';
}

function normalize(t: string): string {
  return t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchSong(text: string, songs: Song[]): Song | undefined {
  const n = normalize(text);
  return n ? songs.find((s) => normalize(s.title) === n) : undefined;
}

/** The text after the colon, falling back to older records' song or Scripture fields. */
export function itemDetail(i: LiturgyItem, songs: Map<string, Song>): string {
  if (i.detail !== undefined) return i.detail;
  const song = i.songId ? songs.get(i.songId) : undefined;
  return song?.title ?? i.scripture ?? '';
}

/** Brings older items into the label/detail shape (idempotent). */
export function normalizeItems(items: LiturgyItem[], songs: Map<string, Song>): LiturgyItem[] {
  return items.map((i) => {
    if (i.detail !== undefined) return i;
    if (i.kind === 'song') {
      const song = i.songId ? songs.get(i.songId) : undefined;
      return { ...i, title: '', detail: song?.title ?? i.title };
    }
    return { ...i, detail: i.scripture ?? '' };
  });
}

/** One line in the church's format. */
export function formatLine(i: LiturgyItem, songs: Map<string, Song>): string {
  const detail = itemDetail(i, songs).trim();
  if (isBullet(i)) return `- ${detail}`;
  const label = i.title.trim() || kindLabel(i.kind);
  return detail ? `${label}: ${detail}` : label;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "November 8" */
export function monthDay(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

export function liturgyToText(date: string, items: LiturgyItem[], songs: Map<string, Song>, team: { role: string; names: string[] }[] = []): string {
  const lines = [monthDay(date), ...items.map((i) => formatLine(i, songs))];
  if (team.length) lines.push('', ...team.map((t) => `${t.role}: ${t.names.join(', ')}`.trimEnd()));
  return lines.join('\n');
}

const DATE_LINE = /^((sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+)?((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(,?\s+\d{4})?|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?)$/i;

/**
 * Parses the church's text format into items. A leading date line is skipped,
 * as are team lines whose label is a ministry role ("Service Leader: Angelo").
 */
export function parseLiturgyText(text: string, songs: Song[], roleNames: string[], makeId: () => string): { items: LiturgyItem[]; skipped: string[] } {
  const roles = new Set(roleNames.map((r) => r.trim().toLowerCase()));
  const items: LiturgyItem[] = [];
  const skipped: string[] = [];
  let first = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (first && DATE_LINE.test(line)) { first = false; continue; }
    first = false;
    const bullet = line.match(/^[-–—•*·]\s*(.*)$/);
    if (bullet) {
      const detail = bullet[1].trim();
      items.push({ id: makeId(), kind: 'song', title: '', detail, songId: matchSong(detail, songs)?.id ?? null });
      continue;
    }
    // Split on the first colon followed by a space or the line end, so "Psalm 89:5" keeps its colon.
    const idx = line.search(/:(\s|$)/);
    const label = (idx >= 0 ? line.slice(0, idx) : line).trim();
    const detail = idx >= 0 ? line.slice(idx + 1).trim() : '';
    if (roles.has(label.toLowerCase())) { skipped.push(line); continue; }
    const kind = inferKind(label, false);
    items.push({ id: makeId(), kind, title: label, detail, songId: kind === 'song' ? matchSong(detail, songs)?.id ?? null : null });
  }
  return { items, skipped };
}

export function diffLines(a: string[], b: string[]): DiffLine[] {
  // LCS-based diff; liturgies are short so O(n*m) is fine.
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
