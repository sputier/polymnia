import { expect, test } from '@playwright/test';
import { openFixture } from '../engraving-helpers';

// Baselines are generated on Linux (the CI image) because font rasterization differs per OS.
// Update them with `npm run test:visual:update` (Docker), see docs/engraving.md.
test.skip(
  process.platform !== 'linux',
  'Visual baselines are Linux only: use npm run test:visual:update',
);

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

const CASES: { name: string; fixture: string; width: number }[] = [
  { name: 'single-staff', fixture: 'auClairDeLaLune', width: 700 },
  { name: 'grand-staff', fixture: 'pianoGrandStaff', width: 900 },
  { name: 'chords', fixture: 'chords', width: 900 },
  { name: 'accidentals-key-changes', fixture: 'accidentals', width: 700 },
  { name: 'ties-slurs', fixture: 'ties', width: 900 },
  { name: 'triplets', fixture: 'triplets', width: 900 },
  { name: 'guitar-standard-tab', fixture: 'guitarArpeggio', width: 900 },
  { name: 'guitar-tab-features', fixture: 'guitarTabFeatures', width: 900 },
  { name: 'cello-clef-changes', fixture: 'celloClefChanges', width: 700 },
  { name: 'pickup-measure', fixture: 'pickup', width: 600 },
];

for (const c of CASES) {
  test(`engraving: ${c.name}`, async ({ page }) => {
    await openFixture(page, c.fixture, c.width);
    await expect(page.locator('.score-host')).toHaveScreenshot(`${c.name}.png`);
  });
}

test('engraving: dark theme and highlights', async ({ browser }) => {
  const context = await browser.newContext({
    colorScheme: 'dark',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await openFixture(page, 'pianoGrandStaff', 900);
  await page.evaluate(() => {
    const w = window as unknown as {
      __polymnia: {
        score: {
          parts: { staves: { measures: { voices: { events: { id: string }[] }[] }[] }[] }[];
        };
        engraver: { setSelection(ids: string[]): void; setPlaying(ids: string[]): void };
      };
    };
    const events = w.__polymnia.score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events;
    w.__polymnia.engraver.setSelection([events[1]!.id]);
    w.__polymnia.engraver.setPlaying([events[2]!.id]);
  });
  await expect(page.locator('.score-host')).toHaveScreenshot('dark-highlights.png');
  await context.close();
});
