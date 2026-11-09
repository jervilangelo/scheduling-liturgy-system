import type { AppSettings, Ministry, Service } from '../../types/domain';
import { h } from '../../utils/dom';
import { describeSunday, sundayInfo } from '../../modules/sunday-rules';
import { blankService, save } from '../../services/api/store';
import { rulesFor } from '../../modules/volunteer-scheduling/ministry-rules';

export function primaryMinistry(ministries: Ministry[]): Ministry {
  const m = ministries.find((x) => x.slug === 'worship' && x.active) ?? ministries.find((x) => x.active) ?? ministries[0];
  if (!m) throw new Error('No ministry is configured. Add one in Settings.');
  return m;
}

export function serviceOn(services: Service[], ministryId: string, date: string): Service | undefined {
  return services.find((s) => s.ministryId === ministryId && s.date === date);
}

/** Returns the service for a date, creating (and saving) a draft if none exists. */
export async function ensureService(services: Service[], ministry: Ministry, date: string): Promise<Service> {
  const existing = serviceOn(services, ministry.id, date);
  if (existing) return existing;
  const s = blankService(ministry.id, date, ministry.defaultStart, ministry.defaultEnd);
  await save('services', s, { action: 'create', details: `${ministry.name} on ${date}` });
  services.push(s);
  return s;
}

/** Special-Sunday pills, e.g. "Holy Communion", "Nicene Creed". */
export function specialTags(date: string, settings: AppSettings, ministry: Ministry | undefined, creedOverride: Service['creedOverride'] = null): HTMLElement | null {
  if (!rulesFor(ministry).specialSundays) return null;
  const labels = describeSunday(sundayInfo(date, settings, creedOverride), settings);
  if (!labels.length) return null;
  return h('span', { class: 'pills' }, labels.map((l) => h('span', { class: 'pill pill-info' }, l)));
}
