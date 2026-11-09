import { expect, type Page } from '@playwright/test';

export const PAGES = [
  { file: 'index.html', title: 'Dashboard' },
  { file: 'calendar.html', title: 'Calendar' },
  { file: 'liturgy.html', title: 'Liturgy planning' },
  { file: 'scheduling.html', title: 'Ministry scheduling' },
  { file: 'volunteers.html', title: 'Volunteers' },
  { file: 'songs.html', title: 'Song library' },
  { file: 'history.html', title: 'History' },
  { file: 'published.html', title: 'Published schedules' },
  { file: 'settings.html', title: 'Settings' },
] as const;

export type DemoRole = 'admin' | 'approver' | 'planner' | 'viewer';

/** Signs in with a demo account and lands on the dashboard (fresh demo data per test context). */
export async function login(page: Page, role: DemoRole = 'admin'): Promise<void> {
  await page.goto('login.html');
  await page.getByTestId(`demo-${role}`).click();
  await expect(page).toHaveURL(/index\.html$/);
  await expect(page.locator('h1.page-title')).toHaveText('Dashboard');
}

/** Collects console errors and failed requests for the page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('fonts.g')) errors.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('localhost')) errors.push(`${r.status()} ${r.url()}`); });
  return errors;
}

/** Sunday dates relative to today, matching the app's own calculation. */
export function sundays(): { next: string; following: string; firstOfNextMonth: string } {
  const d = new Date();
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const n = new Date(d);
  while (n.getDay() !== 0) n.setDate(n.getDate() + 1);
  const f = new Date(n);
  f.setDate(f.getDate() + 7);
  const m = new Date(n.getFullYear(), n.getMonth() + 2, 1);
  while (m.getDay() !== 0) m.setDate(m.getDate() + 1);
  return { next: iso(n), following: iso(f), firstOfNextMonth: iso(m) };
}
