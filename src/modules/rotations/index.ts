import type { Assignment, Volunteer } from '../../types/domain';
import { addDays, daysBetween } from '../../utils/dates';
import { checkCandidate, type Conflict, type SchedulingContext } from '../conflict-detection';

export interface Suggestion {
  volunteer: Volunteer;
  score: number;
  conflicts: Conflict[];
  lastInRole: string | null;
  recentCount: number;
  reason: string;
}

const RECENT_WINDOW_DAYS = 56;

/**
 * Fair-rotation ranking for one role in one service. Eligible, available
 * people who have waited longest in this role and served least recently rank
 * highest; anyone with a blocking conflict sorts to the bottom.
 */
export function suggestCandidates(ctx: SchedulingContext, serviceId: string, roleId: string, limit = 8): Suggestion[] {
  const service = ctx.services.find((s) => s.id === serviceId);
  if (!service) return [];
  const serviceDate = new Map(ctx.services.map((s) => [s.id, s.date]));
  const already = new Set(ctx.assignments.filter((a) => a.serviceId === serviceId && a.roleId === roleId).map((a) => a.volunteerId));

  const out: Suggestion[] = [];
  for (const v of ctx.volunteers) {
    if (!v.roleIds.includes(roleId) || already.has(v.id)) continue;
    const conflicts = checkCandidate(ctx, serviceId, roleId, v.id);
    const past = ctx.assignments
      .filter((a) => a.volunteerId === v.id)
      .map((a) => ({ a, date: serviceDate.get(a.serviceId) }))
      .filter((x): x is { a: Assignment; date: string } => !!x.date && x.date < service.date);
    const inRole = past.filter((x) => x.a.roleId === roleId).map((x) => x.date).sort();
    const lastInRole = inRole.length ? inRole[inRole.length - 1] : null;
    const windowStart = addDays(service.date, -RECENT_WINDOW_DAYS);
    const recentCount = past.filter((x) => x.date >= windowStart).length;

    const wait = lastInRole ? Math.min(daysBetween(lastInRole, service.date), 365) : 400;
    const errors = conflicts.filter((c) => c.severity === 'error').length;
    const warnings = conflicts.length - errors;
    const score = wait - recentCount * 20 - warnings * 50 - errors * 10_000;

    const reason = errors
      ? conflicts.find((c) => c.severity === 'error')!.message
      : lastInRole
        ? `Last served in this role ${daysBetween(lastInRole, service.date)} days earlier; ${recentCount} services in the past 8 weeks.`
        : `Has not served in this role yet; ${recentCount} services in the past 8 weeks.`;

    out.push({ volunteer: v, score, conflicts, lastInRole, recentCount, reason });
  }
  return out.sort((a, b) => b.score - a.score || a.volunteer.name.localeCompare(b.volunteer.name)).slice(0, limit);
}

/**
 * Proposes assignments for every unfilled slot in a service, picking the
 * best conflict-free candidate per slot. Returns the proposals; nothing is saved.
 */
export function autoFill(ctx: SchedulingContext, serviceId: string, makeId: () => string, now: string): Assignment[] {
  const service = ctx.services.find((s) => s.id === serviceId);
  if (!service) return [];
  const working: SchedulingContext = { ...ctx, assignments: [...ctx.assignments] };
  const proposals: Assignment[] = [];
  // Fill the scarcest roles first (fewest eligible people beyond those needed),
  // so versatile volunteers are not used up on roles anyone could fill.
  const slack = (roleId: string, need: number) => ctx.volunteers.filter((v) => v.active && v.roleIds.includes(roleId)).length - need;
  const roles = ctx.roles
    .filter((r) => r.ministryId === service.ministryId && r.active)
    .sort((a, b) => slack(a.id, a.minCount) - slack(b.id, b.minCount) || a.sortOrder - b.sortOrder);
  for (const role of roles) {
    let have = working.assignments.filter((a) => a.serviceId === serviceId && a.roleId === role.id).length;
    while (have < role.minCount) {
      const best = suggestCandidates(working, serviceId, role.id, 50).find((s) => !s.conflicts.some((c) => c.severity === 'error'));
      if (!best) break;
      const a: Assignment = {
        id: makeId(),
        serviceId,
        roleId: role.id,
        volunteerId: best.volunteer.id,
        overridden: false,
        overrideReason: '',
        createdAt: now,
      };
      proposals.push(a);
      working.assignments.push(a);
      have++;
    }
  }
  return proposals;
}
