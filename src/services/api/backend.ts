import type { CollectionMap, CollectionName } from '../../types/domain';
import { getSupabase, isSupabaseConfigured } from '../supabase/client';
import { buildSeed } from './seed';

export interface DataBackend {
  readonly mode: 'supabase' | 'local';
  list<K extends CollectionName>(c: K): Promise<CollectionMap[K][]>;
  upsert<K extends CollectionName>(c: K, rows: CollectionMap[K][]): Promise<void>;
  remove<K extends CollectionName>(c: K, ids: string[]): Promise<void>;
}

/* ---------- Supabase backend ---------- */

const APPEND_ONLY = new Set<CollectionName>(['audit_log', 'liturgy_versions']);

const toSnake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function rowToDb(o: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [toSnake(k), v === undefined ? null : v]));
}
function rowFromDb<T>(o: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [toCamel(k), v])) as T;
}

class SupabaseBackend implements DataBackend {
  readonly mode = 'supabase' as const;

  async list<K extends CollectionName>(c: K): Promise<CollectionMap[K][]> {
    const sb = await getSupabase();
    const out: CollectionMap[K][] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await sb.from(c).select('*').range(from, from + page - 1);
      if (error) throw new Error(`Could not load ${c}: ${error.message}`);
      out.push(...(data ?? []).map((r) => rowFromDb<CollectionMap[K]>(r)));
      if (!data || data.length < page) break;
    }
    return out;
  }

  async upsert<K extends CollectionName>(c: K, rows: CollectionMap[K][]): Promise<void> {
    if (!rows.length) return;
    const sb = await getSupabase();
    const dbRows = rows.map(rowToDb);
    // Append-only tables: plain insert (no update policy exists for them).
    if (APPEND_ONLY.has(c)) {
      const { error } = await sb.from(c).insert(dbRows);
      if (error) throw new Error(`Could not save ${c}: ${error.message}`);
      return;
    }
    const { error } = await sb.from(c).upsert(dbRows);
    if (!error) return;
    // Postgres checks INSERT policies on upsert even when the row exists. When a
    // user may update but not insert (e.g. an approver stamping Last Sung, an
    // admin changing a profile role), fall back to updating existing rows.
    if (error.code !== '42501') throw new Error(`Could not save ${c}: ${error.message}`);
    const ids = dbRows.map((r) => r.id as string);
    const { data: existing, error: selErr } = await sb.from(c).select('id').in('id', ids);
    if (selErr) throw new Error(`Could not save ${c}: ${selErr.message}`);
    const have = new Set((existing ?? []).map((r: { id: string }) => r.id));
    for (const r of dbRows.filter((x) => have.has(x.id as string))) {
      const { error: upErr } = await sb.from(c).update(r).eq('id', r.id as string);
      if (upErr) throw new Error(`Could not save ${c}: ${upErr.message}`);
    }
    const fresh = dbRows.filter((x) => !have.has(x.id as string));
    if (fresh.length) {
      const { error: insErr } = await sb.from(c).insert(fresh);
      if (insErr) throw new Error(`Could not save ${c}: ${insErr.message}`);
    }
  }

  async remove<K extends CollectionName>(c: K, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const sb = await getSupabase();
    const { error } = await sb.from(c).delete().in('id', ids);
    if (error) throw new Error(`Could not delete from ${c}: ${error.message}`);
  }
}

/* ---------- Local (demo) backend: browser storage ---------- */

// v2: liturgy lines are label + detail, and the team matches the church's format.
export const LOCAL_PREFIX = 'eccm:v2:';

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage full or blocked */ }
}

class LocalBackend implements DataBackend {
  readonly mode = 'local' as const;
  private memory = new Map<string, unknown[]>();

  private ensureSeeded(): void {
    if (safeGet(`${LOCAL_PREFIX}seeded`)) return;
    const seed = buildSeed();
    for (const [k, rows] of Object.entries(seed)) safeSet(LOCAL_PREFIX + k, JSON.stringify(rows));
    safeSet(`${LOCAL_PREFIX}seeded`, new Date().toISOString());
    // Fallback when storage is blocked: keep seed in memory for this page.
    for (const [k, rows] of Object.entries(seed)) this.memory.set(k, rows as unknown[]);
  }

  private read<K extends CollectionName>(c: K): CollectionMap[K][] {
    this.ensureSeeded();
    const raw = safeGet(LOCAL_PREFIX + c);
    if (raw) {
      try { return JSON.parse(raw) as CollectionMap[K][]; } catch { /* fall through */ }
    }
    return (this.memory.get(c) as CollectionMap[K][] | undefined) ?? [];
  }

  private write<K extends CollectionName>(c: K, rows: CollectionMap[K][]): void {
    this.memory.set(c, rows);
    safeSet(LOCAL_PREFIX + c, JSON.stringify(rows));
  }

  async list<K extends CollectionName>(c: K): Promise<CollectionMap[K][]> {
    return structuredClone(this.read(c));
  }

  async upsert<K extends CollectionName>(c: K, rows: CollectionMap[K][]): Promise<void> {
    const cur = this.read(c);
    const byId = new Map(cur.map((r) => [(r as { id: string }).id, r]));
    for (const r of rows) byId.set((r as { id: string }).id, structuredClone(r));
    this.write(c, [...byId.values()]);
  }

  async remove<K extends CollectionName>(c: K, ids: string[]): Promise<void> {
    const drop = new Set(ids);
    this.write(c, this.read(c).filter((r) => !drop.has((r as { id: string }).id)));
  }
}

export function resetLocalData(): void {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(LOCAL_PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

export const backend: DataBackend = isSupabaseConfigured ? new SupabaseBackend() : new LocalBackend();
