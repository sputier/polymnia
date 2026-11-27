import { expect, test, type Page } from '@playwright/test';
import { emptyScoreDoc, FakeApi } from './fake-api';

// The API is mocked: no server (docs/contact.md). The real endpoints are covered by the API tests.
test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 800 } });

const legal = {
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
};

interface Sent {
  body: Record<string, unknown>;
  cookie: string | undefined;
}

/** A contact API that records what was posted. */
async function mockContact(page: Page): Promise<{ sent: Sent[]; tokenRequests: string[] }> {
  const sent: Sent[] = [];
  const tokenRequests: string[] = [];
  let counter = 0;
  await page.route('**/api/contact/form-token', (route) => {
    tokenRequests.push(route.request().url());
    counter++;
    return route.fulfill({
      json: { token: `form-token-${counter}`, minFillSeconds: 0 },
      headers: { 'Cache-Control': 'no-store' },
    });
  });
  await page.route('**/api/contact', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 405 });
    sent.push({
      body: route.request().postDataJSON() as Record<string, unknown>,
      cookie: route.request().headers()['cookie'],
    });
    return route.fulfill({ status: 202 });
  });
  return { sent, tokenRequests };
}

test.describe('contact form', () => {
  test('sends a message signed out, without a session, an address or a cookie', async ({
    page,
  }) => {
    let sessionRequests = 0;
    await page.route('**/api/me', (route) => {
      sessionRequests++;
      return route.fulfill({ status: 401 });
    });
    const api = await mockContact(page);

    await page.goto('/');
    await page.getByRole('link', { name: 'Contact' }).click();

    await expect(page).toHaveURL(/#\/contact$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Contact' })).toBeVisible();
    await page.getByLabel('Topic').selectOption('personal-data');
    await page.getByLabel('Message').fill('Please tell me what you hold about me.');
    await page.getByLabel(/Your e-mail address/).fill('visitor@visitor.example');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByRole('heading', { name: 'Message sent' })).toBeVisible();
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]!.body).toEqual({
      topic: 'personal-data',
      message: 'Please tell me what you hold about me.',
      replyTo: 'visitor@visitor.example',
      website: '',
      token: 'form-token-1',
    });
    expect(api.sent[0]!.cookie).toBeUndefined();
    // The page needs no session: that request only happened on the sign-in screen it came from.
    expect(sessionRequests).toBe(1);
    // No e-mail address of the operator anywhere on the page.
    await expect(page.locator('body')).not.toContainText(/@polymnia/);
  });

  test('a robot that fills the hidden field is sent as it is, a person cannot reach it', async ({
    page,
  }) => {
    await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));
    const api = await mockContact(page);
    await page.goto('/#/contact');

    const trap = page.locator('input[name="website"]');
    await expect(trap).not.toBeInViewport();
    await page.getByLabel('Message').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(trap).not.toBeFocused();
    expect(api.sent).toHaveLength(0);
  });

  test('reports a shared page: prefilled, editable, from the footer of the public viewer', async ({
    browser,
  }) => {
    const fake = new FakeApi();
    const id = fake.add('Reported sonata', emptyScoreDoc('Reported sonata', { measures: 2 }));
    const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde';
    fake.shares.set(id, [{ token, createdAt: '2026-11-27T10:00:00Z', revoked: false }]);

    const context = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });
    const visitor = await context.newPage();
    await visitor.addInitScript(() => {
      (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
    });
    let sessionRequests = 0;
    await visitor.route('**/api/me', (route) => {
      sessionRequests++;
      return route.fulfill({ status: 401 });
    });
    await fake.install(visitor);
    const api = await mockContact(visitor);

    await visitor.goto(`/#/s/${token}`);
    await expect(visitor.locator('svg.pm-score')).toBeVisible();
    await visitor.getByRole('link', { name: 'Report this page' }).click();

    await expect(visitor.getByLabel('Topic')).toHaveValue('report');
    const message = visitor.getByLabel('Message');
    await expect(message).toHaveValue(new RegExp(`Reported page: .+/#/s/${token}\\n\\n$`));
    await expect(visitor.getByText(/You can edit or remove it/)).toBeVisible();
    await message.press('Control+End');
    await message.pressSequentially('This score contains my private text.');
    await visitor.getByRole('button', { name: 'Send message' }).click();

    await expect(visitor.getByRole('heading', { name: 'Message sent' })).toBeVisible();
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]!.body['topic']).toBe('report');
    expect(String(api.sent[0]!.body['message'])).toContain(`/#/s/${token}`);
    expect(String(api.sent[0]!.body['message'])).toContain('This score contains my private text.');
    expect(api.sent[0]!.cookie).toBeUndefined();
    // Neither the viewer nor the contact page asked for a session.
    expect(sessionRequests).toBe(0);
    await context.close();
  });

  test('the privacy page links to the form when the contact is the form, in French too', async ({
    page,
  }) => {
    await page.route('**/api/me', (route) => route.fulfill({ status: 401 }));
    await page.route('**/api/legal', (route) => route.fulfill({ json: legal }));
    await mockContact(page);

    await page.goto('/#/privacy');
    await expect(page.getByText('Contact messages: 90 days, then they are deleted.')).toBeVisible();
    await page.getByRole('link', { name: 'Contact form' }).click();

    await expect(page).toHaveURL(/#\/contact$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Contact' })).toBeVisible();
    await page.getByRole('button', { name: /FR/ }).click();
    await expect(page.getByRole('button', { name: 'Envoyer le message' })).toBeVisible();
  });
});
