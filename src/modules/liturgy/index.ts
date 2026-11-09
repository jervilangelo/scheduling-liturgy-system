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
  const song = i.songId ? songs.get(i.songId) : undefined;
  const title = song ? song.title : i.title || kindLabel(i.kind);
  const extra = [i.scripture, i.leader ? `led by ${i.leader}` : ''].filter(Boolean).join(' · ');
  return `${kindLabel(i.kind)}: ${title}${extra ? ` (${extra})` : ''}`;
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
