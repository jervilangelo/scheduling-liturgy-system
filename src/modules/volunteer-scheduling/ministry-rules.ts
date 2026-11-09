import type { Ministry } from '../../types/domain';

/**
 * Ministry-specific scheduling rules on top of the shared engine.
 * A future ministry (kids, pasay-kids, foundations, events) registers its
 * rules here; it reuses the same volunteers, roles, availability and
 * conflict detection, so a kids teacher on an overlapping session is caught
 * against worship assignments automatically.
 */
export interface MinistryRules {
  /** How to treat a volunteer booked in an overlapping service of another ministry. */
  overlapPolicy: 'block' | 'warn';
  /** Whether special Sundays (communion / CPP / creed) apply. */
  specialSundays: boolean;
  /** Whether a liturgy (order of worship) is planned for this ministry's services. */
  hasLiturgy: boolean;
}

const DEFAULT_RULES: MinistryRules = { overlapPolicy: 'block', specialSundays: false, hasLiturgy: false };

const REGISTRY: Record<string, Partial<MinistryRules>> = {
  worship: { overlapPolicy: 'block', specialSundays: true, hasLiturgy: true },
  kids: { overlapPolicy: 'block' },
  'pasay-kids': { overlapPolicy: 'block' },
  foundations: { overlapPolicy: 'warn' },
  events: { overlapPolicy: 'warn' },
};

export function rulesFor(ministry: Pick<Ministry, 'slug' | 'usesSpecialSundays'> | undefined): MinistryRules {
  if (!ministry) return DEFAULT_RULES;
  const r = { ...DEFAULT_RULES, ...(REGISTRY[ministry.slug] ?? {}) };
  r.specialSundays = ministry.usesSpecialSundays;
  return r;
}
