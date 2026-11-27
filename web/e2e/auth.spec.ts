import { expect, test } from '@playwright/test';

// The API is mocked: no server, no Google. A real sign-in needs a Google OAuth client (see docs/authentication.md).
test.use({ locale: 'en-US', colorScheme: 'light' });

test('anonymous visitor sees the sign-in screen and the button targets the login endpoint', async ({
  page,
}) => {
  await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Write. Hear. Share.' })).toBeVisible();
  const signIn = page.getByRole('link', { name: 'Sign in with Google' });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute('href', '/api/auth/login');
  await expect(signIn).toBeFocused();
});

test('pressing Enter starts the sign-in redirect', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));
  let loginRequested = false;
  await page.route('**/api/auth/login*', (route) => {
    loginRequested = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Google</h1>' });
  });

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Google' })).toBeVisible();
  expect(loginRequested).toBe(true);
});

test('the sign-in screen follows the language and the theme', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));
  await page.goto('/');

  await page.getByRole('button', { name: /FR/ }).click();
  await expect(page.getByRole('link', { name: 'Se connecter avec Google' })).toBeVisible();

  await page.getByRole('button', { name: /thème sombre/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('link', { name: 'Se connecter avec Google' })).toBeVisible();
});

test('a failed sign-in is reported', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));

  await page.goto('/?signin=failed');

  await expect(page.getByRole('alert')).toContainText('Sign-in did not complete');
});

test('signed-in user sees the app and can sign out with the antiforgery header', async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: '__Host-XSRF-TOKEN', value: 'tok-1', domain: 'localhost', path: '/', secure: true },
  ]);
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: { id: 'u1', displayName: 'Ada Lovelace', avatarUrl: null, preferredLanguage: null },
    }),
  );
  await page.route('**/api/auth/antiforgery', (route) => route.fulfill({ status: 204 }));
  let logoutHeader: string | undefined;
  await page.route('**/api/auth/logout', (route) => {
    logoutHeader = route.request().headers()['x-xsrf-token'];
    return route.fulfill({ status: 204 });
  });

  await page.goto('/');
  await expect(page.getByText('Ada Lovelace')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
  expect(logoutHeader).toBe('tok-1');
});
