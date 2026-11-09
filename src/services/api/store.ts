import type { AppSettings, CollectionMap, CollectionName, Service } from '../../types/domain';
import type { SchedulingContext } from '../../modules/conflict-detection';
import { uid } from '../../utils/id';
import { backend } from './backend';
import { DEFAULT_SETTINGS } from './seed';

let actor = 'anonymous';
export function setActor(email: string): void { actor = email; }
export function getActor(): string { return actor; }

export const dataMode = backend.mode;

export async function list<K extends CollectionName>(c: K): Promise<CollectionMap[K][]> {
  return backend.list(c);
}

export async function audit(action: string, entity: string, entityId: string, details = ''): Promise<void> {
  try {
    await backend.upsert('audit_log', [{ id: uid(), at: new Date().toISOString(), actor, action, entity, entityId, details }]);
  } catch (e) {
    console.warn('Audit write failed', e);
  }
}

export async function save<K extends CollectionName>(
  c: K,
  rows: CollectionMap[K] | CollectionMap[K][],
  log?: { action: string; details?: string },
): Promise<void> {
  const arr = Array.isArray(rows) ? rows : [rows];
  await backend.upsert(c, arr);
  if (log) {
    const ids = arr.map((r) => (r as { id: string }).id);
    await audit(log.action, c, ids.length === 1 ? ids[0] : `${ids.length} records`, log.details ?? '');
  }
}

export async function remove<K extends CollectionName>(c: K, ids: string[], log?: { action: string; details?: string }): Promise<void> {
  await backend.remove(c, ids);
  if (log) await audit(log.action, c, ids.length === 1 ? ids[0] : `${ids.length} records`, log.details ?? '');
}

export async function getSettings(): Promise<AppSettings> {
  const rows = await backend.list('app_settings');
  return { ...DEFAULT_SETTINGS, ...(rows.find((r) => r.id === 'global') ?? {}) };
}

export async function loadSchedulingContext(): Promise<SchedulingContext & { settingsFull: AppSettings }> {
  const [services, assignments, volunteers, roles, availability, ministries, settingsFull] = await Promise.all([
    list('services'), list('assignments'), list('volunteers'), list('role_definitions'), list('availability'), list('ministries'), getSettings(),
  ]);
  return { services, assignments, volunteers, roles, availability, ministries, settings: settingsFull, settingsFull };
}

export function blankService(ministryId: string, date: string, start = '09:00', end = '11:00'): Service {
  return {
    id: uid(),
    ministryId,
    date,
    startTime: start,
    endTime: end,
    status: 'draft',
    theme: '',
    sermon: { title: '', preacher: '', scripture: '', series: '', notes: '' },
    liturgy: [],
    creedOverride: null,
    notes: '',
    liturgyVersion: 0,
    submittedBy: null,
    approvedBy: null,
    publishedAt: null,
    updatedAt: new Date().toISOString(),
  };
}
