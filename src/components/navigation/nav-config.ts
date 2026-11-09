import type { Permission } from '../../types/domain';
import type { IconName } from '../shared/icons';

/**
 * The single registry of physical pages. To add a future module
 * (e.g. kids-ministry.html), create the HTML file + src/pages/<id>.ts and
 * add one entry here; the sidebar, permissions and build pick it up.
 */
export interface NavItem {
  id: string;
  href: string; // relative, so it works under any base path
  label: string;
  icon: IconName;
  group: 'plan' | 'people' | 'records' | 'admin';
  permission: Permission;
}

export const NAV: NavItem[] = [
  { id: 'dashboard', href: 'index.html', label: 'Dashboard', icon: 'dashboard', group: 'plan', permission: 'view' },
  { id: 'calendar', href: 'calendar.html', label: 'Calendar', icon: 'calendar', group: 'plan', permission: 'view' },
  { id: 'liturgy', href: 'liturgy.html', label: 'Liturgy planning', icon: 'liturgy', group: 'plan', permission: 'view' },
  { id: 'scheduling', href: 'scheduling.html', label: 'Ministry scheduling', icon: 'scheduling', group: 'plan', permission: 'view' },
  { id: 'volunteers', href: 'volunteers.html', label: 'Volunteers', icon: 'volunteers', group: 'people', permission: 'view' },
  { id: 'songs', href: 'songs.html', label: 'Song library', icon: 'songs', group: 'people', permission: 'view' },
  { id: 'published', href: 'published.html', label: 'Published', icon: 'published', group: 'records', permission: 'view' },
  { id: 'history', href: 'history.html', label: 'History', icon: 'history', group: 'records', permission: 'view' },
  { id: 'settings', href: 'settings.html', label: 'Settings', icon: 'settings', group: 'admin', permission: 'view' },
];

export const GROUP_LABEL: Record<NavItem['group'], string> = {
  plan: 'Plan',
  people: 'People and music',
  records: 'Records',
  admin: '',
};
