import { describe, expect, it } from 'vitest';
import {
  createScore,
  validateScore,
  decompose,
  durationTicks,
  fretToMidi,
  getInstrument,
  INSTRUMENTS,
  isInRange,
  keyAlter,
  midiToPitch,
  newId,
  partTuning,
  pitchToMidi,
  rangeWarnings,
  soundingMidi,
  soundingPitch,
  TICKS_PER_QUARTER,
  timeSignatureTicks,
  type Pitch,
} from './index';
import { buildScore } from './fixtures/dsl';
import { guitarArpeggio, ukuleleMelody } from './fixtures';

const P = (step: Pitch['step'], octave: number, alter: Pitch['alter'] = 0): Pitch => ({
  step,
  alter,
  octave,
});

describe('ticks', () => {
  it('uses 960 ticks per quarter', () => {
    expect(TICKS_PER_QUARTER).toBe(960);
    expect(durationTicks({ base: 'whole', dots: 0 })).toBe(3840);
    expect(durationTicks({ base: 'quarter', dots: 1 })).toBe(1440);
    expect(durationTicks({ base: 'half', dots: 2 })).toBe(3360);
    expect(durationTicks({ base: '32nd', dots: 2 })).toBe(210);
    expect(timeSignatureTicks({ beats: 6, beatType: 8 })).toBe(2880);
  });
  it('decomposes gaps into aligned durations', () => {
    expect(decompose(3840, 0)).toEqual([{ base: 'whole', dots: 0 }]);
    expect(decompose(2880, 0)).toEqual([{ base: 'half', dots: 1 }]);
    expect(decompose(1440, 480).map((d) => d.base + d.dots)).toEqual(['eighth0', 'quarter0']);
    expect(() => decompose(100, 0)).toThrow(RangeError);
  });
});

describe('pitch', () => {
  it('converts to MIDI', () => {
    expect(pitchToMidi(P('C', 4))).toBe(60);
    expect(pitchToMidi(P('A', 4))).toBe(69);
    expect(pitchToMidi(P('C', 4, -1))).toBe(59);
    expect(pitchToMidi(P('B', 3, 1))).toBe(60);
  });
  it('spells MIDI numbers using the key', () => {
    expect(midiToPitch(61, 2)).toStrictEqual(P('C', 4, 1));
    expect(midiToPitch(70, -1)).toStrictEqual(P('B', 4, -1));
    expect(midiToPitch(70, 0)).toStrictEqual(P('A', 4, 1));
    expect(midiToPitch(70, 0, true)).toStrictEqual(P('B', 4, -1));
    expect(midiToPitch(71, -7)).toStrictEqual(P('C', 5, -1));
    for (let m = 0; m <= 127; m++) expect(pitchToMidi(midiToPitch(m, (m % 15) - 7))).toBe(m);
  });
  it('knows key signature alterations', () => {
    expect(keyAlter('F', 1)).toBe(1);
    expect(keyAlter('C', 1)).toBe(0);
    expect(keyAlter('B', -1)).toBe(-1);
    expect(keyAlter('E', -1)).toBe(0);
  });
  it('generates unique ids', () => {
    expect(newId()).not.toBe(newId());
    expect(newId('x')).toMatch(/^x-[a-z0-9]{8}$/);
  });
});

describe('instrument catalog', () => {
  it('has unique ids, valid programs and ranges', () => {
    expect(new Set(INSTRUMENTS.map((i) => i.id)).size).toBe(INSTRUMENTS.length);
    for (const i of INSTRUMENTS) {
      expect(i.gmProgram).toBeGreaterThanOrEqual(0);
      expect(i.gmProgram).toBeLessThan(128);
      expect(pitchToMidi(i.range.low)).toBeLessThan(pitchToMidi(i.range.high));
      expect(i.names.en && i.names.fr).toBeTruthy();
      expect(i.clefs.length).toBeGreaterThan(0);
    }
  });
  it('seeds the required instruments', () => {
    for (const id of [
      'piano',
      'voice',
      'flute',
      'violin',
      'cello',
      'guitar-classical',
      'guitar-steel',
      'ukulele-soprano',
      'ukulele-concert',
      'ukulele-tenor',
      'ukulele-tenor-low-g',
      'ukulele-baritone',
    ]) {
      expect(getInstrument(id)).toBeDefined();
    }
    expect(getInstrument('cello')!.clefs).toEqual(['bass', 'tenor', 'treble']);
  });
  it('describes the classical guitar', () => {
    const g = getInstrument('guitar-classical')!;
    expect(g.clefs[0]).toBe('treble-8vb');
    expect(g.transposition).toBe(-12);
    expect(g.strings!.map((s) => s.step + s.octave).join(' ')).toBe('E4 B3 G3 D3 A2 E2');
  });
  it('describes the ukulele family', () => {
    expect(
      getInstrument('ukulele-soprano')!
        .strings!.map((s) => s.step + s.octave)
        .join(' '),
    ).toBe('A4 E4 C4 G4');
    expect(getInstrument('ukulele-tenor-low-g')!.strings![3]).toStrictEqual(P('G', 3));
    expect(
      getInstrument('ukulele-baritone')!
        .strings!.map((s) => s.step + s.octave)
        .join(' '),
    ).toBe('E4 B3 G3 D3');
  });
  it('stores written pitch and computes the sounding pitch', () => {
    expect(soundingPitch(P('E', 3), -12)).toStrictEqual(P('E', 2));
    expect(soundingMidi(P('E', 3), -12)).toBe(40);
    expect(soundingPitch(P('C', 4), 0)).toStrictEqual(P('C', 4));
    expect(soundingPitch(P('C', 5), -2)).toStrictEqual(P('B', 4, -1));
  });
  it('computes fret positions', () => {
    const open = P('D', 3);
    expect(fretToMidi(open, 0, 2)).toBe(52);
    expect(fretToMidi(open, 2, 2)).toBe(54);
  });
  it('lets a part override the tuning', () => {
    expect(partTuning(guitarArpeggio.parts[0]!)).toHaveLength(6);
    expect(partTuning(ukuleleMelody.parts[0]!)![3]).toStrictEqual(P('G', 4));
  });
  it('checks the sounding range (written pitch + transposition)', () => {
    const g = getInstrument('guitar-classical')!;
    expect(isInRange(g, P('E', 3))).toBe(true); // sounds E2
    expect(isInRange(g, P('D', 3))).toBe(false); // sounds D2
    expect(isInRange(g, P('B', 6))).toBe(true); // sounds B5, the top of the range
    expect(isInRange(g, P('C', 7))).toBe(false);
    const v = getInstrument('violin')!;
    expect(isInRange(v, P('G', 3))).toBe(true);
    expect(isInRange(v, P('F', 3, 1))).toBe(false);
  });
  it('reports out-of-range notes as warnings, not errors', () => {
    expect(rangeWarnings(guitarArpeggio)).toEqual([]);
    const s = buildScore({
      title: 't',
      parts: [{ name: 'Violin', instrument: 'violin', staves: [{ measures: ['C3:w', 'A4:w'] }] }],
    });
    const w = rangeWarnings(s);
    expect(w).toHaveLength(1);
    expect(w[0]!.code).toBe('out-of-range');
    expect(w[0]!.path).toContain('/measures/0/');
  });
});

describe('createScore', () => {
  it('builds a piano grand staff by default', () => {
    const s = createScore();
    expect(s.parts[0]!.staves.map((x) => x.clef)).toEqual(['treble', 'bass']);
    expect(validateScore(s)).toEqual([]);
    const g = createScore({ instruments: ['guitar-classical'], time: { beats: 6, beatType: 8 } });
    expect(g.parts[0]!.transposition).toBe(-12);
    expect(g.parts[0]!.staves[0]!.clef).toBe('treble-8vb');
    expect(validateScore(g)).toEqual([]);
  });
});
