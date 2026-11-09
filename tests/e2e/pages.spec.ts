import { expect, test } from '@playwright/test';
import { login, PAGES, watchErrors } from './helpers';

test.describe('multi-page architecture', () => {
  test('signed-out visitors are sent to login and returned to the page they asked for', async ({ page }) => {
    await page.goto('scheduling.html?date=2026-12-06');
    await expect(page).toHaveURL(/login\.html\?next=scheduling\.html/);
    await page.getByTestId('demo-planner').click();
    await expect(page).toHaveURL(/scheduling\.html\?date=2026-12-06/);
    await expect(page.locator('h1')).toHaveText('Ministry scheduling');
  });

  for (const p of PAGES) {
    test(`${p.file} loads directly, refreshes, and has no errors`, async ({ page }) => {
      const errors = watchErrors(page);
      await login(page);
      await page.goto(p.file);
      await expect(page.locator('h1.page-title')).toHaveText(p.title);
      await page.reload();
      await expect(page.locator('h1.page-title')).toHaveText(p.title);
      // Shared shell on every page, with the current page marked
      await expect(page.locator('.sidebar .nav-link[aria-current="page"]')).toHaveCount(1);
      // Stylesheet actually applied (CSS path correct under the base path)
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe('rgb(244, 243, 241)');
      expect(errors).toEqual([]);
    });
  }

  test('sidebar links navigate between physical pages and the session persists', async ({ page }) => {
    await login(page);
    for (const p of PAGES.slice(1)) {
      await page.locator('.sidebar').getByRole('link', { name: new RegExp(`^${p.title.split(' ')[0]}`) }).first().click();
      await expect(page).toHaveURL(new RegExp(`${p.file.replace('.', '\\.')}`));
      await expect(page.locator('h1.page-title')).toHaveText(p.title);
    }
  });

  test('sign out clears the session on every page', async ({ page }) => {
    await login(page);
    await page.getByTestId('sign-out').first().click();
    await expect(page).toHaveURL(/login\.html/);
    await page.goto('calendar.html');
    await expect(page).toHaveURL(/login\.html/);
  });

  test('no privileged secrets are shipped in the HTML', async ({ page }) => {
    for (const p of [...PAGES.map((x) => x.file), 'login.html']) {
      const res = await page.request.get(p);
      const body = await res.text();
      expect(res.status()).toBe(200);
      expect(body).not.toMatch(/service_role|PRIVATE KEY|GOOGLE_SERVICE_ACCOUNT/);
    }
  });
});
