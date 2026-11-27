import { describe, expect, it } from 'vitest';
import { chordTones, notePc, parseChord } from '../score/chords';
import { getInstrument } from '../score/instruments';
import { pitchToMidi } from '../score/pitch';
import type { Pitch } from '../score/types';
import {
  generateShape,
  libraryEntries,
  lookupShape,
  makeShape,
  tuningFamily,
  type ChordShape,
  type TuningFamily,
} from './library';

const tuningOf = (id: string): readonly Pitch[] => getInstrument(id)!.strings!;
const GUITAR = tuningOf('guitar-steel');
const DROP_D: readonly Pitch[] = [...GUITAR.slice(0, 5), { step: 'D', alter: 0, octave: 2 }];
const UKE = tuningOf('ukulele-concert');
const UKE_LOW_G = tuningOf('ukulele-tenor-low-g');
const BARITONE = tuningOf('ukulele-baritone');

/** "x32010" style (lowest string first) of a shape. */
const text = (shape: ChordShape | undefined): string =>
  shape
    ? [...shape.frets]
        .reverse()
        .map((f) => (f < 0 ? 'x' : f.toString(36)))
        .join('')
    : 'none';

const shapeFor = (name: string, tuning: readonly Pitch[], capo = 0) =>
  lookupShape(parseChord(name)!, tuning, capo);

/** Pitch classes sounded by a shape. */
function sounded(shape: ChordShape, tuning: readonly Pitch[], capo = 0): number[] {
  return shape.frets
    .map((f, i) => (f < 0 ? -1 : (pitchToMidi(tuning[i]!) + capo + f) % 12))
    .filter((p) => p >= 0);
}

function lowestPc(shape: ChordShape, tuning: readonly Pitch[]): number {
  const i = shape.frets.map((f) => f >= 0).lastIndexOf(true);
  return (pitchToMidi(tuning[i]!) + shape.frets[i]!) % 12;
}

describe('tuning families', () => {
  it('recognizes the common tunings', () => {
    expect(tuningFamily(GUITAR)).toBe('guitar');
    expect(tuningFamily(tuningOf('guitar-classical'))).toBe('guitar');
    expect(tuningFamily(DROP_D)).toBe('dropD');
    expect(tuningFamily(UKE)).toBe('ukulele');
    expect(tuningFamily(UKE_LOW_G)).toBe('ukulele');
    expect(tuningFamily(BARITONE)).toBe('baritone');
    expect(tuningFamily(tuningOf('ukulele-soprano'))).toBe('ukulele');
  });
  it('does not know other tunings', () => {
    const openG: Pitch[] = [
      { step: 'D', alter: 0, octave: 4 },
      { step: 'B', alter: 0, octave: 3 },
      { step: 'G', alter: 0, octave: 3 },
      { step: 'D', alter: 0, octave: 3 },
      { step: 'G', alter: 0, octave: 2 },
      { step: 'D', alter: 0, octave: 2 },
    ];
    expect(tuningFamily(openG)).toBeUndefined();
  });
});

describe('guitar, standard tuning', () => {
  it.each([
    ['C', 'x32010'],
    ['G', '320003'],
    ['D', 'xx0232'],
    ['A', 'x02220'],
    ['E', '022100'],
    ['F', '133211'],
    ['Am', 'x02210'],
    ['Em', '022000'],
    ['Dm', 'xx0231'],
    ['G7', '320001'],
    ['Cmaj7', 'x32000'],
    ['Bm', 'x24432'],
    ['Bb', 'x13331'],
    ['F#m', '244222'],
    ['Gm', '355333'],
    ['B7', 'x21202'],
  ])('%s is %s', (name, expected) => {
    expect(text(shapeFor(name, GUITAR))).toBe(expected);
  });

  it('draws a barre for the F chord only', () => {
    expect(shapeFor('F', GUITAR)!.barre).toEqual({ fret: 1, from: 1, to: 6 });
    expect(shapeFor('C', GUITAR)!.barre).toBeUndefined();
    expect(shapeFor('Bm', GUITAR)).toMatchObject({ base: 2, barre: { fret: 2, from: 1, to: 5 } });
  });

  it('moves the window up the neck', () => {
    expect(shapeFor('F#m', GUITAR)!.base).toBe(2);
    expect(shapeFor('Gm', GUITAR)!.base).toBe(3);
    expect(shapeFor('C', GUITAR)!.base).toBe(1);
  });

  it('puts the bass of a slash chord at the bottom', () => {
    const shape = shapeFor('G/B', GUITAR)!;
    expect(shape).toBeDefined();
    expect(lowestPc(shape, GUITAR)).toBe(notePc(parseChord('B')!.root));
    const c = shapeFor('C/G', GUITAR)!;
    expect(lowestPc(c, GUITAR)).toBe(7);
  });
});

describe('every shape of every tuning is musically correct', () => {
  const families: [TuningFamily, readonly Pitch[], boolean][] = [
    ['guitar', GUITAR, true],
    ['dropD', DROP_D, true],
    ['ukulele', UKE, false],
    ['ukulele', UKE_LOW_G, false],
    ['baritone', BARITONE, false],
  ];
  const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const qualities = ['', 'm', '7', 'm7', 'maj7', 'sus4', 'sus2', '6', 'm6', 'dim', 'aug', '9'];

  it.each(families)('%s: all roots and qualities', (_family, tuning, rootBass) => {
    let missing = 0;
    for (const r of roots) {
      for (const q of qualities) {
        const chord = parseChord(r + q)!;
        const tones = chordTones(chord);
        const shape = lookupShape(chord, tuning);
        if (!shape) {
          missing++;
          continue;
        }
        const pcs = sounded(shape, tuning);
        const allowed = new Set([...tones.required, ...tones.optional]);
        for (const p of pcs) expect(allowed.has(p), `${r}${q} ${text(shape)}`).toBe(true);
        for (const p of tones.required) expect(pcs, `${r}${q} ${text(shape)}`).toContain(p);
        expect(pcs.length).toBeGreaterThanOrEqual(3);
        expect(shape.frets).toHaveLength(tuning.length);
        expect(Math.max(...shape.frets)).toBeLessThanOrEqual(15);
        if (rootBass) expect(lowestPc(shape, tuning), `${r}${q} ${text(shape)}`).toBe(tones.bass);
      }
    }
    // The basic qualities always have a shape; exotic ones may not on a 4-string instrument.
    expect(missing).toBeLessThanOrEqual(tuning.length === 4 ? 12 : 4);
  });

  it.each(['', 'm', '7', 'm7', 'maj7'])('finds %j on every root, on every instrument', (q) => {
    for (const [, tuning] of families) {
      for (const r of roots) expect(shapeFor(r + q, tuning), `${r}${q}`).toBeDefined();
    }
  });
});

describe('library tables', () => {
  it.each(['guitar', 'dropD', 'ukulele', 'baritone'] as TuningFamily[])(
    '%s: every entry is a valid chord that contains its own tones',
    (family) => {
      const tuning = { guitar: GUITAR, dropD: DROP_D, ukulele: UKE, baritone: BARITONE }[family];
      for (const [name, frets] of libraryEntries(family)) {
        const chord = parseChord(name)!;
        expect(chord, name).not.toBeNull();
        expect(frets).toHaveLength(tuning.length);
        const high = [...frets].reverse().map((c) => (c === 'x' ? -1 : parseInt(c, 36)));
        const shape = makeShape(high);
        const pcs = sounded(shape, tuning);
        const tones = chordTones(chord);
        const allowed = new Set([...tones.required, ...tones.optional]);
        // Derived baritone shapes may be inversions: the lookup re-validates them, here only the tones.
        for (const p of pcs) expect(allowed.has(p), `${family} ${name} ${frets}`).toBe(true);
        if (family !== 'baritone') {
          for (const p of tones.required) expect(pcs, `${family} ${name} ${frets}`).toContain(p);
        }
      }
    },
  );
});

describe('ukulele', () => {
  it.each([
    ['C', '0003'],
    ['F', '2010'],
    ['G', '0232'],
    ['Am', '2000'],
    ['A', '2100'],
    ['D', '2220'],
    ['Em', '0432'],
    ['G7', '0212'],
    ['C7', '0001'],
    ['Dm', '2210'],
  ])('%s is %s (GCEA)', (name, expected) => {
    expect(text(shapeFor(name, UKE))).toBe(expected);
  });

  it('uses the same shapes with a low G string', () => {
    expect(text(shapeFor('C', UKE_LOW_G))).toBe('0003');
    expect(text(shapeFor('Am', UKE_LOW_G))).toBe('2000');
  });

  it('moves a shape up as a barre', () => {
    const bb = shapeFor('Bb', UKE)!;
    expect(text(bb)).toBe('3211');
    const f = shapeFor('Fsus4', UKE)!;
    expect(f).toBeDefined();
  });
});

describe('baritone ukulele', () => {
  it.each([
    ['G', '0003'],
    ['Em', '2000'],
    ['D', '0232'],
    ['Am', '2210'],
    ['E7', '0100'],
  ])('%s is %s (DGBE)', (name, expected) => {
    expect(text(shapeFor(name, BARITONE))).toBe(expected);
  });
});

describe('drop D', () => {
  it.each([
    ['D', '000232'],
    ['Dm', '000231'],
    ['G', '5x0003'],
    ['Am', 'x02210'],
  ])('%s is %s', (name, expected) => {
    expect(text(shapeFor(name, DROP_D))).toBe(expected);
  });

  it('plays a power chord on the two lowest strings', () => {
    const power = shapeFor('A5', DROP_D)!;
    expect(power).toBeDefined();
    expect(sounded(power, DROP_D).every((p) => p === 9 || p === 4)).toBe(true);
  });
});

describe('capo', () => {
  it('shows the shape that is played, counted from the capo', () => {
    // D sounds with a C shape under a capo at the second fret.
    expect(text(shapeFor('D', GUITAR, 2))).toBe('x32010');
    expect(text(shapeFor('Em', GUITAR, 2))).toBe('xx0231'.replace('xx0231', 'xx0231'));
  });
  it('sounds the requested chord', () => {
    for (const [name, capo] of [
      ['D', 2],
      ['A', 3],
      ['Bm', 4],
      ['F#', 2],
      ['Gm7', 5],
    ] as const) {
      const chord = parseChord(name)!;
      const shape = lookupShape(chord, GUITAR, capo)!;
      expect(shape, name).toBeDefined();
      const pcs = sounded(shape, GUITAR, capo);
      const tones = chordTones(chord);
      for (const p of tones.required) expect(pcs, `${name} capo ${capo}`).toContain(p);
    }
  });
  it('works on a ukulele', () => {
    expect(text(shapeFor('D', UKE, 2))).toBe('0003');
  });
});

describe('generator', () => {
  const openG: Pitch[] = [
    { step: 'D', alter: 0, octave: 4 },
    { step: 'B', alter: 0, octave: 3 },
    { step: 'G', alter: 0, octave: 3 },
    { step: 'D', alter: 0, octave: 3 },
    { step: 'G', alter: 0, octave: 2 },
    { step: 'D', alter: 0, octave: 2 },
  ];
  it('finds the open chord of an open tuning', () => {
    const shape = generateShape(parseChord('G')!, openG)!;
    expect(shape).toBeDefined();
    expect(shape.base).toBe(1);
    expect(Math.max(...shape.frets)).toBe(0);
  });
  it('finds shapes for tones the tables do not cover', () => {
    for (const name of ['Cm9', 'C13', 'F#m11', 'Bb7#9', 'Eb7b9', 'Abmaj9', 'C6/9']) {
      expect(shapeFor(name, GUITAR), name).toBeDefined();
    }
  });
  it('gives up on a tuning with too many strings', () => {
    const many: Pitch[] = Array.from({ length: 9 }, (_, i) => ({
      step: 'E',
      alter: 0 as const,
      octave: 2 + (i % 3),
    }));
    expect(generateShape(parseChord('C')!, many)).toBeUndefined();
  });
  it('handles 7-string guitars', () => {
    const seven: Pitch[] = [...GUITAR, { step: 'B', alter: 0, octave: 1 }];
    const shape = shapeFor('Am', seven);
    expect(shape).toBeDefined();
    expect(shape!.frets).toHaveLength(7);
  });
  it('is quick', () => {
    const t0 = performance.now();
    for (const name of ['C13', 'F#m11', 'Bb7#9', 'Ebmaj9', 'G/B', 'D/F#']) shapeFor(name, GUITAR);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('makeShape', () => {
  it('keeps the nut window for low shapes', () => {
    expect(makeShape([0, 1, 0, 2, 3, -1])).toEqual({ frets: [0, 1, 0, 2, 3, -1], base: 1 });
  });
  it('moves the window when the shape is high', () => {
    expect(makeShape([5, 5, 5, 7, 7, 5]).base).toBe(5);
  });
});
