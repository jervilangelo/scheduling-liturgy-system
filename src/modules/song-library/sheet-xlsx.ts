import { strFromU8, unzipSync } from 'fflate';

/**
 * Reads the church's SongList from the Google Sheet's .xlsx export, read-only.
 * Self-contained (only fflate) so the same code runs in the browser and in
 * scripts/fetch-songlist.ts.
 *
 * The songs live in a table named "SongList" on the "Song List" tab (headers on
 * row 4). Columns are matched by header name; links come from the cell
 * hyperlinks; "Last Sung" cells are real dates shown as e.g. "July 5".
 */

export interface SheetSong {
  sheetRow: number;
  title: string;
  artist: string;
  themes: string[];
  lastSung: string | null;
  lyricsLink: string;
  chordsLink: string;
}

export interface SongListHeaders {
  table: string; // table or tab name, e.g. "SongList"
  title: string;
  lastSung: string;
  theme: string;
  artist: string;
  lyrics: string;
  chords: string;
}

export function songListExportUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=xlsx`;
}

/** Accepts a full sheet link or a bare ID. */
export function spreadsheetIdFrom(input: string): string {
  const m = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return (m ? m[1] : input).trim();
}

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
};

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function serialToISO(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "July 5" (no year) → the most recent such date on or before `today`. */
export function monthDayToISO(text: string, today: string): string | null {
  const m = text.trim().match(/^([a-z]+)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (mi === -1) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (m[3]) return `${m[3]}-${pad(mi + 1)}-${pad(Number(m[2]))}`;
  let year = Number(today.slice(0, 4));
  let iso = `${year}-${pad(mi + 1)}-${pad(Number(m[2]))}`;
  if (iso > today) { year -= 1; iso = `${year}-${pad(mi + 1)}-${pad(Number(m[2]))}`; }
  return iso;
}

interface Cell { value: string; numeric: boolean }

export function parseSongListXlsx(bytes: Uint8Array, h: SongListHeaders, today: string): SheetSong[] {
  const files = unzipSync(bytes);
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : '');

  const shared: string[] = [];
  for (const si of text('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push(decode((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  }

  // Locate the table (preferred) and the sheet that holds it.
  let sheetPath = '';
  let ref = '';
  const wanted = h.table.trim().toLowerCase();
  for (const p of Object.keys(files).filter((f) => /^xl\/tables\/table\d+\.xml$/.test(f))) {
    const t = text(p);
    const head = t.match(/<table [^>]*>/)?.[0] ?? '';
    if ((attr(head, 'name') ?? '').toLowerCase() !== wanted && (attr(head, 'displayName') ?? '').toLowerCase() !== wanted) continue;
    ref = attr(head, 'ref') ?? '';
    const file = p.split('/').pop()!;
    for (const r of Object.keys(files).filter((f) => /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(f))) {
      if (text(r).includes(`tables/${file}"`)) sheetPath = r.replace('_rels/', '').replace('.rels', '');
    }
  }
  if (!sheetPath) {
    // Fall back to a tab with that name.
    const wb = text('xl/workbook.xml');
    const rels = text('xl/_rels/workbook.xml.rels');
    for (const tag of wb.match(/<sheet [^>]+>/g) ?? []) {
      const name = (attr(tag, 'name') ?? '').toLowerCase().replace(/\s+/g, '');
      if (name !== wanted.replace(/\s+/g, '')) continue;
      const rid = attr(tag, 'r:id');
      const target = rels.match(new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*>`))?.[0];
      if (target) sheetPath = `xl/${(attr(target, 'Target') ?? '').replace(/^\/?xl\//, '')}`;
    }
  }
  if (!sheetPath) throw new Error(`No table or tab named "${h.table}" was found in the spreadsheet.`);

  const sheet = text(sheetPath);
  const rows = new Map<number, Map<number, Cell>>();
  for (const m of sheet.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, col, row, attrs, inner = ''] = m;
    const type = attr(`<c ${attrs}>`, 't');
    let value = '';
    if (type === 's') value = shared[Number(inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? -1)] ?? '';
    else if (type === 'inlineStr') value = decode((inner.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));
    else value = decode(inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? '');
    if (!rows.has(Number(row))) rows.set(Number(row), new Map());
    rows.get(Number(row))!.set(colIndex(col), { value, numeric: !type || type === 'n' });
  }

  // Hyperlinks: <hyperlink r:id="rId1" ref="B5" location="…"/> + sheet rels
  const relsXml = text(sheetPath.replace('worksheets/', 'worksheets/_rels/') + '.rels');
  const relTarget = new Map<string, string>();
  for (const tag of relsXml.match(/<Relationship [^>]+>/g) ?? []) relTarget.set(attr(tag, 'Id') ?? '', attr(tag, 'Target') ?? '');
  const links = new Map<string, string>();
  for (const tag of sheet.match(/<hyperlink [^>]+>/g) ?? []) {
    const cellRef = attr(tag, 'ref');
    const target = relTarget.get(attr(tag, 'r:id') ?? '') ?? '';
    const loc = attr(tag, 'location');
    if (cellRef && target) links.set(cellRef, loc ? `${target}#${loc}` : target);
  }

  // Header row: the table's first row, else the first row holding the title header.
  let headerRow = ref ? Number(ref.match(/\d+/)?.[0]) : 0;
  let lastRow = ref ? Number(ref.split(':')[1]?.match(/\d+/)?.[0] ?? 0) : Math.max(0, ...rows.keys());
  const findCol = (row: Map<number, Cell> | undefined, name: string) => {
    if (!row || !name.trim()) return -1;
    for (const [i, c] of row) if (c.value.trim().toLowerCase() === name.trim().toLowerCase()) return i;
    return -1;
  };
  if (!headerRow) {
    for (const [r, row] of [...rows].sort((a, b) => a[0] - b[0])) if (findCol(row, h.title) !== -1) { headerRow = r; break; }
    lastRow = Math.max(0, ...rows.keys());
  }
  const header = rows.get(headerRow);
  const ci = { title: findCol(header, h.title), last: findCol(header, h.lastSung), theme: findCol(header, h.theme), artist: findCol(header, h.artist), lyrics: findCol(header, h.lyrics), chords: findCol(header, h.chords) };
  if (ci.title === -1) throw new Error(`The column "${h.title}" was not found in ${h.table}.`);
  const letter = (i: number) => { let s = ''; let n = i + 1; while (n > 0) { const m2 = (n - 1) % 26; s = String.fromCharCode(65 + m2) + s; n = Math.floor((n - 1) / 26); } return s; };

  const out: SheetSong[] = [];
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = rows.get(r);
    const title = row?.get(ci.title)?.value.trim() ?? '';
    if (!title) continue;
    const get = (i: number) => (i === -1 ? '' : row?.get(i)?.value.trim() ?? '');
    const lastCell = ci.last === -1 ? undefined : row?.get(ci.last);
    let lastSung: string | null = null;
    if (lastCell?.value) lastSung = lastCell.numeric && /^\d+(\.\d+)?$/.test(lastCell.value) ? serialToISO(Number(lastCell.value)) : monthDayToISO(lastCell.value, today);
    const link = (i: number) => (i === -1 ? '' : links.get(`${letter(i)}${r}`) ?? (/^https?:\/\//.test(get(i)) ? get(i) : ''));
    out.push({
      sheetRow: r,
      title,
      artist: get(ci.artist),
      themes: get(ci.theme).split(/[,;/]/).map((t) => t.trim()).filter(Boolean),
      lastSung,
      // Most songs link from the title cell itself; the Lyrics Link column is used where filled.
      lyricsLink: link(ci.lyrics) || link(ci.title),
      chordsLink: link(ci.chords),
    });
  }
  return out;
}
