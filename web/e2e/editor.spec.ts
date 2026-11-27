import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US', colorScheme: 'light' });

test.describe('editor shell (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('opens from the home page with landmarks and a status bar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Open the editor' }).click();
    await expect(page).toHaveURL(/#\/editor$/);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Instruments' })).toBeVisible();
    await expect(page.getByRole('contentinfo', { name: 'Editor status' })).toContainText('SELECT');
    await expect(page.getByRole('list', { name: 'Shortcut reminder' })).toBeVisible();
  });

  test('toggles the instruments panel by click and with Ctrl+B', async ({ page }) => {
    await page.goto('/#/editor');
    const toggle = page.getByRole('button', { name: 'Instruments panel' });
    const panel = page.getByRole('complementary', { name: 'Instruments' });
    await expect(panel).toBeVisible();

    await toggle.click();
    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Control+b');
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('switches Simple/Advanced and toggles the inspector with Ctrl+I', async ({ page }) => {
    await page.goto('/#/editor');
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toHaveCount(0);
    await expect(page.getByText('Need more tools? Switch to Advanced mode')).toBeVisible();

    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(inspector).toBeVisible();

    await page.keyboard.press('Control+i');
    await expect(inspector).toBeHidden();

    await page.keyboard.press('Alt+a');
    await expect(page.getByRole('button', { name: 'Simple', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Inspector panel' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Advanced', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('does not fire shortcuts while typing in the title', async ({ page }) => {
    await page.goto('/#/editor');
    await page.getByRole('textbox', { name: 'Score title' }).fill('My piece');
    await page.keyboard.press('Control+b');
    await expect(page.getByRole('complementary', { name: 'Instruments' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My piece');
  });

  test('switches theme and language', async ({ page }) => {
    await page.goto('/#/editor');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: /FR/ }).click();
    await expect(page.getByRole('contentinfo', { name: "État de l'éditeur" })).toContainText(
      'SÉLECTION',
    );
  });

  test('reaches every top bar control with the keyboard', async ({ page }) => {
    await page.goto('/#/editor');
    const names = [
      'Back to home',
      'Instruments panel',
      'Score title',
      'Simple',
      'Advanced',
      'Share',
      'Export',
      'Switch to dark theme',
      'EN English',
      'FR Français',
    ];
    for (const name of names) {
      await page.keyboard.press('Tab');
      await expect(
        page.getByRole(
          name === 'Score title' ? 'textbox' : name === 'Back to home' ? 'link' : 'button',
          { name, exact: true },
        ),
      ).toBeFocused();
    }
  });
});

test.describe('editor shell (768 px)', () => {
  test.use({ viewport: { width: 768, height: 900 } });

  test('side panels become overlays with a close button', async ({ page }) => {
    await page.goto('/#/editor');
    const panel = page.getByRole('complementary', { name: 'Instruments' });
    await expect(panel).toBeHidden();

    await page.getByRole('button', { name: 'Instruments panel' }).click();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS('position', 'absolute');
    await expect(page.getByRole('button', { name: 'Close panel' })).toBeFocused();

    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(panel).toBeHidden();

    await page.getByRole('button', { name: 'Instruments panel' }).click();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});
