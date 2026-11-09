import { h } from '../../utils/dom';
import { icon, mark } from '../shared/icons';
import { GROUP_LABEL, NAV, type NavItem } from './nav-config';
import type { Session } from '../../services/authentication/auth';
import { signOut } from '../../services/authentication/auth';
import { ROLE_LABEL } from '../../modules/permissions';
import { dataMode } from '../../services/api/store';
import { avatar } from '../shared/ui';

/**
 * Shared application shell: labelled sidebar on the page ground (desktop),
 * folding to a 48px top bar with a full-screen menu sheet on phones.
 */
export function mountShell(activeId: string, session: Session, churchName: string, badges: Record<string, number> = {}): HTMLElement {
  const main = h('main', { id: 'main', class: 'canvas', tabindex: '-1' });
  const active = NAV.find((n) => n.id === activeId);

  const navList = (onNavigate?: () => void) => {
    const groups = (['plan', 'people', 'records'] as const).map((g) => {
      const items = NAV.filter((n) => n.group === g && session.can(n.permission));
      if (!items.length) return null;
      return h('div', { class: 'nav-group' },
        h('p', { class: 'nav-group-label' }, GROUP_LABEL[g]),
        h('ul', { class: 'nav-list' }, items.map((n) => navLink(n, n.id === activeId, badges[n.id], onNavigate))),
      );
    });
    return h('nav', { class: 'nav', 'aria-label': 'Main' }, ...groups);
  };

  const footer = () => h('div', { class: 'side-foot' },
    h('ul', { class: 'nav-list' }, NAV.filter((n) => n.group === 'admin' && session.can(n.permission)).map((n) => navLink(n, n.id === activeId))),
    dataMode === 'local'
      ? h('p', { class: 'mode-note' }, 'Demo mode. Data is stored in this browser only.')
      : null,
    h('div', { class: 'user-row' },
      avatar(session.profile.displayName, session.profile.id),
      h('div', { class: 'user-meta' },
        h('span', { class: 'user-name' }, session.profile.displayName),
        h('span', { class: 'user-role' }, ROLE_LABEL[session.profile.role]),
      ),
      h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': 'Sign out', title: 'Sign out', 'data-testid': 'sign-out',
        onclick: async () => { await signOut(); location.href = 'login.html'; },
      }, icon('logout')),
    ),
  );

  const brand = () => h('a', { href: 'index.html', class: 'brand' },
    mark(28),
    h('span', { class: 'brand-text' },
      h('span', { class: 'brand-name' }, churchName),
      h('span', { class: 'brand-scope' }, 'Liturgy and ministry planning'),
    ),
  );

  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Sidebar' }, brand(), navList(), footer());

  // Phone: top bar + sheet
  const sheet = h('div', { class: 'sheet', id: 'nav-sheet', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu' });
  const closeSheet = () => { sheet.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.focus(); };
  const sheetClose = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close menu', onclick: closeSheet }, icon('x'));
  sheet.append(h('div', { class: 'sheet-head' }, brand(), sheetClose), navList(closeSheet), footer());
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  const menuBtn = h('button', {
    type: 'button', class: 'icon-btn', 'aria-label': 'Open menu', 'aria-expanded': 'false', 'aria-controls': 'nav-sheet',
    onclick: () => { sheet.hidden = false; menuBtn.setAttribute('aria-expanded', 'true'); sheetClose.focus(); },
  }, icon('menu'));
  const topbar = h('header', { class: 'topbar' }, menuBtn, h('span', { class: 'topbar-title' }, active?.label ?? churchName), h('span', { class: 'topbar-mark' }, mark(24)));

  const skip = h('a', { href: '#main', class: 'skip-link' }, 'Skip to content');
  const app = document.getElementById('app')!;
  app.className = 'shell';
  app.replaceChildren(skip, sidebar, topbar, sheet, main);
  return main;
}

function navLink(n: NavItem, isActive: boolean, badge?: number, onNavigate?: () => void): HTMLElement {
  return h('li', null,
    h('a', {
      href: n.href,
      class: `nav-link${isActive ? ' is-active' : ''}`,
      'aria-current': isActive ? 'page' : undefined,
      onclick: onNavigate,
    },
    icon(n.icon),
    h('span', { class: 'nav-label' }, n.label),
    badge ? h('span', { class: 'nav-count', 'aria-label': `${badge} need attention` }, String(badge)) : null,
    ),
  );
}
