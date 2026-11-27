import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // Visual baselines are generated on Linux (see docs/engraving.md): one folder, no platform suffix.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' } },
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  projects: [
    // Functional specs: parallel, one retry on CI. Performance specs (tagged @perf) are excluded.
    {
      name: 'chromium',
      grepInvert: /@perf/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Performance specs: only after the functional project is done (never next to other specs),
    // one at a time (`npm run test:perf` adds --workers=1: the worker count is global in
    // Playwright), never retried: a retry would hide a regression. See docs/development.md.
    {
      name: 'perf',
      grep: /@perf/,
      dependencies: ['chromium'],
      fullyParallel: false,
      retries: 0,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
