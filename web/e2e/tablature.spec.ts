import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

interface Pitch {
  step: string;
  octave: number;
  fretting?: { string: number; fret: number; manual?: true };
}
interface Ev {
  id: string;
  kind: 'note' | 'rest';
  pitches?: Pitch[];
}
interface Hook {
  store: {
    getState(): {
      score: {
        parts: {
          id: string;
          staves: { id: string; type: string; measures: { voices: { events: Ev[] }[] }[] }[];
        }[];
      };
      staffId: string;
      tabString: number;
    };
    addPart(instrument: string, opts: { layout: string }): boolean;
    removePart(id: string): boolean;
    click(hit: unknown): void;
    undo(): void;
    redo(): void;
  };
  engraver: {
    svg: SVGSVGElement;
    layout: {
      systems: {
        y: number;
        staves: { top: number; space: number; lines: number; type: string; staffId: string }[];
        measures: { colX: number[] }[];
      }[];
    };
  };
}
type W = { __polymnia: Hook };

async function openEditor(page: Page) {
  await mockSignedIn(page);
  await page.addInitScript(() => {
    (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
  });
  await page.goto('/#/editor?new=4');
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as W).__polymnia?.store);
}

/** Replaces the piano with a fretted instrument. */
async function useInstrument(page: Page, instrument: string, layout: string) {
  await page.evaluate(
    ([inst, lay]) => {
      const { store } = (window as unknown as W).__polymnia;
      store.addPart(inst!, { layout: lay! });
      store.removePart(store.getState().score.parts[0]!.id);
    },
    [instrument, layout],
  );
  await expect(page.locator('svg.pm-score .vf-pm-system').first()).toBeAttached();
}

/** Clicks on string `string` of the TAB staff (or the standard staff) at the first column of measure 1. */
async function clickStaff(page: Page, staffType: 'tab' | 'standard', string = 1) {
  const target = await page.evaluate(
    ([type, str]) => {
      const { engraver } = (window as unknown as W).__polymnia;
      const system = engraver.layout.systems[0]!;
      const slot = system.staves.find((s) => s.type === type)!;
      const svg = engraver.svg.getBoundingClientRect();
      const x = system.measures[0]!.colX[0]! + 5;
      const y = system.y + slot.top + (Number(str) - 1) * slot.space;
      return { x: svg.left + x, y: svg.top + y };
    },
    [staffType, string] as const,
  );
  await page.mouse.click(target.x, target.y);
}

const notesOf = (page: Page, staffIndex: number) =>
  page.evaluate((i) => {
    const part = (window as unknown as W).__polymnia.store.getState().score.parts[0]!;
    return part.staves[i]!.measures.flatMap((m) =>
      m.voices[0]!.events.flatMap((e) =>
        e.kind === 'note'
          ? [
              e
                .pitches!.map((p) =>
                  p.fretting ? `${p.fretting.string}:${p.fretting.fret}` : `${p.step}${p.octave}`,
                )
                .join('+'),
            ]
          : [],
      ),
    );
  }, staffIndex);

test('guitar Standard + TAB: frets typed on the TAB update the standard staff, undo/redo included', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openEditor(page);
  await useInstrument(page, 'guitar-classical', 'standard+tab');
  await expect(page.locator('svg.pm-score .vf-pm-system').first()).toBeVisible();

  // Two staves are drawn for the part: one standard, one with six strings.
  const hook = await page.evaluate(() => {
    const { engraver } = (window as unknown as W).__polymnia;
    return engraver.layout.systems[0]!.staves.map((s) => ({ type: s.type, lines: s.lines }));
  });
  expect(hook).toEqual([
    { type: 'standard', lines: 5 },
    { type: 'tab', lines: 6 },
  ]);

  // Click string 3 of the TAB staff, enter note input, type fret 2 on it: a G string fret 2 = A3 (written A4).
  await clickStaff(page, 'tab', 3);
  await page.keyboard.press('n');
  await page.keyboard.press('2');
  expect(await notesOf(page, 1)).toEqual(['3:2']);
  expect(await notesOf(page, 0)).toEqual(['A4']);

  // The note is drawn on the TAB staff too.
  const tabEventId = await page.evaluate(() => {
    const part = (window as unknown as W).__polymnia.store.getState().score.parts[0]!;
    return part.staves[1]!.measures[0]!.voices[0]!.events.find((e) => e.kind === 'note')!.id;
  });
  await expect(page.locator(`svg.pm-score [data-event-id="${tabEventId}"]`)).toBeVisible();

  // Arrow keys move the string, 1 then 2 quickly make fret 12.
  await page.keyboard.press('ArrowDown'); // string 4
  expect(
    await page.evaluate(() => (window as unknown as W).__polymnia.store.getState().tabString),
  ).toBe(4);
  await page.keyboard.type('12', { delay: 0 });
  expect(await notesOf(page, 1)).toEqual(['3:2', '4:12']);
  expect(await notesOf(page, 0)).toEqual(['A4', 'D5']);

  // Undo takes the second entry back on both staves, redo restores it.
  await page.evaluate(() => (window as unknown as W).__polymnia.store.undo());
  await page.evaluate(() => (window as unknown as W).__polymnia.store.undo());
  expect(await notesOf(page, 1)).toEqual(['3:2']);
  await page.evaluate(() => (window as unknown as W).__polymnia.store.redo());
  await page.evaluate(() => (window as unknown as W).__polymnia.store.redo());
  expect(await notesOf(page, 1)).toEqual(['3:2', '4:12']);

  expect(errors).toEqual([]);
});

test('guitar Standard + TAB: a note typed on the standard staff gets a sensible fret', async ({
  page,
}) => {
  await openEditor(page);
  await useInstrument(page, 'guitar-classical', 'standard+tab');
  await clickStaff(page, 'standard');
  await page.keyboard.press('n');
  // Typed in the treble clef: written E5 sounds E4 (the open first string), then A5 (fret 5 of the same string).
  await page.keyboard.press('e');
  await page.keyboard.press('a');
  const std = await notesOf(page, 0);
  expect(std).toHaveLength(2);
  const tab = await notesOf(page, 1);
  expect(tab).toEqual(['1:0', '1:5']);
});

test('ukulele TAB only: four strings, re-entrant G, frets typed on the keyboard', async ({
  page,
}) => {
  await openEditor(page);
  await useInstrument(page, 'ukulele-soprano', 'tab');
  const lines = await page.evaluate(() =>
    (window as unknown as W).__polymnia.engraver.layout.systems[0]!.staves.map((s) => s.lines),
  );
  expect(lines).toEqual([4]);
  await clickStaff(page, 'tab', 4);
  await page.keyboard.press('n');
  await page.keyboard.press('0'); // the fourth string is the high G
  await page.keyboard.press('ArrowUp'); // string 3 (C)
  await page.keyboard.press('2'); // D4
  expect(await notesOf(page, 0)).toEqual(['4:0', '3:2']);
  // Standard notation of this part does not exist: the TAB staff alone is written.
  const types = await page.evaluate(() =>
    (window as unknown as W).__polymnia.store.getState().score.parts[0]!.staves.map((s) => s.type),
  );
  expect(types).toEqual(['tab']);
});
