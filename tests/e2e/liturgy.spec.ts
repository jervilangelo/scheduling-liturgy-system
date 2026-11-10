import { expect, test, type Page } from '@playwright/test';

// Keep tests offline and deterministic: the spreadsheet read fails, so the
// bundled SongList snapshot is used.
async function open(page: Page, date: string) {
  await page.route('https://docs.google.com/**', (r) => r.abort());
  await page.goto(`./?date=${date}`);
  await expect(page.getByTestId('service-date')).toBeVisible();
}

/** Every line's current text, to check what the document holds. */
const lineValues = (page: Page) => page.$$eval('input.line-input', (els) => els.map((e) => (e as HTMLInputElement).value));
const expectLine = (page: Page, text: string) => expect.poll(() => lineValues(page)).toContain(text);

test('first Sunday is Communion Sunday and the ECCM order includes Communion', async ({ page }) => {
  await open(page, '2026-12-06');
  await expect(page.getByTestId('special-tags')).toHaveText('Communion Sunday');
  await page.getByRole('button', { name: 'Use the ECCM order' }).click();
  await expectLine(page, `Communion Proper`);
  await expectLine(page, `Communion Song`);
});

test('second Sunday adds two songs after the team lines', async ({ page }) => {
  await open(page, '2026-12-13');
  await expect(page.getByTestId('special-tags')).toHaveText('Two added songs');
  await page.getByRole('button', { name: 'Use the ECCM order' }).click();
  await expect(page.locator('input[placeholder="Added song"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Text' }).click();
  await expect(page.getByLabel('Order of worship as text')).toHaveValue(/Music:\n\nCongregational Prayer and Praise:\n1\.\n2\.$/);
});

test('last Sunday uses the creed of the month and can be switched', async ({ page }) => {
  await open(page, '2026-12-27');
  await expect(page.getByTestId('special-tags')).toHaveText("Apostles' Creed");
  await page.getByRole('button', { name: 'Use the ECCM order' }).click();
  await expectLine(page, `Apostles' Creed`);
  await page.getByTestId('creed-select').selectOption('nicene');
  await expectLine(page, `Nicene Creed`);
  await expect(page.getByTestId('special-tags')).toHaveText('Nicene Creed');
});

test('songs come from the SongList and a plan saves with its team', async ({ page }) => {
  await open(page, '2026-12-20');
  await expect(page.getByTestId('songlist-status')).toContainText(/\d+ songs from the SongList spreadsheet/);
  await page.getByRole('button', { name: 'Use the ECCM order' }).click();
  await page.getByLabel('Search the SongList').fill('christian daily prayer');
  await page.getByTestId('song-results').getByRole('button', { name: /^Add / }).first().click();
  await expectLine(page, `A CHRISTIAN'S DAILY PRAYER`);
  await page.getByRole('textbox', { name: 'Service Leader' }).fill('Angelo');
  await page.getByTestId('save-liturgy').click();
  await expect(page.getByText('Saved version 1.')).toBeVisible();
  await page.reload();
  await expectLine(page, `A CHRISTIAN'S DAILY PRAYER`);
  await expect(page.getByRole('textbox', { name: 'Service Leader' })).toHaveValue('Angelo');
});

test('fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '2026-12-20');
  await page.getByRole('button', { name: 'Use the ECCM order' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
