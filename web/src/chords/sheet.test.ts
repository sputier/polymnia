import { describe, expect, it } from 'vitest';
import { createScore, formatChord, parseChord, setChord, setTimeSignature } from '../score';
import type { Score } from '../score';
import { lookupShape } from './library';
import {
  beatOf,
  buildChordSheet,
  capoShapeOf,
  diagramParts,
  shapeFor,
  sheetRows,
  usedChords,
} from './sheet';
import { diagramDescription, diagramGeometry } from './sheetDiagram';

/** `[measure, tick, chord]` triples written on the first staff. */
function withChords(
  score: Score,
  list: readonly (readonly [number, number, string])[],
  partIndex = 0,
): Score {
  let out = score;
  const staffId = score.parts[partIndex]!.staves[0]!.id;
  for (const [measure, tick, text] of list)
    out = setChord({ staffId, measure, tick, chord: parseChord(text)! }).apply(out);
  return out;
}

const cells = (score: Score) =>
  buildChordSheet(score).map((m) =>
    m.repeat ? '%' : m.chords.map((c) => formatChord(c.chord)).join(' ') || '-',
  );

describe('buildChordSheet', () => {
  const base = () => createScore({ measures: 8, instruments: ['guitar-steel'] });

  it('lists the chords of every measure, in order', () => {
    const s = withChords(base(), [
      [0, 0, 'C'],
      [1, 0, 'Am7'],
      [2, 0, 'F'],
      [3, 0, 'G7'],
    ]);
    expect(cells(s).slice(0, 5)).toEqual(['C', 'Am7', 'F', 'G7', '-']);
  });

  it('shows % for a measure that holds the same chords as the previous one', () => {
    const s = withChords(base(), [
      [0, 0, 'C'],
      [1, 0, 'C'],
      [2, 0, 'G'],
      [3, 0, 'G'],
      [4, 0, 'C'],
    ]);
    expect(cells(s).slice(0, 5)).toEqual(['C', '%', 'G', '%', 'C']);
  });

  it('shows % for a single chord that is still sounding from the end of the previous measure', () => {
    const s = withChords(base(), [
      [0, 0, 'C'],
      [0, 1920, 'G'],
      [1, 0, 'G'],
    ]);
    expect(cells(s).slice(0, 2)).toEqual(['C G', '%']);
  });

  it('repeats a whole multi-chord measure with a single %', () => {
    const s = withChords(base(), [
      [0, 0, 'C'],
      [0, 1920, 'G'],
      [1, 0, 'C'],
      [1, 1920, 'G'],
      [2, 0, 'C'],
      [2, 1920, 'Am'],
    ]);
    expect(cells(s).slice(0, 3)).toEqual(['C G', '%', 'C Am']);
  });

  it('never repeats the first measure; a chord still sounding after an empty measure is a repeat', () => {
    const s = withChords(base(), [
      [0, 0, 'C'],
      [2, 0, 'C'],
    ]);
    expect(cells(s).slice(0, 3)).toEqual(['C', '-', '%']);
    expect(buildChordSheet(s)[0]!.repeat).toBe(false);
  });

  it('keeps a different chord at beat 1 and a chord that changes mid-measure as they are', () => {
    const s = withChords(base(), [
      [0, 0, 'C'],
      [1, 0, 'D'],
      [2, 1920, 'D'],
    ]);
    expect(cells(s).slice(0, 3)).toEqual(['C', 'D', 'D']);
    expect(buildChordSheet(s)[2]!.repeat).toBe(false);
  });

  it('gives every chord of a multi-chord measure its beat', () => {
    const s = withChords(base(), [
      [0, 0, 'C'],
      [0, 960, 'Am'],
      [0, 1920, 'F'],
      [0, 2880 + 480, 'G'],
    ]);
    expect(buildChordSheet(s)[0]!.chords.map((c) => c.beat)).toEqual([1, 2, 3, 4.5]);
  });

  it('counts beats with the time signature of the measure (3/8: the beat is an eighth)', () => {
    let s = base();
    s = setTimeSignature({ measure: 0, time: { beats: 3, beatType: 8 } }).apply(s);
    expect(beatOf(s, 0, 480)).toBe(2);
    expect(beatOf(s, 0, 240)).toBe(1.5);
    expect(beatOf(s, 0, 0)).toBe(1);
  });

  it('merges the chords of every part, one per tick', () => {
    const two = createScore({ measures: 4, instruments: ['guitar-steel', 'piano'] });
    const s = withChords(
      withChords(two, [[0, 0, 'C']], 0),
      [
        [0, 0, 'Dm'],
        [1, 0, 'G'],
      ],
      1,
    );
    expect(cells(s).slice(0, 2)).toEqual(['C', 'G']);
  });

  it('has a cell for every measure, chords or not', () => {
    expect(buildChordSheet(base())).toHaveLength(8);
    expect(buildChordSheet(base()).every((m) => m.chords.length === 0 && !m.repeat)).toBe(true);
  });
});

describe('sheetRows', () => {
  it('cuts rows of four, the last one shorter', () => {
    const rows = sheetRows(Array.from({ length: 10 }, (_, i) => i));
    expect(rows).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);
    expect(sheetRows([])).toEqual([]);
  });
});

describe('diagrams', () => {
  const guitar = withChords(createScore({ measures: 4, instruments: ['guitar-steel'] }), [
    [0, 0, 'C'],
    [1, 0, 'G'],
    [2, 0, 'C'],
    [3, 0, 'Am7'],
  ]);

  it('lists each chord used once, in order of appearance', () => {
    expect(usedChords(buildChordSheet(guitar)).map((c) => formatChord(c))).toEqual([
      'C',
      'G',
      'Am7',
    ]);
  });

  it('offers the parts with strings only', () => {
    const mixed = createScore({
      measures: 2,
      instruments: ['piano', 'guitar-steel', 'ukulele-concert'],
    });
    expect(diagramParts(mixed).map((p) => p.instrument)).toEqual([
      'guitar-steel',
      'ukulele-concert',
    ]);
    expect(diagramParts(createScore({ measures: 2, instruments: ['piano'] }))).toEqual([]);
  });

  it('looks the shape up with the tuning of the part and its capo', () => {
    const part = guitar.parts[0]!;
    const chord = usedChords(buildChordSheet(guitar))[0]!;
    const open = shapeFor(chord, part, lookupShape);
    expect(open?.frets).toEqual([0, 1, 0, 2, 3, -1]); // high e to low E: x32010
    // The sounding C with a capo on 2 is played as the shape of Bb.
    const played = shapeFor(chord, { ...part, capo: 2 }, lookupShape);
    expect(played?.frets).not.toEqual(open?.frets);
    expect(shapeFor(chord, part, undefined)).toBeUndefined();
  });

  it('shows the shape to play for a capo only when the part asks', () => {
    const part = { ...guitar.parts[0]!, capo: 2 };
    const chord = usedChords(buildChordSheet(guitar))[0]!;
    expect(capoShapeOf(part, chord)).toBeUndefined();
    expect(formatChord(capoShapeOf({ ...part, chordCapoShapes: true }, chord)!)).toBe('Bb');
  });

  it('describes a diagram for a screen reader and draws one dot per fretted string', () => {
    const chord = usedChords(buildChordSheet(guitar))[0]!;
    const shape = shapeFor(chord, guitar.parts[0]!, lookupShape)!;
    expect(diagramDescription(shape)).toBe('0 1 0 2 3 x');
    const g = diagramGeometry(shape, 6);
    expect(g.circles.filter((c) => c.fill)).toHaveLength(3);
    expect(g.circles.filter((c) => !c.fill)).toHaveLength(2); // open strings
    expect(g.width).toBeGreaterThan(40);
  });
});
