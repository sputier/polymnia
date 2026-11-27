import { describe, expect, it } from 'vitest';
import { buildScore } from '../score/fixtures/dsl';
import { layoutScore } from '../engraving/layout';
import { planPages, printGeometry, systemSpread, type Paper } from './pages';

/** The 100-measure fixture of the export e2e test: 4/4 piano, quarter notes over half notes. */
function simplePiano(measures: number) {
  return buildScore({
    title: 'Long piece',
    parts: [
      {
        name: 'Piano',
        instrument: 'piano',
        staves: [
          {
            clef: 'treble',
            measures: Array.from({ length: measures }, () => 'C5:q D5:q E5:q F5:q'),
          },
          { clef: 'bass', measures: Array.from({ length: measures }, () => 'C3:h G3:h') },
        ],
      },
    ],
  });
}

function print(paper: Paper, measures: number) {
  const score = simplePiano(measures);
  const geometry = printGeometry(paper, 0);
  const layout = layoutScore(score, { width: geometry.width });
  const pages = planPages(layout, paper, geometry.scale);
  return { layout, pages };
}

describe('engraving density (#46)', () => {
  it('fits at least 4 measures per system for simple 4/4 content on A4 and Letter', () => {
    for (const paper of ['a4', 'letter'] as const) {
      const counts = print(paper, 100).layout.systems.map((s) => s.measures.length);
      for (const n of counts.slice(0, -1)) expect(n, paper).toBeGreaterThanOrEqual(4);
    }
  });

  it('prints 100 such measures on at most 5 A4 pages, with at least 6 systems on a full page', () => {
    const { pages } = print('a4', 100);
    expect(pages.length).toBeLessThanOrEqual(5);
    expect(pages[0]!.length).toBeGreaterThanOrEqual(6);
    expect(pages[1]!.length).toBeGreaterThanOrEqual(6);
  });

  it('prints with a 1.75 mm staff space by default, and the size is configurable', () => {
    const mm = (scale: number) => (scale * 10 * 25.4) / 72;
    expect(mm(printGeometry('a4', 0).scale)).toBeCloseTo(1.75, 3);
    expect(mm(printGeometry('a4', 0, 2.2).scale)).toBeCloseTo(2.2, 3);
    expect(printGeometry('a4', 0, 2.2).width).toBeLessThan(printGeometry('a4', 0).width);
  });

  it('spreads the leftover height of a full page between its systems, within a limit', () => {
    const score = simplePiano(100);
    const geometry = printGeometry('a4', 0);
    const layout = layoutScore(score, { width: geometry.width });
    const plan = {
      paper: 'a4' as const,
      scale: geometry.scale,
      layout,
      pages: planPages(layout, 'a4', geometry.scale),
    };
    const first = systemSpread(plan, 0);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(24);
    expect(systemSpread(plan, plan.pages.length - 1)).toBe(0);
  });
});
