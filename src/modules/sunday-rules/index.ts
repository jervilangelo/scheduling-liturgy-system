import type { AppSettings, CreedKind, ISODate, LiturgyItem, LiturgyItemKind } from '../../types/domain';
import { parseISO, sundaysOfMonth } from '../../utils/dates';

/**
 * Special Sunday rules:
 *  - First Sunday of the month: Communion
 *  - Second Sunday: CPP
 *  - Last Sunday: Creed, alternating monthly between Nicene and Apostles'
 *
 * Every month has at least four Sundays, so the last Sunday is never the
 * first or second — the three rules never collide.
 */

export type SpecialKind = 'communion' | 'cpp' | 'creed';

export interface SundayInfo {
  date: ISODate;
  /** 1-based position of this Sunday within its month. */
  ordinal: number;
  isLast: boolean;
  specials: SpecialKind[];
  creed: CreedKind | null;
}

export type CreedSettings = Pick<AppSettings, 'creedAnchorYear' | 'creedAnchorMonth' | 'creedAnchorKind'>;

export const CREED_NAMES: Record<CreedKind, string> = {
  nicene: 'Nicene Creed',
  apostles: "Apostles' Creed",
};

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
  if (d.getUTCDay() !== 0) {
    return { date, ordinal: 0, isLast: false, specials: [], creed: null };
  }
  const list = sundaysOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
  const ordinal = list.indexOf(date) + 1;
  const isLast = ordinal === list.length;
  const specials: SpecialKind[] = [];
  if (ordinal === 1) specials.push('communion');
  if (ordinal === 2) specials.push('cpp');
  if (isLast) specials.push('creed');
  return {
    date,
    ordinal,
    isLast,
    specials,
    creed: isLast ? creedOverride ?? creedForMonth(date, s) : null,
  };
}

export function specialLabel(kind: SpecialKind, settings: Pick<AppSettings, 'communionLabel' | 'cppLabel' | 'creedLabel'>): string {
  if (kind === 'communion') return settings.communionLabel || 'Communion';
  if (kind === 'cpp') return settings.cppLabel || 'CPP';
  return settings.creedLabel || 'Creed';
}

export function describeSunday(info: SundayInfo, settings: AppSettings): string[] {
  return info.specials.map((k) =>
    k === 'creed' && info.creed ? CREED_NAMES[info.creed] : specialLabel(k, settings),
  );
}

const SPECIAL_KIND_TO_ITEM: Record<SpecialKind, LiturgyItemKind> = {
  communion: 'communion',
  cpp: 'cpp',
  creed: 'creed',
};

export interface LiturgyRuleIssue {
  kind: SpecialKind;
  message: string;
}

/** Checks a liturgy against the Sunday's required elements. */
export function checkLiturgy(items: LiturgyItem[], info: SundayInfo, settings: AppSettings): LiturgyRuleIssue[] {
  const issues: LiturgyRuleIssue[] = [];
  for (const k of info.specials) {
    const present = items.find((i) => i.kind === SPECIAL_KIND_TO_ITEM[k]);
    if (!present) {
      const label = k === 'creed' && info.creed ? CREED_NAMES[info.creed] : specialLabel(k, settings);
      issues.push({ kind: k, message: `${label} is required on this Sunday but is not in the order of worship.` });
    } else if (k === 'creed' && info.creed && !`${present.title} ${present.detail ?? ''}`.toLowerCase().includes(info.creed === 'nicene' ? 'nicene' : 'apostles')) {
      issues.push({ kind: k, message: `This month uses the ${CREED_NAMES[info.creed]}; the creed item says "${present.title}".` });
    }
  }
  return issues;
}

/**
 * Adds any missing required elements to a liturgy, placing them in a
 * conventional position (before the sermon for creed/CPP, after it for communion).
 */
export function applySundayRules(items: LiturgyItem[], info: SundayInfo, settings: AppSettings, makeId: () => string): LiturgyItem[] {
  const out = items.map((i) => ({ ...i }));
  const sermonIdx = () => {
    const i = out.findIndex((x) => x.kind === 'sermon');
    return i === -1 ? out.length : i;
  };
  for (const k of info.specials) {
    const kind = SPECIAL_KIND_TO_ITEM[k];
    const existing = out.find((i) => i.kind === kind);
    if (k === 'creed' && info.creed) {
      const title = CREED_NAMES[info.creed];
      if (existing) { existing.title = title; existing.detail = ''; }
      else out.splice(sermonIdx(), 0, { id: makeId(), kind, title, detail: '', durationMin: 3 });
      continue;
    }
    if (existing) continue;
    const item: LiturgyItem = { id: makeId(), kind, title: specialLabel(k, settings), detail: '', durationMin: k === 'communion' ? 15 : 10 };
    if (k === 'communion') {
      const idx = sermonIdx();
      out.splice(Math.min(idx + 1, out.length), 0, item);
    } else {
      out.splice(sermonIdx(), 0, item);
    }
  }
  return out;
}
