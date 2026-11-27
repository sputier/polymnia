import { describe, expect, it } from 'vitest';
import { buildScore } from '../score/fixtures/dsl';
import { celloClefChanges, guitarArpeggio } from '../score/fixtures';
import {
  accidentalsFor,
  clefChangeAt,
  clefGlyph,
  beamGroups,
  beamGroupTicks,
  hasSecond,
  pitchAtY,
  sortedByStaffPosition,
  stepIndex,
  tieInFrom,
  yOfStep,
} from './notation';

function staffMeasure(cells: string | string[], keyless = true) {
  void keyless;
  const score = buildScore({
    title: 't',
    parts: [{ name: 'p', instrument: 'piano', staves: [{ measures: [cells] }] }],
  });
  return score.parts[0]!.staves[0]!.measures[0]!;
}

describe('staff geometry', () => {
  it('puts the treble top line on F5 and the bass top line on A3', () => {
    expect(yOfStep(stepIndex({ step: 'F', octave: 5 }), 'treble')).toBe(0);
    expect(yOfStep(stepIndex({ step: 'E', octave: 4 }), 'treble')).toBe(40);
    expect(yOfStep(stepIndex({ step: 'A', octave: 3 }), 'bass')).toBe(0);
    expect(yOfStep(stepIndex({ step: 'C', octave: 4 }), 'tenor')).toBe(10);
  });

  it('treats treble-8vb like treble for the written position', () => {
    const p = { step: 'A' as const, octave: 3 };
    expect(yOfStep(stepIndex(p), 'treble-8vb')).toBe(yOfStep(stepIndex(p), 'treble'));
  });

  it('round-trips pitches through y', () => {
    for (const clef of ['treble', 'bass', 'alto', 'tenor'] as const) {
      for (const step of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const) {
        const p = { step, alter: 0 as const, octave: 4 };
        expect(pitchAtY(yOfStep(stepIndex(p), clef), clef)).toEqual(p);
      }
    }
  });

  it('snaps a click between a line and a space to the nearest position', () => {
    // y = 2 is closer to the top line (F5) than to the first space (E5 at y = 5).
    expect(pitchAtY(2, 'treble')).toMatchObject({ step: 'F', octave: 5 });
    expect(pitchAtY(3.5, 'treble')).toMatchObject({ step: 'E', octave: 5 });
  });

  it('detects displaced seconds in chords', () => {
    const chord = staffMeasure('C4+D4:w').voices[0]!.events[0]!;
    if (chord.kind !== 'note') throw new Error('note expected');
    expect(hasSecond(chord.pitches)).toBe(true);
    const triad = staffMeasure('C4+E4+G4:w').voices[0]!.events[0]!;
    if (triad.kind !== 'note') throw new Error('note expected');
    expect(hasSecond(triad.pitches)).toBe(false);
    expect(sortedByStaffPosition(triad.pitches).map((p) => p.step)).toEqual(['C', 'E', 'G']);
  });
});

describe('accidentals', () => {
  const glyphs = (m: ReturnType<typeof staffMeasure>, key = 0, tieIn = tieInFrom(undefined)) => {
    const map = accidentalsFor(m, key, tieIn);
    return m.voices.flatMap((v) => v.events).map((e) => map.get(e.id));
  };

  it('prints an accidental only when it differs from the key signature', () => {
    // In G major (1 sharp) F# is in the key: no sign. F natural needs a natural sign.
    const m = staffMeasure('F#4:q F4:q C4:h');
    expect(glyphs(m, 1)).toEqual([[null], ['n'], [null]]);
  });

  it('prints sharps in C major and remembers them for the rest of the measure', () => {
    const m = staffMeasure('F#4:q F#4:q F4:q C4:q');
    expect(glyphs(m)).toEqual([['#'], [null], ['n'], [null]]);
  });

  it('tracks the accidental per octave', () => {
    const m = staffMeasure('F#4:q F#5:q');
    expect(glyphs(m)).toEqual([['#'], ['#']]);
  });

  it('handles double sharps and flats and chords', () => {
    const m = staffMeasure('C##4:q Bb3+D4:q E4:h');
    expect(glyphs(m)).toEqual([['##'], ['b', null], [null]]);
  });

  it('follows time order across voices', () => {
    const m = staffMeasure(['F#4:q F4:q C4:h', 'C4:h F4:h']);
    const map = accidentalsFor(m, 0);
    const second = m.voices[1]!.events[1]!;
    // Voice 1's F4 at tick 1920 comes after the F natural of voice 0 (tick 960): no sign needed.
    expect(map.get(second.id)).toEqual([null]);
  });

  it('does not repeat the accidental of a note tied from the previous measure', () => {
    const score = buildScore({
      title: 't',
      parts: [
        {
          name: 'p',
          instrument: 'piano',
          staves: [{ measures: ['C4:h F#4:h~', 'F#4:w'] }],
        },
      ],
    });
    const [m0, m1] = score.parts[0]!.staves[0]!.measures;
    const withTie = accidentalsFor(m1!, 0, tieInFrom(m0));
    expect(withTie.get(m1!.voices[0]!.events[0]!.id)).toEqual([null]);
    const without = accidentalsFor(m1!, 0);
    expect(without.get(m1!.voices[0]!.events[0]!.id)).toEqual(['#']);
  });
});

describe('beam groups', () => {
  const voice = (text: string) => staffMeasure(text).voices[0]!;

  it('beams eighths by beat in 4/4', () => {
    expect(
      beamGroups(voice('C4:e D4:e E4:e F4:e G4:q A4:e B4:e'), { beats: 4, beatType: 4 }),
    ).toEqual([
      [0, 1],
      [2, 3],
      [5, 6],
    ]);
  });

  it('does not beam across a rest or beat boundary', () => {
    expect(beamGroups(voice('C4:e r:e D4:e E4:e F4:q G4:h'), { beats: 4, beatType: 4 })).toEqual([
      [2, 3],
    ]);
    // Offbeat eighths: the middle two are in different beats.
    expect(beamGroups(voice('C4:q D4:e E4:e F4:e G4:e'), { beats: 3, beatType: 4 })).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('groups three eighths in compound meters', () => {
    expect(beamGroupTicks({ beats: 6, beatType: 8 })).toBe(1440);
    expect(beamGroups(voice('C4:e D4:e E4:e F4:e G4:e A4:e'), { beats: 6, beatType: 8 })).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
  });

  it('never beams quarters', () => {
    expect(beamGroups(voice('C4:q D4:q E4:q F4:q'), { beats: 4, beatType: 4 })).toEqual([]);
  });

  it('beams tuplet members by their real duration', () => {
    const v = voice('(3 C4:e D4:e E4:e) F4:q G4:h');
    expect(beamGroups(v, { beats: 4, beatType: 4 })).toEqual([[0, 1, 2]]);
  });
});

describe('courtesy clefs', () => {
  const cello = celloClefChanges.parts[0]!.staves[0]!;
  const guitar = guitarArpeggio.parts[0]!.staves[0]!;

  it('announces a clef only where the clef in force changes', () => {
    const at = cello.measures.findIndex((m, i) => i > 0 && m.clef);
    expect(at).toBeGreaterThan(0);
    expect(clefChangeAt(cello, at)).toBe(cello.measures[at]!.clef);
    // A staff whose clef never changes announces nothing, whatever the other staves do.
    for (let m = 0; m < guitar.measures.length + 1; m++) expect(clefChangeAt(guitar, m)).toBeNull();
    expect(clefChangeAt(cello, 0)).toBeNull();
  });

  it('a clef repeated at a measure is not a change', () => {
    const repeated = {
      ...guitar,
      measures: guitar.measures.map((m, i) => (i === 1 ? { ...m, clef: guitar.clef } : m)),
    };
    expect(clefChangeAt(repeated, 1)).toBeNull();
  });

  it('draws treble-8vb as a treble clef with the 8vb mark, everything else plain', () => {
    expect(clefGlyph('treble-8vb')).toEqual({ type: 'treble', annotation: '8vb' });
    expect(clefGlyph('tenor')).toEqual({ type: 'tenor', annotation: undefined });
  });
});
