import { expect, test } from '@playwright/test';
import { mockSignedIn, openFixture, type EngravingStats } from './engraving-helpers';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 700 } });

// Font loading and progressive rendering (#33), against the production build.

test.describe('engraving fonts', () => {
  test('no font is embedded in JavaScript: Bravura is one hashed woff2, preloaded', async ({
    page,
  }) => {
    const scripts: string[] = [];
    const fonts: string[] = [];
    page.on('response', async (res) => {
      const url = res.url();
      if (res.request().resourceType() === 'script') scripts.push(await res.text());
      if (/\.woff2?$/.test(url)) fonts.push(url);
    });
    await openFixture(page, 'auClairDeLaLune', 700);
    expect(scripts.length).toBeGreaterThan(1);
    for (const js of scripts)
      expect(js).not.toMatch(/data:(?:font|application\/font)[^"'`]*base64/);
    expect(fonts.filter((f) => /\/assets\/bravura-[\w-]+\.woff2$/.test(f))).toHaveLength(1);
    expect(fonts.some((f) => /academico/i.test(f))).toBe(false);
    await expect(page.locator('link[rel=preload][as=font][data-pm-font=bravura]')).toHaveCount(1);
    expect(await page.evaluate(() => document.fonts.check('20px Bravura'))).toBe(true);
  });

  test('the score renders when the music font arrives late, and the glyphs appear after', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/assets/bravura-*.woff2', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3500)); // longer than the 2.5 s wait
      await route.continue();
    });
    await mockSignedIn(page);
    await page.goto('/#/editor?fixture=auClairDeLaLune&width=700');
    // Staves, layout and hit testing exist before the font does.
    await page.waitForSelector('svg.pm-score .vf-pm-system', { state: 'attached', timeout: 3300 });
    expect(await page.evaluate(() => document.fonts.check('20px Bravura'))).toBe(false);
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('20px Bravura')), { timeout: 8000 })
      .toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('progressive render', () => {
  test('first systems fast, the rest in idle time, nothing to redo afterwards', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await page.goto('/#/editor?fixture=benchmark100&width=1100');
    await page.waitForSelector('svg.pm-score .vf-pm-system', { state: 'attached' });
    await page.waitForFunction(() => (window as unknown as { __polymnia?: unknown }).__polymnia);
    const r = await page.evaluate(async () => {
      const w = window as unknown as {
        __polymnia: {
          score: unknown;
          engraver: {
            stats: EngravingStats;
            svg: SVGSVGElement;
            render(score: unknown, width: number, o?: { progressive: boolean }): EngravingStats;
            settled(): Promise<void>;
          };
        };
      };
      const { engraver, score } = w.__polymnia;
      const stats = { ...engraver.stats };
      const systems = engraver.svg.querySelectorAll('.vf-pm-system').length;
      const again = engraver.render(score, 1100); // same score and width: nothing to engrave
      // A new width engraves again, progressively: the full layout is there, the drawing is not.
      const first = engraver.render(score, 1000, { progressive: true });
      const heightAtOnce = Number(engraver.svg.getAttribute('height'));
      const drawnAtOnce = engraver.svg.querySelectorAll('.vf-pm-system').length;
      await engraver.settled();
      const last = { ...engraver.stats };
      const drawnAtEnd = engraver.svg.querySelectorAll('.vf-pm-system').length;
      return { stats, systems, again, first, heightAtOnce, drawnAtOnce, last, drawnAtEnd };
    });
    console.log(
      `PERF first system ${r.stats.firstSystemMs.toFixed(0)} ms, complete after ${r.stats.ms.toFixed(0)} ms ` +
        `(${r.drawnAtOnce} of ${r.last.systems} systems before the first idle chunk)`,
    );
    expect(r.stats.complete).toBe(true);
    expect(r.systems).toBe(r.stats.systems);
    expect(r.heightAtOnce).toBeGreaterThan(5000); // the full height is known at once
    expect(r.first.complete).toBe(false);
    expect(r.drawnAtOnce).toBeLessThan(r.last.systems);
    expect(r.last.complete).toBe(true);
    expect(r.drawnAtEnd).toBe(r.last.systems);
    expect(r.stats.firstSystemMs).toBeLessThan(100);
    expect(r.again).toMatchObject({ drawn: 0, complete: true, reused: r.stats.systems });
  });
});
