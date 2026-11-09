import type {
  AppSettings,
  Assignment,
  Availability,
  Ministry,
  RoleDefinition,
  Service,
  Volunteer,
} from '../../types/domain';
import { addDays, monthKey, timesOverlap } from '../../utils/dates';
import { rulesFor } from '../volunteer-scheduling/ministry-rules';

export interface SchedulingContext {
  services: Service[];
  assignments: Assignment[];
  volunteers: Volunteer[];
  roles: RoleDefinition[];
  availability: Availability[];
  ministries: Ministry[];
  settings: Pick<AppSettings, 'consecutiveWeeksWarning'>;
}

export type ConflictCode =
  | 'not_eligible'
  | 'inactive'
  | 'unavailable'
  | 'same_service'
  | 'overlapping_service'
  | 'over_monthly_cap'
  | 'consecutive_weeks'
  | 'not_in_ministry'
  | 'understaffed'
  | 'overstaffed';

export type Severity = 'error' | 'warning';

export interface Conflict {
  code: ConflictCode;
  severity: Severity;
  message: string;
  serviceId: string;
  roleId?: string;
  volunteerId?: string;
  assignmentId?: string;
  /** True when a manual override on the assignment acknowledges this conflict. */
  overridden?: boolean;
}

interface Indexes {
  serviceById: Map<string, Service>;
  volunteerById: Map<string, Volunteer>;
  roleById: Map<string, RoleDefinition>;
  ministryById: Map<string, Ministry>;
}

function index(ctx: SchedulingContext): Indexes {
  return {
    serviceById: new Map(ctx.services.map((s) => [s.id, s])),
    volunteerById: new Map(ctx.volunteers.map((v) => [v.id, v])),
    roleById: new Map(ctx.roles.map((r) => [r.id, r])),
    ministryById: new Map(ctx.ministries.map((m) => [m.id, m])),
  };
}

/**
 * Conflicts that WOULD exist if `volunteerId` held `roleId` in `serviceId`.
 * `ignoreAssignmentId` excludes the assignment under evaluation itself.
 */
export function checkCandidate(
  ctx: SchedulingContext,
  serviceId: string,
  roleId: string,
  volunteerId: string,
  ignoreAssignmentId?: string,
  idx: Indexes = index(ctx),
): Conflict[] {
  const out: Conflict[] = [];
  const service = idx.serviceById.get(serviceId);
  const vol = idx.volunteerById.get(volunteerId);
  const role = idx.roleById.get(roleId);
  if (!service || !vol || !role) return out;
  const base = { serviceId, roleId, volunteerId };
  const others = ctx.assignments.filter((a) => a.id !== ignoreAssignmentId && a.volunteerId === volunteerId);

  if (!vol.active) out.push({ ...base, code: 'inactive', severity: 'error', message: `${vol.name} is marked inactive.` });

  if (!vol.roleIds.includes(roleId)) {
    out.push({ ...base, code: 'not_eligible', severity: 'error', message: `${vol.name} is not eligible for ${role.name}.` });
  }

  if (!vol.ministryIds.includes(service.ministryId)) {
    const m = idx.ministryById.get(service.ministryId);
    out.push({ ...base, code: 'not_in_ministry', severity: 'warning', message: `${vol.name} is not a member of ${m?.name ?? 'this ministry'}.` });
  }

  const away = ctx.availability.find((a) => a.volunteerId === volunteerId && a.date === service.date);
  if (away) {
    out.push({ ...base, code: 'unavailable', severity: 'error', message: `${vol.name} is unavailable on this date${away.note ? ` (${away.note})` : ''}.` });
  }

  // Same service, different role
  for (const a of others.filter((x) => x.serviceId === serviceId)) {
    const otherRole = idx.roleById.get(a.roleId);
    if (!otherRole) continue;
    if (a.roleId === roleId) {
      out.push({ ...base, code: 'same_service', severity: 'error', message: `${vol.name} is already assigned to ${role.name} in this service.` });
      continue;
    }
    const compatible = role.compatibleRoleIds.includes(a.roleId) || otherRole.compatibleRoleIds.includes(roleId);
    if (!compatible) {
      out.push({ ...base, code: 'same_service', severity: 'error', message: `${vol.name} is also serving as ${otherRole.name} in this service.` });
    }
  }

  // Overlapping services across ministries (shared engine)
  for (const a of others) {
    if (a.serviceId === serviceId) continue;
    const other = idx.serviceById.get(a.serviceId);
    if (!other || other.date !== service.date) continue;
    if (!timesOverlap(service.startTime, service.endTime, other.startTime, other.endTime)) continue;
    const otherMinistry = idx.ministryById.get(other.ministryId);
    const policy = rulesFor(idx.ministryById.get(service.ministryId)).overlapPolicy === 'block' || rulesFor(otherMinistry).overlapPolicy === 'block' ? 'error' : 'warning';
    const otherRole = idx.roleById.get(a.roleId);
    out.push({
      ...base,
      code: 'overlapping_service',
      severity: policy,
      message: `${vol.name} is serving as ${otherRole?.name ?? 'a volunteer'} in ${otherMinistry?.name ?? 'another ministry'} (${other.startTime}–${other.endTime}) at the same time.`,
    });
  }

  // Monthly cap
  if (vol.maxPerMonth > 0) {
    const month = monthKey(service.date);
    const servicesThisMonth = new Set(
      others
        .map((a) => idx.serviceById.get(a.serviceId))
        .filter((s): s is Service => !!s && monthKey(s.date) === month && s.id !== serviceId)
        .map((s) => s.id),
    );
    if (servicesThisMonth.size + 1 > vol.maxPerMonth) {
      out.push({ ...base, code: 'over_monthly_cap', severity: 'warning', message: `${vol.name} would serve ${servicesThisMonth.size + 1} times this month (limit ${vol.maxPerMonth}).` });
    }
  }

  // Consecutive weeks in the same role
  const limit = ctx.settings.consecutiveWeeksWarning;
  if (limit > 0) {
    const datesInRole = new Set(
      others
        .filter((a) => a.roleId === roleId)
        .map((a) => idx.serviceById.get(a.serviceId)?.date)
        .filter((d): d is string => !!d),
    );
    let run = 1;
    let d = addDays(service.date, -7);
    while (datesInRole.has(d)) { run++; d = addDays(d, -7); }
    d = addDays(service.date, 7);
    while (datesInRole.has(d)) { run++; d = addDays(d, 7); }
    if (run > limit) {
      out.push({ ...base, code: 'consecutive_weeks', severity: 'warning', message: `${vol.name} would serve as ${role.name} ${run} weeks in a row.` });
    }
  }

  return out;
}

/** All conflicts for one service: per-assignment conflicts plus staffing gaps. */
export function serviceConflicts(ctx: SchedulingContext, serviceId: string): Conflict[] {
  const idx = index(ctx);
  const service = idx.serviceById.get(serviceId);
  if (!service) return [];
  const out: Conflict[] = [];
  const mine = ctx.assignments.filter((a) => a.serviceId === serviceId);
  for (const a of mine) {
    for (const c of checkCandidate(ctx, serviceId, a.roleId, a.volunteerId, a.id, idx)) {
      out.push({ ...c, assignmentId: a.id, overridden: a.overridden });
    }
  }
  const roles = ctx.roles.filter((r) => r.ministryId === service.ministryId && r.active);
  for (const r of roles) {
    const n = mine.filter((a) => a.roleId === r.id).length;
    if (n < r.minCount) {
      out.push({ code: 'understaffed', severity: 'warning', serviceId, roleId: r.id, message: `${r.name}: ${n} of ${r.minCount} assigned.` });
    }
  }
  return out;
}

/** Conflicts that still need attention (not acknowledged by an override). */
export function openConflicts(conflicts: Conflict[]): Conflict[] {
  return conflicts.filter((c) => !c.overridden);
}

export function hasBlockingConflicts(conflicts: Conflict[]): boolean {
  return conflicts.some((c) => c.severity === 'error' && !c.overridden);
}

export interface StaffingSummary {
  needed: number;
  filled: number;
  missing: number;
}

export function staffing(ctx: SchedulingContext, service: Service): StaffingSummary {
  const roles = ctx.roles.filter((r) => r.ministryId === service.ministryId && r.active);
  let needed = 0;
  let filled = 0;
  for (const r of roles) {
    const n = ctx.assignments.filter((a) => a.serviceId === service.id && a.roleId === r.id).length;
    needed += r.minCount;
    filled += Math.min(n, r.minCount);
  }
  return { needed, filled, missing: needed - filled };
}
