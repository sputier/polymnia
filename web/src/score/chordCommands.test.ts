import { describe, expect, it } from 'vitest';
import {
  History,
  chordStaffId,
  createScore,
  deserialize,
  formatChord,
  insertMeasure,
  parseChord,
  removeChord,
  serialize,
  setChord,
  setChordCapoShapes,
  setChordDiagram,
  setChordDiagramMode,
  setKeySignature,
  setMeasureLength,
  setTimeSignature,
  staffChords,
  transposeChords,
  validateScore,
  CommandError,
  type ChordData,
  type Score,
} from './index';

const chord = (text: string): ChordData => parseChord(text)!;

function guitarScore(measures = 4): Score {
  return createScore({ measures, instruments: ['guitar-steel'] });
}
const staffOf = (s: Score) => chordStaffId(s.parts[0]!);

function run(score: Score, ...cmds: Parameters<History['execute']>[0][]): Score {
  const h = new History(score);
  for (const c of cmds) h.execute(c);
  return h.score;
}

const names = (s: Score) =>
  staffChords(s, staffOf(s)).map(
    ({ measure, chord: c }) => `${measure}:${c.tick}:${formatChord(c)}`,
  );

describe('setChord', () => {
  it('adds symbols sorted by tick', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    const s = run(
      s0,
      setChord({ staffId: id, measure: 1, tick: 1920, chord: chord('G') }),
      setChord({ staffId: id, measure: 1, tick: 0, chord: chord('Am7') }),
    );
    expect(names(s)).toEqual(['1:0:Am7', '1:1920:G']);
    expect(validateScore(s)).toEqual([]);
  });

  it('replaces the symbol at the same tick and keeps its id and diagram flag', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    const a = run(
      s0,
      setChord({ staffId: id, measure: 0, tick: 0, chord: chord('C') }),
      setChordDiagram({ staffId: id, measure: 0, tick: 0, diagram: true }),
    );
    const before = staffChords(a, id)[0]!.chord;
    const b = run(a, setChord({ staffId: id, measure: 0, tick: 0, chord: chord('F/A') }));
    const after = staffChords(b, id)[0]!.chord;
    expect(after.id).toBe(before.id);
    expect(after.diagram).toBe(true);
    expect(formatChord(after)).toBe('F/A');
    expect(staffChords(b, id)).toHaveLength(1);
  });

  it('returns the same score for the same chord', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    const a = run(s0, setChord({ staffId: id, measure: 0, tick: 0, chord: chord('C') }));
    expect(setChord({ staffId: id, measure: 0, tick: 0, chord: chord('C') }).apply(a)).toBe(a);
  });

  it('refuses a position outside the measure and an unknown staff', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    expect(() =>
      setChord({ staffId: id, measure: 0, tick: 3840, chord: chord('C') }).apply(s0),
    ).toThrow(CommandError);
    expect(() =>
      setChord({ staffId: id, measure: 9, tick: 0, chord: chord('C') }).apply(s0),
    ).toThrow(CommandError);
    expect(() =>
      setChord({ staffId: 'nope', measure: 0, tick: 0, chord: chord('C') }).apply(s0),
    ).toThrow(CommandError);
    expect(() =>
      setChord({ staffId: id, measure: 0, tick: 10.5, chord: chord('C') }).apply(s0),
    ).toThrow(CommandError);
  });

  it('undoes and redoes exactly', () => {
    const s0 = guitarScore();
    const h = new History(s0);
    h.execute(setChord({ staffId: staffOf(s0), measure: 0, tick: 960, chord: chord('Dm') }));
    const withChord = h.score;
    h.undo();
    expect(h.score).toEqual(s0);
    h.redo();
    expect(h.score).toEqual(withChord);
  });
});

describe('removeChord', () => {
  it('removes a symbol and drops the empty list', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    const a = run(s0, setChord({ staffId: id, measure: 0, tick: 0, chord: chord('C') }));
    const b = run(a, removeChord({ staffId: id, measure: 0, tick: 0 }));
    expect(b.parts[0]!.staves[0]!.measures[0]!.chords).toBeUndefined();
    expect(removeChord({ staffId: id, measure: 0, tick: 0 }).apply(b)).toBe(b);
  });
});

describe('diagram options', () => {
  it('sets the part mode and the per-chord flag', () => {
    const s0 = guitarScore();
    const part = s0.parts[0]!;
    const a = run(s0, setChordDiagramMode({ partId: part.id, mode: 'first' }));
    expect(a.parts[0]!.chordDiagrams).toBe('first');
    const b = run(a, setChordDiagramMode({ partId: part.id, mode: null }));
    expect(b.parts[0]!.chordDiagrams).toBeUndefined();
    expect(setChordDiagramMode({ partId: part.id, mode: null }).apply(b)).toBe(b);
    const c = run(b, setChordCapoShapes({ partId: part.id, on: true }));
    expect(c.parts[0]!.chordCapoShapes).toBe(true);
    expect(run(c, setChordCapoShapes({ partId: part.id, on: false })).parts[0]!).not.toHaveProperty(
      'chordCapoShapes',
    );
  });

  it('clears the flag with null', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    const a = run(
      s0,
      setChord({ staffId: id, measure: 0, tick: 0, chord: chord('C') }),
      setChordDiagram({ staffId: id, measure: 0, tick: 0, diagram: false }),
    );
    expect(staffChords(a, id)[0]!.chord.diagram).toBe(false);
    const b = run(a, setChordDiagram({ staffId: id, measure: 0, tick: 0, diagram: null }));
    expect(staffChords(b, id)[0]!.chord).not.toHaveProperty('diagram');
  });
});

describe('transposeChords', () => {
  it('transposes every chord with a correct spelling', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    const a = run(
      s0,
      setChord({ staffId: id, measure: 0, tick: 0, chord: chord('C') }),
      setChord({ staffId: id, measure: 0, tick: 1920, chord: chord('Am7/G') }),
      setChord({ staffId: id, measure: 1, tick: 0, chord: chord('F') }),
    );
    const b = run(a, transposeChords({ semitones: 3 }));
    expect(names(b)).toEqual(['0:0:Eb', '0:1920:Cm7/Bb', '1:0:Ab']);
    expect(names(run(b, transposeChords({ semitones: -3 })))).toEqual(names(a));
    expect(validateScore(b)).toEqual([]);
  });

  it('follows the key signature of the measure', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    const a = run(
      s0,
      setKeySignature({ measure: 0, fifths: 2 }),
      setChord({ staffId: id, measure: 0, tick: 0, chord: chord('B') }),
    );
    expect(names(run(a, transposeChords({ semitones: 1 })))).toEqual(['0:0:C']);
    const b = run(
      s0,
      setKeySignature({ measure: 0, fifths: 2 }),
      setChord({ staffId: id, measure: 0, tick: 0, chord: chord('C') }),
    );
    expect(names(run(b, transposeChords({ semitones: 1 })))).toEqual(['0:0:C#']);
    expect(names(run(b, transposeChords({ semitones: 1, keyFifths: -3 })))).toEqual(['0:0:Db']);
  });

  it('does nothing for whole octaves and an empty score', () => {
    const s0 = guitarScore();
    expect(transposeChords({ semitones: 12 }).apply(s0)).toBe(s0);
    expect(transposeChords({ semitones: 2 }).apply(s0)).toEqual(s0);
  });

  it('only touches the given staves', () => {
    const s0 = createScore({ measures: 2, instruments: ['guitar-steel', 'ukulele-concert'] });
    const g = chordStaffId(s0.parts[0]!);
    const u = chordStaffId(s0.parts[1]!);
    const a = run(
      s0,
      setChord({ staffId: g, measure: 0, tick: 0, chord: chord('C') }),
      setChord({ staffId: u, measure: 0, tick: 0, chord: chord('C') }),
    );
    const b = run(a, transposeChords({ semitones: 2, staffIds: [g] }));
    expect(formatChord(staffChords(b, g)[0]!.chord)).toBe('D');
    expect(formatChord(staffChords(b, u)[0]!.chord)).toBe('C');
  });

  it('rejects a fractional interval', () => {
    expect(() => transposeChords({ semitones: 1.5 }).apply(guitarScore())).toThrow(CommandError);
  });
});

describe('structure edits', () => {
  it('drops chords that no longer fit a shorter measure', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    const a = run(
      s0,
      setChord({ staffId: id, measure: 0, tick: 0, chord: chord('C') }),
      setChord({ staffId: id, measure: 0, tick: 2880, chord: chord('G') }),
    );
    const b = run(a, setMeasureLength({ measure: 0, length: 1920 }));
    expect(names(b)).toEqual(['0:0:C']);
    expect(validateScore(b)).toEqual([]);
    const c = run(a, setTimeSignature({ measure: 0, time: { beats: 2, beatType: 4 } }));
    expect(names(c)).toEqual(['0:0:C']);
    expect(validateScore(c)).toEqual([]);
  });

  it('keeps the chords of other measures when a measure is inserted', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    const a = run(
      s0,
      setChord({ staffId: id, measure: 1, tick: 0, chord: chord('D') }),
      insertMeasure({ index: 0 }),
    );
    expect(names(a)).toEqual(['2:0:D']);
  });
});

describe('serialization', () => {
  it('round trips chords, frames and part options', () => {
    const s0 = guitarScore();
    const id = staffOf(s0);
    const a = run(
      s0,
      setChord({ staffId: id, measure: 0, tick: 0, chord: chord('F#m7b5/C') }),
      setChord({ staffId: id, measure: 2, tick: 960, chord: chord('Bb6/9') }),
      setChordDiagramMode({ partId: s0.parts[0]!.id, mode: 'all' }),
      setChordCapoShapes({ partId: s0.parts[0]!.id, on: true }),
    );
    const back = deserialize(serialize(a));
    expect(back).toEqual(a);
    expect(names(back)).toEqual(['0:0:F#m7b5/C', '2:960:Bb6/9']);
  });

  it('round trips a custom frame', () => {
    const s0 = guitarScore();
    const json = JSON.parse(serialize(s0)) as {
      parts: { staves: { measures: Record<string, unknown>[] }[] }[];
    };
    json.parts[0]!.staves[0]!.measures[0]!.chords = [
      {
        id: 'k1',
        tick: 0,
        root: { step: 'F', alter: 0 },
        quality: '',
        frame: { frets: [1, 1, 2, 3, 3, 1], base: 1, barre: { fret: 1, from: 1, to: 6 } },
      },
    ];
    const back = deserialize(JSON.stringify(json));
    expect(back.parts[0]!.staves[0]!.measures[0]!.chords![0]!.frame!.barre).toEqual({
      fret: 1,
      from: 1,
      to: 6,
    });
    expect(deserialize(serialize(back))).toEqual(back);
  });

  const withChord = (patch: Record<string, unknown>) => {
    const json = JSON.parse(serialize(guitarScore())) as {
      parts: { staves: { measures: Record<string, unknown>[] }[] }[];
    };
    json.parts[0]!.staves[0]!.measures[0]!.chords = [
      { id: 'k1', tick: 0, root: { step: 'C', alter: 0 }, quality: '', ...patch },
    ];
    return JSON.stringify(json);
  };

  it('rejects invalid chords', () => {
    expect(() => deserialize(withChord({ tick: 3840 }))).toThrow(/outside the measure/);
    expect(() => deserialize(withChord({ quality: 'zzz' }))).toThrow(/Unknown chord quality/);
    expect(() => deserialize(withChord({ quality: 'm<7' }))).toThrow(/Invalid characters/);
    expect(() => deserialize(withChord({ quality: 'm7'.repeat(20) }))).toThrow();
    expect(() => deserialize(withChord({ root: { step: 'H', alter: 0 } }))).toThrow();
    expect(() => deserialize(withChord({ extra: 1 }))).toThrow(/Unknown property/);
    expect(() => deserialize(withChord({ frame: { frets: [0, 0], base: 1 } }))).toThrow(/strings/);
    expect(() =>
      deserialize(withChord({ frame: { frets: [0, 0, 0, 0, 0, 0], base: 0 } })),
    ).toThrow();
    expect(() =>
      deserialize(
        withChord({
          frame: { frets: [0, 0, 0, 0, 0, 0], base: 1, barre: { fret: 1, from: 4, to: 2 } },
        }),
      ),
    ).toThrow(/barre/);
  });

  it('rejects duplicate ticks and unsorted chords', () => {
    const json = JSON.parse(withChord({})) as {
      parts: { staves: { measures: { chords: Record<string, unknown>[] }[] }[] }[];
    };
    const list = json.parts[0]!.staves[0]!.measures[0]!.chords;
    list.push({ ...list[0]!, id: 'k2' });
    expect(() => deserialize(JSON.stringify(json))).toThrow(/sorted by tick/);
  });
});
