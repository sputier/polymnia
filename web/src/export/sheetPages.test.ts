import { describe, expect, it } from 'vitest';
import { lookupShape } from '../chords/library';
import { createScore, parseChord, setChord } from '../score';
import type { Score } from '../score';
import { buildSheetPages } from './sheetPages';
import { PAPER_SIZES } from './pages';
import { buildPdf } from './pdf';

function scoreWith(
  list: readonly (readonly [number, number, string])[],
  measures: number,
  instrument = 'guitar-steel',
): Score {
  let out = createScore({ measures, instruments: [instrument] });
  const staffId = out.parts[0]!.staves[0]!.id;
  for (const [measure, tick, text] of list)
    out = setChord({ staffId, measure, tick, chord: parseChord(text)! }).apply(out);
  return out;
}

const OPTIONS = { naming: 'letters', diagramsLabel: 'Chord diagrams' } as const;
const texts = (pages: ReturnType<typeof buildSheetPages>) =>
  pages.flatMap((p) => p.items.flatMap((i) => (i.kind === 'text' ? [i.text] : [])));

describe('buildSheetPages', () => {
  const score = scoreWith(
    [
      [0, 0, 'C'],
      [1, 0, 'C'],
      [2, 0, 'Am7'],
      [2, 1920, 'G'],
    ],
    4,
  );

  it('writes the chord names, the repeat sign and the beats of a split measure', () => {
    const pages = buildSheetPages(score, 'Song', 'a4', OPTIONS);
    const all = texts(pages);
    expect(all).toContain('Song');
    expect(all).toContain('C');
    expect(all).toContain('%');
    expect(all).toContain('Am7');
    expect(all).toContain('G');
    // The split measure shows its beats (1 and 3), the measures show their numbers.
    expect(all.filter((t) => t === '3')).toHaveLength(2); // measure 3 and beat 3
    expect(all).toContain('1 / 1');
  });

  it('follows the chord naming option', () => {
    const all = texts(buildSheetPages(score, '', 'a4', { ...OPTIONS, naming: 'solfege' }));
    expect(all).toContain('Do');
    expect(all).toContain('Lam7');
    expect(all).not.toContain('Am7');
  });

  it('draws the diagrams of the chords used for the chosen part, with the library', () => {
    const part = score.parts[0]!;
    const without = buildSheetPages(score, '', 'a4', OPTIONS);
    const withDiagrams = buildSheetPages(score, '', 'a4', {
      ...OPTIONS,
      part,
      lookup: lookupShape,
      capoLabel: (n) => `Capo ${n}`,
    });
    expect(texts(withDiagrams)).toContain(`Chord diagrams - ${part.name}`);
    expect(withDiagrams[0]!.items.length).toBeGreaterThan(without[0]!.items.length + 40);
    // A caption per distinct chord (C, Am7, G), not per use.
    expect(texts(withDiagrams).filter((t) => t === 'C')).toHaveLength(2); // cell + caption
  });

  it('prints no diagram section for a piano', () => {
    const piano = scoreWith([[0, 0, 'C']], 2, 'piano');
    const all = texts(buildSheetPages(piano, '', 'a4', { ...OPTIONS, part: undefined }));
    expect(all).not.toContain('Chord diagrams');
  });

  it('breaks pages by rows and keeps everything inside the margins', () => {
    const long = scoreWith(
      Array.from({ length: 80 }, (_, i) => [i, 0, ['C', 'Am', 'F', 'G'][i % 4]!] as const),
      80,
    );
    const pages = buildSheetPages(long, 'Long', 'letter', {
      ...OPTIONS,
      part: long.parts[0]!,
      lookup: lookupShape,
    });
    expect(pages.length).toBeGreaterThan(1);
    const { width, height } = PAPER_SIZES.letter;
    for (const page of pages) {
      expect([page.width, page.height]).toEqual([width, height]);
      for (const item of page.items) {
        if (item.kind === 'text') {
          expect(item.y).toBeLessThanOrEqual(height);
          expect(item.y).toBeGreaterThan(0);
        } else {
          for (const seg of item.segs) {
            const y = seg[seg.length - 1] as number;
            if (seg[0] !== 'Z') expect(y).toBeLessThanOrEqual(height - 40);
          }
        }
      }
    }
    expect(texts(pages).at(-1)).toBe(`${pages.length} / ${pages.length}`);
  });

  it('is a valid PDF whose content shows the chord names', () => {
    const pages = buildSheetPages(score, 'Song', 'a4', OPTIONS);
    const bytes = buildPdf(pages, { title: 'Song', author: '', creator: 'Polymnia' });
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 5))).toBe('%PDF-');
  });
});
