import type { AppSettings, Assignment, RoleDefinition, Service, Song, Volunteer } from '../../types/domain';
import { formatLong } from '../../utils/dates';
import { kindLabel } from '../liturgy';
import { describeSunday, sundayInfo } from '../sunday-rules';
import type { Sheet } from './xlsx';

export interface ScheduleData {
  services: Service[];
  assignments: Assignment[];
  roles: RoleDefinition[];
  volunteers: Volunteer[];
  songs: Song[];
  settings: AppSettings;
}

function rosterFor(data: ScheduleData, s: Service): { role: string; names: string[] }[] {
  const vol = new Map(data.volunteers.map((v) => [v.id, v.name]));
  return data.roles
    .filter((r) => r.ministryId === s.ministryId && r.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      role: r.name,
      names: data.assignments.filter((a) => a.serviceId === s.id && a.roleId === r.id).map((a) => vol.get(a.volunteerId) ?? 'Unknown'),
    }));
}

function itemText(i: Service['liturgy'][number], songs: Map<string, Song>): string {
  const song = i.songId ? songs.get(i.songId) : undefined;
  const name = song ? song.title : i.title || kindLabel(i.kind);
  const bits = [i.scripture, i.leader].filter(Boolean).join(' — ');
  return `${name}${bits ? ` — ${bits}` : ''}`;
}

/** Plain-text schedule for pasting into chat apps or email. */
export function serviceAsText(data: ScheduleData, s: Service): string {
  const songs = new Map(data.songs.map((x) => [x.id, x]));
  const info = sundayInfo(s.date, data.settings, s.creedOverride);
  const specials = describeSunday(info, data.settings);
  const lines: string[] = [];
  lines.push(`${data.settings.churchName} — ${formatLong(s.date)} (${s.startTime})`);
  if (specials.length) lines.push(`Special: ${specials.join(', ')}`);
  if (s.theme) lines.push(`Theme: ${s.theme}`);
  if (s.sermon.title || s.sermon.preacher) {
    lines.push(`Sermon: ${[s.sermon.title, s.sermon.scripture].filter(Boolean).join(' — ')}${s.sermon.preacher ? ` (${s.sermon.preacher})` : ''}`);
  }
  if (s.liturgy.length) {
    lines.push('', 'Order of worship');
    s.liturgy.forEach((i, n) => lines.push(`${n + 1}. ${kindLabel(i.kind)}: ${itemText(i, songs)}`));
  }
  const roster = rosterFor(data, s);
  if (roster.length) {
    lines.push('', 'Ministry team');
    for (const r of roster) lines.push(`${r.role}: ${r.names.length ? r.names.join(', ') : '—'}`);
  }
  return lines.join('\n');
}

export function servicesAsText(data: ScheduleData, list: Service[]): string {
  return list.map((s) => serviceAsText(data, s)).join('\n\n────────\n\n');
}

/** Workbook with a roster grid (roles × Sundays) and one order-of-worship sheet per service. */
export function scheduleWorkbook(data: ScheduleData, list: Service[]): Sheet[] {
  const songs = new Map(data.songs.map((x) => [x.id, x]));
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const roleNames = [...new Set(sorted.flatMap((s) => rosterFor(data, s).map((r) => r.role)))];
  const roster: Sheet = {
    name: 'Roster',
    widths: [24, ...sorted.map(() => 26)],
    rows: [
      ['Role', ...sorted.map((s) => formatLong(s.date))],
      ['Special', ...sorted.map((s) => describeSunday(sundayInfo(s.date, data.settings, s.creedOverride), data.settings).join(', '))],
      ['Status', ...sorted.map((s) => s.status)],
      ...roleNames.map((role) => [role, ...sorted.map((s) => rosterFor(data, s).find((r) => r.role === role)?.names.join(', ') ?? '')]),
    ],
  };
  const services: Sheet[] = sorted.map((s) => ({
    name: s.date,
    widths: [6, 24, 44, 24, 10],
    rows: [
      ['#', 'Element', 'Detail', 'Leader', 'Minutes'],
      ...s.liturgy.map((i, n) => [n + 1, kindLabel(i.kind), itemText(i, songs), i.leader ?? '', i.durationMin ?? null]),
      [],
      ['', 'Theme', s.theme, '', null],
      ['', 'Sermon', [s.sermon.title, s.sermon.scripture].filter(Boolean).join(' — '), s.sermon.preacher, null],
    ],
  }));
  return [roster, ...services];
}
