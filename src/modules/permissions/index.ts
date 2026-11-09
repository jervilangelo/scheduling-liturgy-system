import type { Permission, RolePermission, UserRole } from '../../types/domain';
import { PERMISSIONS } from '../../types/domain';

/** Default role → permission matrix. Admins can change it in Settings. */
export const DEFAULT_MATRIX: Record<UserRole, Permission[]> = {
  admin: PERMISSIONS.map((p) => p.id),
  approver: ['view', 'edit_liturgy', 'edit_schedule', 'submit_review', 'approve', 'publish'],
  planner: ['view', 'edit_liturgy', 'edit_schedule', 'manage_volunteers', 'manage_songs', 'submit_review'],
  viewer: ['view'],
};

export function defaultRolePermissions(): RolePermission[] {
  return (Object.keys(DEFAULT_MATRIX) as UserRole[]).flatMap((role) =>
    DEFAULT_MATRIX[role].map((permission) => ({ id: `${role}:${permission}`, role, permission })),
  );
}

export function permissionsFor(role: UserRole, rows: RolePermission[]): Set<Permission> {
  // Admins always keep user management, so the matrix can never lock everyone out.
  const set = new Set(rows.filter((r) => r.role === role).map((r) => r.permission));
  if (role === 'admin') { set.add('manage_users'); set.add('manage_settings'); set.add('view'); }
  return set;
}

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Administrator',
  approver: 'Pastor / approver',
  planner: 'Planner',
  viewer: 'Viewer',
};
