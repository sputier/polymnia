import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';
import { emptyScoreDoc, FakeApi } from './fake-api';

test.use({
  locale: 'en-US',
  colorScheme: 'light',
  viewport: { width: 1280, height: 800 },
  permissions: ['clipboard-read', 'clipboard-write'],
});

type W = Window & {
  __polymnia?: { playback: { getState(): { status: string } } };
  __polymniaAudioLog?: unknown;
};

async function mockAudio(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
  });
}

async function openOwner(page: Page, fake: FakeApi, id: string) {
  await mockSignedIn(page);
  await mockAudio(page);
  await fake.install(page);
  await page.goto(`/#/scores/${id}`);
  await expect(page.locator('svg.pm-score')).toBeVisible();
}

test.describe('share links', () => {
  test('share, open signed out, play, revoke', async ({ page, browser }) => {
    const fake = new FakeApi();
    const id = fake.add('Shared sonata', emptyScoreDoc('Shared sonata', { measures: 4 }));
    await openOwner(page, fake, id);

    // Owner: create the link from the top bar, copy it.
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share' });
    await expect(dialog).toContainText('This score is not shared');
    await dialog.getByRole('button', { name: 'Create link' }).click();
    const link = dialog.getByLabel('Share link');
    const url = await link.inputValue();
    expect(url).toMatch(/\/#\/s\/[A-Za-z0-9_-]{43}$/);
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByText('Link copied.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    // The export actions are in the dialog too.
    await expect(dialog.getByRole('button', { name: 'MusicXML (.musicxml)' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'PDF' })).toBeVisible();

    // A visitor with no account and no cookie.
    const visitorContext = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });
    const visitor = await visitorContext.newPage();
    let sessionRequests = 0;
    await visitor.route('**/api/me', (route) => {
      sessionRequests++;
      return route.fulfill({ status: 401 });
    });
    await mockAudio(visitor);
    await fake.install(visitor);
    await visitor.goto(url);

    await expect(visitor.getByRole('heading', { name: 'Shared sonata' })).toBeVisible();
    await expect(visitor.locator('svg.pm-score')).toBeVisible();
    await expect(visitor.getByText('Read only')).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'Made with Polymnia' })).toHaveAttribute(
      'href',
      '/',
    );
    // No sign-in screen, no editing interface, no session request.
    await expect(visitor.getByRole('button', { name: /sign in/i })).toHaveCount(0);
    await expect(visitor.getByRole('textbox')).toHaveCount(0);
    await expect(visitor.getByRole('button', { name: /export|share|import/i })).toHaveCount(0);
    expect(sessionRequests).toBe(0);
    await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    // The one public request carries no cookie and no referrer.
    expect(fake.sharedRequests).toHaveLength(1);
    expect(fake.sharedRequests[0]).toMatchObject({ cookie: null, referer: null });
    // The token travels in a header: the URL of the request has none.
    expect(fake.sharedRequests[0]!.path).toBe('/api/shared');

    // Playback works (the audio engine is mocked).
    await visitor.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(() =>
        visitor.evaluate(() => (window as unknown as W).__polymnia?.playback.getState().status),
      )
      .toBe('playing');
    expect(await visitor.evaluate(() => !!(window as unknown as W).__polymniaAudioLog)).toBe(true);
    await visitor.getByRole('button', { name: 'Stop', exact: true }).click();

    // Owner: stop sharing. The status no longer offers a link and the viewer is refused.
    await dialog.getByRole('button', { name: 'Stop sharing' }).click();
    await expect(dialog).toContainText('This score is not shared');
    await visitor.reload();
    await expect(
      visitor.getByRole('heading', { name: 'This link is no longer valid.' }),
    ).toBeVisible();
    await expect(visitor.locator('svg.pm-score')).toHaveCount(0);
    await visitorContext.close();
  });

  test('a new link replaces the old one, and the old one stops working', async ({
    page,
    browser,
  }) => {
    const fake = new FakeApi();
    const id = fake.add('Twice shared');
    await openOwner(page, fake, id);

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share' });
    await dialog.getByRole('button', { name: 'Create link' }).click();
    const first = await dialog.getByLabel('Share link').inputValue();
    await dialog.getByRole('button', { name: 'New link' }).click();
    await expect(dialog.getByLabel('Share link')).not.toHaveValue(first);
    const second = await dialog.getByLabel('Share link').inputValue();

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await mockAudio(visitor);
    await fake.install(visitor);
    await visitor.goto(first);
    await expect(
      visitor.getByRole('heading', { name: 'This link is no longer valid.' }),
    ).toBeVisible();
    await visitor.goto(second);
    await expect(visitor.getByRole('heading', { name: 'Twice shared' })).toBeVisible();
    await visitorContext.close();
  });

  test('closing and reopening the dialog never shows the old link again', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('Private link');
    await openOwner(page, fake, id);

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Share' });
    await dialog.getByRole('button', { name: 'Create link' }).click();
    await expect(dialog.getByLabel('Share link')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Share' });
    await expect(dialog).toContainText('Sharing has been on since');
    await expect(dialog.getByLabel('Share link')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'New link' })).toBeVisible();
  });

  test('the command palette has a Share command', async ({ page }) => {
    const fake = new FakeApi();
    const id = fake.add('By palette');
    await openOwner(page, fake, id);

    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('share');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Share' })).toBeVisible();
  });
});
