import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

test.use({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });

async function openEditor(page: Page) {
  await mockSignedIn(page);
  await page.goto('/#/editor');
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!window.__polymnia?.store);
}

const ATTRIBUTION =
  'Choir samples derived from VocalSet (Wilkins, Seetharaman, Wahl, Pardo 2018), CC BY 4.0, https://doi.org/10.5281/zenodo.1442513 — epic-choir by thepok';

test.describe('about and credits (English)', () => {
  test.use({ locale: 'en-US' });

  test('the toolbar button lists every sample set with its license and the CC BY credit', async ({
    page,
  }) => {
    await openEditor(page);
    const trigger = page.getByRole('button', { name: 'About and credits' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'About and credits' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('tbody tr')).toHaveCount(10);
    const voice = dialog.locator('tr[data-set="voice"]');
    await expect(voice).toContainText('VocalSet');
    await expect(voice.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    );
    await expect(dialog).toContainText(ATTRIBUTION);
    await expect(dialog.locator('tr[data-set="guitar-steel"]')).toContainText('Meta');
    await expect(dialog.locator('tr[data-set="cello"]')).toContainText('Karoryfer');
    // External links open in a new tab and never leak the opener.
    for (const link of await dialog.getByRole('link').all())
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('the command palette opens it too', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('credits');
    await expect(page.getByRole('option', { selected: true })).toContainText('About and credits');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'About and credits' })).toBeVisible();
  });
});

test.describe('à propos et crédits (français)', () => {
  test.use({ locale: 'fr-FR' });

  test('the dialog is in French, the credit line stays as the license asks', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'À propos et crédits' }).click();
    const dialog = page.getByRole('dialog', { name: 'À propos et crédits' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('tr[data-set="cello"] th')).toHaveText('Violoncelle');
    await expect(dialog).toContainText(ATTRIBUTION);
    await expect(dialog.getByRole('button', { name: 'Fermer' })).toBeVisible();
  });
});
