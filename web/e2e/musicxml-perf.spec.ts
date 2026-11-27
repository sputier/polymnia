import { expect, test } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

const MEASURE_1_ATTRIBUTES =
  '<attributes><divisions>1</divisions><key><fifths>0</fifths></key>' +
  '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>' +
  '<clef number="1"><sign>G</sign><line>2</line></clef>' +
  '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>';

const note = (step: string, octave: number, duration: number, type: string, staff: number) =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>` +
  `<voice>${staff}</voice><type>${type}</type><staff>${staff}</staff></note>`;

function measure(n: number): string {
  const treble = ['C', 'D', 'E', 'F'].map((s) => note(s, 5, 1, 'quarter', 1)).join('');
  const bass = ['C', 'G'].map((s) => note(s, 3, 2, 'half', 2)).join('');
  return `<measure number="${n}">${n === 1 ? MEASURE_1_ATTRIBUTES : ''}${treble}<backup><duration>4</duration></backup>${bass}</measure>`;
}

test('a 500-measure score imports and exports in under 500 ms (real browser)', async ({ page }) => {
  test.setTimeout(120_000);
  await mockSignedIn(page);
  const body = Array.from({ length: 500 }, (_, i) => measure(i + 1)).join('');
  const xml =
    '<?xml version="1.0"?><score-partwise version="4.0"><part-list>' +
    '<score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    `<part id="P1">${body}</part></score-partwise>`;
  const file = { name: 'big.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) };

  await page.goto('/#/editor');
  const confirm = page.getByRole('alertdialog', { name: 'Replace the current score?' });
  const replace = confirm.getByRole('button', { name: 'Replace the score' });
  // The first run loads the lazy chunk; the second one is measured.
  await page.setInputFiles('input[type="file"]', file);
  await expect(confirm).toBeVisible();
  await replace.click();
  await expect(confirm).toHaveCount(0);
  // Let the engraver finish the big score so that it does not compete with what is measured.
  await page.waitForFunction(
    () =>
      (window as unknown as { __polymnia?: { engraver?: { stats?: { complete?: boolean } } } })
        .__polymnia?.engraver?.stats?.complete === true,
    undefined,
    { timeout: 90_000 },
  );

  const start = Date.now();
  await page.setInputFiles('input[type="file"]', file);
  await expect(confirm).toBeVisible();
  const importMs = Date.now() - start;
  await confirm.getByRole('button', { name: 'Cancel' }).click();

  const exportStart = Date.now();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'MusicXML (.musicxml)' }).click();
  await download;
  const exportMs = Date.now() - exportStart;
  console.log(`PERF musicxml 500 measures: import ${importMs} ms, export ${exportMs} ms`);
  expect(importMs).toBeLessThan(500);
  expect(exportMs).toBeLessThan(500);
});
