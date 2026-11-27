import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';
import { FakeApi } from './fake-api';

// Route splitting (#50): each screen downloads its own chunks, the active language is the only catalog loaded
// up front. See docs/development.md, "Bundle".

const EDITOR_CHUNK = /\/assets\/(engraver|EditorLayout|ScoreEditorRoute)-[\w-]+\.js$/;
const catalogChunk = (language: string) => new RegExp(`/assets/${language}-[\\w-]+\\.js$`);

function recordScripts(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') urls.push(new URL(request.url()).pathname);
  });
  return urls;
}

async function setup(page: Page, hash: string): Promise<string[]> {
  const scripts = recordScripts(page);
  await mockSignedIn(page);
  await new FakeApi().install(page);
  await page.goto(`/#${hash}`);
  return scripts;
}

test.describe('route splitting', () => {
  test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 800 } });

  test('the library renders without requesting any editor chunk', async ({ page }) => {
    // Idle callbacks never run here: this is what the first paint of the library costs.
    await page.addInitScript(() => {
      window.requestIdleCallback = () => 0;
    });
    const scripts = await setup(page, '/');
    await expect(page.getByRole('heading', { name: 'My scores' })).toBeVisible();
    expect(scripts.filter((url) => EDITOR_CHUNK.test(url))).toEqual([]);
    expect(scripts.some((url) => /\/assets\/Library-/.test(url))).toBe(true);
  });

  test('the library prefetches the editor in idle time, so opening a score is instant', async ({
    page,
  }) => {
    const scripts = await setup(page, '/');
    await expect(page.getByRole('heading', { name: 'My scores' })).toBeVisible();
    await expect
      .poll(() => scripts.filter((url) => EDITOR_CHUNK.test(url)).length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);
  });

  test('the editor route does not load the library', async ({ page }) => {
    const scripts = await setup(page, '/editor');
    await expect(page.getByRole('main').or(page.locator('svg.pm-score')).first()).toBeVisible();
    await page.waitForSelector('svg.pm-score .vf-pm-system', { state: 'attached' });
    expect(scripts.some((url) => /\/assets\/Library-/.test(url))).toBe(false);
    expect(scripts.some((url) => /\/assets\/(Viewer|Privacy)-/.test(url))).toBe(false);
  });

  test('the privacy page and the shared viewer stay out of the first load', async ({ page }) => {
    const scripts = await setup(page, '/');
    await expect(page.getByRole('heading', { name: 'My scores' })).toBeVisible();
    expect(scripts.some((url) => /\/assets\/(Viewer|Privacy)-/.test(url))).toBe(false);
  });
});

test.describe('language catalogs', () => {
  test('only the active language is downloaded; the other one on switch', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'fr-FR' });
    const page = await context.newPage();
    const scripts = await setup(page, '/');
    await expect(page.getByRole('heading', { name: 'Mes partitions' })).toBeVisible();
    expect(scripts.some((url) => catalogChunk('fr').test(url))).toBe(true);
    // The idle prefetch of the palette must not drag the other language along either.
    await page.waitForTimeout(1500);
    expect(scripts.some((url) => catalogChunk('en').test(url))).toBe(false);

    await page.getByRole('button', { name: 'EN' }).click();
    await expect(page.getByRole('heading', { name: 'My scores' })).toBeVisible();
    expect(scripts.some((url) => catalogChunk('en').test(url))).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await context.close();
  });
});
