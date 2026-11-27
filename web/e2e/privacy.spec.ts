import { expect, test } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';
import { FakeApi } from './fake-api';

// The API is mocked: no server, no Google (docs/privacy.md). The real endpoints are covered by the API tests.
test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 800 } });

const legal = {
  configured: true,
  operatorName: 'Example Operator',
  contact: 'privacy@polymnia.example',
  contactKind: 'email',
  address: null,
  hostingProvider: 'Example Hosting',
  hostingCountry: 'Exampleland',
  logRetentionDays: 14,
  sessionIdleDays: 7,
  sessionAbsoluteDays: 30,
};

test.describe('privacy page', () => {
  test('is reachable signed out, from the sign-in screen, in both languages', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));
    await page.route('**/api/legal', (route) => route.fulfill({ json: legal }));

    await page.goto('/');
    await page.getByRole('link', { name: 'Privacy policy' }).click();

    await expect(page).toHaveURL(/#\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
    await expect(page.getByText('Example Operator')).toBeVisible();
    await expect(page.getByRole('link', { name: 'privacy@polymnia.example' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '7. Your rights and how to use them' }),
    ).toBeVisible();

    await page.getByRole('button', { name: /FR/ }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Politique de confidentialité' }),
    ).toBeVisible();
    await expect(page.getByText('Journaux de sécurité : 14 jours.')).toBeVisible();

    await page.getByRole('link', { name: 'Retour à Polymnia' }).click();
    await expect(page.getByRole('link', { name: 'Se connecter avec Google' })).toBeVisible();
  });

  test('is reachable by URL while signed out, in dark theme', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));
    await page.route('**/api/legal', (route) => route.fulfill({ json: legal }));

    await page.goto('/#/privacy');
    await page.getByRole('button', { name: /dark theme/i }).click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
  });

  test('shows a placeholder when the operator is not configured', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));
    await page.route('**/api/legal', (route) =>
      route.fulfill({
        json: { ...legal, configured: false, operatorName: null, contact: null, contactKind: null },
      }),
    );

    await page.goto('/#/privacy');

    await expect(page.getByText('Operator details not configured')).toBeVisible();
  });
});

test.describe('account menu', () => {
  test('deletes the account after a typed confirmation, with the antiforgery header', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await new FakeApi().install(page);
    let deleteHeader: string | undefined;
    await page.route('**/api/me', (route) => {
      if (route.request().method() === 'DELETE') {
        deleteHeader = route.request().headers()['x-xsrf-token'];
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({
        json: { id: 'u1', displayName: 'Ada Lovelace', avatarUrl: null, preferredLanguage: null },
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Ada Lovelace/ }).click();
    await page.getByRole('menuitem', { name: 'Delete my account' }).click();

    const dialog = page.getByRole('dialog', { name: 'Delete your account' });
    const confirm = dialog.getByRole('button', { name: 'Delete my account' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.getByText('Your account and all its data were deleted.')).toBeVisible();
    expect(deleteHeader).toBe('test-token');
  });

  test('asks to sign in again when the session is too old', async ({ page }) => {
    await mockSignedIn(page);
    await new FakeApi().install(page);
    await page.route('**/api/me', (route) => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({ status: 403, json: { status: 403, code: 'reauth-required' } });
      }
      return route.fulfill({
        json: { id: 'u1', displayName: 'Ada Lovelace', avatarUrl: null, preferredLanguage: null },
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Ada Lovelace/ }).click();
    await page.getByRole('menuitem', { name: 'Delete my account' }).click();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await page.getByRole('dialog').getByRole('button', { name: 'Delete my account' }).click();

    const again = page.getByRole('dialog', { name: 'Sign in again to continue' });
    await expect(again.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/api/auth/login?reauth=true',
    );
  });

  test('downloads the export archive', async ({ page }) => {
    await mockSignedIn(page);
    await new FakeApi().install(page);
    await page.route('**/api/me/export', (route) =>
      route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="polymnia-export-20261127.zip"',
        },
        body: Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]),
      }),
    );

    await page.goto('/');
    await page.getByRole('button', { name: /Ada Lovelace/ }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export my data' }).click();

    expect((await download).suggestedFilename()).toBe('polymnia-export-20261127.zip');
    await expect(page.getByText('Your data was downloaded.')).toBeVisible();
  });

  test('links the privacy policy from the menu', async ({ page }) => {
    await mockSignedIn(page);
    await new FakeApi().install(page);

    await page.goto('/');
    await page.getByRole('button', { name: /Ada Lovelace/ }).click();

    await expect(page.getByRole('menuitem', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '#/privacy',
    );
  });
});
