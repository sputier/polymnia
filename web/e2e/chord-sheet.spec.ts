import { readFile } from 'node:fs/promises';
import { unzlibSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';
import { emptyScoreDoc, FakeApi } from './fake-api';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

interface Hook {
  store: {
    getState(): {
      selection: string[];
      cursor: { measure: number };
      score: { parts: { id: string; staves: { id: string }[] }[] };
    };
    addPart(instrument: string, opts: { layout: string }): boolean;
    removePart(id: string): boolean;
    openChordEntry(at: { staffId: string; measure: number; tick: number }): boolean;
    commitChord(text: string): boolean;
    closeChordEntry(): void;
  };
}
type W = { __polymnia: Hook };

/** Guitar score of `measures` measures with chords `[measure, tick, name]`. */
async function openGuitar(
  page: Page,
  measures: number,
  chords: readonly (readonly [number, number, string])[],
) {
  await mockSignedIn(page);
  await page.goto(`/#/editor?new=${measures}`);
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as W).__polymnia?.store);
  await page.evaluate((list) => {
    const { store } = (window as unknown as W).__polymnia;
    store.addPart('guitar-steel', { layout: 'standard' });
    store.removePart(store.getState().score.parts[0]!.id);
    const staffId = store.getState().score.parts.at(-1)!.staves[0]!.id;
    for (const [measure, tick, name] of list) {
      store.openChordEntry({ staffId, measure, tick });
      store.commitChord(name);
      store.closeChordEntry();
    }
  }, chords);
}

const viewGroup = (page: Page) => page.getByRole('group', { name: 'View' });

/** The text shown by the page contents of a PDF: every `<hex> Tj`, decoded as Windows-1252. */
async function exportSheetPdf(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Chord sheet (PDF)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('score.pdf');
  const bytes = await readFile((await file.path())!);
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  const streams: string[] = [];
  for (const m of text.matchAll(/\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index! + m[0].length;
    streams.push(
      Buffer.from(unzlibSync(new Uint8Array(bytes.subarray(start, start + Number(m[1]))))).toString(
        'latin1',
      ),
    );
  }
  return [...streams.join('\n').matchAll(/<([0-9a-f]+)> Tj/g)]
    .map((m) => Buffer.from(m[1]!, 'hex').toString('latin1'))
    .join('|');
}

test.describe('chord sheet (#60)', () => {
  test('toggle: a grid of four measures per row, % for repeats, beats, diagrams', async ({
    page,
  }) => {
    await openGuitar(page, 6, [
      [0, 0, 'C'],
      [1, 0, 'C'],
      [2, 0, 'Am7'],
      [2, 1920, 'G'],
      [3, 0, 'F'],
    ]);
    await viewGroup(page).getByRole('button', { name: 'Chord sheet' }).click();
    const table = page.getByRole('table', { name: /Chord sheet, 6 measures/ });
    await expect(table).toBeVisible();
    await expect(page.locator('svg.pm-score')).toHaveCount(0);
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table.getByRole('row').first().getByRole('button')).toHaveCount(4);
    await expect(table.getByRole('button', { name: 'Measure 1: C' })).toBeVisible();
    await expect(
      table.getByRole('button', { name: 'Measure 2: same as the previous measure, C' }),
    ).toContainText('%');
    await expect(
      table.getByRole('button', { name: 'Measure 3: Am7 on beat 1, G on beat 3' }),
    ).toContainText('Am7');
    await expect(table.getByRole('button', { name: 'Measure 5: no chord' })).toBeVisible();

    // The diagrams of the chords used (C, Am7, G, F), once each.
    const figures = page.locator('.sheet-diagram');
    await expect(figures).toHaveCount(4);
    await expect(figures.first().locator('svg')).toHaveAttribute('data-frets', '0,1,0,2,3,-1');
    await expect(page.getByRole('heading', { name: 'Chord diagrams' })).toBeVisible();

    // The chord naming option applies.
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('chord names');
    await page.keyboard.press('Enter');
    await expect(table.getByRole('button', { name: 'Measure 1: Do' })).toBeVisible();

    // Alt+V and the Score button go back.
    await page.keyboard.press('Alt+v');
    await expect(page.locator('svg.pm-score')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await page.keyboard.press('Alt+v');
    await expect(page.getByRole('table')).toBeVisible();
    await viewGroup(page).getByRole('button', { name: 'Score' }).click();
    await expect(page.locator('svg.pm-score')).toBeVisible();
  });

  test('a measure takes back to the score at that measure', async ({ page }) => {
    await openGuitar(page, 60, [
      [0, 0, 'C'],
      [44, 0, 'Dm'],
    ]);
    await viewGroup(page).getByRole('button', { name: 'Chord sheet' }).click();
    await page.getByRole('button', { name: 'Measure 45: Dm' }).click();
    await expect(page.locator('svg.pm-score')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as W).__polymnia.store.getState().cursor.measure),
      )
      .toBe(44);
    expect(
      await page.evaluate(() => (window as unknown as W).__polymnia.store.getState().selection),
    ).toHaveLength(1);
    // The score scrolled down to the system of measure 45: the selected note is on screen.
    await expect(page.locator('svg.pm-score .pm-event.pm-selected')).toBeInViewport({
      timeout: 10_000,
    });
    expect(await page.locator('.score-area').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });

  test('export: the PDF of the sheet holds the chord names and the diagrams heading', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openGuitar(page, 8, [
      [0, 0, 'Cmaj7'],
      [1, 0, 'Am7'],
      [2, 0, 'F#m7b5'],
      [2, 1920, 'G'],
      [3, 0, 'G'],
    ]);
    await viewGroup(page).getByRole('button', { name: 'Chord sheet' }).click();
    const shown = await exportSheetPdf(page);
    for (const name of ['Cmaj7', 'Am7', 'F#m7b5', '%', 'Chord diagrams'])
      expect(shown).toContain(name);
    // Not the score's own PDF items (no page of notes): chord names only.
    expect(shown).not.toContain('Pno.');

    // PNG: an image.
    await page.getByRole('button', { name: 'Export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Chord sheet (PNG)' }).click();
    const png = await readFile((await (await download).path())!);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  test('export: French chord names in the PDF of the sheet', async ({ page }) => {
    test.setTimeout(60_000);
    await openGuitar(page, 4, [
      [0, 0, 'Dm7'],
      [1, 0, 'G/B'],
    ]);
    await viewGroup(page).getByRole('button', { name: 'Chord sheet' }).click();
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('chord names');
    await page.keyboard.press('Enter');
    const shown = await exportSheetPdf(page);
    expect(shown).toContain('Rém7');
    expect(shown).toContain('Sol/Si');
    expect(shown).not.toContain('Dm7');
  });

  test('the sheet menu items exist only while the sheet is shown', async ({ page }) => {
    await openGuitar(page, 4, [[0, 0, 'C']]);
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('menuitem', { name: 'Chord sheet (PDF)' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+v');
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('menuitem', { name: 'Chord sheet (PDF)' })).toBeVisible();
  });

  test('the shared viewer has the same toggle, read only', async ({ page, browser }) => {
    const fake = new FakeApi();
    const doc = emptyScoreDoc('Shared chords', { measures: 6 });
    const staff = (doc.parts as { staves: { measures: Record<string, unknown>[] }[] }[])[0]!
      .staves[0]!;
    staff.measures[0]!.chords = [
      { id: 'c1', tick: 0, root: { step: 'C', alter: 0 }, quality: 'm7' },
    ];
    staff.measures[1]!.chords = [{ id: 'c2', tick: 0, root: { step: 'G', alter: 0 }, quality: '' }];
    const id = fake.add('Shared chords', doc);
    await mockSignedIn(page);
    await fake.install(page);
    await page.goto(`/#/scores/${id}`);
    await expect(page.locator('svg.pm-score')).toBeVisible();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share' });
    await dialog.getByRole('button', { name: 'Create link' }).click();
    const url = await dialog.getByLabel('Share link').inputValue();

    const visitorContext = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });
    const visitor = await visitorContext.newPage();
    await visitor.route('**/api/me', (route) => route.fulfill({ status: 401 }));
    await fake.install(visitor);
    await visitor.goto(url);
    await expect(visitor.locator('svg.pm-score')).toBeVisible();
    await viewGroup(visitor).getByRole('button', { name: 'Chord sheet' }).click();
    await expect(visitor.getByRole('button', { name: 'Measure 1: Cm7' })).toBeVisible();
    await expect(visitor.getByRole('button', { name: 'Measure 2: G' })).toBeVisible();
    // No editing, no export menu: the viewer stays read only.
    await expect(visitor.getByRole('button', { name: 'Export' })).toHaveCount(0);
    await visitor.getByRole('button', { name: 'Measure 2: G' }).click();
    await expect(visitor.locator('svg.pm-score')).toBeVisible();
    await visitorContext.close();
  });
});
