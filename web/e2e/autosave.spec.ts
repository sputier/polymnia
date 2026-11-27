import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';
import { emptyScoreDoc, FakeApi } from './fake-api';
import { expectBudget } from './perf-stats';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 800 } });

interface Event {
  kind: string;
  pitches?: { step: string }[];
}
interface Hook {
  store: {
    getState: () => {
      score: { parts: { staves: { measures: { voices: { events: Event[] }[] }[] }[] }[] };
    };
  };
}

async function open(page: Page, fake: FakeApi, id: string) {
  await mockSignedIn(page);
  await page.addInitScript(() => {
    (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
  });
  await fake.install(page);
  await page.goto(`/#/scores/${id}`);
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(
    () => !!(window as unknown as { __polymnia?: Hook }).__polymnia?.store,
  );
}

const firstMeasure = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const hook = (window as unknown as { __polymnia: Hook }).__polymnia;
    const events = hook.store.getState().score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events;
    return events.map((e) =>
      e.kind === 'rest' ? 'rest' : e.pitches!.map((p) => p.step).join('+'),
    );
  });

const savedLabel = (page: Page) =>
  page.getByRole('contentinfo', { name: 'Editor status' }).locator('.save');

/** Note input, quarter notes: `C D`. */
async function typeNotes(page: Page, keys = 'n5cd') {
  await page.locator('.paper').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await page.keyboard.type(keys);
}

test.describe('autosave', () => {
  test('saves after a pause with a gzip body, and survives a reload', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Draft', emptyScoreDoc('Draft', { measures: 40 }));
    await open(page, fake, id);
    await expect(savedLabel(page)).toHaveText('Saved');

    await typeNotes(page);
    await expect(savedLabel(page)).toHaveText('Saving…');
    await expect(savedLabel(page)).toHaveText('Saved');

    const puts = fake.writes('PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.ifMatch).toBe('"1"');
    expect(puts[0]!.contentEncoding).toBe('gzip');
    expect(fake.version(id)).toBe(2);

    await page.reload();
    await expect(page.locator('svg.pm-score')).toBeVisible();
    await page.waitForFunction(
      () => !!(window as unknown as { __polymnia?: Hook }).__polymnia?.store,
    );
    expect(await firstMeasure(page)).toEqual(['C', 'D', 'rest']);
  });

  test('never runs two saves at once while typing', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Busy', emptyScoreDoc('Busy', { measures: 40 }));
    await open(page, fake, id);
    let inFlight = 0;
    let maxInFlight = 0;
    await page.route(`**/api/scores/${id}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 600));
      inFlight--;
      return route.fallback();
    });
    await typeNotes(page, 'n5cdefgabcdefg');
    await expect(savedLabel(page)).toHaveText('Saved', { timeout: 15_000 });
    expect(maxInFlight).toBe(1);
    expect(fake.writes('PUT').length).toBeGreaterThanOrEqual(1);
  });

  test('renaming from the editor title saves with PATCH and If-Match', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Before');
    await open(page, fake, id);
    const title = page.getByRole('textbox', { name: 'Score title' });
    await expect(title).toHaveValue('Before');
    await title.fill('After');
    await expect(savedLabel(page)).toHaveText('Saved');
    await expect.poll(() => fake.writes('PATCH').length).toBe(1);
    expect(fake.writes('PATCH')[0]).toMatchObject({ ifMatch: '"1"', body: { title: 'After' } });
    expect(fake.writes('PUT')).toHaveLength(0);
  });

  test('a conflict offers to keep mine: the server version is replaced', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Shared', emptyScoreDoc('Shared', { measures: 40 }));
    await open(page, fake, id);
    fake.bump(id); // saved from another tab
    await typeNotes(page);

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('This score changed elsewhere');
    await expect(savedLabel(page)).toHaveText('Conflict');
    await dialog.getByRole('button', { name: 'Keep mine (overwrite)' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(savedLabel(page)).toHaveText('Saved');
    const puts = fake.writes('PUT');
    expect(puts.at(-1)!.ifMatch).toBe('"2"');
    expect(fake.version(id)).toBe(3);
    const stored = fake.scores.get(id)!.doc as unknown as {
      parts: { staves: { measures: { voices: { events: Event[] }[] }[] }[] }[];
    };
    expect(stored.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events[0]!.kind).toBe('note');
  });

  test('a conflict can load the server version instead', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Shared', emptyScoreDoc('Shared', { measures: 40 }));
    await open(page, fake, id);
    fake.bump(id);
    await typeNotes(page);
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Load the server version' })
      .click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(savedLabel(page)).toHaveText('Saved');
    expect(await firstMeasure(page)).toEqual(['rest']);
    expect(fake.writes('PUT').length).toBe(1); // only the one that conflicted
  });

  test('offline: edits are kept, the status says so, and they are saved when back online', async ({
    page,
  }) => {
    const fake = new FakeApi();
    const id = fake.add('Train', emptyScoreDoc('Train', { measures: 40 }));
    await open(page, fake, id);
    fake.offline = true;
    await typeNotes(page);
    await expect(savedLabel(page)).toHaveText('Offline');
    await expect(page.getByRole('status').filter({ hasText: 'You are offline' })).toBeVisible();
    expect(fake.version(id)).toBe(1);

    fake.offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(savedLabel(page)).toHaveText('Saved');
    expect(fake.version(id)).toBe(2);
    expect((fake.scores.get(id)!.doc as { meta: unknown }).meta).toBeTruthy();
    expect(await firstMeasure(page)).toEqual(['C', 'D', 'rest']);
  });

  test('a 429 waits for Retry-After, then saves', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Busy', emptyScoreDoc('Busy', { measures: 40 }));
    await open(page, fake, id);
    fake.failNextWrite = { status: 429, headers: { 'Retry-After': '2' } };
    await typeNotes(page);
    await expect.poll(() => fake.writes('PUT').length).toBe(1);
    await expect(page.getByRole('status').filter({ hasText: 'Too many saves' })).toBeVisible();
    await expect(savedLabel(page)).toHaveText('Saved', { timeout: 10_000 });
    expect(fake.writes('PUT')).toHaveLength(2);
  });

  test('a 413 explains that the score is too large', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Huge', emptyScoreDoc('Huge', { measures: 40 }));
    await open(page, fake, id);
    fake.failNextWrite = { status: 413 };
    await typeNotes(page);
    await expect(page.getByRole('alert').filter({ hasText: 'too large to save' })).toBeVisible();
    await expect(savedLabel(page)).toHaveText('Not saved');
  });

  test('a 401 asks to sign in again and keeps the edits', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Session', emptyScoreDoc('Session', { measures: 40 }));
    await open(page, fake, id);
    fake.failNextWrite = { status: 401 };
    await typeNotes(page);
    const dialog = page.getByRole('dialog', { name: 'Your session expired' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: /Sign in/ })).toHaveAttribute('target', '_blank');
    await dialog.getByRole('button', { name: 'I signed in: save now' }).click();
    await expect(savedLabel(page)).toHaveText('Saved');
    expect(await firstMeasure(page)).toEqual(['C', 'D', 'rest']);
  });

  test('Ctrl+S saves at once and Alt+L goes back to the library', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Quick', emptyScoreDoc('Quick', { measures: 40 }));
    await open(page, fake, id);
    await typeNotes(page);
    await page.keyboard.press('Control+s');
    await expect.poll(() => fake.writes('PUT').length).toBe(1);
    await expect(savedLabel(page)).toHaveText('Saved');
    await page.keyboard.press('Alt+l');
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('heading', { name: 'My scores' })).toBeVisible();
  });

  test('leaving the editor right after an edit still saves it', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Leaving', emptyScoreDoc('Leaving', { measures: 40 }));
    await open(page, fake, id);
    await typeNotes(page);
    await page.getByRole('link', { name: 'Back to home' }).click();
    await expect(page.getByRole('heading', { name: 'My scores' })).toBeVisible();
    await expect.poll(() => fake.version(id)).toBe(2);
  });

  test('a score that does not exist says so', async ({ page }) => {
    const fake = new FakeApi();
    await mockSignedIn(page);
    await fake.install(page);
    await page.goto('/#/scores/00000000-0000-4000-8000-0000000000ff');
    await expect(page.getByRole('alert')).toContainText('does not exist or is not yours');
    await expect(page.getByRole('link', { name: 'Back to my scores' })).toBeVisible();
  });
});

test.describe('open performance', { tag: '@perf' }, () => {
  test('opens a 500-measure score: fetch, deserialize, first system', async ({ page }) => {
    const doc = JSON.parse(
      readFileSync(
        join(process.cwd(), '..', 'api', 'Polymnia.Tests', 'Fixtures', 'score-500-measures.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const fake = new FakeApi();
    const id = fake.add('Big', doc);
    await mockSignedIn(page);
    await page.addInitScript(() => {
      (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
    });
    await fake.install(page);
    // Warm the browser cache of the app code so the number is the score, not the first download.
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: 'My scores' })).toBeVisible();

    // 2 warm-up opens (discarded) then 6 samples: back to the library, open the score again.
    const opens: number[] = [];
    const totals: number[] = [];
    for (let k = 0; k < 8; k++) {
      // A fresh document each time, with the HTTP cache of the app code warm.
      await page.goto('about:blank');
      await page.goto('/#/');
      await expect(page.getByRole('heading', { name: 'My scores' })).toBeVisible();
      const start = Date.now();
      await page.evaluate((hash) => {
        performance.clearMeasures('score-open');
        window.location.hash = hash;
      }, `/scores/${id}`);
      await page.waitForSelector('svg.pm-score .vf-pm-system', { state: 'attached' });
      const totalMs = Date.now() - start;
      const openMs = await page.evaluate(
        () => performance.getEntriesByName('score-open').at(-1)?.duration ?? -1,
      );
      expect(openMs).toBeGreaterThan(0);
      if (k >= 2) {
        opens.push(openMs);
        totals.push(totalMs);
      }
    }
    expectBudget('open 500 measures: fetch + deserialize', opens, { medianMs: 1500 });
    expectBudget('open 500 measures: until first system', totals, { medianMs: 3000 });
  });
});
