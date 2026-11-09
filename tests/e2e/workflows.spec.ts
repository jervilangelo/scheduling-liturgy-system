import { expect, test } from '@playwright/test';
import { login, sundays } from './helpers';

// The church's own weekly plan, as written.
const SAMPLE = [
  'November 8',
  'Preparatory: God Rest Ye Merry Gentlemen',
  'Call to Worship: Psalm 89:5',
  '-\tMagnificent, Marvelous, Matchless Love',
  '-\tHere Is Love',
  'Scripture Reading: Romans 5',
  'Prayer of Confession',
  '-\tWhen I Survey The Wondrous Cross',
  'Congregational Reading of Scripture: Matthew 5:38-47',
  'Prayer of Thanksgiving',
  '-\tBeautiful Savior',
  'Pastoral Prayer',
  '-\tCome Thou Fount',
  'Sermon: Nehemiah 9',
  'Response Song: The Lord is my Salvation',
  '',
  'Service Leader: Angelo',
  'Scripture Reader: ',
  'Music:',
].join('\n');

test.describe('liturgy planning', () => {
  test('writes the order of worship as lines, like the printed plan', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { firstOfNextMonth } = sundays();
    await login(page, 'planner');
    await page.goto(`liturgy.html?date=${firstOfNextMonth}`);
    await expect(page.locator('.pill', { hasText: 'Holy Communion' }).first()).toBeVisible();

    await page.getByRole('button', { name: /Use .Standard Sunday./ }).click();
    const order = page.getByTestId('order');
    await expect(order.locator('li[data-kind="communion"]')).toHaveCount(1);
    await expect(page.getByLabel('Line 1', { exact: true })).toHaveValue('Preparatory');

    // Type a song on the first dash line; Enter starts a new song line below
    await page.getByLabel('Line 3 song').fill('Here Is Love');
    await page.getByLabel('Line 3 song').press('Enter');
    await expect(page.getByLabel('Line 4 song')).toBeFocused();
    await page.keyboard.type('Come Thou Fount');
    // Backspace on an empty line removes it
    await page.getByLabel('Line 4 song').press('Enter');
    const before = await order.locator('li').count();
    await page.keyboard.press('Backspace');
    await expect(order.locator('li')).toHaveCount(before - 1);

    // The text view shows the church's format
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    const text = page.getByRole('textbox', { name: 'Order of worship as text' });
    await expect(text).toHaveValue(/- Here Is Love\n- Come Thou Fount/);

    // Paste a whole plan in that format
    await text.fill(SAMPLE);
    await expect(page.getByText(/Team lines .* are set in the Team section/)).toBeVisible();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(order.locator('li')).toHaveCount(14);
    await expect(page.getByLabel('Line 2 Call to Worship')).toHaveValue('Psalm 89:5');
    // This Sunday needs Communion; the pasted plan has none
    await page.getByRole('button', { name: 'Add it' }).click();
    await expect(order.locator('li[data-kind="communion"]')).toHaveCount(1);

    await page.getByLabel('Version note').fill('Pasted plan');
    await page.getByTestId('save-liturgy').click();
    await expect(page.getByTestId('versions')).toContainText('Version 1 (current)');

    await page.reload();
    await expect(page.getByLabel(/^Line \d+ Sermon$/)).toHaveValue('Nehemiah 9');

    // Copy gives the church's own text format (captured as written, independent of the OS clipboard)
    await page.evaluate(() => {
      const w = window as unknown as { __copied: string };
      w.__copied = '';
      navigator.clipboard.writeText = async (t: string) => { w.__copied = t; };
    });
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByText('Copied in your church')).toBeVisible();
    const copied = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(copied.split('\n').slice(1, 4)).toEqual(['Preparatory: God Rest Ye Merry Gentlemen', 'Call to Worship: Psalm 89:5', '- Magnificent, Marvelous, Matchless Love']);
    expect(copied).toMatch(/\n\nService Leader:.*\nScripture Reader:.*\nMusic:/);
  });

  test('viewers see plans read-only', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto('liturgy.html');
    await expect(page.getByText('Editing needs the planner role')).toBeVisible();
    await expect(page.getByTestId('save-liturgy')).toHaveCount(0);
    await expect(page.getByTestId('order')).toContainText('Sermon:');
  });
});

test.describe('scheduling', () => {
  test('assigns by rotation, detects an availability conflict, overrides with a reason', async ({ page }) => {
    const { following } = sundays();
    await login(page, 'planner');
    await page.goto(`scheduling.html?date=${following}`);
    // Seed marks Mark Dela Rosa (Music) unavailable on this Sunday
    await page.getByTestId('assign-role-music').click();
    const cands = page.getByTestId('candidates');
    await expect(cands.locator('.cand').first()).toContainText('Next in rotation');
    await expect(cands.locator('.cand', { hasText: 'Mark Dela Rosa' })).toContainText('unavailable');

    await cands.locator('.cand', { hasText: 'Mark Dela Rosa' }).getByRole('button', { name: 'Assign anyway' }).click();
    await page.getByRole('button', { name: 'Override', exact: true }).click();
    await expect(page.getByText('A reason is required')).toBeVisible();
    await page.getByLabel('Reason for the override').fill('Back early, confirmed by phone');
    await page.getByRole('button', { name: 'Override', exact: true }).click();

    const slot = page.locator('[data-role="role-music"] [data-testid="slot"]');
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
    await expect(page.getByText('3 of 3 roles filled')).toBeVisible();
  });
});

test.describe('review and publishing', () => {
  test('approver approves and publishes; the schedule is read-only, exportable and audited', async ({ page }) => {
    const { next } = sundays();
    await login(page, 'approver');
    await page.goto(`liturgy.html?date=${next}`);
    const wf = page.getByTestId('workflow');
    await wf.getByRole('button', { name: 'Approve' }).click();
    // Approving with open issues (e.g. an empty team role) asks for confirmation
    const confirm = page.getByRole('dialog').getByRole('button', { name: 'Approve' });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(wf.getByText('Approved')).toBeVisible();
    await wf.getByRole('button', { name: 'Publish' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
    await expect(wf.getByText('Published')).toBeVisible();
    await expect(page.getByText('Published and read-only')).toBeVisible();

    await page.goto(`published.html?date=${next}`);
    const doc = page.getByTestId('published-service');
    await expect(doc).toHaveCount(1);
    await expect(doc).toContainText('Order of worship');
    await expect(doc).toContainText('Sermon:');
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
    await page.getByRole('dialog').getByLabel('Music').check();
    await page.getByRole('button', { name: 'Add volunteer' }).last().click();
    const row = page.getByTestId('volunteer-table').getByRole('row', { name: /Joel Rivera/ });
    await expect(row).toContainText('Music');
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
    await expect(page.getByTestId('roles-worship')).toContainText('Service Leader');
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
