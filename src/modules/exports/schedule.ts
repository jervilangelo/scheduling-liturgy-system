import type { AppSettings, Assignment, RoleDefinition, Service, Song, Volunteer } from '../../types/domain';
import { formatLong } from '../../utils/dates';
import { formatLine, liturgyToText, normalizeItems } from '../liturgy';
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

export function rosterFor(data: ScheduleData, s: Service): { role: string; names: string[] }[] {
  const vol = new Map(data.volunteers.map((v) => [v.id, v.name]));
  return data.roles
    .filter((r) => r.ministryId === s.ministryId && r.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      role: r.name,
      names: data.assignments.filter((a) => a.serviceId === s.id && a.roleId === r.id).map((a) => vol.get(a.volunteerId) ?? 'Unknown'),
    }));
}

/** Plain text in the church's own format ("November 8", lines, then the team). */
export function serviceAsText(data: ScheduleData, s: Service): string {
  const songs = new Map(data.songs.map((x) => [x.id, x]));
  return liturgyToText(s.date, normalizeItems(s.liturgy, songs), songs, rosterFor(data, s));
}

export function servicesAsText(data: ScheduleData, list: Service[]): string {
  return [...list].sort((a, b) => a.date.localeCompare(b.date)).map((s) => serviceAsText(data, s)).join('\n\n\n');
}

/** Workbook with a team roster (roles × Sundays) and one order-of-worship sheet per service. */
export function scheduleWorkbook(data: ScheduleData, list: Service[]): Sheet[] {
  const songs = new Map(data.songs.map((x) => [x.id, x]));
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const roleNames = [...new Set(sorted.flatMap((s) => rosterFor(data, s).map((r) => r.role)))];
  const roster: Sheet = {
    name: 'Team',
    widths: [24, ...sorted.map(() => 26)],
    rows: [
      ['', ...sorted.map((s) => formatLong(s.date))],
      ['Special', ...sorted.map((s) => describeSunday(sundayInfo(s.date, data.settings, s.creedOverride), data.settings).join(', '))],
      ...roleNames.map((role) => [role, ...sorted.map((s) => rosterFor(data, s).find((r) => r.role === role)?.names.join(', ') ?? '')]),
    ],
  };
  const services: Sheet[] = sorted.map((s) => ({
    name: s.date,
    widths: [70],
    rows: [
      [formatLong(s.date)],
      ...normalizeItems(s.liturgy, songs).map((i) => [formatLine(i, songs)]),
      [''],
      ...rosterFor(data, s).map((t) => [`${t.role}: ${t.names.join(', ')}`]),
    ],
  }));
  return [roster, ...services];
}
