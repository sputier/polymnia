import { describe, expect, it } from 'vitest';
import {
  chordStaffId,
  createScore,
  parseChord,
  setChord,
  setChordDiagramMode,
  type Score,
} from '../score';
import { guitarChords, pianoChords, ukuleleChords, pianoGrandStaff } from '../score/fixtures';
import { CHORD, DIAGRAM_BAND, DIAGRAM_HEIGHT, chordLabel } from './chords';
import { chordAnchor, hitTest } from './hitTest';
import { LayoutCache, METRICS, layoutScore, staffSlots } from './layout';

function withChords(score: Score, entries: [number, number, string][], part = 0): Score {
  let s = score;
  for (const [measure, tick, text] of entries) {
    s = setChord({
      staffId: chordStaffId(s.parts[part]!),
      measure,
      tick,
      chord: parseChord(text)!,
    }).apply(s);
  }
  return s;
}

const empty = (instrument: string, measures = 4) =>
  createScore({ measures, instruments: [instrument] });

describe('chords in the layout: columns and widths', () => {
  it('puts every symbol on the column of its tick', () => {
    const layout = layoutScore(pianoChords, { width: 900 });
    const first = layout.systems[0]!.measures[0]!;
    const chords = first.shape.chords[0]!;
    expect(chords.map((c) => c.tick)).toEqual([0, 1920]);
    chords.forEach((c) => expect(first.shape.columns[c.col]!.tick).toBe(c.tick));
    // The grand staff has a second slot, without chords.
    expect(first.shape.chords[1]).toEqual([]);
  });

  it('creates a column, without a notehead width, for a symbol between two notes', () => {
    const s = withChords(empty('guitar-steel'), [[0, 480, 'Am']]);
    const layout = layoutScore(s, { width: 600 });
    const shape = layout.systems[0]!.measures[0]!.shape;
    expect(shape.columns.map((c) => c.tick)).toEqual([0, 480]);
    expect(shape.columns[1]!.glyph).toBeGreaterThanOrEqual(0);
    // The whole-rest column is not shortened by the chord column.
    expect(shape.chords[0]![0]!.col).toBe(1);
  });

  it('does not center a measure that has symbols', () => {
    const rests = layoutScore(empty('guitar-steel'), { width: 600 }).systems[0]!.measures[0]!;
    expect(rests.shape.restOnly).toBe(true);
    const chorded = layoutScore(withChords(empty('guitar-steel'), [[0, 0, 'C']]), {
      width: 600,
    }).systems[0]!.measures[0]!;
    expect(chorded.shape.restOnly).toBe(false);
  });

  it('keeps two symbols of a staff apart, whatever the width', () => {
    for (const score of [guitarChords, ukuleleChords, pianoChords]) {
      for (const width of [260, 420, 700, 1100]) {
        const layout = layoutScore(score, { width });
        for (const system of layout.systems) {
          for (const m of system.measures) {
            m.shape.chords.forEach((list) => {
              list.forEach((c, i) => {
                const next = list[i + 1];
                const right = next ? m.colX[next.col]! : m.noteEndX;
                expect(
                  right - m.colX[c.col]!,
                  `${score.meta.title} @${width}`,
                ).toBeGreaterThanOrEqual(Math.min(c.width, 1e9) - 1);
              });
            });
          }
        }
      }
    }
  });

  it('widens a measure whose symbols are long', () => {
    const plain = withChords(empty('guitar-steel'), [
      [0, 0, 'C'],
      [0, 960, 'G'],
      [0, 1920, 'D'],
      [0, 2880, 'A'],
    ]);
    const long = withChords(empty('guitar-steel'), [
      [0, 0, 'C#m7b5/G'],
      [0, 960, 'Bbmaj7#11/D'],
      [0, 1920, 'F#7b9#5/A#'],
      [0, 2880, 'Ebm(maj7)/Bb'],
    ]);
    const w = (s: Score) => layoutScore(s, { width: 4000 }).systems[0]!.measures[0]!;
    const natural = (m: ReturnType<typeof w>) => m.shape.fixed + m.shape.stretch;
    expect(natural(w(long))).toBeGreaterThan(natural(w(plain)));
  });

  it('sizes the measure for the label of the symbol', () => {
    const s = withChords(empty('piano', 1), [[0, 0, 'F#m7b5/C#']]);
    const m = layoutScore(s, { width: 4000 }).systems[0]!.measures[0]!;
    const needed = chordLabel(parseChord('F#m7b5/C#')!).width;
    expect(m.shape.fixed).toBeGreaterThanOrEqual(needed);
  });
});

describe('chords in the layout: room above the staff', () => {
  it('adds nothing for symbols alone', () => {
    const plain = staffSlots(pianoGrandStaff);
    const chorded = staffSlots(pianoChords);
    expect(chorded[0]!.top).toBe(plain[0]!.top);
    expect(chorded[0]!.diagrams).toBe(false);
    expect(chorded[0]!.chordY).toBe(chorded[0]!.top - CHORD.baseline);
  });

  it('reserves a band for the diagrams of the staff that has them', () => {
    const slots = staffSlots(guitarChords);
    expect(slots[0]!.diagrams).toBe(true);
    expect(slots[0]!.top).toBe(METRICS.topPad + DIAGRAM_BAND);
    expect(slots[0]!.diagramY + DIAGRAM_HEIGHT).toBe(slots[0]!.top - CHORD.clearance);
    expect(slots[0]!.chordY).toBeLessThan(slots[0]!.diagramY);
    const plainGuitar = staffSlots(empty('guitar-steel'))[0]!;
    expect(plainGuitar.top).toBe(METRICS.topPad);
    expect(plainGuitar.diagrams).toBe(false);
  });

  it('makes the systems taller by the band, and only then', () => {
    const base = withChords(empty('guitar-steel'), [[0, 0, 'C']]);
    const noDiagram = layoutScore(base, { width: 600 }).systems[0]!;
    const withDiagram = layoutScore(
      setChordDiagramMode({ partId: base.parts[0]!.id, mode: 'all' }).apply(base),
      { width: 600 },
    ).systems[0]!;
    expect(withDiagram.height - noDiagram.height).toBe(DIAGRAM_BAND);
    expect(noDiagram.height).toBe(
      layoutScore(empty('guitar-steel'), { width: 600 }).systems[0]!.height,
    );
  });

  it('stacks the bands of two staves', () => {
    let s = createScore({ measures: 2, instruments: ['guitar-steel', 'ukulele-concert'] });
    s = withChords(s, [[0, 0, 'C']], 0);
    s = withChords(s, [[0, 0, 'G']], 1);
    s = setChordDiagramMode({ partId: s.parts[0]!.id, mode: 'all' }).apply(s);
    s = setChordDiagramMode({ partId: s.parts[1]!.id, mode: 'all' }).apply(s);
    const slots = staffSlots(s);
    expect(slots[0]!.diagrams && slots[1]!.diagrams).toBe(true);
    const gap = slots[1]!.top - (slots[0]!.top + slots[0]!.height);
    expect(gap).toBe(METRICS.partGap + DIAGRAM_BAND);
  });
});

describe('chords in the layout: incremental', () => {
  it('only recomputes the measure that changed', () => {
    const cache = new LayoutCache();
    const before = layoutScore(guitarChords, { width: 900 }, cache);
    const edited = withChords(guitarChords, [[2, 1920, 'Fmaj7']]);
    const after = layoutScore(edited, { width: 900 }, cache);
    const shapes = (l: typeof before) => l.systems.flatMap((s) => s.measures.map((m) => m.shape));
    const a = shapes(before);
    const b = shapes(after);
    expect(b[2]).not.toBe(a[2]);
    // The measure after it is recomputed too (the cache identity includes the previous measure, for ties).
    expect(b.filter((shape, i) => shape === a[i])).toHaveLength(a.length - 2);
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
    expect(b.slice(4)).toEqual(a.slice(4));
  });

  it('recomputes when the diagram mode changes what is shown', () => {
    const cache = new LayoutCache();
    layoutScore(guitarChords, { width: 900 }, cache);
    const all = setChordDiagramMode({ partId: guitarChords.parts[0]!.id, mode: 'all' }).apply(
      guitarChords,
    );
    const layout = layoutScore(all, { width: 900 }, cache);
    // The repeated G of the last measure now shows a diagram: its shape knows it.
    const last = layout.systems.flatMap((s) => s.measures).at(-1)!;
    expect(last.shape.chords[0]![0]!.diagram).toBe(true);
  });
});

describe('chord positions and hits', () => {
  const layout = layoutScore(guitarChords, { width: 900 });
  const system = layout.systems[0]!;
  const slot = system.staves[0]!;
  const measure = system.measures[1]!;

  it('finds the place of the text field', () => {
    const staffId = guitarChords.parts[0]!.staves[0]!.id;
    const at = chordAnchor(layout, staffId, 1, 0)!;
    expect(at.x).toBeCloseTo(measure.colX[measure.shape.chords[0]![0]!.col]! - 2, 5);
    expect(at.y).toBe(system.y + slot.chordY - CHORD.size);
  });

  it('places a position between two columns, and past the last one', () => {
    const staffId = guitarChords.parts[0]!.staves[0]!.id;
    const m = system.measures[0]!;
    const first = chordAnchor(layout, staffId, 0, 0)!;
    const mid = chordAnchor(layout, staffId, 0, 480)!;
    const second = chordAnchor(layout, staffId, 0, 1920)!;
    expect(mid.x).toBeGreaterThan(first.x);
    expect(mid.x).toBeLessThan(second.x);
    const late = chordAnchor(layout, staffId, 0, 3840 - 120)!;
    expect(late.x).toBeLessThan(m.noteEndX);
    expect(chordAnchor(layout, 'nope', 0, 0)).toBeUndefined();
    expect(chordAnchor(layout, staffId, 99, 0)).toBeUndefined();
  });

  it('hits a chord symbol and its diagram', () => {
    const c = measure.shape.chords[0]![0]!;
    const x = measure.colX[c.col]! + 4;
    const onSymbol = hitTest(layout, x, system.y + slot.chordY - 4)!;
    expect(onSymbol.chord).toEqual({ id: c.id, tick: 0 });
    expect(onSymbol.staffId).toBe(slot.staffId);
    expect(onSymbol.measureIndex).toBe(1);
    const onDiagram = hitTest(layout, x, system.y + slot.diagramY + 20)!;
    expect(onDiagram.chord?.id).toBe(c.id);
  });

  it('does not hit a chord elsewhere', () => {
    const c = measure.shape.chords[0]![0]!;
    const x = measure.colX[c.col]! + 4;
    // On the staff: a normal hit, no chord.
    expect(hitTest(layout, x, system.y + slot.top + 10)!.chord).toBeUndefined();
    // Far to the right of the symbol, in the same row.
    const far = hitTest(layout, measure.colX[c.col]! + c.width + 30, system.y + slot.chordY - 4);
    expect(far?.chord).toBeUndefined();
  });
});
