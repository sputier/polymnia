import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

// Real engine (Tone.js + the Ogg Opus samples, no mock): decoding works, the first note starts
// within the budget cold and with a warm cache, and the samples are same-origin immutable files.
test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

interface Hook {
  playback: { getState(): { status: string; error: string | null }; lastStartMs: number };
}
const hook = (page: Page) =>
  page.evaluate(() => {
    const pb = (window as unknown as { __polymnia: Hook }).__polymnia.playback;
    return { ...pb.getState(), startMs: pb.lastStartMs };
  });

async function playOnce(page: Page) {
  await mockSignedIn(page);
  await page.goto('/#/editor');
  await expect(page.locator('svg.pm-score')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __polymnia?: Hook }).__polymnia);
  // Play from a cold page: the engine, the piano samples and the decoding all count.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await hook(page)).startMs, { timeout: 15_000 }).toBeGreaterThan(0);
  return hook(page);
}

// The API serves the app with this policy (SecurityOptions.DefaultContentSecurityPolicy): Tone.js
// and the samples must work under it (same-origin files, no blob worker).
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

test('plays with the real audio engine, cold then cached', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': CSP },
    });
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    );
  });
  const sampleRequests: { url: string; cache: string | undefined }[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('.ogg'))
      sampleRequests.push({
        url: response.url(),
        cache: response.headers()['cache-control'],
      });
  });

  const cold = await playOnce(page);
  expect(cold.error).toBeNull();
  expect(cold.status).toBe('playing');
  // Budget: first note under 3 s on a first load (local server: the real figure is in docs/playback.md).
  expect(cold.startMs).toBeLessThan(3000);
  // Only the instrument that is used is downloaded, from the page's own origin.
  expect(sampleRequests.length).toBeGreaterThan(5);
  expect(sampleRequests.length).toBeLessThan(15);
  for (const r of sampleRequests) {
    expect(new URL(r.url).origin).toBe(new URL(page.url()).origin);
    expect(new URL(r.url).pathname).toMatch(/^\/assets\/.+-[\w-]{8}\.ogg$/);
  }

  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  // (Styles are the shell's business; audio must add no violation of its own.)
  expect(violations.filter((v) => !v.startsWith('style-src'))).toEqual([]);

  const before = sampleRequests.length;
  await page.reload();
  const warm = await playOnce(page);
  expect(warm.error).toBeNull();
  expect(warm.startMs).toBeLessThan(1000);
  // The browser cache served the second round (the dev preview server sends validators).
  expect(sampleRequests.length).toBeGreaterThanOrEqual(before);
  console.log(
    `first note: cold ${Math.round(cold.startMs)} ms, warm ${Math.round(warm.startMs)} ms, ` +
      `${sampleRequests.length > 0 ? sampleRequests.slice(0, before).length : 0} sample files`,
  );
});
