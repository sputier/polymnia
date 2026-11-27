import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

// The audio engine is replaced by a silent one driven by the wall clock (docs/playback.md).
interface AudioLog {
  notes: { staffId: string; midi: number; time: number; duration: number }[];
  clicks: { time: number; accent: boolean }[];
  muted: string[];
  sets: string[];
}
interface PlaybackHook {
  getState(): { status: string; loop: boolean; tempoScale: number };
  positionTick(): number;
  seekTick(tick: number): void;
  setTempoScale(scale: number): void;
  lastStartMs: number;
}
type W = Window & {
  __polymnia: { playback: PlaybackHook };
  __polymniaAudioLog: AudioLog;
};

async function openEditor(page: Page, measures = 4) {
  await page.addInitScript(() => {
    (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
  });
  await page.goto(`/#/editor?new=${measures}`);
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as W).__polymnia?.playback);
}

/** Types a melody in note input: `n`, a duration key, then the letters. */
async function enterNotes(page: Page, duration: string, letters: string) {
  await page.keyboard.press('n');
  await page.keyboard.press(duration);
  for (const letter of letters) await page.keyboard.press(letter);
  await page.keyboard.press('Escape');
}

const status = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__polymnia?.playback.getState().status);

test.describe('playback', () => {
  test('plays and stops: cursor moves and the notes light up', async ({ page }) => {
    await openEditor(page);
    await enterNotes(page, '5', 'cdefgabc');
    const playButton = page.getByRole('button', { name: 'Play', exact: true });
    await playButton.click();
    await expect.poll(() => status(page)).toBe('playing');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

    const playing = page.locator('svg.pm-score .pm-event.pm-playing');
    await expect(playing.first()).toBeVisible();
    const cursor = page.locator('svg.pm-score rect.pm-cursor');
    await expect(cursor).toBeVisible();
    const x1 = Number(await cursor.getAttribute('x'));
    // The cursor moves on to the next notes (a quarter note lasts 0.5 s at the default 120 bpm).
    await expect
      .poll(async () => Number(await cursor.getAttribute('x')), { timeout: 4000 })
      .not.toBe(x1);

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect.poll(() => status(page)).toBe('stopped');
    await expect(playing).toHaveCount(0);
    await expect(cursor).toBeHidden();
  });

  test('Space plays and pauses, Home goes back to the start', async ({ page }) => {
    await openEditor(page);
    await enterNotes(page, '5', 'cdefgabc');
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Space');
    await expect.poll(() => status(page)).toBe('playing');
    await expect
      .poll(
        () => page.evaluate(() => (window as unknown as W).__polymnia?.playback.positionTick()),
        {
          timeout: 4000,
        },
      )
      .toBeGreaterThan(1000);

    await page.keyboard.press('Space');
    await expect.poll(() => status(page)).toBe('paused');
    const paused = await page.evaluate(() =>
      (window as unknown as W).__polymnia?.playback.positionTick(),
    );
    await page.waitForTimeout(400);
    expect(
      await page.evaluate(() => (window as unknown as W).__polymnia?.playback.positionTick()),
    ).toBe(paused);

    await page.keyboard.press('Home');
    expect(
      await page.evaluate(() => (window as unknown as W).__polymnia?.playback.positionTick()),
    ).toBe(0);
    await page.keyboard.press('Space');
    await expect.poll(() => status(page)).toBe('playing');
  });

  test('Space does not play while typing the title', async ({ page }) => {
    await openEditor(page);
    const title = page.getByRole('textbox', { name: 'Score title' });
    await title.click();
    await page.keyboard.type('a b');
    await expect(title).toHaveValue('a b');
    expect(await status(page)).toBe('stopped');
  });

  test('plays the selection first, and loops it', async ({ page }) => {
    await openEditor(page);
    await enterNotes(page, '5', 'cdefgabc');
    // Select the 3rd note (E4): the playhead goes there.
    const events = page.locator('svg.pm-score .pm-event');
    await events.nth(2).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as W).__polymnia?.playback.positionTick()))
      .toBe(1920);

    await page.getByRole('button', { name: /^Loop/ }).click();
    await expect(page.getByRole('button', { name: /^Loop/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The notes heard while entering them are not part of the playback.
    const heard = await page.evaluate(
      () => (window as unknown as W).__polymniaAudioLog?.notes.length ?? 0,
    );
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => status(page)).toBe('playing');
    await page.waitForTimeout(2500);
    // Looping one quarter note: still playing, and the note was attacked several times.
    expect(await status(page)).toBe('playing');
    const attacks = await page.evaluate(
      (from) =>
        (window as unknown as W).__polymniaAudioLog?.notes.slice(from).filter((n) => n.midi === 76)
          .length,
      heard,
    );
    expect(attacks).toBeGreaterThanOrEqual(3);
    expect(
      await page.evaluate(
        (from) =>
          (window as unknown as W).__polymniaAudioLog?.notes.slice(from).some((n) => n.midi === 77),
        heard,
      ),
    ).toBe(false);
  });

  test('every entered note is heard on the instrument of its staff', async ({ page }) => {
    await openEditor(page);
    await enterNotes(page, '5', 'c');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as W).__polymniaAudioLog?.notes.map((n) => n.midi)),
      )
      .toEqual([72]);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as W).__polymniaAudioLog?.sets))
      .toContain('piano');
  });

  test('tempo control slows the playback down and the metronome clicks', async ({ page }) => {
    await openEditor(page);
    await enterNotes(page, '5', 'cdef');
    await page.getByRole('button', { name: 'Metronome' }).click();
    await expect(page.getByRole('button', { name: 'Metronome' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const slider = page.getByRole('slider', { name: 'Tempo' });
    await slider.fill('50');
    await expect(page.locator('.transport-tempo output')).toContainText('♩ = 50');
    await page.evaluate(() => (window as unknown as W).__polymnia.playback.seekTick(0));
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as W).__polymniaAudioLog?.clicks.length))
      .toBeGreaterThan(0);
    const [first, second] = await page.evaluate(
      () => (window as unknown as W).__polymniaAudioLog?.clicks,
    );
    expect(first!.accent).toBe(true);
    // 50 bpm: 1.2 s between beats.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as W).__polymniaAudioLog?.clicks.length), {
        timeout: 4000,
      })
      .toBeGreaterThan(1);
    const clicks = await page.evaluate(() => (window as unknown as W).__polymniaAudioLog?.clicks);
    expect(clicks[1]!.time - clicks[0]!.time).toBeCloseTo(1.2, 1);
    void second;
  });

  test('mute and solo per staff (Advanced mode)', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Mixer' })).toBeVisible();
    await page
      .getByRole('button', { name: /^Mute Piano/ })
      .first()
      .click();
    await expect(page.getByRole('button', { name: /^Mute Piano/ }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page
      .getByRole('button', { name: /^Solo Piano/ })
      .nth(1)
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as W).__polymniaAudioLog?.muted.length ?? 0),
      )
      .toBeGreaterThan(0);
  });

  test('the page scrolls to follow the cursor', async ({ page }) => {
    await openEditor(page, 40);
    const area = page.locator('.score-area');
    expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(0);
    await area.evaluate((el) => (el.scrollTop = 0));
    // Start far down the score: the view has to jump to the cursor.
    await page.evaluate(() => (window as unknown as W).__polymnia?.playback.seekTick(3840 * 30));
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(() => area.evaluate((el) => el.scrollTop), { timeout: 5000 })
      .toBeGreaterThan(300);
    await page.getByRole('button', { name: 'Stop' }).click();
  });
});
