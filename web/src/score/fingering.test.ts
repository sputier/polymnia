import { describe, expect, test } from 'vitest';
import { fingerNote, fingerSequence, type Fretboard } from './fingering';

/** Sounding MIDI of "E2", "F#3", "Bb4" ... */
function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name)!;
  const step = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'];
  return (Number(m[3]) + 1) * 12 + step + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const tuning = (...names: string[]) => names.map(midi);

const GUITAR: Fretboard = {
  open: tuning('E4', 'B3', 'G3', 'D3', 'A2', 'E2'),
  capo: 0,
  frets: 19,
};
const DROP_D: Fretboard = { ...GUITAR, open: tuning('E4', 'B3', 'G3', 'D3', 'A2', 'D2') };
const UKE: Fretboard = { open: tuning('A4', 'E4', 'C4', 'G4'), capo: 0, frets: 15 };

/** Plays a list of single notes and returns "string:fret" labels. */
function line(board: Fretboard, notes: string[]): string[] {
  return fingerSequence(
    board,
    notes.map((n) => ({ midis: [midi(n)] })),
  ).map((r) => `${r[0]!.string}:${r[0]!.fret}`);
}

/** Plays one chord and returns the label of each pitch, in the order given. */
function chord(board: Fretboard, notes: string[]): string[] {
  return fingerSequence(board, [{ midis: notes.map(midi) }])[0]!.map((f) =>
    f ? `${f.string}:${f.fret}` : '-',
  );
}

describe('single notes', () => {
  test('open strings are played open', () => {
    expect(line(GUITAR, ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'])).toEqual([
      '6:0',
      '5:0',
      '4:0',
      '3:0',
      '2:0',
      '1:0',
    ]);
  });

  test('a lone note takes the lowest fret', () => {
    expect(line(GUITAR, ['F2'])).toEqual(['6:1']);
    expect(line(GUITAR, ['C4'])).toEqual(['2:1']);
  });

  test('C major scale in first position stays in the first position', () => {
    const out = line(GUITAR, ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4']);
    expect(out).toEqual(['5:3', '4:0', '4:2', '4:3', '3:0', '3:2', '2:0', '2:1']);
  });

  test('a run on one octave does not jump along the neck', () => {
    const out = fingerSequence(
      GUITAR,
      ['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4'].map((n) => ({ midis: [midi(n)] })),
    ).map((r) => r[0]!.fret);
    for (let i = 1; i < out.length; i++)
      expect(Math.abs(out[i]! - out[i - 1]!)).toBeLessThanOrEqual(5);
    expect(Math.max(...out)).toBeLessThanOrEqual(5);
  });

  test('a high passage stays in position instead of dropping to open strings', () => {
    // E5 F#5 G5 A5 B5 on a 19-fret guitar: all on the first strings around frets 12-19.
    const out = fingerSequence(
      GUITAR,
      ['B4', 'C#5', 'D5', 'E5', 'D5', 'C#5', 'B4'].map((n) => ({ midis: [midi(n)] })),
    ).map((r) => r[0]!);
    expect(out.every((f) => f.string <= 2)).toBe(true);
    expect(Math.max(...out.map((f) => f.fret))).toBeLessThanOrEqual(12);
  });

  test('a pitch outside the instrument is undefined, neighbours still get fingered', () => {
    const out = fingerSequence(GUITAR, [
      { midis: [midi('C2')] },
      { midis: [midi('E4')] },
      { midis: [midi('C8')] },
    ]);
    expect(out[0]![0]).toBeUndefined();
    expect(out[1]![0]).toEqual({ string: 1, fret: 0 });
    expect(out[2]![0]).toBeUndefined();
  });

  test('highest fret is respected', () => {
    const board = { ...GUITAR, frets: 12 };
    expect(fingerSequence(board, [{ midis: [midi('E6')] }])[0]![0]).toBeUndefined();
    expect(fingerSequence(board, [{ midis: [midi('E5')] }])[0]![0]).toEqual({
      string: 1,
      fret: 12,
    });
  });

  test('fingerNote follows the previous position', () => {
    // A4: fret 5 on the high E string, but fret 10 on the B string when the hand is at the 12th fret.
    expect(fingerNote(GUITAR, midi('A4'))).toEqual({ string: 1, fret: 5 });
    expect(fingerNote(GUITAR, midi('A4'), { string: 3, fret: 12 })).toEqual({
      string: 2,
      fret: 10,
    });
  });
});

describe('chords on guitar', () => {
  test('C major (x32010)', () => {
    expect(chord(GUITAR, ['C3', 'E3', 'G3', 'C4', 'E4'])).toEqual([
      '5:3',
      '4:2',
      '3:0',
      '2:1',
      '1:0',
    ]);
  });

  test('G major (320003)', () => {
    expect(chord(GUITAR, ['G2', 'B2', 'D3', 'G3', 'B3', 'G4'])).toEqual([
      '6:3',
      '5:2',
      '4:0',
      '3:0',
      '2:0',
      '1:3',
    ]);
  });

  test('D major (xx0232)', () => {
    expect(chord(GUITAR, ['D3', 'A3', 'D4', 'F#4'])).toEqual(['4:0', '3:2', '2:3', '1:2']);
  });

  test('A minor (x02210)', () => {
    expect(chord(GUITAR, ['A2', 'E3', 'A3', 'C4', 'E4'])).toEqual([
      '5:0',
      '4:2',
      '3:2',
      '2:1',
      '1:0',
    ]);
  });

  test('E minor (022000)', () => {
    expect(chord(GUITAR, ['E2', 'B2', 'E3', 'G3', 'B3', 'E4'])).toEqual([
      '6:0',
      '5:2',
      '4:2',
      '3:0',
      '2:0',
      '1:0',
    ]);
  });

  test('one note per string and a reachable stretch', () => {
    const out = fingerSequence(GUITAR, [{ midis: ['F3', 'C4', 'F4', 'A4'].map(midi) }])[0]!;
    expect(new Set(out.map((f) => f!.string)).size).toBe(4);
    const frets = out.map((f) => f!.fret).filter((f) => f > 0);
    expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(4);
  });

  test('more pitches than strings: the extra pitch is unplayable', () => {
    const out = chord(UKE, ['C4', 'E4', 'G4', 'A4', 'C5']);
    expect(out.filter((x) => x === '-')).toHaveLength(1);
  });
});

describe('drop D, capo and ukulele', () => {
  test('drop D low D is the open sixth string and the power chord is one barre', () => {
    expect(line(DROP_D, ['D2'])).toEqual(['6:0']);
    expect(chord(DROP_D, ['D2', 'A2', 'D3'])).toEqual(['6:0', '5:0', '4:0']);
    expect(chord(DROP_D, ['F2', 'C3', 'F3'])).toEqual(['6:3', '5:3', '4:3']);
  });

  test('a capo shifts the open strings: frets count from the capo', () => {
    const capo2: Fretboard = { ...GUITAR, capo: 2 };
    // Open E string + capo 2 sounds F#4.
    expect(line(capo2, ['F#4', 'C#4'])).toEqual(['1:0', '2:0']);
  });

  test('capo: a pitch below the capoed open string cannot be played', () => {
    const capo2: Fretboard = { ...GUITAR, capo: 2 };
    expect(fingerSequence(capo2, [{ midis: [midi('E2')] }])[0]![0]).toBeUndefined();
    expect(fingerSequence(capo2, [{ midis: [midi('F#2')] }])[0]![0]).toEqual({
      string: 6,
      fret: 0,
    });
  });

  test('ukulele re-entrant: C major scale uses the open C, E, G and A strings', () => {
    expect(line(UKE, ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'])).toEqual([
      '3:0',
      '3:2',
      '2:0',
      '2:1',
      '4:0',
      '1:0',
      '1:2',
      '1:3',
    ]);
  });

  test('ukulele chords C, G, F and Am with the high G', () => {
    const sorted = (notes: string[]) => chord(UKE, notes).sort();
    expect(chord(UKE, ['G4', 'C4', 'E4', 'C5'])).toEqual(['4:0', '3:0', '2:0', '1:3']); // C 0003
    expect(sorted(['G4', 'D4', 'G4', 'B4'])).toEqual(['1:2', '2:3', '3:2', '4:0']); // G 0232
    expect(sorted(['A4', 'C4', 'F4', 'A4'])).toEqual(['1:0', '2:1', '3:0', '4:2']); // F 2010
    expect(sorted(['A4', 'C4', 'E4', 'A4'])).toEqual(['1:0', '2:0', '3:0', '4:2']); // Am 2000
  });

  test('low-G ukulele puts G3 on the fourth string', () => {
    const lowG: Fretboard = { ...UKE, open: tuning('A4', 'E4', 'C4', 'G3') };
    expect(line(lowG, ['G3', 'B3'])).toEqual(['4:0', '4:4']);
  });
});

describe('fixed frettings', () => {
  test('a fixed fretting is returned unchanged and steers the neighbours', () => {
    const notes = ['G3', 'A3', 'B3'].map(midi);
    const free = fingerSequence(
      GUITAR,
      notes.map((m) => ({ midis: [m] })),
    ).map((r) => r[0]!);
    // Force the first G to the 3rd string 5th... no, to the 4th string, fret 5.
    const forced = fingerSequence(
      GUITAR,
      notes.map((m, i) => ({
        midis: [m],
        ...(i === 0 ? { fixed: [{ string: 4, fret: 5 }] } : {}),
      })),
    ).map((r) => r[0]!);
    expect(free[0]).toEqual({ string: 3, fret: 0 });
    expect(forced[0]).toEqual({ string: 4, fret: 5 });
    // The next notes stay around the forced position.
    expect(forced[1]!.fret).toBeGreaterThanOrEqual(2);
  });

  test('partially fixed chord: only the free pitch is chosen', () => {
    const out = fingerSequence(GUITAR, [
      { midis: ['E3', 'G3'].map(midi), fixed: [{ string: 5, fret: 7 }, undefined] },
    ])[0]!;
    expect(out[0]).toEqual({ string: 5, fret: 7 });
    expect(out[1]!.string).not.toBe(5);
  });
});

describe('performance', () => {
  test('under one millisecond per note', () => {
    const names = ['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'B3', 'D4', 'F4', 'A4'];
    const items = Array.from({ length: 2000 }, (_, i) => ({
      midis: [midi(names[i % names.length]!)],
    }));
    const t0 = performance.now();
    fingerSequence(GUITAR, items);
    const perNote = (performance.now() - t0) / items.length;
    expect(perNote).toBeLessThan(1);
  });

  test('under one millisecond per note with chords', () => {
    const chords = [
      ['C3', 'E3', 'G3', 'C4', 'E4'],
      ['G2', 'B2', 'D3', 'G3', 'B3', 'G4'],
      ['A2', 'E3', 'A3', 'C4', 'E4'],
      ['D3', 'A3', 'D4', 'F#4'],
    ];
    const items = Array.from({ length: 400 }, (_, i) => ({
      midis: chords[i % chords.length]!.map(midi),
    }));
    const t0 = performance.now();
    fingerSequence(GUITAR, items);
    const notes = items.reduce((n, it) => n + it.midis.length, 0);
    expect((performance.now() - t0) / notes).toBeLessThan(1);
  });
});
