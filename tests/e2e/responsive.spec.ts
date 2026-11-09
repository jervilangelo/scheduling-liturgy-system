import { expect, test } from '@playwright/test';
import { login, PAGES } from './helpers';

test('phone: menu sheet replaces the sidebar and no page scrolls sideways', async ({ page }) => {
  await login(page, 'admin');
  for (const p of PAGES) {
    await page.goto(p.file);
    await expect(page.locator('h1.page-title')).toHaveText(p.title);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, p.file).toBeLessThanOrEqual(0);
  }
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Volunteers' }).click();
  await expect(page).toHaveURL(/volunteers\.html/);
});
