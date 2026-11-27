import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US', colorScheme: 'light' });

// The app is behind the sign-in screen: the API is mocked as signed in (see auth.spec.ts for the rest).
test.beforeEach(async ({ page }) => {
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: { id: 'u1', displayName: 'Ada Lovelace', avatarUrl: null, preferredLanguage: null },
    }),
  );
  await page.route('**/api/auth/antiforgery', (route) => route.fulfill({ status: 204 }));
});

test('loads, switches theme and language without reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Polymnia' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const marker = await page.evaluate(() => {
    (window as unknown as { __marker: number }).__marker = 1;
    return 1;
  });

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(13, 15, 20)');

  await page.getByRole('button', { name: /FR/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByText('Composez de la musique dans votre navigateur.')).toBeVisible();

  const stillThere = await page.evaluate(
    () => (window as unknown as { __marker?: number }).__marker,
  );
  expect(stillThere).toBe(marker); // no page reload happened

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});

test('follows the OS dark preference on first visit', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark', locale: 'fr-FR' });
  const page = await context.newPage();
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: { id: 'u1', displayName: 'Ada Lovelace', avatarUrl: null, preferredLanguage: null },
    }),
  );
  await page.route('**/api/auth/antiforgery', (route) => route.fulfill({ status: 204 }));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await context.close();
});
