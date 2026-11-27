import { readFile } from 'node:fs/promises';
import { unzlibSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

interface Chord {
  id: string;
  tick: number;
  root: { step: string; alter: number };
  quality: string;
  diagram?: boolean;
}
interface Hook {
  store: {
    getState(): {
      score: {
        parts: {
          id: string;
          chordDiagrams?: string;
          staves: { id: string; measures: { chords?: Chord[] }[] }[];
        }[];
      };
      chordEntry: { measure: number; tick: number } | null;
    };
    addPart(instrument: string, opts: { layout: string }): boolean;
    removePart(id: string): boolean;
    openChordEntry(at?: { staffId: string; measure: number; tick: number }): boolean;
    commitChord(text: string): boolean;
    closeChordEntry(): void;
    toggleInputMode(): void;
    durationKey(digit: string): void;
    enterStep(step: string): void;
    click(hit: unknown): void;
  };
  engraver: {
    svg: SVGSVGElement;
    render: (...args: unknown[]) => unknown;
    stats: { drawn: number };
    settled(): Promise<void>;
    layout: {
      systems: {
        y: number;
        staves: { chordY: number; top: number; staffId: string }[];
        measures: { colX: number[]; shape: { chords: { col: number }[][] } }[];
      }[];
    };
  };
  score: unknown;
}
type W = { __polymnia: Hook };

async function openEditor(page: Page, query = '?new=4') {
  await mockSignedIn(page);
  await page.addInitScript(() => {
    (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
  });
  await page.goto(`/#/editor${query}`);
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as W).__polymnia?.store);
}

/** Replaces the piano with a guitar (standard staff). */
async function switchToGuitar(page: Page) {
  await page.evaluate(() => {
    const { store } = (window as unknown as W).__polymnia;
    store.addPart('guitar-steel', { layout: 'standard' });
    store.removePart(store.getState().score.parts[0]!.id);
  });
  await expect(page.locator('svg.pm-score .vf-pm-system').first()).toBeAttached();
}

const symbols = (page: Page) =>
  page
    .locator('svg.pm-score .vf-pm-chord')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-chord')));

const chordsOf = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as W).__polymnia.store
      .getState()
      .score.parts[0]!.staves[0]!.measures.flatMap((m, i) =>
        (m.chords ?? []).map(
          (c) =>
            `${i}:${c.tick}:${c.root.step}${'#b'.charAt(c.root.alter > 0 ? 0 : 1).repeat(Math.abs(c.root.alter))}${c.quality}`,
        ),
      ),
  );

test.describe('chord symbols', () => {
  test('typed with Alt+K: Space for the next beat, Tab for the next measure, Esc to close', async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press('Alt+k');
    const field = page.getByRole('textbox', { name: /Chord symbol, measure 1, beat 1/ });
    await expect(field).toBeFocused();
    await page.keyboard.type('Am7');
    await page.keyboard.press('Space');
    await expect(page.getByRole('textbox', { name: /measure 1, beat 2/ })).toBeFocused();
    await page.keyboard.type('G');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: /measure 2, beat 1/ })).toBeFocused();
    // French names are accepted and shown with letters.
    await page.keyboard.type('rém7');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: /Chord symbol/ })).toHaveCount(0);

    await expect.poll(() => chordsOf(page)).toEqual(['0:0:Am7', '0:960:G', '1:0:Dm7']);
    await expect.poll(() => symbols(page)).toEqual(['Am7', 'G', 'Dm7']);
    // The symbols sit above the first staff, in reading order.
    const boxes = await page.locator('svg.pm-score .vf-pm-chord').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.left, bottom: r.bottom };
      }),
    );
    const staff = await page.locator('svg.pm-score .vf-stave').first().boundingBox();
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
    for (const b of boxes) expect(b.bottom).toBeLessThan(staff!.y + 1);

    // Esc closes without writing.
    await page.keyboard.press('Alt+k');
    await page.keyboard.type('B7');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: /Chord symbol/ })).toHaveCount(0);
    expect(await chordsOf(page)).toHaveLength(3);
  });

  test('a click on a symbol edits it, an empty field removes it, undo brings it back', async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press('Alt+k');
    await page.keyboard.type('C');
    await page.keyboard.press('Enter');
    await expect.poll(() => symbols(page)).toEqual(['C']);

    await page.locator('svg.pm-score .vf-pm-chord').first().click({ force: true });
    const field = page.getByRole('textbox', { name: /Chord symbol/ });
    await expect(field).toHaveValue('C');
    // The browser takes the focus away right after the click; the field gets it back.
    await page.waitForTimeout(400);
    await expect(field).toBeFocused();
    await page.keyboard.type('Fmaj7');
    await page.keyboard.press('Enter');
    await expect.poll(() => symbols(page)).toEqual(['Fmaj7']);

    await page.locator('svg.pm-score .vf-pm-chord').first().click({ force: true });
    await page.waitForTimeout(400);
    await expect(page.getByRole('textbox', { name: /Chord symbol/ })).toBeFocused();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect.poll(() => symbols(page)).toEqual([]);
    await page.keyboard.press('Control+z');
    await expect.poll(() => symbols(page)).toEqual(['Fmaj7']);
  });

  test('text that is not a chord keeps the field open and says so', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('Alt+k');
    await page.keyboard.type('zzz');
    await expect(page.getByRole('textbox', { name: /Chord symbol/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: /Chord symbol/ })).toBeVisible();
    expect(await chordsOf(page)).toEqual([]);
  });

  test('transposing the symbols from the command palette spells them correctly', async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press('Alt+k');
    await page.keyboard.type('Am7');
    await page.keyboard.press('Space');
    await page.keyboard.type('G/B');
    await page.keyboard.press('Space');
    await page.keyboard.type('F#m7b5');
    await page.keyboard.press('Enter');
    await expect.poll(() => symbols(page)).toEqual(['Am7', 'G/B', 'F#m7b5']);

    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('transpose the symbols up');
    await page.keyboard.press('Enter');
    await expect.poll(() => symbols(page)).toEqual(['Bbm7', 'Ab/C', 'Gm7b5']);
    await page.keyboard.press('Control+z');
    await expect.poll(() => symbols(page)).toEqual(['Am7', 'G/B', 'F#m7b5']);
  });

  test('typography: sharps and flats are music glyphs, extensions are raised', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('Alt+k');
    await page.keyboard.type('Bbmaj7');
    await page.keyboard.press('Space');
    await page.keyboard.type('F#m7b5');
    await page.keyboard.press('Enter');
    await expect.poll(() => symbols(page)).toEqual(['Bbmaj7', 'F#m7b5']);
    const runs = await page
      .locator('svg.pm-score .vf-pm-chord')
      .first()
      .locator('text')
      .evaluateAll((els) =>
        els.map((e) => ({
          text: e.textContent,
          family: e.getAttribute('font-family'),
          y: Number(e.getAttribute('y')),
        })),
      );
    expect(runs.map((r) => r.text)).toEqual(['B', '', 'maj', '7']);
    // Bravura is the default font of the SVG: its glyphs carry no family of their own.
    expect(runs[1]!.family ?? 'Bravura').toContain('Bravura');
    expect(runs[0]!.family).toContain('Inter');
    // The 7 is raised above the baseline of the root.
    expect(runs[3]!.y).toBeLessThan(runs[0]!.y);
  });
});

test.describe('fretboard diagrams', () => {
  async function chordsOnGuitar(page: Page) {
    await openEditor(page);
    await switchToGuitar(page);
    await page.keyboard.press('Alt+k');
    for (const [i, name] of ['C', 'G', 'C', 'Am7'].entries()) {
      await page.keyboard.type(name);
      await page.keyboard.press(i === 3 ? 'Enter' : 'Space');
    }
    await expect.poll(() => symbols(page)).toEqual(['C', 'G', 'C', 'Am7']);
  }

  const diagrams = (page: Page) =>
    page
      .locator('svg.pm-score .vf-pm-diagram')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-frets')));

  test('first occurrence of each chord, from the instrument panel, with the real shapes', async ({
    page,
  }) => {
    await chordsOnGuitar(page);
    expect(await diagrams(page)).toEqual([]);
    await page
      .getByLabel('Fretboard diagrams')
      .selectOption({ label: 'First time each chord appears' });
    // Highest string first: C is x32010, G is 320003, Am7 is x02010.
    await expect
      .poll(() => diagrams(page))
      .toEqual(['0,1,0,2,3,-1', '3,0,0,0,2,3', '0,1,0,2,0,-1']);
    await page.getByLabel('Fretboard diagrams').selectOption({ label: 'Every chord' });
    await expect.poll(() => diagrams(page)).toHaveLength(4);
    await page.getByLabel('Fretboard diagrams').selectOption({ label: 'None' });
    await expect.poll(() => diagrams(page)).toEqual([]);
  });

  test('uses the capo: the shape is drawn, the symbol shows it', async ({ page }) => {
    await openEditor(page);
    await switchToGuitar(page);
    await page.getByLabel('Fretboard diagrams').selectOption({ label: 'Every chord' });
    await page.getByLabel('Capo').selectOption({ label: 'Fret 2' });
    await page.getByLabel(/also show the shape to play/).check();
    // D sounds with the C shape under a capo on 2: type D, see C's frets and "D (C)".
    await page.keyboard.press('Alt+k');
    await page.keyboard.type('D');
    await page.keyboard.press('Enter');
    await expect
      .poll(() =>
        page
          .locator('svg.pm-score .vf-pm-chord')
          .first()
          .locator('text')
          .allTextContents()
          .then((t) => t.join('')),
      )
      .toBe('D(C)');
    await expect.poll(async () => (await diagrams(page))[0]).toBe('0,1,0,2,3,-1');
  });

  test('a diagram toggles for one chord from the palette', async ({ page }) => {
    await chordsOnGuitar(page);
    await page.evaluate(() => {
      const { store } = (window as unknown as W).__polymnia;
      store.click({
        systemIndex: 0,
        partId: '',
        staffId: store.getState().score.parts[0]!.staves[0]!.id,
        measureIndex: 0,
        tick: 0,
      });
    });
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('show or hide the diagram');
    await page.keyboard.press('Enter');
    await expect.poll(() => diagrams(page)).toEqual(['0,1,0,2,3,-1']);
  });

  test('a ukulele gets four strings, and its own shapes', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      const { store } = (window as unknown as W).__polymnia;
      store.addPart('ukulele-concert', { layout: 'standard' });
      store.removePart(store.getState().score.parts[0]!.id);
    });
    await page.keyboard.press('Alt+k');
    await page.keyboard.type('C');
    await page.keyboard.press('Space');
    await page.keyboard.type('F');
    await page.keyboard.press('Enter');
    await page.getByLabel('Fretboard diagrams').selectOption({ label: 'Every chord' });
    // Highest string (A) first: C is 0003, F is 2010 (g C E A).
    await expect.poll(() => diagrams(page)).toEqual(['3,0,0,0', '0,1,0,2']);
  });
});

test.describe('export and playback', () => {
  async function exportPdf(page: Page): Promise<string> {
    await page.getByRole('button', { name: 'Export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'PDF' }).click();
    const file = await download;
    const bytes = await readFile((await file.path())!);
    const text = bytes.toString('latin1');
    // Every page content stream, decoded.
    const streams: string[] = [];
    for (const m of text.matchAll(/\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
      const start = m.index! + m[0].length;
      streams.push(
        Buffer.from(
          unzlibSync(new Uint8Array(bytes.subarray(start, start + Number(m[1])))),
        ).toString('latin1'),
      );
    }
    return streams.join('\n');
  }

  /** The text shown by the page content: every `<hex> Tj` in order, decoded as Windows-1252. */
  const shown = (content: string) =>
    [...content.matchAll(/<([0-9a-f]+)> Tj/g)]
      .map((m) => Buffer.from(m[1]!, 'hex').toString('latin1'))
      .join('');

  test('PDF: the symbols and the diagrams are in the printed score', async ({ page }) => {
    test.setTimeout(60_000);
    await openEditor(page);
    await switchToGuitar(page);
    await page.keyboard.press('Alt+k');
    for (const [i, name] of ['Cmaj7', 'Am7', 'F#m7b5/C', 'G'].entries()) {
      await page.keyboard.type(name);
      await page.keyboard.press(i === 3 ? 'Enter' : 'Space');
    }
    await expect.poll(() => symbols(page)).toHaveLength(4);
    const plain = await exportPdf(page);
    const text = shown(plain);
    expect(text).toContain('Cmaj7');
    expect(text).toContain('Am7');
    expect(text).toContain('F');
    expect(text).toContain('m7');

    await page.getByLabel('Fretboard diagrams').selectOption({ label: 'Every chord' });
    await expect.poll(() => page.locator('svg.pm-score .vf-pm-diagram').count()).toBe(4);
    const withDiagrams = await exportPdf(page);
    // Four diagrams of six strings and four frets add strokes and dots: the page has far more paths.
    const paths = (c: string) => (c.match(/\n(f|S|B)(?=\n|$)/g) ?? []).length;
    expect(paths(withDiagrams)).toBeGreaterThan(paths(plain) + 20);
    expect(shown(withDiagrams)).toContain('Cmaj7');
  });

  test('chord names: Do Ré Mi from the palette, on screen, in the PDF, kept after a reload (#63)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openEditor(page);
    await page.keyboard.press('Alt+k');
    for (const [i, name] of ['Dm7', 'G/B', 'F#m', 'C'].entries()) {
      await page.keyboard.type(name);
      await page.keyboard.press(i === 3 ? 'Enter' : 'Space');
    }
    await expect.poll(() => symbols(page)).toEqual(['Dm7', 'G/B', 'F#m', 'C']);

    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('chord names');
    await page.keyboard.press('Enter');
    await expect.poll(() => symbols(page)).toEqual(['Rém7', 'Sol/Si', 'Fa#m', 'Do']);
    // Sharps stay music glyphs, in French too.
    await expect(page.locator('svg.pm-score .vf-pm-chord').nth(2)).toContainText('Fa');

    const content = await exportPdf(page);
    const text = shown(content);
    expect(text).toContain('Ré');
    expect(text).toContain('Sol');
    expect(text).toContain('Si');
    expect(text).not.toContain('Dm7');

    // The preference is the user's: it survives a reload, and typing still accepts English.
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as W).__polymnia?.store);
    await expect(page.locator('svg.pm-score')).toBeVisible();
    await page.evaluate(() => {
      const { store } = (window as unknown as W).__polymnia;
      const staffId = store.getState().score.parts[0]!.staves[0]!.id;
      store.openChordEntry({ staffId, measure: 0, tick: 0 });
      store.commitChord('Am7');
      store.closeChordEntry();
    });
    await expect.poll(() => symbols(page)).toEqual(['Lam7']);
  });

  test('chord names: the toggle re-renders a 100-measure score within budget (#63)', async ({
    page,
  }) => {
    await openEditor(page, '?new=100');
    await page.evaluate(() => {
      const store = (window as unknown as W).__polymnia.store;
      const staffId = store.getState().score.parts[0]!.staves[0]!.id;
      for (let m = 0; m < 60; m++) {
        for (let t = 0; t < 4; t++) {
          store.openChordEntry({ staffId, measure: m, tick: t * 960 });
          store.commitChord(['C', 'Am7', 'F#m7b5', 'G/B'][(m + t) % 4]!);
        }
      }
      store.closeChordEntry();
    });
    await page.waitForFunction(
      () => document.querySelectorAll('svg.pm-score .vf-pm-chord').length >= 8,
    );
    const toggle = async (expected: string) => {
      const t0 = Date.now();
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox', { name: 'Search commands' }).fill('chord names');
      await page.keyboard.press('Enter');
      await page.waitForFunction(
        (name) =>
          document.querySelector('svg.pm-score .vf-pm-chord')?.getAttribute('data-chord') === name,
        expected,
        { polling: 'raf' },
      );
      return Date.now() - t0;
    };
    const times = [await toggle('Do'), await toggle('C'), await toggle('Do'), await toggle('C')];
    console.log(`chord names toggle (100 measures, 240 symbols): ${times.join(', ')} ms`);
    expect(Math.max(...times)).toBeLessThan(process.env.CI ? 1500 : 750);
  });

  test('chord playback is muted by default and can be switched on', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('Alt+k');
    await page.keyboard.type('C');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Alt+a'); // Advanced: the inspector holds the mixer
    const select = page.getByRole('combobox', { name: /Chord symbols/ });
    await expect(select).toHaveValue('off');
    await select.selectOption('strum');
    await expect(select).toHaveValue('strum');
    const notes = await page.evaluate(
      () =>
        (
          window as unknown as {
            __polymnia: { playback: { getTimeline(): { notes: unknown[] } } };
          }
        ).__polymnia.playback.getTimeline().notes.length,
    );
    expect(notes).toBeGreaterThan(2);
  });
});

test.describe('performance', { tag: '@perf' }, () => {
  const BUDGET_MS = process.env.CI ? 32 : 16;

  test('writing a chord on a filled 100-measure score: p95 under 16 ms', async ({ page }) => {
    await openEditor(page, '?new=100');
    await page.evaluate(() => {
      const store = (window as unknown as W).__polymnia.store;
      store.toggleInputMode();
      store.durationKey('4');
      const letters = ['C', 'G', 'E', 'A'];
      for (let i = 0; i < 800; i++) store.enterStep(letters[i % 4]!);
      const staffId = store.getState().score.parts[0]!.staves[0]!.id;
      // A chord on every beat of the first 60 measures, so the layout has real chord columns.
      for (let m = 0; m < 60; m++) {
        for (let t = 0; t < 4; t++) {
          store.openChordEntry({ staffId, measure: m, tick: t * 960 });
          store.commitChord(['C', 'Am7', 'F#m7b5', 'G/B'][(m + t) % 4]!);
        }
      }
      store.closeChordEntry();
      store.click({ systemIndex: 0, partId: '', staffId, measureIndex: 2, tick: 0 });
    });
    await page.waitForFunction(
      () =>
        (window as unknown as W).__polymnia.score ===
        (
          window as unknown as { __polymnia: { store: { getState(): { score: unknown } } } }
        ).__polymnia.store.getState().score,
    );

    const run = await page.evaluate(async () => {
      const { engraver, store } = (window as unknown as W).__polymnia;
      const staffId = store.getState().score.parts[0]!.staves[0]!.id;
      const mark = { at: 0 };
      const original = engraver.render.bind(engraver);
      engraver.render = (...args: unknown[]) => {
        const r = original(...args);
        mark.at = performance.now();
        return r;
      };
      // Seven names against twelve positions: a position never gets the same chord twice in a row.
      const names = ['Dm7', 'Gsus4', 'Ebmaj7/G', 'C6/9', 'Bm7b5', 'E7#9', 'Abmaj7'];
      const tick = () => new Promise<void>((r) => setTimeout(r, 0));
      const times: number[] = [];
      for (let i = 0; i < 40; i++) {
        mark.at = 0;
        const t0 = performance.now();
        store.openChordEntry({ staffId, measure: 2 + (i % 3), tick: (i % 4) * 960 });
        store.commitChord(names[i % names.length]!);
        while (mark.at === 0 && performance.now() - t0 < 150) await tick();
        if (mark.at > 0) times.push(mark.at - t0);
        await engraver.settled();
        await tick();
      }
      return times;
    });
    expect(run.length).toBeGreaterThanOrEqual(24);
    const sorted = [...run].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    console.log(
      `chord edit end-to-end (100 measures, 240 symbols): ${run.length} edits, median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${sorted.at(-1)!.toFixed(1)} ms`,
    );
    expect(p95).toBeLessThan(BUDGET_MS);
  });
});
