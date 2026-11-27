import { expect, test, type Page } from '@playwright/test';
import { openFixture } from '../engraving-helpers';

// Baselines are generated on Linux (the CI image) because font rasterization differs per OS.
// Update them with `npm run test:visual:update` (Docker), see docs/engraving.md.
test.skip(
  process.platform !== 'linux',
  'Visual baselines are Linux only: use npm run test:visual:update',
);

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

type W = {
  __polymnia: { score?: unknown; store?: { loadScore(score: unknown): void } };
};

/** The editor holding a fixture score (the fixture preview itself shows the engraver only). */
async function openSheet(page: Page, fixture: string): Promise<void> {
  await openFixture(page, fixture, 900);
  const score = await page.evaluate(() =>
    JSON.stringify((window as unknown as W).__polymnia.score),
  );
  await page.goto('/#/editor?new=1');
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as W).__polymnia?.store);
  await page.evaluate(
    (json) => (window as unknown as W).__polymnia.store!.loadScore(JSON.parse(json)),
    score,
  );
  await page
    .getByRole('group', { name: 'View' })
    .getByRole('button', { name: 'Chord sheet' })
    .click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const CASES: { name: string; fixture: string; diagrams: boolean }[] = [
  // Chords and diagrams, a repeat (G then G), a slash chord.
  { name: 'chord-sheet-guitar', fixture: 'guitarChords', diagrams: true },
  // Two chords in one measure (beats), diagrams with the capo shapes.
  { name: 'chord-sheet-ukulele-capo', fixture: 'ukuleleChords', diagrams: true },
  // A piano has no diagrams.
  { name: 'chord-sheet-piano', fixture: 'pianoChords', diagrams: false },
];

for (const c of CASES) {
  test(`chord sheet: ${c.name}`, async ({ page }) => {
    await openSheet(page, c.fixture);
    if (c.diagrams) await expect(page.locator('.sheet-diagram').first()).toBeVisible();
    await expect(page.locator('.paper')).toHaveScreenshot(`${c.name}.png`);
  });
}

test('chord sheet: dark theme', async ({ browser }) => {
  const context = await browser.newContext({
    colorScheme: 'dark',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await openSheet(page, 'guitarChords');
  await expect(page.locator('.sheet-diagram').first()).toBeVisible();
  await expect(page.locator('.paper')).toHaveScreenshot('chord-sheet-dark.png');
  await context.close();
});
