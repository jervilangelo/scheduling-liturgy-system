import { expect, test } from '@playwright/test';
import { login, sundays } from './helpers';

test.describe('liturgy planning', () => {
  test('starts a plan from a template, adds special elements, reorders, saves a version', async ({ page }) => {
    const { firstOfNextMonth } = sundays();
    await login(page, 'planner');
    await page.goto(`liturgy.html?date=${firstOfNextMonth}`);
    await expect(page.getByTestId('service-date')).toContainText('Sunday worship');
    await expect(page.locator('.pill', { hasText: 'Holy Communion' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Standard Sunday' }).first().click();
    const order = page.getByTestId('order');
    await expect(order.locator('li[data-kind="communion"]')).toHaveCount(1);

    // Reorder with the keyboard-accessible buttons
    const firstTitle = await order.locator('li').nth(0).locator('select').inputValue();
    await page.getByRole('button', { name: 'Move element 1 down' }).click();
    expect(await order.locator('li').nth(1).locator('select').inputValue()).toBe(firstTitle);

    // Choose a song by searching
    await order.getByRole('button', { name: /song: none chosen/ }).first().click();
    await page.getByRole('searchbox', { name: 'Search songs' }).fill('fortress');
    await page.getByRole('row', { name: /A Mighty Fortress/ }).getByRole('button', { name: 'Choose' }).click();
    await expect(order).toContainText('A Mighty Fortress Is Our God');

    await page.getByLabel('Sermon title').fill('Bread of life');
    await page.getByLabel('Version note').fill('First draft');
    await page.getByTestId('save-liturgy').click();
    await expect(page.getByTestId('versions')).toContainText('Version 1 (current)');
    await expect(page.getByTestId('versions')).toContainText('First draft');

    // Persisted across a reload (another page load)
    await page.reload();
    await expect(page.getByLabel('Sermon title')).toHaveValue('Bread of life');
  });

  test('viewers see plans read-only', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto('liturgy.html');
    await expect(page.getByText('Editing needs the planner role')).toBeVisible();
    await expect(page.getByTestId('save-liturgy')).toHaveCount(0);
  });
});

test.describe('scheduling', () => {
  test('assigns by rotation, detects an availability conflict, overrides with a reason', async ({ page }) => {
    const { following } = sundays();
    await login(page, 'planner');
    await page.goto(`scheduling.html?date=${following}`);
    // Seed marks Mark Dela Rosa (keyboard) unavailable on this Sunday
    await page.getByTestId('assign-role-keys').click();
    const cands = page.getByTestId('candidates');
    await expect(cands.locator('.cand').first()).toContainText('Bea Mendoza');
    await expect(cands.locator('.cand', { hasText: 'Mark Dela Rosa' })).toContainText('unavailable');

    await cands.locator('.cand', { hasText: 'Mark Dela Rosa' }).getByRole('button', { name: 'Assign anyway' }).click();
    await page.getByRole('button', { name: 'Override', exact: true }).click();
    await expect(page.getByText('A reason is required')).toBeVisible();
    await page.getByLabel('Reason for the override').fill('Back early, confirmed by phone');
    await page.getByRole('button', { name: 'Override', exact: true }).click();

    const slot = page.locator('[data-role="role-keys"] [data-testid="slot"]');
    await expect(slot).toContainText('Mark Dela Rosa');
    await expect(slot).toContainText('Override');
    await expect(page.getByTestId('conflicts')).toContainText('Overridden: Back early');
  });

  test('suggests a full conflict-free team', async ({ page }) => {
    const { following } = sundays();
    await login(page, 'planner');
    await page.goto(`scheduling.html?date=${following}`);
    await page.getByRole('button', { name: 'Suggest a full team' }).click();
    await page.getByRole('button', { name: 'Assign all' }).click();
    await expect(page.getByText(/roles filled by rotation/)).toBeVisible();
    await expect(page.locator('.slot.has-error')).toHaveCount(0);
    await expect(page.getByText('13 of 13 roles filled')).toBeVisible();
  });
});

test.describe('review and publishing', () => {
  test('approver approves and publishes; the schedule is read-only, exportable and audited', async ({ page }) => {
    const { next } = sundays();
    await login(page, 'approver');
    await page.goto(`liturgy.html?date=${next}`);
    const wf = page.getByTestId('workflow');
    await wf.getByRole('button', { name: 'Approve' }).click();
    await expect(wf.getByText('Approved')).toBeVisible();
    await wf.getByRole('button', { name: 'Publish' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
    await expect(wf.getByText('Published')).toBeVisible();
    await expect(page.getByText('published and read-only')).toBeVisible();

    await page.goto(`published.html?date=${next}`);
    const doc = page.getByTestId('published-service');
    await expect(doc).toHaveCount(1);
    await expect(doc).toContainText('Order of worship');
    const download = page.waitForEvent('download');
    await doc.getByRole('button', { name: 'Excel' }).click();
    expect((await download).suggestedFilename()).toBe(`eccm-${next}.xlsx`);

    await page.goto('history.html?tab=audit');
    await expect(page.getByTestId('audit')).toContainText('publish');
  });

  test('planner can submit but cannot approve', async ({ page }) => {
    const { following } = sundays();
    await login(page, 'planner');
    await page.goto(`liturgy.html?date=${following}`);
    const wf = page.getByTestId('workflow');
    await expect(wf.getByRole('button', { name: 'Submit for review' })).toBeVisible();
    await expect(wf.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });
});

test.describe('directory, songs, settings', () => {
  test('adds a volunteer with eligibility and marks them unavailable', async ({ page }) => {
    await login(page, 'planner');
    await page.goto('volunteers.html');
    await page.getByRole('button', { name: 'Add volunteer' }).click();
    await page.getByRole('button', { name: 'Add volunteer' }).last().click();
    await expect(page.getByText('Enter a name.')).toBeVisible();
    await page.getByLabel('Full name').fill('Joel Rivera');
    await page.getByLabel('Email').fill('joel@example.org');
    await page.getByRole('dialog').getByLabel('Drums').check();
    await page.getByRole('button', { name: 'Add volunteer' }).last().click();
    const row = page.getByTestId('volunteer-table').getByRole('row', { name: /Joel Rivera/ });
    await expect(row).toContainText('Drums');
    await row.getByRole('button', { name: 'Details' }).click();
    await page.getByLabel('Unavailable date').fill('2031-01-05');
    await page.getByRole('button', { name: 'Mark unavailable' }).click();
    await expect(page.getByTestId('availability')).toContainText('5 Jan 2031');
  });

  test('searches songs by title and theme, and shows usage history', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto('songs.html');
    await page.getByRole('searchbox', { name: 'Search songs' }).fill('communion');
    const rows = page.getByTestId('song-table').locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await page.getByRole('searchbox', { name: 'Search songs' }).fill('amazing');
    await rows.first().getByRole('button', { name: 'Details' }).click();
    await expect(page.getByTestId('usage')).toBeVisible();
  });

  test('admin edits roles and the creed preview follows the anchor', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('settings.html#specials');
    const preview = page.getByTestId('creed-preview');
    const before = await preview.textContent();
    await page.getByLabel('Creed in that month').selectOption('apostles');
    expect(await preview.textContent()).not.toBe(before);
    await expect(page.getByTestId('roles-worship')).toContainText('Worship leader');
    await expect(page.getByTestId('permissions')).toBeVisible();
  });

  test('viewer cannot change settings', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto('settings.html');
    await expect(page.getByText('Changing them needs the administrator role')).toBeVisible();
    await expect(page.getByLabel('Church name')).toBeDisabled();
    await expect(page.getByTestId('permissions')).toHaveCount(0);
  });

  test('calendar switches between month and week views', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto('calendar.html');
    await expect(page.locator('.month-cell.is-sunday').first()).toBeVisible();
    await page.getByRole('button', { name: 'Week' }).click();
    await expect(page.getByTestId('week-view')).toBeVisible();
    await expect(page).toHaveURL(/view=week/);
    await page.reload();
    await expect(page.getByTestId('week-view')).toBeVisible();
  });
});
