import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

// The documented test hook: `window.__polymnia = { engraver, score, width, store }`.
interface Hook {
  store: {
    getState(): State;
    click(hit: unknown, extend?: boolean): void;
  };
  engraver: {
    svg: SVGSVGElement;
    stats: { drawn: number; reused: number; systems: number; ms: number };
    layout: Layout;
    eventBox(id: string): { x: number; y: number; w: number; h: number } | undefined;
  };
  score: unknown;
}
interface State {
  score: Score;
  mode: string;
  selection: string[];
  cursor: { measure: number; tick: number };
  staffId: string;
}
interface Score {
  measures: unknown[];
  slurs: unknown[];
  parts: { staves: { id: string; measures: { voices: { events: Ev[] }[] }[] }[] }[];
}
interface Ev {
  id: string;
  kind: 'note' | 'rest';
  duration: { base: string; dots: number };
  pitches?: { step: string; alter: number; octave: number; tieToNext?: boolean }[];
}
interface Layout {
  systems: {
    y: number;
    staves: { top: number }[];
    measures: { colX: number[] }[];
  }[];
}

declare global {
  interface Window {
    __polymnia: Hook;
  }
}

async function openEditor(page: Page, query = '') {
  await mockSignedIn(page);
  await page.goto(`/#/editor${query}`);
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(
    () => !!window.__polymnia?.store && !!window.__polymnia?.engraver?.layout.systems.length,
  );
}

/** Notes of one measure of the first staff, e.g. `C5:quarter`. */
async function measureNotes(page: Page, measure: number): Promise<string[]> {
  return page.evaluate((m) => {
    const ev =
      window.__polymnia.store.getState().score.parts[0]!.staves[0]!.measures[m]!.voices[0]!.events;
    return ev.map((e) =>
      e.kind === 'rest'
        ? `r:${e.duration.base}`
        : `${e.pitches!.map((p) => `${p.step}${p.alter ? (p.alter > 0 ? '#' : 'b') : ''}${p.octave}`).join('+')}:${e.duration.base}`,
    );
  }, measure);
}

test.describe('note entry', () => {
  test('N 5 C D E F 6 G writes the model and the rendering', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openEditor(page);
    await expect(page.getByRole('contentinfo', { name: 'Editor status' })).toContainText('SELECT');

    await page.keyboard.press('n');
    await expect(page.getByRole('contentinfo', { name: 'Editor status' })).toContainText(
      'NOTE INPUT',
    );
    for (const key of ['5', 'c', 'd', 'e', 'f', '6', 'g']) await page.keyboard.press(key);

    expect(await measureNotes(page, 0)).toEqual([
      'C5:quarter',
      'D5:quarter',
      'E5:quarter',
      'F5:quarter',
    ]);
    expect(await measureNotes(page, 1)).toEqual(['G5:half', 'r:half']);

    // Rendering: every written note has its own element in the SVG, with a notehead.
    const ids = await page.evaluate(() => {
      const ev = window.__polymnia.store.getState().score.parts[0]!.staves[0]!.measures;
      return [...ev[0]!.voices[0]!.events, ev[1]!.voices[0]!.events[0]!]
        .filter((e) => e.kind === 'note')
        .map((e) => e.id);
    });
    expect(ids).toHaveLength(5);
    for (const id of ids) {
      await expect(page.locator(`svg.pm-score [data-event-id="${id}"] .vf-notehead`)).toHaveCount(
        1,
      );
    }
    // Status bar and live region follow.
    await expect(page.getByRole('contentinfo', { name: 'Editor status' })).toContainText('Half');
    await expect(page.getByRole('contentinfo', { name: 'Editor status' })).toContainText('M2 · B3');
    await expect(page.locator('.score-view [role=status]')).toHaveText('G5 half, measure 2 beat 1');
    expect(errors).toEqual([]);
  });

  test('undo and redo round trip, from keys and from the palette', async ({ page }) => {
    await openEditor(page);
    const initial = await measureNotes(page, 0);
    await page.keyboard.press('n');
    for (const key of ['5', 'c', 'd', 'e']) await page.keyboard.press(key);
    const written = await measureNotes(page, 0);
    expect(written[0]).toBe('C5:quarter');

    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
    expect(await measureNotes(page, 0)).toEqual(initial);
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+Shift+z');
    await page.getByRole('button', { name: 'Redo' }).click();
    expect(await measureNotes(page, 0)).toEqual(written);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await measureNotes(page, 0))[2]).toBe('r:half');
  });

  test('mouse: click a note to select it, click the staff to enter a note', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('n');
    for (const key of ['5', 'c', 'd']) await page.keyboard.press(key);
    await page.keyboard.press('n'); // back to select mode

    // Click the C5 note.
    const click = async (point: { x: number; y: number }) => {
      const box = await page.locator('svg.pm-score').boundingBox();
      await page.mouse.click(box!.x + point.x, box!.y + point.y);
    };
    const firstId = await page.evaluate(
      () =>
        window.__polymnia.store.getState().score.parts[0]!.staves[0]!.measures[0]!.voices[0]!
          .events[0]!.id,
    );
    const box = await page.evaluate((id) => window.__polymnia.engraver.eventBox(id)!, firstId);
    await click({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
    expect(await page.evaluate(() => window.__polymnia.store.getState().selection)).toEqual([
      firstId,
    ]);
    await expect(page.locator('svg.pm-score .pm-sel-bg')).toHaveCount(1);
    await expect(page.locator('.score-view [role=status]')).toHaveText(
      'C5 quarter, measure 1 beat 1',
    );

    // Note input, quarter: click on the E4 line of the second beat of measure 2.
    await page.keyboard.press('n');
    await page.keyboard.press('5');
    const target = await page.evaluate(() => {
      const { engraver } = window.__polymnia;
      const system = engraver.layout.systems[0]!;
      const m = system.measures[1]!;
      // E4 is 8 half-spaces below the top line F5: 40 px.
      return { x: m.colX[0]! + 7, y: system.y + system.staves[0]!.top + 40 };
    });
    await click(target);
    expect(await measureNotes(page, 1)).toEqual(['E4:quarter', 'r:quarter', 'r:half']);
    await page.keyboard.press('Control+z');
    expect(await measureNotes(page, 1)).toEqual(['r:whole']);
  });

  test('selection with Shift+arrows, transposition, copy and paste', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('n');
    for (const key of ['5', 'c', 'd', 'e', 'f']) await page.keyboard.press(key);
    await page.keyboard.press('n'); // selects F5
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    expect(await page.evaluate(() => window.__polymnia.store.getState().selection.length)).toBe(3);
    await expect(page.locator('svg.pm-score .pm-sel-bg')).toHaveCount(3);

    await page.keyboard.press('ArrowUp');
    expect((await measureNotes(page, 0)).slice(1)).toEqual([
      'D#5:quarter',
      'F5:quarter',
      'F#5:quarter',
    ]);
    await page.keyboard.press('Control+ArrowDown');
    expect((await measureNotes(page, 0)).slice(1)).toEqual([
      'D#4:quarter',
      'F4:quarter',
      'F#4:quarter',
    ]);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect((await measureNotes(page, 0)).slice(1)).toEqual([
      'D5:quarter',
      'E5:quarter',
      'F5:quarter',
    ]);

    await page.keyboard.press('Control+c');
    // Paste into the second measure by clicking its empty space.
    await page.evaluate(() => {
      const { store, engraver } = window.__polymnia;
      const system = engraver.layout.systems[0]!;
      const staffId = store.getState().staffId;
      store.click({ systemIndex: 0, partId: '', staffId, measureIndex: 1, tick: 0 });
      void system;
    });
    await page.keyboard.press('Control+v');
    expect((await measureNotes(page, 1)).slice(0, 3)).toEqual([
      'D5:quarter',
      'E5:quarter',
      'F5:quarter',
    ]);
  });

  test('palette buttons mirror the keys and show them in a tooltip', async ({ page }) => {
    await openEditor(page);
    const quarter = page.getByRole('button', { name: 'Quarter' });
    await expect(quarter).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Half', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Half', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Note input' }).click();
    await expect(page.getByRole('contentinfo', { name: 'Editor status' })).toContainText(
      'NOTE INPUT',
    );
    await page.keyboard.press('c');
    expect((await measureNotes(page, 0))[0]).toBe('C5:half');

    await page.getByRole('button', { name: 'Sixteenth' }).hover();
    await expect(page.locator('.tip-wrap:hover .tip')).toContainText('3');
    // Triplet only in Advanced mode.
    await expect(page.getByRole('button', { name: 'Triplet' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Triplet' })).toBeVisible();
  });

  test('reserved digits only show a notice', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('2');
    await expect(page.getByRole('contentinfo', { name: 'Editor status' })).toContainText(
      'Only sixteenth to whole durations',
    );
    await expect(page.getByRole('contentinfo', { name: 'Editor status' })).toContainText('Quarter');
  });
});

test.describe('note entry on macOS', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS' }) });
    });
  });

  test('Cmd replaces Ctrl', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('n');
    await page.keyboard.press('c');
    expect((await measureNotes(page, 0))[0]).toBe('C5:quarter');
    await page.keyboard.press('Control+z');
    expect((await measureNotes(page, 0))[0]).toBe('C5:quarter');
    await page.keyboard.press('Meta+z');
    expect((await measureNotes(page, 0))[0]).toBe('r:whole');
    await page.keyboard.press('Meta+Shift+z');
    expect((await measureNotes(page, 0))[0]).toBe('C5:quarter');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.getByRole('button', { name: 'Redo' }).hover();
    await expect(page.locator('.tip-wrap:hover .tip')).toContainText('⌘');
  });
});

interface KeyRun {
  requested: number;
  times: number[];
  drawn: number[];
}

/**
 * Presses `count` note keys one after the other. Each time is the end of the synchronous render
 * of the edit minus the start of the key (what blocks the next keystroke); idle-time drawing of the
 * other systems is awaited (`settled()`) between keys, like a pause of the player.
 */
async function pressNoteKeys(
  page: Page,
  count: number,
  letters: string[],
  sharp = false,
): Promise<KeyRun> {
  return page.evaluate(
    async ({ count, letters, sharp }) => {
      const engraver = window.__polymnia.engraver as unknown as {
        render: (...a: unknown[]) => unknown;
        stats: { drawn: number };
        settled(): Promise<void>;
      };
      const mark = { at: 0 };
      const original = engraver.render.bind(engraver);
      engraver.render = (...args: unknown[]) => {
        const r = original(...args);
        mark.at = performance.now();
        return r;
      };
      const tick = () => new Promise<void>((r) => setTimeout(r, 0));
      const times: number[] = [];
      const drawn: number[] = [];
      for (let i = 0; i < count; i++) {
        const letter = letters[i % letters.length]!;
        // A sharp widens the measure: the edit may move line breaks.
        if (sharp) (window.__polymnia.store as unknown as EntryStore).accidental(1);
        mark.at = 0;
        const t0 = performance.now();
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: letter.toLowerCase(),
            code: `Key${letter}`,
            bubbles: true,
            cancelable: true,
          }),
        );
        // A key that changes nothing (same pitch, refused entry) does not render: it is not a
        // sample and must not cost a long wait.
        while (mark.at === 0 && performance.now() - t0 < 150) await tick();
        if (mark.at > 0) {
          times.push(mark.at - t0);
          drawn.push(engraver.stats.drawn);
        }
        await engraver.settled();
        await tick();
      }
      return { times, drawn, requested: count };
    },
    { count, letters, sharp },
  );
}

function report(label: string, run: KeyRun): { median: number; p95: number } {
  // Most keys must have rendered, otherwise the measurement means nothing.
  expect(run.times.length).toBeGreaterThanOrEqual(run.requested * 0.6);
  const sorted = [...run.times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  const max = sorted[sorted.length - 1]!;
  console.log(
    `keystroke end-to-end (${label}): ${run.times.length} keys, median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms, systems drawn per edit max ${Math.max(...run.drawn)}`,
  );
  return { median, p95 };
}

type EntryStore = {
  toggleInputMode(): void;
  durationKey(d: string): void;
  enterStep(s: string): void;
  accidental(alter: number): void;
  click(hit: unknown): void;
  getState(): State;
};

/**
 * p95 budget of a keystroke. Shared CI runners are about twice as slow as the reference laptop
 * (a single system takes 10 ms there), so CI gets twice the budget: still far under what a
 * full re-flow cost before #38.
 */
const KEYSTROKE_BUDGET_MS = process.env.CI ? 32 : 16;

test.describe('performance', () => {
  test('a keystroke on a filled 100-measure score: p95 under 16 ms', async ({ page }) => {
    await openEditor(page, '?new=100');
    // Fill the score programmatically (800 eighth notes), then edit at the start of it, on screen (off-screen systems are drawn in idle time).
    await page.evaluate(() => {
      const store = window.__polymnia.store as unknown as EntryStore;
      store.toggleInputMode();
      store.durationKey('4');
      const letters = ['C', 'G', 'E', 'A'];
      for (let i = 0; i < 800; i++) store.enterStep(letters[i % 4]!);
      const staffId = store.getState().staffId;
      store.click({ systemIndex: 0, partId: '', staffId, measureIndex: 2, tick: 0 });
    });
    // The hook is refreshed once every system is drawn.
    await page.waitForFunction(
      () => window.__polymnia.score === window.__polymnia.store.getState().score,
    );

    const run = await pressNoteKeys(page, 40, ['D', 'F', 'B', 'C']);
    const { p95 } = report('100 measures, filled', run);
    expect(p95).toBeLessThan(KEYSTROKE_BUDGET_MS);
  });

  test('re-flow at the top of a filled 100-measure score: p95 under 16 ms', async ({ page }) => {
    await openEditor(page, '?new=100');
    await page.evaluate(() => {
      const store = window.__polymnia.store as unknown as EntryStore;
      store.toggleInputMode();
      store.durationKey('4');
      const letters = ['C', 'G', 'E', 'A'];
      for (let i = 0; i < 800; i++) store.enterStep(letters[i % 4]!);
      const staffId = store.getState().staffId;
      store.click({ systemIndex: 0, partId: '', staffId, measureIndex: 0, tick: 0 });
    });
    await page.waitForFunction(
      () => window.__polymnia.score === window.__polymnia.store.getState().score,
    );
    // Sharps on the first 40 notes: the first measures widen, line breaks move, every system after
    // them is concerned while the ones on screen must be redrawn right away.
    const run = await pressNoteKeys(page, 40, ['C', 'G', 'E', 'A'], true);
    const { p95 } = report('100 measures, filled, re-flow at the top', run);
    expect(p95).toBeLessThan(KEYSTROKE_BUDGET_MS);
  });

  test('filling an empty 100-measure score: re-flows stay under 16 ms (p95)', async ({ page }) => {
    await openEditor(page, '?new=100');
    await page.evaluate(() => {
      const store = window.__polymnia.store as unknown as EntryStore;
      store.toggleInputMode();
      store.durationKey('4');
    });
    // 400 eighth notes: the first 50 measures, each widening as its rests become notes.
    const run = await pressNoteKeys(page, 400, ['C', 'G', 'E', 'A']);
    const { p95 } = report('100 measures, filling an empty score', run);
    expect(p95).toBeLessThan(KEYSTROKE_BUDGET_MS);
  });
});
