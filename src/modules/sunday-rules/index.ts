import type { CreedKind, CreedSettings, ISODate, LiturgyItem, SpecialKind } from '../../types/domain';
import { parseISO, sundaysOfMonth } from '../../utils/dates';

/**
 * ECCM special Sundays:
 *  - First Sunday: Communion. "Communion Proper" and "Communion Song: …" come
 *    right after the Response Song (before the ministry assignments).
 *  - Second Sunday: two added songs. The liturgy is unchanged;
 *    "Congregational Prayer and Praise" with two songs is appended after the
 *    team lines.
 *  - Last Sunday: Creed. The Congregational Reading of Scripture is replaced by
 *    the creed, alternating monthly between the Nicene and Apostles' Creeds.
 *
 * Every month has at least four Sundays, so the last Sunday is never the
 * first or second: the three rules never collide.
 */

export type { CreedSettings, SpecialKind };

export interface SundayInfo {
  date: ISODate;
  /** 1-based position of this Sunday within its month. */
  ordinal: number;
  isLast: boolean;
  specials: SpecialKind[];
  creed: CreedKind | null;
}

/** Creed rotation anchor: January 2026 is a Nicene month; it alternates monthly from there. */
export const CREED_ANCHOR: CreedSettings = { creedAnchorYear: 2026, creedAnchorMonth: 1, creedAnchorKind: 'nicene' };

export const CREED_NAMES: Record<CreedKind, string> = {
  nicene: 'Nicene Creed',
  apostles: "Apostles' Creed",
};

export const CPP_TITLE = 'Congregational Prayer and Praise';
export const COMMUNION_TITLE = 'Communion Proper';
export const COMMUNION_SONG_TITLE = 'Communion Song';
export const READING_TITLE = 'Congregational Reading of Scripture';

export function otherCreed(c: CreedKind): CreedKind {
  return c === 'nicene' ? 'apostles' : 'nicene';
}

/** Creed for the month containing `date`, alternating from the configured anchor month. */
export function creedForMonth(date: ISODate, s: CreedSettings): CreedKind {
  const d = parseISO(date);
  const months = (d.getUTCFullYear() - s.creedAnchorYear) * 12 + (d.getUTCMonth() + 1 - s.creedAnchorMonth);
  return Math.abs(months) % 2 === 0 ? s.creedAnchorKind : otherCreed(s.creedAnchorKind);
}

export function sundayInfo(date: ISODate, s: CreedSettings, creedOverride: CreedKind | null = null): SundayInfo {
  const d = parseISO(date);
  if (d.getUTCDay() !== 0) return { date, ordinal: 0, isLast: false, specials: [], creed: null };
  const list = sundaysOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
  const ordinal = list.indexOf(date) + 1;
  const isLast = ordinal === list.length;
  const specials: SpecialKind[] = [];
  if (ordinal === 1) specials.push('communion');
  if (ordinal === 2) specials.push('cpp');
  if (isLast) specials.push('creed');
  return { date, ordinal, isLast, specials, creed: isLast ? creedOverride ?? creedForMonth(date, s) : null };
}

export const SPECIAL_LABEL: Record<SpecialKind, string> = {
  communion: 'Communion Sunday',
  cpp: 'Two added songs',
  creed: 'Creed',
};

/** Short tags for the Sunday, e.g. ["Communion Sunday"] or ["Nicene Creed"]. */
export function describeSunday(info: SundayInfo): string[] {
  return info.specials.map((k) => (k === 'creed' && info.creed ? CREED_NAMES[info.creed] : SPECIAL_LABEL[k]));
}

/* ---------- Locating the lines the rules manage ---------- */

const isReading = (i: LiturgyItem) => i.slot === 'congregational_reading' || /congregational reading/i.test(i.title);
const isResponse = (i: LiturgyItem) => i.slot === 'response_song' || /response song/i.test(i.title);
const isCommunionSong = (i: LiturgyItem) => i.slot === 'communion_song';
const isCppSong = (i: LiturgyItem) => i.slot === 'cpp_song';
const mentionsCreed = (s: string, c: CreedKind) => s.toLowerCase().replace(/[’']/g, '').includes(c === 'nicene' ? 'nicene' : 'apostles');

export interface LiturgyRuleIssue {
  kind: SpecialKind;
  message: string;
}

/** What this Sunday still needs. Sundays where the rule was overridden are skipped. */
export function checkLiturgy(items: LiturgyItem[], info: SundayInfo, overrides: SpecialKind[] = []): LiturgyRuleIssue[] {
  const issues: LiturgyRuleIssue[] = [];
  for (const k of info.specials) {
    if (overrides.includes(k)) continue;
    if (k === 'communion') {
      if (!items.some((i) => i.kind === 'communion') || !items.some(isCommunionSong)) {
        issues.push({ kind: k, message: `First Sunday: ${COMMUNION_TITLE} and the ${COMMUNION_SONG_TITLE} belong after the Response Song.` });
      }
    } else if (k === 'cpp') {
      if (!items.some((i) => i.kind === 'cpp') || !items.some(isCppSong)) {
        issues.push({ kind: k, message: `Second Sunday: two songs are added (${CPP_TITLE}) after the team lines.` });
      }
    } else if (info.creed) {
      const reading = items.find(isReading);
      if (!reading || !mentionsCreed(`${reading.detail ?? ''} ${reading.title}`, info.creed)) {
        issues.push({ kind: k, message: `Last Sunday: the ${READING_TITLE} is replaced by the ${CREED_NAMES[info.creed]} this month.` });
      }
    }
  }
  return issues;
}

/**
 * Adds or corrects the special-Sunday lines. Idempotent: running it again on
 * its own output changes nothing, so reloading or re-editing never duplicates
 * Communion or CPP sections. Songs already chosen are kept.
 */
export function applySundayRules(items: LiturgyItem[], info: SundayInfo, makeId: () => string, overrides: SpecialKind[] = []): LiturgyItem[] {
  let out = items.map((i) => ({ ...i }));
  for (const k of info.specials) {
    if (overrides.includes(k)) continue;

    if (k === 'creed' && info.creed) {
      const name = CREED_NAMES[info.creed];
      const reading = out.find(isReading);
      if (reading) {
        reading.kind = 'creed';
        reading.slot = 'congregational_reading';
        reading.title = reading.title || READING_TITLE;
        reading.detail = name;
      } else {
        const before = out.findIndex((i) => /thanksgiving/i.test(i.title) || i.kind === 'sermon');
        const line: LiturgyItem = { id: makeId(), kind: 'creed', title: READING_TITLE, detail: name, slot: 'congregational_reading' };
        out.splice(before === -1 ? out.length : before, 0, line);
      }
    }

    if (k === 'communion') {
      if (!out.some((i) => i.kind === 'communion')) {
        const at = afterResponse(out);
        out.splice(at, 0, { id: makeId(), kind: 'communion', title: COMMUNION_TITLE, detail: '' });
      }
      if (!out.some(isCommunionSong)) {
        const proper = out.findIndex((i) => i.kind === 'communion');
        out.splice(proper + 1, 0, { id: makeId(), kind: 'song', title: COMMUNION_SONG_TITLE, detail: '', songId: null, slot: 'communion_song' });
      }
    }

    if (k === 'cpp') {
      if (!out.some((i) => i.kind === 'cpp')) out.push({ id: makeId(), kind: 'cpp', title: CPP_TITLE, detail: '' });
      if (!out.some(isCppSong)) {
        out.push(
          { id: makeId(), kind: 'song', title: '', detail: '', songId: null, slot: 'cpp_song' },
          { id: makeId(), kind: 'song', title: '', detail: '', songId: null, slot: 'cpp_song' },
        );
      }
      // CPP lines always sit together at the end (they print after the assignments).
      const cpp = out.filter((i) => i.kind === 'cpp' || isCppSong(i));
      out = [...out.filter((i) => !(i.kind === 'cpp' || isCppSong(i))), ...cpp.sort((a, b) => (a.kind === 'cpp' ? -1 : b.kind === 'cpp' ? 1 : 0))];
    }
  }
  return out;
}

/** Index just after the Response Song (or after the sermon, or at the end before any CPP lines). */
function afterResponse(items: LiturgyItem[]): number {
  const r = items.findIndex(isResponse);
  if (r !== -1) return r + 1;
  const s = items.findIndex((i) => i.kind === 'sermon');
  if (s !== -1) return s + 1;
  const cpp = items.findIndex((i) => i.kind === 'cpp' || isCppSong(i));
  return cpp === -1 ? items.length : cpp;
}
