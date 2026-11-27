import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';
import { emptyScoreDoc, FakeApi } from './fake-api';
import { expectBudget } from './perf-stats';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 800 } });

async function setup(page: Page, fake: FakeApi, hash = '/') {
  await mockSignedIn(page);
  await page.addInitScript(() => {
    (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
  });
  await fake.install(page);
  await page.goto(`/#${hash}`);
  // The session check runs first: shortcuts exist once the screen is there.
  if (hash === '/') await expect(page.getByRole('heading', { name: 'My scores' })).toBeVisible();
}

const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) });

async function openCardMenu(page: Page, title: string, item: string) {
  await page.getByRole('button', { name: `Actions for ${title}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('library', () => {
  test('lists the scores with instruments, measures and last change, newest first', async ({
    page,
  }) => {
    const fake = new FakeApi();
    fake.add('Old piece', emptyScoreDoc('Old piece', { measures: 12, instruments: ['piano'] }));
    fake.add('Duo', emptyScoreDoc('Duo', { measures: 1, instruments: ['violin', 'cello'] }));
    await setup(page, fake);

    const cards = page.getByRole('list', { name: 'Your scores' }).getByRole('listitem');
    await expect(cards).toHaveCount(2);
    await expect(cards.first().getByRole('heading')).toHaveText('Duo');
    await expect(cards.first()).toContainText('Violin');
    await expect(cards.first()).toContainText('Cello');
    await expect(cards.first()).toContainText('1 measure');
    await expect(cards.last()).toContainText('12 measures');
    await expect(cards.last()).toContainText('Modified');
    await expect(page.locator('.lib-head').getByText('2 scores')).toBeVisible();
  });

  test('shows an empty state with a way to create the first score', async ({ page }) => {
    await setup(page, new FakeApi());
    await expect(page.getByRole('heading', { name: 'No score yet' })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'New score' }).click();
    await expect(page.getByRole('dialog', { name: 'New score' })).toBeVisible();
  });

  test('creates a score from the dialog and opens it in the editor', async ({ page }) => {
    const fake = new FakeApi();
    await setup(page, fake);
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog', { name: 'New score' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Title')).toBeFocused();

    await dialog.getByLabel('Title').fill('Sonata');
    await dialog.getByRole('checkbox', { name: 'Cello' }).check();
    await dialog.getByLabel('Key').selectOption({ label: 'G major (1♯), relative minor E' });
    await dialog.getByLabel('Time signature').selectOption({ label: '3/4' });
    await dialog.getByLabel('Tempo (beats per minute)').fill('90');
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page).toHaveURL(/#\/scores\/00000000-/);
    await expect(page.getByRole('textbox', { name: 'Score title' })).toHaveValue('Sonata');
    await expect(page.locator('svg.pm-score')).toBeVisible();

    const created = fake.writes('POST')[0]!.body as {
      meta: { title: string; tempoBpm: number };
      parts: { instrument: string }[];
      measures: { time?: { beats: number }; keyFifths?: number }[];
    };
    expect(created.meta).toMatchObject({ title: 'Sonata', tempoBpm: 90 });
    expect(created.parts.map((p) => p.instrument)).toEqual(['cello', 'piano']);
    expect(created.measures[0]).toMatchObject({ time: { beats: 3 }, keyFifths: 1 });
  });

  test('requires at least one instrument', async ({ page }) => {
    await setup(page, new FakeApi());
    const dialog = page.getByRole('dialog', { name: 'New score' });
    // The shortcut can be pressed before the library registered it: retry until the dialog opens.
    await expect(async () => {
      if (!(await dialog.isVisible())) await page.keyboard.press('n');
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await dialog.getByRole('checkbox', { name: 'Piano' }).uncheck();
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Pick at least one instrument.');
  });

  test('renames from the menu with If-Match and moves the score to the top', async ({ page }) => {
    const fake = new FakeApi();
    fake.add('Alpha');
    fake.add('Beta');
    await setup(page, fake);
    await expect(card(page, 'Alpha')).toBeVisible();

    await openCardMenu(page, 'Alpha', 'Rename');
    const dialog = page.getByRole('dialog', { name: 'Rename score' });
    await dialog.getByLabel('Title').fill('Alpha 2');
    await dialog.getByRole('button', { name: 'Rename' }).click();

    await expect(page.getByRole('heading', { name: 'Alpha 2' })).toBeVisible();
    const patch = fake.writes('PATCH')[0]!;
    expect(patch.ifMatch).toBe('"1"');
    expect(patch.body).toEqual({ title: 'Alpha 2' });
    await expect(page.getByRole('listitem').first().getByRole('heading')).toHaveText('Alpha 2');
  });

  test('duplicates a score', async ({ page }) => {
    const fake = new FakeApi();
    fake.add('Etude', emptyScoreDoc('Etude', { measures: 6, instruments: ['guitar-classical'] }));
    await setup(page, fake);
    await openCardMenu(page, 'Etude', 'Duplicate');
    const copy = card(page, 'Etude (copy)');
    await expect(copy).toBeVisible();
    await expect(copy).toContainText('6 measures');
    await expect(copy).toContainText('Classical guitar');
    expect(fake.scores.size).toBe(2);
  });

  test('delete can be undone: the server is never asked', async ({ page }) => {
    const fake = new FakeApi();
    fake.add('Keep me');
    fake.add('Other');
    await setup(page, fake);

    await openCardMenu(page, 'Keep me', 'Delete');
    await expect(card(page, 'Keep me')).toHaveCount(0);
    await expect(page.getByText('Deleted "Keep me".')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(card(page, 'Keep me')).toBeVisible();
    // Past the undo window: still nothing sent.
    await page.waitForTimeout(8500);
    expect(fake.writes('DELETE')).toHaveLength(0);
    expect(fake.scores.size).toBe(2);
  });

  test('delete goes through when the undo window ends', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Doomed');
    fake.add('Stays');
    await setup(page, fake);

    await openCardMenu(page, 'Doomed', 'Delete');
    await expect(card(page, 'Doomed')).toHaveCount(0);
    await expect.poll(() => fake.scores.has(id), { timeout: 12_000 }).toBe(false);
    await expect(card(page, 'Stays')).toBeVisible();
  });

  test('share opens the share dialog', async ({ page }) => {
    const fake = new FakeApi();
    fake.add('Shared');
    await setup(page, fake);
    await openCardMenu(page, 'Shared', 'Share');
    await expect(page.getByRole('dialog', { name: 'Share' })).toContainText(
      'This score is not shared',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('searches by title on the server, "/" focuses the field', async ({ page }) => {
    const fake = new FakeApi();
    fake.add('Moonlight');
    fake.add('Sunrise');
    await setup(page, fake);
    await expect(card(page, 'Sunrise')).toBeVisible();

    await page.keyboard.press('/');
    const search = page.getByRole('searchbox', { name: 'Search scores' });
    await expect(search).toBeFocused();
    await search.fill('moon');
    await expect(card(page, 'Sunrise')).toHaveCount(0);
    await expect(card(page, 'Moonlight')).toBeVisible();
    const searches = fake.requests.filter((r) => r.path.includes('q=moon'));
    // Debounced: the keystrokes of one word make one request.
    expect(searches).toHaveLength(1);

    await search.fill('zzz');
    await expect(page.getByText('No score matches "zzz".')).toBeVisible();
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(card(page, 'Sunrise')).toBeVisible();
  });

  test('moves between cards with the arrow keys and opens with Enter', async ({ page }) => {
    const fake = new FakeApi();
    const first = fake.add('One');
    fake.add('Two');
    fake.add('Three');
    await setup(page, fake);
    const open = (title: string) => page.getByRole('link', { name: `Open: ${title}` });
    await open('Three').focus();
    await page.keyboard.press('ArrowRight');
    await expect(open('Two')).toBeFocused();
    await page.keyboard.press('End');
    await expect(open('One')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(open('Three')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#/scores/${first}`));
    await expect(page.getByRole('textbox', { name: 'Score title' })).toHaveValue('One');
  });

  test('is available in French', async ({ page }) => {
    const fake = new FakeApi();
    fake.add('Pièce');
    await setup(page, fake);
    await page.getByRole('button', { name: /FR/ }).click();
    await expect(page.getByRole('heading', { name: 'Mes partitions' })).toBeVisible();
    await page.getByRole('button', { name: 'Actions pour Pièce' }).click();
    await expect(page.getByRole('menuitem', { name: 'Dupliquer' })).toBeVisible();
  });

  test('opens the command palette with the library commands', async ({ page }) => {
    await setup(page, new FakeApi());
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('option', { name: /New score/ })).toBeVisible();
  });

  test('a 401 on the list shows the sign-in screen', async ({ page }) => {
    await mockSignedIn(page);
    await page.route('**/api/scores**', (route) => route.fulfill({ status: 401 }));
    await page.goto('/#/');
    await expect(page.getByRole('link', { name: /Sign in with Google/ })).toBeVisible();
  });
});

test.describe('library performance', { tag: '@perf' }, () => {
  test('renders 200 scores in under 100 ms', async ({ page }) => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      title: `Score number ${i}`,
      schemaVersion: 1,
      version: 1,
      createdAt: '2026-06-01T10:00:00Z',
      updatedAt: '2026-06-01T10:00:00Z',
      measureCount: 32,
      instruments: ['piano', 'cello'],
    }));
    await mockSignedIn(page);
    // Time from the answer of the list to the 200th card in the DOM (parsing, React render, commit).
    await page.addInitScript(() => {
      const w = window as unknown as { __answered?: number; __rendered?: number };
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        if (String(input).includes('/api/scores')) w.__answered = performance.now();
        return response;
      };
      new MutationObserver(() => {
        if (!w.__rendered && document.querySelectorAll('li.card').length >= 200) {
          w.__rendered = performance.now();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.route('**/api/scores**', (route) =>
      route.fulfill({ json: { items, page: 1, pageSize: 200, total: 200 } }),
    );
    // 2 warm-up loads (discarded), then 8 samples: the init script runs again on each reload.
    const samples: number[] = [];
    await page.goto('/#/');
    for (let i = 0; i < 10; i++) {
      if (i > 0) await page.reload();
      await expect(page.getByRole('heading', { name: 'Score number 199' })).toBeAttached();
      const ms = await page.evaluate(() => {
        const w = window as unknown as { __answered: number; __rendered: number };
        return w.__rendered - w.__answered;
      });
      if (i >= 2) samples.push(ms);
    }
    await expect(page.getByRole('listitem')).toHaveCount(200);
    expectBudget('library render of 200 cards', samples, { medianMs: 100 });
  });
});
