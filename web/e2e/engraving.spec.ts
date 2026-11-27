import { expect, test } from '@playwright/test';
import { FIXTURE_NAMES, openFixture, type EngravingStats } from './engraving-helpers';
import { CI_FACTOR, expectBudget } from './perf-stats';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

// Everything below runs against the production build, in real Chromium: VexFlow needs real SVG.

test.describe('engraving', () => {
  for (const name of FIXTURE_NAMES) {
    test(`${name}: engraves without errors and the layout reserved enough room`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openFixture(page, name, 900);
      const stats = await page.evaluate(
        () =>
          (window as unknown as { __polymnia: { engraver: { stats: EngravingStats } } }).__polymnia
            .engraver.stats,
      );
      expect(stats.systems).toBeGreaterThan(0);
      expect(stats.overflow).toBe(0);
      expect(errors).toEqual([]);
    });
  }

  test('exposes an accessible summary and a live region', async ({ page }) => {
    await openFixture(page, 'auClairDeLaLune', 900);
    const svg = page.locator('svg.pm-score');
    await expect(svg).toHaveAttribute('role', 'img');
    await expect(svg).toHaveAttribute('aria-label', /Au clair de la lune.*1 instrument.*4 measure/);
    await expect(page.locator('.score-view [role=status]')).toHaveAttribute('aria-live', 'polite');
  });

  test('layout positions agree with where VexFlow drew the notes', async ({ page }) => {
    await openFixture(page, 'pianoGrandStaff', 900);
    const worst = await page.evaluate(() => {
      const { engraver } = (window as unknown as { __polymnia: { engraver: Engraver } }).__polymnia;
      const svgBox = engraver.svg.getBoundingClientRect();
      let max = 0;
      let count = 0;
      engraver.svg.querySelectorAll('.pm-event').forEach((el) => {
        const id = el.getAttribute('data-event-id')!;
        const box = engraver.eventBox(id)!;
        const head = el.querySelector('.vf-notehead') ?? el;
        const r = head.getBoundingClientRect();
        const cx = r.left - svgBox.left + r.width / 2;
        const boxCx = box.x + box.w / 2;
        max = Math.max(max, Math.abs(cx - boxCx));
        count++;
      });
      return { max, count };
    });
    expect(worst.count).toBeGreaterThan(10);
    expect(worst.max).toBeLessThan(8);

    interface Engraver {
      svg: SVGSVGElement;
      eventBox(id: string): { x: number; w: number } | undefined;
    }
  });

  test('hit testing resolves a real click on a note', async ({ page }) => {
    await openFixture(page, 'pianoGrandStaff', 900);
    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __polymnia: {
          score: {
            parts: {
              staves: { id: string; measures: { voices: { events: { id: string }[] }[] }[] }[];
            }[];
          };
          engraver: {
            svg: SVGSVGElement;
            eventBox(id: string): { x: number; y: number; w: number; h: number };
            hitTest(
              x: number,
              y: number,
            ): { eventId?: string; staffId: string; measureIndex: number } | null;
          };
        };
      };
      const { score, engraver } = w.__polymnia;
      const staff = score.parts[0]!.staves[0]!;
      const id = staff.measures[2]!.voices[0]!.events[1]!.id;
      const box = engraver.eventBox(id);
      const rect = engraver.svg.getBoundingClientRect();
      // The DOM element under that point is the note we expect.
      const el = document.elementFromPoint(
        rect.left + box.x + box.w / 2,
        rect.top + box.y + box.h / 2,
      );
      return {
        id,
        staffId: staff.id,
        hit: engraver.hitTest(box.x + box.w / 2, box.y + box.h / 2),
        domId: el?.closest('.pm-event')?.getAttribute('data-event-id') ?? null,
      };
    });
    expect(result.hit).toMatchObject({
      eventId: result.id,
      staffId: result.staffId,
      measureIndex: 2,
    });
    expect(result.domId).toBe(result.id);
  });

  test('selection and playback highlighting are class toggles, never a re-engrave', async ({
    page,
  }) => {
    await openFixture(page, 'pianoGrandStaff', 900);
    const out = await page.evaluate(() => {
      const w = window as unknown as {
        __polymnia: {
          score: {
            parts: { staves: { measures: { voices: { events: { id: string }[] }[] }[] }[] }[];
          };
          engraver: {
            svg: SVGSVGElement;
            stats: { drawn: number };
            setSelection(ids: string[]): void;
            setPlaying(ids: string[]): void;
          };
        };
      };
      const { score, engraver } = w.__polymnia;
      const ids = score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events.map((e) => e.id);
      const group = engraver.svg.querySelector('.vf-pm-system');
      const statsBefore = engraver.stats;
      engraver.setSelection([ids[0]!]);
      engraver.setPlaying([ids[1]!]);
      const color = (id: string) =>
        getComputedStyle(engraver.svg.querySelector(`[data-event-id="${id}"] .vf-notehead text`)!)
          .color;
      return {
        selected: color(ids[0]!),
        playing: color(ids[1]!),
        plain: color(ids[2]!),
        sameGroup: group === engraver.svg.querySelector('.vf-pm-system'),
        sameStats: statsBefore === engraver.stats,
        background: engraver.svg.querySelectorAll('.pm-sel-bg').length,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        play: getComputedStyle(document.documentElement).getPropertyValue('--play').trim(),
        ink: getComputedStyle(document.documentElement).getPropertyValue('--score-ink').trim(),
      };
    });
    const rgb = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    expect(out.selected).toBe(rgb(out.accent));
    expect(out.playing).toBe(rgb(out.play));
    expect(out.plain).toBe(rgb(out.ink));
    expect(out.sameGroup).toBe(true);
    expect(out.sameStats).toBe(true);
    expect(out.background).toBe(1);
  });

  test('follows the dark theme through the tokens', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark', locale: 'en-US' });
    const page = await context.newPage();
    await openFixture(page, 'auClairDeLaLune', 700);
    const ink = await page
      .locator('svg.pm-score .vf-notehead text')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(ink).toBe('rgb(231, 234, 241)'); // --score-ink in dark
    await context.close();
  });

  test('re-engraves when the page is resized, debounced', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openFixture(page, 'benchmark100');
    const first = await page.locator('svg.pm-score').getAttribute('width');
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(async () => {
      const w = await page.locator('svg.pm-score').getAttribute('width');
      expect(Number(w)).toBeLessThan(Number(first));
    }).toPass({ timeout: 5000 });
    // The re-engraving is progressive: wait until every system is drawn.
    await page.evaluate(() =>
      (
        window as unknown as { __polymnia: { engraver: { settled(): Promise<void> } } }
      ).__polymnia.engraver.settled(),
    );
    const systems = await page.locator('svg.pm-score .vf-pm-system').count();
    expect(systems).toBeGreaterThan(20);
  });
});

test.describe('re-flow, progressive (100 measures, grand staff)', () => {
  test('a re-flow engraves a few systems at once, hit testing stays complete, the rest follows in order', async ({
    page,
  }) => {
    await openFixture(page, 'benchmark100', 1100);
    const r = await page.evaluate(async () => {
      interface Hit {
        eventId?: string;
        systemIndex: number;
      }
      const w = window as unknown as {
        __polymnia: {
          score: unknown;
          engraver: {
            svg: SVGSVGElement;
            layout: { systems: { y: number; height: number }[] };
            render(score: unknown, width: number, o: { progressive: boolean }): EngravingStats;
            settled(): Promise<void>;
            hitTest(x: number, y: number): Hit | null;
          };
        };
      };
      const { score, engraver } = w.__polymnia;
      // A narrower page: every line break moves, every system must be engraved again.
      const stats = engraver.render(score, 760, { progressive: true });
      const atOnce = engraver.svg.querySelectorAll('.vf-pm-system').length;
      const systems = engraver.layout.systems;
      const last = systems[systems.length - 1]!;
      const hit = engraver.hitTest(300, last.y + last.height / 2);
      await engraver.settled();
      const groups = [...engraver.svg.querySelectorAll('.vf-pm-system')];
      const ys = groups.map((g) =>
        Number(/translate\(0 ([\d.]+)\)/.exec(g.getAttribute('transform')!)![1]),
      );
      return {
        stats,
        atOnce,
        total: systems.length,
        hitSystem: hit?.systemIndex,
        after: groups.length,
        inOrder: ys.every((y, i) => i === 0 || y > ys[i - 1]!),
        final: engraver.svg.querySelectorAll('.vf-pm-system').length === systems.length,
      };
    });
    expect(r.total).toBeGreaterThan(20);
    // Only what is on screen is engraved by the call (its time is a perf test below); the rest is pending.
    expect(r.stats.complete).toBe(false);
    expect(r.atOnce).toBeLessThan(r.total);
    // The layout is complete at once: the last system answers hit tests before it is drawn.
    expect(r.hitSystem).toBe(r.total - 1);
    expect(r.after).toBe(r.total);
    expect(r.final).toBe(true);
    expect(r.inOrder).toBe(true);
  });
});

test.describe('engraving performance (100 measures, grand staff)', { tag: '@perf' }, () => {
  test('full render, one edit, progressive re-flow and highlight toggles stay under budget, only the touched system is engraved', async ({
    page,
  }) => {
    await openFixture(page, 'benchmark100', 1100);
    const r = await page.evaluate(() => {
      interface Ev {
        kind: string;
        pitches: { octave: number }[];
      }
      const w = window as unknown as {
        __polymnia: {
          score: {
            parts: {
              staves: { id: string; measures: { voices: { events: Ev[] }[] }[] }[];
            }[];
          };
          engraver: {
            stats: EngravingStats;
            svg: SVGSVGElement;
            render(score: unknown, width: number, o?: { progressive: boolean }): EngravingStats;
            settled(): Promise<void>;
            setSelection(ids: string[]): void;
            setPlaying(ids: string[]): void;
          };
        };
      };
      const { score, engraver } = w.__polymnia;
      const cold = engraver.stats.ms;
      // Warm full renders: a different width forces every system to be engraved again.
      // 4 warm-up renders (JIT, glyph caches) are discarded, then 15 samples.
      const full: number[] = [];
      for (let i = 0; i < 19; i++) {
        const ms = engraver.render(score, 1101 + (i % 2) * 37).ms;
        if (i >= 4) full.push(ms);
      }
      engraver.render(score, 1100);
      const before = [...engraver.svg.querySelectorAll('.vf-pm-system')];

      const edits: { ms: number; drawn: number; reused: number }[] = [];
      let cur = score;
      // 8 warm-up edits then 60 samples.
      for (let i = 0; i < 68; i++) {
        const mi = 40 + (i % 12);
        const part = cur.parts[0]!;
        const staff = part.staves[0]!;
        const sm = staff.measures[mi]!;
        const v = sm.voices[0]!;
        const ev = v.events[0]!;
        const next =
          ev.kind === 'note'
            ? {
                ...ev,
                pitches: [
                  { ...ev.pitches[0]!, octave: ev.pitches[0]!.octave + (i % 2 ? 1 : -1) },
                  ...ev.pitches.slice(1),
                ],
              }
            : ev;
        const nv = { ...v, events: [next, ...v.events.slice(1)] };
        const nsm = { ...sm, voices: [nv, ...sm.voices.slice(1)] };
        const nstaff = { ...staff, measures: staff.measures.map((m, k) => (k === mi ? nsm : m)) };
        cur = {
          ...cur,
          parts: [{ ...part, staves: [nstaff, ...part.staves.slice(1)] }],
        } as typeof cur;
        const t0 = performance.now();
        const st = engraver.render(cur, 1100);
        if (i >= 8) edits.push({ ms: performance.now() - t0, drawn: st.drawn, reused: st.reused });
      }
      const after = [...engraver.svg.querySelectorAll('.vf-pm-system')];
      const kept = before.filter((el) => after.includes(el)).length;
      return { cold, full, edits, systems: after.length, kept };
    });
    const editMs = r.edits.map((e) => e.ms);
    console.log(`PERF 100 measures: cold ${r.cold.toFixed(0)} ms, ${r.systems} systems`);
    expectBudget('engraving full render', r.full, { medianMs: 200 });
    // Cold (JIT, first use) is a single sample by nature: a generous budget with the CI factor.
    expect(r.cold, 'cold render').toBeLessThan(600 * CI_FACTOR);
    expectBudget('engraving one edit', editMs, { medianMs: 16 });
    // Every edit engraves at most two systems (the edited one and, on reflow, the next).
    expect(Math.max(...r.edits.map((e) => e.drawn))).toBeLessThanOrEqual(3);
    // The edits touch about 12 measures: the other systems keep their DOM nodes.
    expect(r.kept).toBeGreaterThanOrEqual(r.systems - 10);
  });

  test('a progressive re-flow engraves the screen within a keystroke budget, highlight toggles are cheap', async ({
    page,
  }) => {
    await openFixture(page, 'benchmark100', 1100);
    const r = await page.evaluate(async () => {
      const w = window as unknown as {
        __polymnia: {
          score: {
            parts: { staves: { measures: { voices: { events: { id: string }[] }[] }[] }[] }[];
          };
          engraver: {
            render(score: unknown, width: number, o: { progressive: boolean }): { ms: number };
            settled(): Promise<void>;
            setSelection(ids: string[]): void;
            setPlaying(ids: string[]): void;
          };
        };
      };
      const { score, engraver } = w.__polymnia;
      // A narrower page, then back: every line break moves. 3 warm-up calls, then 15 samples.
      const reflow: number[] = [];
      for (let i = 0; i < 18; i++) {
        const ms = engraver.render(score, i % 2 ? 1100 : 760, { progressive: true }).ms;
        if (i >= 3) reflow.push(ms);
        await engraver.settled();
      }
      const ids = score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events.map((e) => e.id);
      const toggles: number[] = [];
      for (let i = 0; i < 40; i++) {
        const t0 = performance.now();
        engraver.setSelection([ids[i % 2]!]);
        engraver.setPlaying([ids[2 + (i % 2)]!]);
        if (i >= 8) toggles.push(performance.now() - t0);
      }
      return { reflow, toggles };
    });
    expectBudget('progressive re-flow (first systems)', r.reflow, { medianMs: 40 });
    expectBudget('selection and playback toggles', r.toggles, { medianMs: 8 });
  });
});
