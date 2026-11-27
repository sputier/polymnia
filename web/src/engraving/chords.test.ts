import { describe, expect, it } from 'vitest';
import {
  chordStaffId,
  createScore,
  parseChord,
  setChord,
  setChordCapoShapes,
  setChordDiagram,
  setChordDiagramMode,
  setCapo,
  type Score,
} from '../score';
import { guitarChords, pianoChords, ukuleleChords } from '../score/fixtures';
import {
  CHORD,
  DIAGRAM_BAND,
  capoShape,
  chordLabel,
  chordWidth,
  diagramPlan,
  diagramStrings,
  diagramWidth,
  needsChordLibrary,
} from './chords';

const label = (text: string, shape?: string) =>
  chordLabel(parseChord(text)!, shape ? parseChord(shape)! : undefined);
const texts = (text: string) => label(text).runs.map((r) => r.text);

describe('chordLabel', () => {
  it('sets the root on the baseline and the extensions raised and smaller', () => {
    const l = label('Am7');
    expect(l.runs.map((r) => [r.text, r.size, r.dy])).toEqual([
      ['A', CHORD.size, 0],
      ['m', CHORD.size, 0],
      ['7', CHORD.supSize, -CHORD.supRaise],
    ]);
  });

  it('draws sharps and flats as Bravura glyphs, never as # and b', () => {
    const sharp = label('F#m7b5');
    expect(sharp.runs.filter((r) => r.font === 'music').map((r) => r.text)).toEqual(['', '']);
    expect(sharp.runs.some((r) => r.text.includes('#'))).toBe(false);
    expect(texts('Bbmaj7')).toEqual(['B', '', 'maj', '7']);
    expect(label('Cbb').runs.map((r) => r.text)).toEqual(['C', '']);
    expect(label('Gx').runs.map((r) => r.text)).toEqual(['G', '']);
  });

  it('keeps maj, dim, aug and sus on the baseline', () => {
    for (const name of ['Cmaj7', 'Cdim7', 'Caug', 'Csus4']) {
      const [, word] = label(name).runs;
      expect(word!.dy).toBe(0);
    }
    expect(label('Cadd9').runs[1]!.dy).toBe(-CHORD.supRaise);
  });

  it('writes a slash chord with the bass on the baseline', () => {
    const l = label('E7b9/G#');
    expect(l.runs.map((r) => r.text)).toEqual(['E', '7', '', '9', '/', 'G', '']);
    expect(l.runs.at(-1)!.dy).toBeLessThan(0); // the accidental of the bass is lifted
    expect(l.runs.find((r) => r.text === 'G')!.dy).toBe(0);
  });

  it('advances left to right and reports the width', () => {
    for (const name of ['C', 'Am7', 'F#m7b5/C#', 'Bbmaj7', 'C6/9']) {
      const l = label(name);
      const xs = l.runs.map((r) => r.x);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
      expect(l.width).toBeGreaterThan(xs.at(-1)!);
    }
    expect(label('Cmaj7').width).toBeGreaterThan(label('C').width);
    expect(label('F#m7b5/C#').width).toBeGreaterThan(label('Fm7b5').width);
  });

  it('adds the capo shape in parentheses and a smaller size', () => {
    const l = label('D', 'C');
    expect(l.runs.map((r) => r.text)).toEqual(['D', '(', 'C', ')']);
    expect(l.runs[2]!.size).toBe(CHORD.capoSize);
    expect(l.width).toBeGreaterThan(label('D').width + 10);
  });
});

function guitarWith(...entries: [number, number, string][]): Score {
  let s = createScore({ measures: 4, instruments: ['guitar-steel'] });
  for (const [measure, tick, text] of entries) {
    s = setChord({
      staffId: chordStaffId(s.parts[0]!),
      measure,
      tick,
      chord: parseChord(text)!,
    }).apply(s);
  }
  return s;
}

describe('diagramPlan', () => {
  const entries: [number, number, string][] = [
    [0, 0, 'C'],
    [0, 1920, 'G'],
    [1, 0, 'C'],
    [2, 0, 'G/B'],
    [3, 0, 'G'],
  ];

  it('shows no diagram by default', () => {
    expect(diagramPlan(guitarWith(...entries)).size).toBe(0);
  });

  it('shows the first occurrence of each chord', () => {
    const base = guitarWith(...entries);
    const s = setChordDiagramMode({ partId: base.parts[0]!.id, mode: 'first' }).apply(base);
    const chords = s.parts[0]!.staves[0]!.measures.flatMap((m) => m.chords ?? []);
    const plan = diagramPlan(s);
    expect(chords.map((c) => plan.has(c.id))).toEqual([true, true, false, true, false]);
  });

  it('shows every chord', () => {
    const base = guitarWith(...entries);
    const s = setChordDiagramMode({ partId: base.parts[0]!.id, mode: 'all' }).apply(base);
    expect(diagramPlan(s).size).toBe(5);
  });

  it('lets a chord override the mode, both ways', () => {
    const base = guitarWith(...entries);
    const id = chordStaffId(base.parts[0]!);
    let s = setChordDiagramMode({ partId: base.parts[0]!.id, mode: 'first' }).apply(base);
    s = setChordDiagram({ staffId: id, measure: 1, tick: 0, diagram: true }).apply(s);
    s = setChordDiagram({ staffId: id, measure: 0, tick: 1920, diagram: false }).apply(s);
    const chords = s.parts[0]!.staves[0]!.measures.flatMap((m) => m.chords ?? []);
    const plan = diagramPlan(s);
    expect(chords.map((c) => plan.has(c.id))).toEqual([true, false, true, true, false]);
  });

  it('forces one diagram without a mode', () => {
    const base = guitarWith(...entries);
    const s = setChordDiagram({
      staffId: chordStaffId(base.parts[0]!),
      measure: 2,
      tick: 0,
      diagram: true,
    }).apply(base);
    expect(diagramPlan(s).size).toBe(1);
  });

  it('never draws a diagram for an instrument without strings', () => {
    const s0 = createScore({ measures: 1, instruments: ['piano'] });
    const s = setChord({
      staffId: chordStaffId(s0.parts[0]!),
      measure: 0,
      tick: 0,
      chord: parseChord('C')!,
    }).apply(s0);
    const forced = setChordDiagram({
      staffId: chordStaffId(s.parts[0]!),
      measure: 0,
      tick: 0,
      diagram: true,
    }).apply(s);
    expect(diagramPlan(forced).size).toBe(0);
    expect(needsChordLibrary(forced)).toBe(false);
  });

  it('counts the same chord with a custom fingering as another chord', () => {
    expect(diagramStrings(guitarWith().parts[0]!)).toBe(6);
    expect(diagramStrings(createScore({ instruments: ['piano'] }).parts[0]!)).toBeUndefined();
  });
});

describe('needsChordLibrary', () => {
  it('is true only when a diagram can be shown', () => {
    expect(needsChordLibrary(guitarChords)).toBe(true);
    expect(needsChordLibrary(ukuleleChords)).toBe(true);
    expect(needsChordLibrary(pianoChords)).toBe(false);
    expect(needsChordLibrary(guitarWith([0, 0, 'C']))).toBe(false);
  });
});

describe('chordWidth', () => {
  it('is the wider of the label and the diagram', () => {
    const s = guitarWith([0, 0, 'C'], [0, 1920, 'Bbmaj7/D']);
    const part = s.parts[0]!;
    const [c, long] = s.parts[0]!.staves[0]!.measures[0]!.chords!;
    expect(chordWidth(c!, { part, diagram: false })).toBe(label('C').width);
    expect(chordWidth(c!, { part, diagram: true })).toBe(diagramWidth(6));
    expect(chordWidth(long!, { part, diagram: true })).toBe(label('Bbmaj7/D').width);
  });

  it('counts the capo shape', () => {
    let s = guitarWith([0, 0, 'D']);
    s = setCapo({ partId: s.parts[0]!.id, capo: 2 }).apply(s);
    s = setChordCapoShapes({ partId: s.parts[0]!.id, on: true }).apply(s);
    const part = s.parts[0]!;
    const c = part.staves[0]!.measures[0]!.chords![0]!;
    expect(capoShape(part, c)).toMatchObject({ root: { step: 'C' } });
    expect(chordWidth(c, { part, diagram: false })).toBeGreaterThan(label('D').width);
    const off = setChordCapoShapes({ partId: part.id, on: false }).apply(s).parts[0]!;
    expect(capoShape(off, c)).toBeUndefined();
  });
});

describe('metrics', () => {
  it('reserves room for a diagram above the staff', () => {
    expect(DIAGRAM_BAND).toBeGreaterThan(CHORD.marker + CHORD.frets * CHORD.fretGap);
    expect(diagramWidth(4)).toBeLessThan(diagramWidth(6));
  });
});
