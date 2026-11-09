import { describe, expect, it } from 'vitest';
import { applySundayRules, checkLiturgy, creedForMonth, sundayInfo } from '../../src/modules/sunday-rules';
import { DEFAULT_SETTINGS } from '../../src/services/api/seed';
import { sundaysOfMonth, upcomingSundays, parseLooseDate } from '../../src/utils/dates';
import type { LiturgyItem } from '../../src/types/domain';

const S = DEFAULT_SETTINGS; // anchor: January 2026 = Nicene
let n = 0;
const id = () => `i${++n}`;

describe('sundays', () => {
  it('lists the Sundays of a month', () => {
    expect(sundaysOfMonth(2026, 11)).toEqual(['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']);
    expect(sundaysOfMonth(2026, 2)).toEqual(['2026-02-01', '2026-02-08', '2026-02-15', '2026-02-22']);
  });
  it('finds upcoming Sundays including today when today is Sunday', () => {
    expect(upcomingSundays('2026-11-09', 2)).toEqual(['2026-11-15', '2026-11-22']);
    expect(upcomingSundays('2026-11-15', 1)).toEqual(['2026-11-15']);
  });
  it('parses sheet date formats', () => {
    expect(parseLooseDate('2026-03-01')).toBe('2026-03-01');
    expect(parseLooseDate('3/1/2026')).toBe('2026-03-01');
    expect(parseLooseDate(46082)).toBe('2026-03-01'); // Sheets serial
    expect(parseLooseDate('')).toBeNull();
  });
});

describe('special Sunday rules', () => {
  it('first Sunday is Communion, second CPP, last the creed', () => {
    expect(sundayInfo('2026-11-01', S).specials).toEqual(['communion']);
    expect(sundayInfo('2026-11-08', S).specials).toEqual(['cpp']);
    expect(sundayInfo('2026-11-15', S).specials).toEqual([]);
    expect(sundayInfo('2026-11-22', S).specials).toEqual([]);
    expect(sundayInfo('2026-11-29', S).specials).toEqual(['creed']);
  });
  it('handles four-Sunday months: the fourth is last', () => {
    const info = sundayInfo('2026-02-22', S);
    expect(info.ordinal).toBe(4);
    expect(info.specials).toEqual(['creed']);
  });
  it('non-Sundays have no specials', () => {
    expect(sundayInfo('2026-11-02', S).specials).toEqual([]);
  });
  it('alternates the creed monthly from the anchor, both directions', () => {
    expect(creedForMonth('2026-01-25', S)).toBe('nicene');
    expect(creedForMonth('2026-02-22', S)).toBe('apostles');
    expect(creedForMonth('2026-03-29', S)).toBe('nicene');
    expect(creedForMonth('2026-11-29', S)).toBe('nicene');
    expect(creedForMonth('2026-12-27', S)).toBe('apostles');
    expect(creedForMonth('2025-12-28', S)).toBe('apostles');
    expect(creedForMonth('2025-11-30', S)).toBe('nicene');
  });
  it('respects a manual creed override', () => {
    expect(sundayInfo('2026-11-29', S, 'apostles').creed).toBe('apostles');
  });
  it('adds missing required elements and reports issues', () => {
    const base: LiturgyItem[] = [{ id: id(), kind: 'song', title: 'x' }, { id: id(), kind: 'sermon', title: 'Sermon' }];
    const info = sundayInfo('2026-11-29', S);
    expect(checkLiturgy(base, info, S)).toHaveLength(1);
    const fixed = applySundayRules(base, info, S, id);
    expect(fixed.map((i) => i.kind)).toEqual(['song', 'creed', 'sermon']);
    expect(fixed[1].title).toBe('Nicene Creed');
    expect(checkLiturgy(fixed, info, S)).toHaveLength(0);

    const comm = applySundayRules(base, sundayInfo('2026-11-01', S), S, id);
    expect(comm.map((i) => i.kind)).toEqual(['song', 'sermon', 'communion']);
  });
  it('flags the wrong creed for the month', () => {
    const items: LiturgyItem[] = [{ id: id(), kind: 'creed', title: "Apostles' Creed" }];
    const issues = checkLiturgy(items, sundayInfo('2026-11-29', S), S);
    expect(issues[0].message).toMatch(/Nicene/);
  });
});
