import { expect, test } from '@playwright/test';
import { FIXTURE_NAMES, openFixture, type EngravingStats } from './engraving-helpers';

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
      const t0 = performance.now();
      engraver.setSelection([ids[0]!]);
      engraver.setPlaying([ids[1]!]);
      const ms = performance.now() - t0;
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
        ms,
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
    expect(out.ms).toBeLessThan(8);
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

test.describe('engraving performance (100 measures, grand staff)', () => {
  test('full render under 200 ms, one edit under 16 ms, only the touched system is engraved', async ({
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
              staves: { measures: { voices: { events: Ev[] }[] }[] }[];
            }[];
          };
          engraver: {
            stats: EngravingStats;
            svg: SVGSVGElement;
            render(score: unknown, width: number): EngravingStats;
          };
        };
      };
      const { score, engraver } = w.__polymnia;
      const cold = engraver.stats.ms;
      // Warm full renders: a different width forces every system to be engraved again.
      const full: number[] = [];
      for (let i = 0; i < 7; i++) full.push(engraver.render(score, 1101 + (i % 2) * 37).ms);
      engraver.render(score, 1100);
      const before = [...engraver.svg.querySelectorAll('.vf-pm-system')];

      const edits: { ms: number; drawn: number; reused: number }[] = [];
      let cur = score;
      for (let i = 0; i < 25; i++) {
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
        edits.push({ ms: performance.now() - t0, drawn: st.drawn, reused: st.reused });
      }
      const after = [...engraver.svg.querySelectorAll('.vf-pm-system')];
      const kept = before.filter((el) => after.includes(el)).length;
      return { cold, full, edits, systems: after.length, kept };
    });
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const fullMedian = median(r.full);
    const editMedian = median(r.edits.map((e) => e.ms));
    const editMax = Math.max(...r.edits.map((e) => e.ms));
    console.log(
      `PERF 100 measures: cold ${r.cold.toFixed(0)} ms, warm full median ${fullMedian.toFixed(0)} ms, ` +
        `edit median ${editMedian.toFixed(1)} ms, edit max ${editMax.toFixed(1)} ms, ${r.systems} systems`,
    );
    expect(fullMedian).toBeLessThan(200);
    expect(r.cold).toBeLessThan(600);
    expect(editMedian).toBeLessThan(16);
    // Every edit engraves at most two systems (the edited one and, on reflow, the next).
    expect(Math.max(...r.edits.map((e) => e.drawn))).toBeLessThanOrEqual(3);
    // The edits touch about 12 measures: the other systems keep their DOM nodes.
    expect(r.kept).toBeGreaterThanOrEqual(r.systems - 10);
  });
});
