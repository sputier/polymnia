import { test, type Browser } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';
import { FakeApi } from './fake-api';
import { expectBudget } from './perf-stats';

// Time to interactive of the two main screens on a cold cache, on a throttled device (CPU x4, 40 ms of latency per
// request: a mid-range phone on a decent connection). The initial bundle (#50) is what keeps these low; the
// numbers before and after the work are in the pull request. See docs/development.md, "Bundle".

const RUNS = 7;

async function coldLoad(
  browser: Browser,
  hash: string,
  ready: (page: import('@playwright/test').Page) => Promise<unknown>,
): Promise<number> {
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 40,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await page.addInitScript(() => {
      (window as unknown as { __polymniaAudio: string }).__polymniaAudio = 'mock';
    });
    await mockSignedIn(page);
    await new FakeApi().install(page);
    const start = Date.now();
    await page.goto(`/#${hash}`, { waitUntil: 'commit' });
    await ready(page);
    return Date.now() - start;
  } finally {
    await context.close();
  }
}

async function measure(
  browser: Browser,
  hash: string,
  ready: (page: import('@playwright/test').Page) => Promise<unknown>,
): Promise<number[]> {
  await coldLoad(browser, hash, ready); // warm-up, discarded
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) samples.push(await coldLoad(browser, hash, ready));
  return samples;
}

test(
  'the library is interactive in under 1 s on a throttled device',
  { tag: '@perf' },
  async ({ browser }) => {
    test.setTimeout(120_000);
    const samples = await measure(browser, '/', (page) =>
      page.getByRole('heading', { name: 'My scores' }).waitFor(),
    );
    expectBudget('library route, cold, throttled', samples, { medianMs: 1000 });
  },
);

test(
  'the editor draws its first system in under 2.2 s on a throttled device',
  { tag: '@perf' },
  async ({ browser }) => {
    test.setTimeout(120_000);
    const samples = await measure(browser, '/editor', (page) =>
      page.waitForSelector('svg.pm-score .vf-pm-system', { state: 'attached' }),
    );
    expectBudget('editor route, cold, throttled', samples, { medianMs: 2200 });
  },
);
