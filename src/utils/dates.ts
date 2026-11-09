import type { ISODate } from '../types/domain';

/** All date math is done on calendar dates in UTC to avoid timezone drift. */

export function parseISO(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function todayISO(now: Date = new Date()): ISODate {
  // Local calendar day, not UTC day.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = parseISO(d);
  x.setUTCDate(x.getUTCDate() + n);
  return toISO(x);
}

export function dayOfWeek(d: ISODate): number {
  return parseISO(d).getUTCDay();
}

export function isSunday(d: ISODate): boolean {
  return dayOfWeek(d) === 0;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Sundays in the given month (month is 1-12). */
export function sundaysOfMonth(year: number, month: number): ISODate[] {
  const out: ISODate[] = [];
  const n = daysInMonth(year, month);
  for (let day = 1; day <= n; day++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isSunday(iso)) out.push(iso);
  }
  return out;
}

export function nextSunday(from: ISODate, includeToday = true): ISODate {
  let d = from;
  if (!includeToday) d = addDays(d, 1);
  while (!isSunday(d)) d = addDays(d, 1);
  return d;
}

export function upcomingSundays(from: ISODate, count: number): ISODate[] {
  const out: ISODate[] = [];
  let d = nextSunday(from);
  for (let i = 0; i < count; i++) {
    out.push(d);
    d = addDays(d, 7);
  }
  return out;
}

export function startOfWeek(d: ISODate): ISODate {
  return addDays(d, -dayOfWeek(d));
}

export function monthKey(d: ISODate): string {
  return d.slice(0, 7);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthName(month: number): string {
  return MONTHS[month - 1];
}

export function weekdayShort(i: number): string {
  return DAYS_SHORT[i];
}

/** "Sun 15 Nov 2026" */
export function formatLong(d: ISODate): string {
  const x = parseISO(d);
  return `${DAYS_SHORT[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS_SHORT[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}

/** "15 Nov" */
export function formatShort(d: ISODate): string {
  const x = parseISO(d);
  return `${x.getUTCDate()} ${MONTHS_SHORT[x.getUTCMonth()]}`;
}

export function formatDateTime(iso: string): string {
  const x = new Date(iso);
  if (Number.isNaN(x.getTime())) return '—';
  return `${x.getDate()} ${MONTHS_SHORT[x.getMonth()]} ${x.getFullYear()}, ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISO(parseISO(s)) === s;
}

/** Accepts YYYY-MM-DD, M/D/YYYY, D Mon YYYY and Google Sheets serial numbers. */
export function parseLooseDate(input: string | number | null | undefined): ISODate | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number' || /^\d+(\.\d+)?$/.test(String(input).trim())) {
    const serial = Number(input);
    if (serial > 20000 && serial < 80000) {
      // Sheets epoch: 1899-12-30
      return toISO(new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000));
    }
    return null;
  }
  const s = String(input).trim();
  if (isValidISODate(s)) return s;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const iso = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    return isValidISODate(iso) ? iso : null;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const x = new Date(t);
    return todayISO(x);
  }
  return null;
}

/** Minutes since midnight for HH:MM. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}
