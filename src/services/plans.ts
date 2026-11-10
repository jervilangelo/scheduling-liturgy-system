import type { LiturgyItem, Plan, PlanVersion } from '../types/domain';
import { defaultTeam } from '../modules/liturgy';
import { uid } from '../utils/id';

/**
 * Sunday plans and their saved versions, kept in this browser's storage.
 * (Sharing between planners is done by copying the plan's text.)
 */

const PLANS_KEY = 'eccm:liturgy:v1:plans';
const VERSIONS_KEY = 'eccm:liturgy:v1:versions';
/** Older builds of this app kept services here; their liturgies are imported once. */
const LEGACY_SERVICES_KEY = 'eccm:v2:services';

const memory = new Map<string, string>();

function get(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return memory.get(key) ?? null; }
}
function set(key: string, value: string): void {
  memory.set(key, value);
  try { localStorage.setItem(key, value); } catch { /* storage full or blocked: kept for this page only */ }
}
function readJSON<T>(key: string, fallback: T): T {
  const raw = get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function importLegacy(): Plan[] {
  const old = readJSON<{ date: string; theme?: string; sermon?: { title?: string; preacher?: string }; liturgy?: LiturgyItem[]; creedOverride?: Plan['creedOverride']; liturgyVersion?: number; updatedAt?: string }[]>(LEGACY_SERVICES_KEY, []);
  return old.filter((s) => s.liturgy?.length).map((s) => ({
    id: uid(),
    date: s.date,
    theme: s.theme ?? '',
    sermon: { title: s.sermon?.title ?? '', preacher: s.sermon?.preacher ?? '' },
    liturgy: s.liturgy ?? [],
    team: defaultTeam(),
    creedOverride: s.creedOverride ?? null,
    version: s.liturgyVersion ?? 0,
    updatedAt: s.updatedAt ?? new Date().toISOString(),
  }));
}

export function listPlans(): Plan[] {
  if (get(PLANS_KEY) === null) {
    const legacy = importLegacy();
    set(PLANS_KEY, JSON.stringify(legacy));
    return legacy;
  }
  return readJSON<Plan[]>(PLANS_KEY, []);
}

export function planOn(date: string): Plan | undefined {
  return listPlans().find((p) => p.date === date);
}

export function blankPlan(date: string): Plan {
  return { id: uid(), date, theme: '', sermon: { title: '', preacher: '' }, liturgy: [], team: defaultTeam(), creedOverride: null, version: 0, updatedAt: new Date().toISOString() };
}

/** Saves the plan as a new version and returns it. */
export function savePlan(plan: Plan, note = ''): Plan {
  const saved: Plan = { ...plan, version: plan.version + 1, updatedAt: new Date().toISOString() };
  const plans = listPlans().filter((p) => p.id !== saved.id && p.date !== saved.date);
  set(PLANS_KEY, JSON.stringify([...plans, saved]));
  const v: PlanVersion = { id: uid(), planId: saved.id, version: saved.version, items: saved.liturgy, note, savedAt: saved.updatedAt };
  set(VERSIONS_KEY, JSON.stringify([...readJSON<PlanVersion[]>(VERSIONS_KEY, []), v]));
  return saved;
}

export function versionsOf(planId: string): PlanVersion[] {
  return readJSON<PlanVersion[]>(VERSIONS_KEY, []).filter((v) => v.planId === planId).sort((a, b) => b.version - a.version);
}
