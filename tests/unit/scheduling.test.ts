import { describe, expect, it } from 'vitest';
import { checkCandidate, serviceConflicts, staffing, type SchedulingContext } from '../../src/modules/conflict-detection';
import { autoFill, suggestCandidates } from '../../src/modules/rotations';
import type { Assignment, Ministry, RoleDefinition, Service, Volunteer } from '../../src/types/domain';
import { blankService } from '../../src/services/api/store';

const worship: Ministry = { id: 'm-w', slug: 'worship', name: 'Sunday worship', description: '', defaultStart: '09:00', defaultEnd: '11:00', usesSpecialSundays: true, active: true };
const kids: Ministry = { id: 'm-k', slug: 'kids', name: 'Kids ministry', description: '', defaultStart: '09:30', defaultEnd: '10:30', usesSpecialSundays: false, active: true };
const foundations: Ministry = { id: 'm-f', slug: 'foundations', name: 'Foundations', description: '', defaultStart: '10:00', defaultEnd: '10:45', usesSpecialSundays: false, active: true };

const role = (id: string, ministryId: string, minCount = 1, compatibleRoleIds: string[] = []): RoleDefinition => ({ id, ministryId, name: id, minCount, sortOrder: 0, compatibleRoleIds, active: true });
const vol = (id: string, roleIds: string[], ministryIds = ['m-w'], extra: Partial<Volunteer> = {}): Volunteer => ({ id, name: id, email: '', phone: '', ministryIds, roleIds, maxPerMonth: 0, active: true, notes: '', ...extra });
const svc = (id: string, ministry: Ministry, date: string): Service => ({ ...blankService(ministry.id, date, ministry.defaultStart, ministry.defaultEnd), id });
let k = 0;
const asg = (serviceId: string, roleId: string, volunteerId: string, extra: Partial<Assignment> = {}): Assignment => ({ id: `a${++k}`, serviceId, roleId, volunteerId, overridden: false, overrideReason: '', createdAt: '', ...extra });

function ctx(over: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    services: [svc('s1', worship, '2026-11-15'), svc('k1', kids, '2026-11-15'), svc('f1', foundations, '2026-11-15'), svc('s0', worship, '2026-11-08'), svc('s-1', worship, '2026-11-01'), svc('s-2', worship, '2026-10-25')],
    assignments: [],
    volunteers: [vol('ana', ['lead', 'vox']), vol('ben', ['lead']), vol('cy', ['vox', 'teacher'], ['m-w', 'm-k'])],
    roles: [role('lead', 'm-w'), role('vox', 'm-w', 2), role('teacher', 'm-k'), role('host', 'm-f')],
    availability: [],
    ministries: [worship, kids, foundations],
    settings: { consecutiveWeeksWarning: 3 },
    ...over,
  };
}
const codes = (c: { code: string }[]) => c.map((x) => x.code).sort();

describe('conflict detection', () => {
  it('passes an eligible, available volunteer', () => {
    expect(checkCandidate(ctx(), 's1', 'lead', 'ben')).toEqual([]);
  });
  it('flags role ineligibility and inactive volunteers', () => {
    const c = ctx({ volunteers: [vol('ben', ['lead'], ['m-w'], { active: false })] });
    expect(codes(checkCandidate(c, 's1', 'vox', 'ben'))).toEqual(['inactive', 'not_eligible']);
  });
  it('flags unavailability', () => {
    const c = ctx({ availability: [{ id: 'x', volunteerId: 'ben', date: '2026-11-15', note: 'away' }] });
    const r = checkCandidate(c, 's1', 'lead', 'ben');
    expect(r[0].code).toBe('unavailable');
    expect(r[0].severity).toBe('error');
  });
  it('blocks two incompatible roles in one service but allows compatible ones', () => {
    const c = ctx({ assignments: [asg('s1', 'vox', 'ana')] });
    expect(codes(checkCandidate(c, 's1', 'lead', 'ana'))).toEqual(['same_service']);
    const c2 = ctx({ assignments: [asg('s1', 'vox', 'ana')], roles: [role('lead', 'm-w', 1, ['vox']), role('vox', 'm-w', 2), role('teacher', 'm-k')] });
    expect(checkCandidate(c2, 's1', 'lead', 'ana')).toEqual([]);
  });
  it('detects overlapping services across ministries (kids teacher vs worship)', () => {
    const c = ctx({ assignments: [asg('k1', 'teacher', 'cy')] });
    const r = checkCandidate(c, 's1', 'vox', 'cy');
    expect(r).toHaveLength(1);
    expect(r[0].code).toBe('overlapping_service');
    expect(r[0].severity).toBe('error');
    expect(r[0].message).toMatch(/Kids ministry/);
  });
  it('uses a warning when both ministries allow overlaps', () => {
    const c = ctx({
      volunteers: [vol('dee', ['host', 'teacher'], ['m-f', 'm-k'])],
      services: [svc('f1', foundations, '2026-11-15'), { ...svc('f2', foundations, '2026-11-15'), startTime: '10:30', endTime: '11:00' }],
      assignments: [asg('f1', 'host', 'dee')],
    });
    const r = checkCandidate(c, 'f2', 'host', 'dee');
    expect(r.find((x) => x.code === 'overlapping_service')?.severity).toBe('warning');
  });
  it('does not flag non-overlapping times on the same day', () => {
    const late = { ...svc('k2', kids, '2026-11-15'), startTime: '11:00', endTime: '12:00' };
    const c = ctx({ services: [...ctx().services, late], assignments: [asg('k2', 'teacher', 'cy')] });
    expect(checkCandidate(c, 's1', 'vox', 'cy')).toEqual([]);
  });
  it('warns over the monthly cap', () => {
    const c = ctx({ volunteers: [vol('ben', ['lead'], ['m-w'], { maxPerMonth: 1 })], assignments: [asg('s0', 'lead', 'ben')] });
    expect(codes(checkCandidate(c, 's1', 'lead', 'ben'))).toEqual(['over_monthly_cap']);
  });
  it('warns on too many consecutive weeks in one role', () => {
    const c = ctx({ assignments: [asg('s0', 'lead', 'ben'), asg('s-1', 'lead', 'ben'), asg('s-2', 'lead', 'ben')] });
    const r = checkCandidate(c, 's1', 'lead', 'ben');
    expect(r.map((x) => x.code)).toContain('consecutive_weeks');
  });
  it('reports understaffed roles and staffing totals; overrides are marked', () => {
    const c = ctx({ availability: [{ id: 'x', volunteerId: 'ana', date: '2026-11-15', note: '' }], assignments: [asg('s1', 'vox', 'ana', { overridden: true, overrideReason: 'ok' })] });
    const all = serviceConflicts(c, 's1');
    expect(all.filter((x) => x.code === 'understaffed').map((x) => x.roleId).sort()).toEqual(['lead', 'vox']);
    expect(all.find((x) => x.code === 'unavailable')?.overridden).toBe(true);
    expect(staffing(c, c.services[0])).toEqual({ needed: 3, filled: 1, missing: 2 });
  });
});

describe('rotation', () => {
  it('ranks whoever waited longest in the role first and conflicts last', () => {
    const c = ctx({ assignments: [asg('s0', 'lead', 'ana')], availability: [] });
    const s = suggestCandidates(c, 's1', 'lead');
    expect(s.map((x) => x.volunteer.id)).toEqual(['ben', 'ana']);
    const blocked = ctx({ availability: [{ id: 'x', volunteerId: 'ben', date: '2026-11-15', note: '' }] });
    expect(suggestCandidates(blocked, 's1', 'lead').at(-1)!.volunteer.id).toBe('ben');
  });
  it('auto-fills only with conflict-free volunteers and never double-books', () => {
    const c = ctx();
    let i = 0;
    const out = autoFill(c, 's1', () => `n${++i}`, 'now');
    const byVol = new Map<string, number>();
    out.forEach((a) => byVol.set(a.volunteerId, (byVol.get(a.volunteerId) ?? 0) + 1));
    expect([...byVol.values()].every((n) => n === 1)).toBe(true);
    // lead + 2 vocals needed; ana, ben, cy can cover it
    expect(out).toHaveLength(3);
  });
});
