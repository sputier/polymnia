import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';
import { expectBudget } from './perf-stats';

test.use({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });

async function openEditor(page: Page) {
  await mockSignedIn(page);
  await page.goto('/#/editor');
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!window.__polymnia?.store);
}

const palette = (page: Page) =>
  page.getByRole('dialog', { name: /Command palette|Palette de commandes/ });

test.describe('command palette (English)', () => {
  test.use({ locale: 'en-US' });

  test('Ctrl+K opens it, finds a command in French and in English, Esc restores focus', async ({
    page,
  }) => {
    await openEditor(page);
    const trigger = page.getByRole('button', { name: 'Commands…' });
    await trigger.focus();
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    const input = page.getByRole('combobox', { name: 'Search commands' });
    await expect(input).toBeFocused();

    await input.fill('silence');
    await expect(page.getByRole('option', { selected: true })).toContainText('Enter a rest');
    await input.fill('rest');
    await expect(page.getByRole('option', { selected: true })).toContainText('Enter a rest');
    await input.fill('bemol');
    await expect(page.getByRole('option', { selected: true })).toContainText('Flat');

    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('runs a command: Simple to Advanced reveals the inspector', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByRole('button', { name: 'Inspector panel' })).toHaveCount(0);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('advanced');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Inspector panel' })).toBeVisible();
  });

  test('runs a note-entry command: Enter a rest moves the cursor in note input', async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press('n');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('enter a rest');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.__polymnia.store.getState().cursor.tick))
      .toBeGreaterThan(0);
  });

  test('arrows move the highlight, disabled commands are shown disabled', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('option', { name: /^Undo/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    const first = await page.getByRole('option', { selected: true }).innerText();
    await page.keyboard.press('ArrowDown');
    expect(await page.getByRole('option', { selected: true }).innerText()).not.toBe(first);
  });

  test('Alt+F hides everything but the score, Esc brings it back', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByRole('banner')).toBeVisible();
    await page.keyboard.press('Alt+f');
    await expect(page.getByRole('banner')).toBeHidden();
    await expect(page.getByRole('contentinfo')).toBeHidden();
    await expect(page.locator('svg.pm-score')).toBeVisible();
    await expect(page.getByText('to exit')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByText('to exit')).toBeHidden();
  });

  test('? opens the cheat sheet, also with the AZERTY key (Shift+comma)', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Note input' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Print' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '?', code: 'Comma', shiftKey: true, bubbles: true }),
      ),
    );
    await expect(sheet).toBeVisible();
  });

  test(
    'opens in under 50 ms and filters a keystroke in under 5 ms',
    { tag: '@perf' },
    async ({ page }) => {
      await openEditor(page);
      // Warm up: the dialogs chunk is fetched in idle time.
      await page.keyboard.press('Control+k');
      await expect(palette(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(palette(page)).toBeHidden();

      const round = () =>
        page.evaluate(async () => {
          const dialog = () => document.querySelector('[role="dialog"]');
          const open = await new Promise<number>((resolve) => {
            const start = performance.now();
            const observer = new MutationObserver(() => {
              if (dialog()) {
                observer.disconnect();
                resolve(performance.now() - start);
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            document.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'k',
                code: 'KeyK',
                ctrlKey: true,
                bubbles: true,
              }),
            );
          });
          const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
          const keystrokes: number[] = [];
          let text = '';
          for (const ch of 'enter a rest') {
            text += ch;
            const start = performance.now();
            setter.call(input, text);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            // React flushes a discrete event in a microtask.
            await Promise.resolve();
            keystrokes.push(performance.now() - start);
          }
          return { open, keystrokes };
        });
      // 3 warm-up rounds (discarded), then 12 samples of the open and of 12 keystrokes each.
      const opens: number[] = [];
      const keystrokes: number[] = [];
      for (let i = 0; i < 15; i++) {
        const r = await round();
        if (i >= 3) {
          opens.push(r.open);
          keystrokes.push(...r.keystrokes);
        }
        await page.keyboard.press('Escape');
        await expect(palette(page)).toBeHidden();
      }
      expectBudget('palette open', opens, { medianMs: 50 });
      expectBudget('palette keystroke', keystrokes, { medianMs: 5 });
    },
  );
});

test.describe('command palette (French)', () => {
  test.use({ locale: 'fr-FR' });

  test('is labelled in French and finds "rest" as well as "silence"', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('Control+k');
    const input = page.getByRole('combobox', { name: 'Rechercher une commande' });
    await expect(input).toBeFocused();
    await input.fill('rest');
    await expect(page.getByRole('option', { selected: true })).toContainText('Saisir un silence');
    await input.fill('silence');
    await expect(page.getByRole('option', { selected: true })).toContainText('Saisir un silence');
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Raccourcis clavier' })).toBeVisible();
  });
});
