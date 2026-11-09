/**
 * Shared domain model. Every ministry (worship today; kids, foundations,
 * events in future) uses the SAME volunteers, availability, role definitions,
 * services and assignments — there is one volunteer database, not one per
 * ministry. Ministry-specific behaviour lives in `ministryRules`.
 */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // full ISO timestamp

export type UserRole = 'admin' | 'approver' | 'planner' | 'viewer';
export const USER_ROLES: UserRole[] = ['admin', 'approver', 'planner', 'viewer'];

export type Permission =
  | 'view'
  | 'edit_liturgy'
  | 'edit_schedule'
  | 'manage_volunteers'
  | 'manage_songs'
  | 'submit_review'
  | 'approve'
  | 'publish'
  | 'manage_settings'
  | 'manage_users';

export const PERMISSIONS: { id: Permission; label: string }[] = [
  { id: 'view', label: 'View plans and schedules' },
  { id: 'edit_liturgy', label: 'Edit liturgy' },
  { id: 'edit_schedule', label: 'Edit ministry schedules' },
  { id: 'manage_volunteers', label: 'Manage volunteers' },
  { id: 'manage_songs', label: 'Manage song library' },
  { id: 'submit_review', label: 'Submit for review' },
  { id: 'approve', label: 'Approve services' },
  { id: 'publish', label: 'Publish and unpublish' },
  { id: 'manage_settings', label: 'Manage settings and templates' },
  { id: 'manage_users', label: 'Manage users and permissions' },
];

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface RolePermission {
  id: string; // `${role}:${permission}`
  role: UserRole;
  permission: Permission;
}

export interface Ministry {
  id: string;
  slug: string; // 'worship', future: 'kids', 'pasay-kids', 'foundations'
  name: string;
  description: string;
  defaultStart: string; // HH:MM
  defaultEnd: string; // HH:MM
  usesSpecialSundays: boolean;
  active: boolean;
}

export interface RoleDefinition {
  id: string;
  ministryId: string;
  name: string;
  /** People needed per service. */
  minCount: number;
  sortOrder: number;
  /** Roles in this list may be held by the same person in the same service. */
  compatibleRoleIds: string[];
  active: boolean;
}

export interface Volunteer {
  id: string;
  name: string;
  email: string;
  phone: string;
  ministryIds: string[];
  /** Role eligibility. */
  roleIds: string[];
  /** Soft cap; 0 = no cap. */
  maxPerMonth: number;
  active: boolean;
  notes: string;
}

export interface Availability {
  id: string;
  volunteerId: string;
  date: ISODate;
  /** Always an unavailability record. */
  note: string;
}

export type ServiceStatus = 'draft' | 'in_review' | 'approved' | 'published';

export type CreedKind = 'nicene' | 'apostles';

export interface Sermon {
  title: string;
  preacher: string;
  scripture: string;
  series: string;
  notes: string;
}

export type LiturgyItemKind =
  | 'call_to_worship'
  | 'song'
  | 'scripture'
  | 'prayer'
  | 'confession'
  | 'creed'
  | 'communion'
  | 'cpp'
  | 'offering'
  | 'announcements'
  | 'sermon'
  | 'benediction'
  | 'custom';

/**
 * One line of the order of worship, written as "Label: detail"
 * (e.g. "Call to Worship: Psalm 89:5"). A song with no label is a dash line
 * ("- Here Is Love"). `kind` is inferred from the label for rules and exports.
 */
export interface LiturgyItem {
  id: string;
  kind: LiturgyItemKind;
  /** The label, e.g. "Call to Worship". Empty for a plain song line. */
  title: string;
  /** Text after the colon: a song title, Scripture passage or other detail. */
  detail?: string;
  songId?: string | null;
  scripture?: string;
  leader?: string;
  durationMin?: number;
  notes?: string;
}

export interface Service {
  id: string;
  ministryId: string;
  date: ISODate;
  startTime: string;
  endTime: string;
  status: ServiceStatus;
  theme: string;
  sermon: Sermon;
  liturgy: LiturgyItem[];
  /** Manual override of the computed creed (null = follow the rotation). */
  creedOverride: CreedKind | null;
  notes: string;
  liturgyVersion: number;
  submittedBy: string | null;
  approvedBy: string | null;
  publishedAt: ISODateTime | null;
  updatedAt: ISODateTime;
}

export interface Assignment {
  id: string;
  serviceId: string;
  roleId: string;
  volunteerId: string;
  /** Manual override acknowledging a conflict. */
  overridden: boolean;
  overrideReason: string;
  createdAt: ISODateTime;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  themes: string[];
  songKey: string;
  lastSung: ISODate | null;
  /** 1-based row in the Google Sheet `SongList`, when imported from it. */
  sheetRow: number | null;
  notes: string;
}

export interface LiturgyTemplate {
  id: string;
  name: string;
  description: string;
  items: LiturgyItem[];
}

export interface LiturgyVersion {
  id: string;
  serviceId: string;
  version: number;
  items: LiturgyItem[];
  sermon: Sermon;
  theme: string;
  note: string;
  savedBy: string;
  savedAt: ISODateTime;
}

export interface AuditEntry {
  id: string;
  at: ISODateTime;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  details: string;
}

export interface AppSettings {
  id: 'global';
  churchName: string;
  /** Anchor for the monthly creed alternation. */
  creedAnchorYear: number;
  creedAnchorMonth: number; // 1-12
  creedAnchorKind: CreedKind;
  communionLabel: string;
  cppLabel: string;
  creedLabel: string;
  defaultTemplateId: string | null;
  sheetSpreadsheetId: string;
  sheetName: string; // 'SongList'
  sheetTitleHeader: string; // 'Title'
  sheetLastSungHeader: string; // 'Last Sung'
  sheetThemeHeader: string; // 'Theme'
  sheetArtistHeader: string;
  consecutiveWeeksWarning: number;
}

export interface CollectionMap {
  profiles: Profile;
  role_permissions: RolePermission;
  ministries: Ministry;
  role_definitions: RoleDefinition;
  volunteers: Volunteer;
  availability: Availability;
  services: Service;
  assignments: Assignment;
  songs: Song;
  liturgy_templates: LiturgyTemplate;
  liturgy_versions: LiturgyVersion;
  audit_log: AuditEntry;
  app_settings: AppSettings;
}

export type CollectionName = keyof CollectionMap;
