import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

interface Hook {
  store: {
    getState(): State;
    undo(): void;
    redo(): void;
  };
  playback: { getState(): { status: string } };
}
interface State {
  score: {
    measures: { keyFifths?: number }[];
    parts: {
      id: string;
      instrument: string;
      staves: { id: string; clef: string; measures: { clef?: string }[] }[];
    }[];
  };
  canUndo: boolean;
  canRedo: boolean;
}
interface AudioLog {
  notes: { staffId: string; midi: number }[];
}
type W = { __polymnia: Hook; __polymniaAudioLog: AudioLog };

async function openEditor(page: Page) {
  await mockSignedIn(page);
  await page.addInitScript(() => {
    // Silent audio engine driven by the wall clock (docs/playback.md) and the Advanced interface.
    (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
    try {
      localStorage.setItem('polymnia.uiMode', 'advanced');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/#/editor?new=4');
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as W).__polymnia?.store);
}

const parts = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as W).__polymnia.store.getState().score.parts.map((p) => p.instrument),
  );

async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function addInstrument(page: Page, query: string, name: string) {
  await page.getByRole('button', { name: 'Add an instrument' }).click();
  await page.getByRole('searchbox', { name: 'Search instruments' }).fill(query);
  await page.getByRole('button', { name, exact: true }).click();
}

test('two-part score: guitar + cello, key change, cello clef change, play, out of range, undo/redo', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openEditor(page);

  // Parts: piano out, guitar and cello in.
  await addInstrument(page, 'guitar', 'Steel-string guitar');
  await addInstrument(page, 'violoncelle', 'Cello');
  await page.getByRole('button', { name: 'Remove Piano' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  expect(await parts(page)).toEqual(['guitar-steel', 'cello']);
  await expect(page.getByRole('button', { name: 'Edit Cello' })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // Cello: one bar of quarter notes, then a key change and a tenor clef from bar 2.
  await page.keyboard.press('n');
  await page.keyboard.press('5');
  for (const letter of 'cdef') await page.keyboard.press(letter);
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Key signature' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Clef from this measure' }).selectOption('tenor');
  await blur(page);
  const attributes = await page.evaluate(() => {
    const s = (window as unknown as W).__polymnia.store.getState().score;
    const cello = s.parts[1]!.staves[0]!;
    return {
      key: s.measures.map((m) => m.keyFifths),
      clefs: [cello.clef, cello.measures[1]!.clef],
    };
  });
  expect(attributes.key[1]).toBe(2);
  expect(attributes.clefs).toEqual(['bass', 'tenor']);

  // Guitar: a note, a chord, then push it out of range an octave at a time.
  await page.getByRole('button', { name: 'Edit Steel-string guitar' }).click();
  await page.keyboard.press('n');
  await page.keyboard.press('5');
  await page.keyboard.press('e');
  await page.keyboard.press('Shift+g');
  await page.keyboard.press('Escape');
  await expect(page.locator('svg.pm-score .pm-warn-mark')).toHaveCount(0);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+ArrowUp');
  await expect(page.locator('svg.pm-score .pm-warn-mark')).toHaveCount(1);
  await expect(page.locator('svg.pm-score .pm-event.pm-warn')).toHaveCount(1);
  await expect(page.locator('svg.pm-score .pm-warn-mark title')).toContainText(
    'Out of range for Steel-string guitar',
  );
  await expect(page.getByText(/is outside the range of Steel-string guitar/)).toBeVisible();

  // Playback: both staves sound.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__polymnia.playback.getState().status))
    .toBe('playing');
  await expect
    .poll(() =>
      page.evaluate(
        () => new Set((window as unknown as W).__polymniaAudioLog.notes.map((n) => n.staffId)).size,
      ),
    )
    .toBe(2);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();

  // Visual record for the PR (kept out of the repo by the caller).
  await expect(page.locator('svg.pm-score')).toBeVisible();

  // Undo everything, then redo everything.
  await page.evaluate(() => {
    const { store } = (window as unknown as W).__polymnia;
    while (store.getState().canUndo) store.undo();
  });
  expect(await parts(page)).toEqual(['piano']);
  await expect(page.locator('svg.pm-score .pm-warn-mark')).toHaveCount(0);
  await page.evaluate(() => {
    const { store } = (window as unknown as W).__polymnia;
    while (store.getState().canRedo) store.redo();
  });
  expect(await parts(page)).toEqual(['guitar-steel', 'cello']);
  await expect(page.locator('svg.pm-score .pm-warn-mark')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('guitar flows: drop D, capo, TAB layout; palette adds measures; command palette finds clef changes', async ({
  page,
}) => {
  await openEditor(page);
  await addInstrument(page, 'ukulele', 'Tenor ukulele (low G)');
  expect(await parts(page)).toEqual(['piano', 'ukulele-tenor-low-g']);
  await page.getByRole('radio', { name: 'Standard + TAB' }).check();
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.getByRole('combobox', { name: 'Capo' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Tuning' }).selectOption('baritone');
  const uke = await page.evaluate(() => {
    const p = (window as unknown as W).__polymnia.store.getState().score.parts[1] as unknown as {
      capo: number;
      tuning: unknown[];
      staves: { type: string }[];
    };
    return { capo: p.capo, strings: p.tuning.length, staves: p.staves.map((s) => s.type) };
  });
  expect(uke).toEqual({ capo: 2, strings: 4, staves: ['standard', 'tab'] });

  // Measures from the keyboard: Insert adds one before, Ctrl+Insert appends.
  await blur(page);
  const count = () =>
    page.evaluate(() => (window as unknown as W).__polymnia.store.getState().score.measures.length);
  expect(await count()).toBe(4);
  await page.keyboard.press('Insert');
  await page.keyboard.press('Control+Insert');
  expect(await count()).toBe(6);

  // The palette lists the structure commands.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('tenor');
  await expect(page.getByRole('option', { name: /Clef from this measure: tenor/ })).toBeVisible();
});
