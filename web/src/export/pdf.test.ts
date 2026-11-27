import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { benchmarkScore, accidentalsScore } from '../engraving/previewScores';
import { FIXTURES } from '../score/fixtures';
import { exportPdf } from './index';
import { buildPdf, pageContent, winAnsiHex } from './pdf';
import { PAPER_SIZES, fitText, textWidth, printGeometry, planPages } from './pages';
import { parsePath, transformSegs } from './paths';
import { convertSvg } from './svgItems';

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('parsePath', () => {
  it('handles absolute and relative commands, implicit repeats and compact numbers', () => {
    expect(parsePath('M10 20L30 40 50-60')).toEqual([
      ['M', 10, 20],
      ['L', 30, 40],
      ['L', 50, -60],
    ]);
    expect(parsePath('m1 2 3 4 h5 v6 z')).toEqual([
      ['M', 1, 2],
      ['L', 4, 6],
      ['L', 9, 6],
      ['L', 9, 12],
      ['Z'],
    ]);
  });

  it('turns quadratics and arcs into cubics ending at the same point', () => {
    const q = parsePath('M0 0Q10 0 10 10')!;
    expect(q[1]![0]).toBe('C');
    expect(q[1]!.slice(-2)).toEqual([10, 10]);
    const a = parsePath('M0 0A5 5 0 0 1 10 0')!;
    expect(a.slice(1).every((s) => s[0] === 'C')).toBe(true);
    const last = a.at(-1)!;
    expect(last[5]).toBeCloseTo(10);
    expect(last[6]).toBeCloseTo(0);
    // Sweep 1 runs clockwise on screen (y down): the arc passes above the chord.
    expect(Math.min(...a.slice(1).map((s) => (s[0] === 'C' ? s[4]! : 0)))).toBeLessThan(0);
  });

  it('rejects garbage', () => {
    expect(parsePath('M10 20 L oops')).toBeUndefined();
    expect(parsePath('10 20')).toBeUndefined();
  });

  it('applies an affine matrix', () => {
    expect(transformSegs([['M', 1, 1]], [2, 0, 0, 3, 10, 20])).toEqual([['M', 12, 23]]);
  });
});

describe('convertSvg', () => {
  const svg = (inner: string) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.innerHTML = inner;
    return el;
  };

  it('is black ink whatever the colors in the SVG, skips hit areas and overlays', () => {
    const { items } = convertSvg(
      svg(
        '<g transform="translate(5 7)" fill="red" stroke="blue"><rect x="0" y="0" width="2" height="4"/><rect x="0" y="0" width="9" height="9" opacity="0"/></g>' +
          '<g class="pm-overlay"><rect x="0" y="0" width="50" height="50"/></g>' +
          '<path fill="none" stroke="currentColor" stroke-width="2" d="M0 0L10 0"/>',
      ),
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'path', fill: true, stroke: true });
    expect(JSON.stringify(items)).not.toMatch(/red|blue/);
    expect((items[0] as unknown as { segs: unknown[] }).segs[0]).toEqual(['M', 5, 7]);
    expect(items[1]).toMatchObject({ fill: false, stroke: true, lineWidth: 2 });
  });

  it('draws Bravura code points as outlines and keeps other text as text', () => {
    const { items, dropped } = convertSvg(
      svg(
        '<text x="10" y="20" font-size="30pt"></text><text x="1" y="2" font-size="10pt">Piano</text>',
      ),
    );
    expect(dropped).toEqual({});
    expect(items[0]).toMatchObject({ kind: 'path', fill: true, stroke: false });
    expect(items[1]).toMatchObject({ kind: 'text', text: 'Piano', x: 1, y: 2 });
    expect((items[1] as { size: number }).size).toBeCloseTo(13.33, 1);
  });

  it('reports glyphs it has no outline for', () => {
    const { dropped } = convertSvg(svg('<text x="0" y="0"></text>'));
    expect(dropped).toEqual({ 'glyph-U+E9FF': 1 });
  });
});

describe('PDF writer', () => {
  const page = {
    width: 200,
    height: 100,
    items: [
      {
        kind: 'path' as const,
        segs: [['M', 10, 10], ['L', 50, 10], ['C', 60, 20, 70, 30, 80, 40], ['Z']] as const,
        fill: true,
        stroke: true,
        lineWidth: 1.5,
        dash: [],
      },
      { kind: 'text' as const, x: 100, y: 50, size: 12, text: 'Été', align: 'middle' as const },
    ],
  };

  it('produces a well-formed file: header, xref offsets, page count, black on white', () => {
    const bytes = buildPdf([page, page], { title: 'Chant', author: 'Anon', creator: 'Polymnia' });
    const text = latin1(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 200 100]');
    // Every xref entry points at "<id> 0 obj".
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const entries = [...text.slice(xref).matchAll(/(\d{10}) 00000 n /g)];
    expect(entries.length).toBe(8);
    entries.forEach((m, i) => {
      expect(text.slice(Number(m[1]), Number(m[1]) + `${i + 1} 0 obj`.length)).toBe(
        `${i + 1} 0 obj`,
      );
    });
    // The content streams are Flate: inflate the first one.
    const stream = /\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/.exec(text)!;
    const start = stream.index + stream[0].length;
    const inflated = latin1(unzlibSync(bytes.slice(start, start + Number(stream[1]))));
    expect(inflated).toBe(pageContent(page));
    expect(inflated).toContain('0 g 0 G');
    expect(inflated).toContain('10 90 m');
    expect(inflated.split('\n')).toContain('B');
    expect(inflated).not.toMatch(/\brg\b|\bRG\b/);
  });

  it('encodes text in WinAnsi and replaces what Helvetica cannot show', () => {
    expect(winAnsiHex('Été')).toBe('<c974e9>');
    expect(winAnsiHex('a’b中')).toBe('<619262' + '3f>');
  });
});

describe('pages', () => {
  it('measures and fits Helvetica text', () => {
    expect(textWidth('Hello', 10)).toBeCloseTo(22.78, 1);
    expect(fitText('x'.repeat(200), 20, 100).endsWith('...')).toBe(true);
    expect(textWidth(fitText('x'.repeat(200), 20, 100), 20)).toBeLessThanOrEqual(100);
    expect(fitText('Short', 20, 100)).toBe('Short');
  });

  it('knows A4 and Letter', () => {
    expect(PAPER_SIZES.a4.width).toBeCloseTo(595.28);
    expect(PAPER_SIZES.letter).toEqual({ width: 612, height: 792 });
    expect(printGeometry('letter', 0).width).toBeGreaterThan(printGeometry('a4', 0).width * 0.99);
  });

  it('never splits a system and keeps every system once', () => {
    const systems = Array.from({ length: 30 }, (_, i) => ({ index: i, y: i * 200, height: 200 }));
    const pages = planPages({ width: 800, height: 6000, systems, staves: [] } as never, 'a4', 0.6);
    expect(pages.flat()).toEqual(systems.map((s) => s.index));
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0]!.length).toBeLessThan(pages[1]!.length); // the title block takes room
  });
});

describe('export of real scores', () => {
  it('has an outline for every music glyph the fixtures use', async () => {
    const { Engraver } = await import('../engraving/engraver');
    const scores = [...Object.values(FIXTURES), accidentalsScore()];
    for (const score of scores) {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const engraver = new Engraver(host);
      engraver.render(score, 800);
      const { dropped } = convertSvg(engraver.svg);
      expect(dropped, score.meta.title).toEqual({});
      engraver.destroy();
      host.remove();
    }
  });

  it('writes a multi-page PDF for a 100 measure score', async () => {
    const file = await exportPdf(benchmarkScore(100), 'Benchmark', 'a4');
    expect(file.mime).toBe('application/pdf');
    expect(file.extension).toBe('pdf');
    expect(file.pages).toBeGreaterThan(3);
    expect(file.dropped).toEqual({});
    const text = latin1(file.bytes);
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain(`/Count ${file.pages}`);
    const letter = await exportPdf(benchmarkScore(100), 'Benchmark', 'letter');
    expect(latin1(letter.bytes)).toContain('/MediaBox [0 0 612 792]');
  }, 20_000);

  it('reports progress page by page', async () => {
    const seen: number[] = [];
    const file = await exportPdf(benchmarkScore(30), 'T', 'a4', (p) => seen.push(p.done));
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(file.pages);
  }, 20_000);
});
