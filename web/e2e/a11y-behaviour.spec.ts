import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';
import { emptyScoreDoc, FakeApi } from './fake-api';

// Accessibility behaviours (#19, docs/accessibility.md) that axe cannot judge: skip links, focus return,
// announcements, reduced motion, reflow. The axe pass itself is in a11y.spec.ts.
test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

async function mockAudio(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
  });
}

async function openEditor(page: Page) {
  await mockSignedIn(page);
  await mockAudio(page);
  await page.goto('/#/editor');
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!window.__polymnia?.store);
}

const live = (page: Page) => page.locator('.score-view [role="status"]');

test.describe('skip links', () => {
  test('editor: the first Tab stop skips to the score, shortcuts keep working there', async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('button', { name: 'Skip to the score' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Score' })).toBeFocused();
    // The keyboard model is global: typing a note from there works.
    await page.keyboard.press('n');
    await expect(
      page.getByRole('status').filter({ hasText: 'Note input on' }).first(),
    ).toBeAttached();
  });

  test('library: skips the toolbar to the list', async ({ page }) => {
    await mockSignedIn(page);
    await new FakeApi().install(page);
    await page.goto('/#/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Skip to the content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('the skip link is off screen until it is focused', async ({ page }) => {
    await openEditor(page);
    const skip = page.getByRole('button', { name: 'Skip to the score' });
    await expect(skip).not.toBeInViewport();
  });
});

test.describe('dialogs: focus goes in, stays in, comes back', () => {
  test('credits: focus returns to the button that opened it, Tab stays inside', async ({
    page,
  }) => {
    await openEditor(page);
    const trigger = page.getByRole('button', { name: 'About and credits' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'About and credits' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('library: new-score and delete-account dialogs return the focus', async ({ page }) => {
    await mockSignedIn(page);
    await new FakeApi().install(page);
    await page.goto('/#/');
    const newScore = page.locator('.toolbar-actions .btn.primary').first();
    await newScore.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(newScore).toBeFocused();

    const account = page.locator('.account-trigger');
    await account.click();
    await page.getByRole('menuitem').last().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(account).toBeFocused();
  });
});

test.describe('announcements', () => {
  test('describe the measure (Alt+M and the palette) reads the measure out', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('n');
    await page.keyboard.press('5');
    await page.keyboard.press('c');
    await page.keyboard.press('d');
    await page.keyboard.press('Alt+m');
    await expect(live(page)).toContainText(/^Measure 1: C\d quarter, D\d quarter, rest half$/);

    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('describe');
    await expect(page.getByRole('option', { selected: true })).toContainText(
      'Describe the measure',
    );
    await page.keyboard.press('Enter');
    await expect(live(page)).toContainText('Measure 1:');
  });

  test('the same sentence twice is spoken twice: a new node each time', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('Alt+m');
    const first = await live(page).locator('span').elementHandle();
    await page.keyboard.press('Alt+m');
    await expect
      .poll(async () => (await live(page).locator('span').elementHandle()) !== first)
      .toBe(true);
  });

  test('note entry announces pitch, duration, measure and beat', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('n');
    await page.keyboard.press('5');
    await page.keyboard.press('e');
    await expect(live(page)).toContainText(/E\d quarter, measure 1 beat 1/);
  });

  test('playback: start and stop are announced, nothing in between', async ({ page }) => {
    await openEditor(page);
    const status = page.locator('.transport-status');
    await expect(status).toHaveText('');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(status).toHaveText('Playback started');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(status).toHaveText('Playback stopped');
  });

  test('French: the measure is described in French', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'fr-FR', colorScheme: 'light' });
    const page = await context.newPage();
    await openEditor(page);
    await page.keyboard.press('Alt+m');
    await expect(live(page)).toContainText(/^Mesure 1: /);
    await context.close();
  });
});

test.describe('keyboard only walkthrough', () => {
  test('library to editor: create, enter a melody and a chord, play, share, export, no trap', async ({
    page,
  }) => {
    const fake = new FakeApi();
    fake.add('Existing', emptyScoreDoc('Existing', { measures: 2 }));
    await mockSignedIn(page);
    await mockAudio(page);
    await fake.install(page);
    await page.goto('/#/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Create a score: N opens the dialog, Enter submits it.
    await page.keyboard.press('n');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('svg.pm-score')).toBeVisible();
    await page.waitForFunction(() => !!window.__polymnia?.store);

    // A melody, then a chord symbol.
    await page.keyboard.press('n');
    await page.keyboard.press('5');
    await page.keyboard.press('c');
    await page.keyboard.press('d');
    await page.keyboard.press('e');
    await expect(live(page)).toContainText(/E\d quarter, measure 1 beat 3/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+k');
    const chord = page.getByRole('textbox', { name: /chord/i });
    await expect(chord).toBeFocused();
    await page.keyboard.type('Am');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    // Play and stop with Space.
    await page.keyboard.press('Space');
    await expect(page.locator('.transport-status')).toHaveText('Playback started');
    await page.keyboard.press('Space');
    await expect(page.locator('.transport-status')).toHaveText('Playback paused');

    // Share dialog: opens, traps, closes, the focus is not lost in the page.
    await page.keyboard.press('Control+Shift+L');
    const share = page.getByRole('dialog', { name: 'Share' });
    await expect(share).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(share).toBeHidden();

    // Export menu by keyboard: Enter opens it, arrows move, Escape closes and returns to the button.
    const exportButton = page.getByRole('button', { name: 'Export', exact: true });
    await exportButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(exportButton).toBeFocused();
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('dialogs do not animate and playback follow never scrolls smoothly', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const durations = await dialog.evaluate((d) => {
      const style = getComputedStyle(d);
      return [style.animationName, style.animationDuration];
    });
    // Either no animation at all or one that lasts a blink.
    expect(durations[0] === 'none' || parseFloat(durations[1]!) < 0.001).toBe(true);
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe('auto');
  });
});

test.describe('reflow at 320 CSS px (WCAG 1.4.10)', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  const noHorizontalScroll = (page: Page) =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );

  test('library, new-score dialog, privacy, contact and the shared viewer fit', async ({
    page,
    browser,
  }) => {
    const fake = new FakeApi();
    const id = fake.add('Reflow piece', emptyScoreDoc('Reflow piece', { measures: 4 }));
    await mockSignedIn(page);
    await mockAudio(page);
    await page.route('**/api/legal', (route) =>
      route.fulfill({
        json: {
          configured: true,
          operatorName: 'Example Operator',
          contact: '/#/contact',
          contactKind: 'page',
          address: null,
          hostingProvider: 'Example Hosting',
          hostingCountry: 'Exampleland',
          logRetentionDays: 14,
          contactRetentionDays: 90,
          sessionIdleDays: 7,
          sessionAbsoluteDays: 30,
        },
      }),
    );
    await page.route('**/api/contact/form-token', (route) =>
      route.fulfill({ json: { token: 't', minFillSeconds: 0 } }),
    );
    await fake.install(page);

    await page.goto('/#/');
    await expect(page.getByRole('listitem').first()).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.locator('.toolbar-actions .btn.primary').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const box = await page.getByRole('dialog').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');

    await page.goto('/#/privacy');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.goto('/#/contact');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    // The shared viewer: a share link made through the owner's session.
    const token = 'A'.repeat(43);
    fake.shares.set(id, [{ token, createdAt: new Date().toISOString(), revoked: false }]);
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
    const visitor = await context.newPage();
    await mockAudio(visitor);
    await fake.install(visitor);
    await visitor.goto(`/#/s/${token}`);
    await expect(visitor.locator('svg.pm-score')).toBeVisible();
    expect(await noHorizontalScroll(visitor)).toBe(true);
    await context.close();
  });
});
