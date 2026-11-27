import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

interface Ev {
  kind: 'note' | 'rest';
  pitches?: { step: string; alter: number; octave: number }[];
}
interface Hook {
  store: {
    getState(): {
      score: { parts: { staves: { measures: { voices: { events: Ev[] }[] }[] }[] }[] };
    };
  };
  playback: { seekTick(tick: number): void };
}
type W = Window & {
  __polymnia: Hook;
  __polymniaMidi?: { send(data: number[], time: number): void };
};

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
  });
  await mockSignedIn(page);
  await page.goto('/#/editor?new=4');
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as W).__polymnia?.playback);
}

/** "C4", "E4+G4" description of the notes of the first measure. */
const notes = (page: Page) =>
  page.evaluate(() => {
    const events = (window as unknown as W).__polymnia.store.getState().score.parts[0]!.staves[0]!
      .measures[0]!.voices[0]!.events;
    return events
      .filter((e) => e.kind === 'note')
      .map((e) =>
        e
          .pitches!.map((p) => p.step + (p.alter > 0 ? '#' : p.alter < 0 ? 'b' : '') + p.octave)
          .join('+'),
      );
  });

const key = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.describe('on-screen piano', () => {
  test('P toggles the piano, and the palette lists it', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByRole('region', { name: 'On-screen piano' })).toBeHidden();
    await page.keyboard.press('p');
    await expect(page.getByRole('region', { name: 'On-screen piano' })).toBeVisible();
    await expect(key(page, 'C4')).toBeVisible();
    await page.keyboard.press('p');
    await expect(page.getByRole('region', { name: 'On-screen piano' })).toBeHidden();
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('piano');
    await expect(page.getByRole('option', { name: /on-screen piano/i })).toBeVisible();
  });

  test('clicking keys enters notes; Shift+click makes a chord', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('p');
    await page.keyboard.press('n');
    await page.keyboard.press('5');
    await key(page, 'C4').click();
    await key(page, 'E4').click();
    await key(page, 'G4').click();
    await key(page, 'B4').click({ modifiers: ['Shift'] });
    expect(await notes(page)).toEqual(['C4', 'E4', 'G4+B4']);
    // The entered notes light up.
    await expect(page.locator('.pk.is-on')).toHaveCount(2);
  });

  test('black keys follow the key signature in the label (C major: sharps)', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('p');
    await page.keyboard.press('n');
    await key(page, 'C sharp 4').click();
    expect(await notes(page)).toEqual(['C#4']);
  });

  test('in select mode a key changes the selected note', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('p');
    await page.keyboard.press('n');
    await key(page, 'C4').click();
    await page.keyboard.press('Escape');
    await page.locator('svg.pm-score .pm-event').first().click();
    await key(page, 'A4').click();
    expect(await notes(page)).toEqual(['A4']);
  });

  test('arrow keys move between keys without moving the score cursor', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('p');
    await key(page, 'C4').focus();
    await page.keyboard.press('ArrowRight');
    await expect(key(page, 'C sharp 4')).toBeFocused();
    await page.keyboard.press('Enter');
    // Select mode and no selection: nothing is written.
    expect(await notes(page)).toEqual([]);
  });

  test('keys light up during playback', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('p');
    await page.keyboard.press('n');
    await page.keyboard.press('5');
    for (const letter of 'cdef') await page.keyboard.press(letter);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Home');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('.pk.is-playing').first()).toBeVisible();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.locator('.pk.is-playing')).toHaveCount(0);
  });

  test('the piano does not re-render while playing', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('p');
    await page.keyboard.press('n');
    await page.keyboard.press('5');
    for (const letter of 'cdefgabc') await page.keyboard.press(letter);
    await page.keyboard.press('Escape');
    // Mutations of the key DOM other than class changes would show up here.
    await page.evaluate(() => {
      const w = window as unknown as { __pianoMutations: number };
      w.__pianoMutations = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'childList' || r.attributeName !== 'class') w.__pianoMutations++;
        }
      }).observe(document.querySelector('.piano-keys')!, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    });
    await page.keyboard.press('Home');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('.pk.is-playing').first()).toBeVisible();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { __pianoMutations: number }).__pianoMutations,
      ),
    ).toBe(0);
  });
});

test.describe('MIDI keyboard', () => {
  test('connects on demand and enters notes and chords', async ({ page }) => {
    await page.addInitScript(() => {
      const port = {
        id: 'kb1',
        name: 'Test Keys',
        type: 'input',
        state: 'connected',
        onmidimessage: null as null | ((e: { data: Uint8Array; timeStamp: number }) => void),
      };
      const w = window as unknown as Record<string, unknown>;
      w.__midiRequests = 0;
      w.__polymniaMidi = {
        send: (data: number[], timeStamp: number) =>
          port.onmidimessage?.({ data: new Uint8Array(data), timeStamp }),
      };
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: async () => {
          (w.__midiRequests as number)++;
          return { inputs: new Map([['kb1', port]]), onstatechange: null };
        },
      });
    });
    await openEditor(page);
    await page.keyboard.press('p');
    // Nothing was requested before the user asks.
    expect(
      await page.evaluate(() => (window as unknown as { __midiRequests: number }).__midiRequests),
    ).toBe(0);
    await page.getByRole('button', { name: 'Connect MIDI keyboard' }).click();
    await expect(page.getByText('MIDI keyboard connected: Test Keys')).toBeVisible();
    await page.keyboard.press('n');
    await page.keyboard.press('5');
    const send = (data: number[], t: number) =>
      page.evaluate(
        ([d, time]) => (window as unknown as W).__polymniaMidi!.send(d as number[], time as number),
        [data, t] as const,
      );
    await send([0x90, 60, 90], 1000);
    await send([0x80, 60, 0], 1200);
    await send([0x90, 64, 90], 2000);
    await send([0x90, 67, 90], 2020); // within 50 ms: same chord
    await send([0x90, 70, 90], 3000);
    expect(await notes(page)).toEqual(['C4', 'E4+G4', 'A#4']);
  });

  test('explains when Web MIDI is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        value: undefined,
        configurable: true,
      });
    });
    await openEditor(page);
    await page.keyboard.press('p');
    await expect(page.getByText(/cannot read a MIDI keyboard/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect MIDI keyboard' })).toHaveCount(0);
  });

  test('explains a denied permission and lets the user retry', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: () => Promise.reject(new DOMException('denied', 'SecurityError')),
      });
    });
    await openEditor(page);
    await page.keyboard.press('p');
    await page.getByRole('button', { name: 'Connect MIDI keyboard' }).click();
    await expect(page.getByText(/MIDI access was denied/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect MIDI keyboard' })).toBeVisible();
  });
});
