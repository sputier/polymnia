/**
 * Chord library: fretboard shapes for guitar and ukulele, and a generator for everything else.
 * This module is lazy: it is only loaded when a score shows diagrams or plays chords.
 *
 * - Shapes are the usual open chords per tuning family (guitar standard and drop D, ukulele GCEA
 *   with a high or a low G, baritone ukulele). A shape moves up the neck as a barre chord: the
 *   shape of the same quality with the smallest shift wins (E form, A form, D form...).
 * - Everything else (slash chords, extensions, other tunings, 7 strings...) comes from a small
 *   search over the frets, ranked for comfort (low position, few muted strings, root in the bass).
 * - A capo is handled by looking up the chord that is actually played: the sounding chord lowered
 *   by the capo fret. Frets are counted from the capo.
 * - Every shape is checked against the chord tones before it is returned, so a typo in the table
 *   can never put a wrong note on a diagram (a test checks every entry for every root).
 */
import {
  chordTones,
  notePc,
  parseChord,
  shapeOf,
  type ChordData,
  type ChordTones,
} from '../score/chords';
import type { ChordBarre, ChordFrame, Pitch } from '../score/types';
import { pitchToMidi } from '../score/pitch';

export type ChordShape = ChordFrame;

export type TuningFamily = 'guitar' | 'dropD' | 'ukulele' | 'baritone';

const FAMILY_PCS: Record<TuningFamily, readonly number[]> = {
  guitar: [4, 11, 7, 2, 9, 4],
  dropD: [4, 11, 7, 2, 9, 2],
  ukulele: [9, 4, 0, 7],
  baritone: [4, 11, 7, 2],
};

/** The family of a tuning (string pitches, highest string first), or undefined for any other tuning. */
export function tuningFamily(tuning: readonly Pitch[]): TuningFamily | undefined {
  const pcs = tuning.map((p) => ((pitchToMidi(p) % 12) + 12) % 12);
  for (const [family, expected] of Object.entries(FAMILY_PCS) as [TuningFamily, number[]][]) {
    if (expected.length === pcs.length && expected.every((v, i) => v === pcs[i])) return family;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Tables. Frets are written from the lowest string to the highest ("x32010"), x = muted.
// ---------------------------------------------------------------------------------------------

type Entry = readonly [chord: string, frets: string];

const GUITAR: readonly Entry[] = [
  ['E', '022100'],
  ['A', 'x02220'],
  ['C', 'x32010'],
  ['D', 'xx0232'],
  ['G', '320003'],
  ['F', '133211'],
  ['Em', '022000'],
  ['Am', 'x02210'],
  ['Dm', 'xx0231'],
  ['E7', '020100'],
  ['A7', 'x02020'],
  ['B7', 'x21202'],
  ['C7', 'x32310'],
  ['D7', 'xx0212'],
  ['G7', '320001'],
  ['Em7', '020000'],
  ['Am7', 'x02010'],
  ['Dm7', 'xx0211'],
  ['Emaj7', '021100'],
  ['Amaj7', 'x02120'],
  ['Cmaj7', 'x32000'],
  ['Dmaj7', 'xx0222'],
  ['Fmaj7', 'xx3210'],
  ['Gmaj7', '320002'],
  ['Esus4', '022200'],
  ['Asus4', 'x02230'],
  ['Dsus4', 'xx0233'],
  ['Gsus4', '330013'],
  ['Asus2', 'x02200'],
  ['Dsus2', 'xx0230'],
  ['Gsus2', '300033'],
  ['E6', '022120'],
  ['A6', 'x02222'],
  ['C6', 'x32210'],
  ['G6', '320000'],
  ['D6', 'xx0202'],
  ['Em6', '022020'],
  ['Am6', 'x02212'],
  ['Dm6', 'xx0201'],
  ['E9', '020102'],
  ['A9', 'x02423'],
  ['Cmaj9', 'x32430'],
  ['Cadd9', 'x32030'],
  ['Aadd9', 'x02420'],
  ['Eadd9', '022102'],
  ['Gadd9', '320203'],
  ['E7sus4', '020200'],
  ['A7sus4', 'x02030'],
  ['Bm7b5', 'x2323x'],
  ['Cdim', 'x3454x'],
  ['Cdim7', 'x3424x'],
  ['Caug', 'x32110'],
  ['E5', '022xxx'],
  ['A5', 'x022xx'],
  ['C5', 'x355xx'],
];

const DROP_D: readonly Entry[] = [
  ['D', '000232'],
  ['Dm', '000231'],
  ['D7', '000212'],
  ['Dmaj7', '000222'],
  ['Dm7', '000211'],
  ['Dsus4', '000233'],
  ['Dsus2', '000230'],
  ['D5', '000xxx'],
  ['G', '5x0003'],
  ['Em', '2x2000'],
  // Shapes that do not use the lowest string are the same as on a guitar in standard tuning.
  ...GUITAR.filter(([, frets]) => frets.startsWith('x')),
];

const UKULELE: readonly Entry[] = [
  ['C', '0003'],
  ['Cm', '0333'],
  ['C7', '0001'],
  ['Cmaj7', '0002'],
  ['Cm7', '3333'],
  ['C6', '0000'],
  ['Csus4', '0013'],
  ['Csus2', '0233'],
  ['Cadd9', '0203'],
  ['Cdim7', '2323'],
  ['Caug', '1003'],
  ['A', '2100'],
  ['Am', '2000'],
  ['A7', '0100'],
  ['Am7', '0000'],
  ['Amaj7', '1100'],
  ['Asus4', '2200'],
  ['D', '2220'],
  ['Dm', '2210'],
  ['D7', '2223'],
  ['Dm7', '2213'],
  ['Dmaj7', '2224'],
  ['Dsus4', '0230'],
  ['Dsus2', '2200'],
  ['E', '4442'],
  ['Em', '0432'],
  ['E7', '1202'],
  ['Em7', '0202'],
  ['F', '2010'],
  ['Fm', '1013'],
  ['F7', '2310'],
  ['Fmaj7', '2413'],
  ['Fm7', '1313'],
  ['G', '0232'],
  ['Gm', '0231'],
  ['G7', '0212'],
  ['Gmaj7', '0222'],
  ['Gm7', '0211'],
  ['Gsus4', '0233'],
  ['G6', '0202'],
  ['Bb', '3211'],
  ['Bbm', '3111'],
  ['Bb7', '1211'],
  ['B', '4322'],
  ['Bm', '4222'],
  ['B7', '2322'],
];

const TABLES: Record<TuningFamily, readonly Entry[]> = {
  guitar: GUITAR,
  dropD: DROP_D,
  ukulele: UKULELE,
  // Baritone ukulele: the four high strings of the guitar, same chord forms.
  baritone: GUITAR.map(([chord, frets]): Entry => [chord, frets.slice(-4)]),
};

interface Template {
  readonly pc: number;
  readonly quality: string;
  /** Per string from the lowest, -1 = muted. */
  readonly frets: readonly number[];
}

const TEMPLATE_CACHE = new Map<TuningFamily, Template[]>();

function templates(family: TuningFamily): Template[] {
  let list = TEMPLATE_CACHE.get(family);
  if (list) return list;
  list = [];
  for (const [name, frets] of TABLES[family]) {
    const chord = parseChord(name);
    if (!chord) throw new Error(`Bad chord library entry ${name}`);
    list.push({
      pc: notePc(chord.root),
      quality: chord.quality,
      frets: [...frets].map((c) => (c === 'x' ? -1 : parseInt(c, 36))),
    });
  }
  TEMPLATE_CACHE.set(family, list);
  return list;
}

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

function pcsOf(frets: readonly number[], open: readonly number[]): (number | undefined)[] {
  return frets.map((f, i) => (f < 0 ? undefined : (open[i]! + f) % 12));
}

/**
 * Window, barre and the final ChordShape from frets listed from the highest string (the order of
 * `Part.tuning`). The window starts at the nut unless the shape sits higher than the fourth fret.
 */
export function makeShape(fretsHighFirst: readonly number[]): ChordShape {
  const fretted = fretsHighFirst.filter((f) => f > 0);
  const lo = fretted.length > 0 ? Math.min(...fretted) : 1;
  const hi = fretted.length > 0 ? Math.max(...fretted) : 1;
  const base = hi <= 4 ? 1 : lo;
  const barre = findBarre(fretsHighFirst, lo);
  return { frets: [...fretsHighFirst], base, ...(barre ? { barre } : {}) };
}

/** A barre lies on the lowest fretted fret when it holds the finger on 2+ strings without a gap. */
function findBarre(frets: readonly number[], lo: number): ChordBarre | undefined {
  if (lo <= 0) return undefined;
  const at: number[] = [];
  frets.forEach((f, i) => {
    if (f === lo) at.push(i + 1);
  });
  if (at.length < 2) return undefined;
  const from = at[0]!;
  const to = at[at.length - 1]!;
  // Strings between the ends must be pressed at or above the barre (no open string under it).
  for (let s = from; s <= to; s++) {
    const f = frets[s - 1]!;
    if (f < lo) return undefined;
  }
  // A bar line only for a real barre: wide enough, and reaching the end of the sounded strings.
  const minSpan = frets.length <= 4 ? 2 : 3;
  if (to - from + 1 < minSpan) return undefined;
  const first = frets.findIndex((f) => f >= 0) + 1;
  const last = frets.length - [...frets].reverse().findIndex((f) => f >= 0);
  if (from !== first && to !== last) return undefined;
  return { fret: lo, from, to };
}

function validate(
  frets: readonly number[],
  open: readonly number[],
  tones: ChordTones,
  rootBass: boolean,
): boolean {
  const sounded = pcsOf(frets, open);
  const have = new Set(sounded.filter((p): p is number => p !== undefined));
  if (have.size === 0) return false;
  const allowed = new Set([...tones.required, ...tones.optional]);
  for (const p of have) if (!allowed.has(p)) return false;
  for (const r of tones.required) if (!have.has(r)) return false;
  if (rootBass) {
    // Lowest sounding note (strings are listed from the lowest): it must be the bass.
    const lowest = sounded.find((p) => p !== undefined);
    if (lowest !== tones.bass) return false;
  }
  return true;
}

/** Open string pitch classes from the lowest string, for a tuning listed highest first. */
function openPcs(tuning: readonly Pitch[]): number[] {
  return tuning.map((p) => ((pitchToMidi(p) % 12) + 12) % 12).reverse();
}

function fromTable(
  family: TuningFamily,
  chord: ChordData,
  tones: ChordTones,
  open: readonly number[],
  rootBass: boolean,
): ChordShape | undefined {
  const root = notePc(chord.root);
  let best: { frets: number[]; shift: number } | undefined;
  for (const t of templates(family)) {
    if (t.quality !== chord.quality) continue;
    const shift = (root - t.pc + 12) % 12;
    const frets = t.frets.map((f) => (f < 0 ? -1 : f + shift));
    if (Math.max(...frets) > 15) continue;
    if (!validate(frets, open, tones, rootBass)) continue;
    if (!best || shift < best.shift) best = { frets, shift };
  }
  if (!best) return undefined;
  return makeShape([...best.frets].reverse());
}

/**
 * Searches fingerings: every string muted, open or fretted inside a window of four frets, rated by
 * comfort. Returns the best shape, or undefined when the tuning has too many strings or no
 * playable shape contains the chord.
 */
export function generateShape(
  chord: ChordData,
  tuning: readonly Pitch[],
  maxFret = 15,
): ChordShape | undefined {
  const n = tuning.length;
  if (n < 3 || n > 8) return undefined;
  const tones = chordTones(chord);
  const open = openPcs(tuning);
  const allowed = new Set([...tones.required, ...tones.optional]);
  const minSounded = Math.min(n, n >= 6 ? 4 : 3);
  let best: { frets: number[]; score: number } | undefined;
  let bestLo = 0;

  for (let lo = 1; lo <= maxFret; lo++) {
    const frets: number[] = new Array<number>(n).fill(-1);
    const dfs = (s: number, sounded: number, started: boolean, ended: boolean): void => {
      if (s === n) {
        if (sounded < minSounded) return;
        if (!validate(frets, open, tones, true)) return;
        const score = rate(frets, open, tones);
        if (!best || score > best.score) {
          best = { frets: [...frets], score };
          bestLo = lo;
        }
        return;
      }
      if (ended) {
        frets[s] = -1;
        dfs(s + 1, sounded, started, true);
        return;
      }
      // Muted string: before the first sounded string, or the end of the sounded ones (no gaps).
      frets[s] = -1;
      dfs(s + 1, sounded, started, started);
      const candidates = [0];
      for (let f = lo; f <= lo + 3 && f <= maxFret; f++) candidates.push(f);
      for (const f of candidates) {
        if (f === 0 && lo > 4) continue; // far up the neck an open string is no longer in reach
        if (!allowed.has((open[s]! + f) % 12)) continue;
        frets[s] = f;
        dfs(s + 1, sounded + 1, true, false);
      }
      frets[s] = -1;
    };
    dfs(0, 0, false, false);
    // Higher positions only get less comfortable once a shape is found a little below.
    if (best && lo >= bestLo + 2) break;
  }
  if (!best) return undefined;
  return makeShape([...best.frets].reverse());
}

function rate(frets: readonly number[], open: readonly number[], tones: ChordTones): number {
  let score = 0;
  const sounded = frets.filter((f) => f >= 0).length;
  score += sounded * 2;
  score -= (frets.length - sounded) * 1.2;
  const fretted0 = frets.filter((f) => f > 0);
  score -= (fretted0.length > 0 ? Math.min(...fretted0) : 0) * 1.5;
  const fretted = frets.filter((f) => f > 0);
  score -= fretted.length * 0.8;
  score += frets.filter((f) => f === 0).length * 0.8;
  if (fretted.length > 0) score -= (Math.max(...fretted) - Math.min(...fretted)) * 0.6;
  // Fingers: strings at the lowest fretted fret count as one with a barre.
  const have = new Set(pcsOf(frets, open).filter((p): p is number => p !== undefined));
  for (const p of [...tones.required, ...tones.optional]) if (have.has(p)) score += 0.3;
  const lowest = pcsOf(frets, open).find((p) => p !== undefined);
  if (lowest === tones.bass) score += 4;
  return score;
}

const CACHE = new Map<string, ChordShape | null>();

/**
 * The diagram for a chord on an instrument: the shape of the chord the player forms (the sounding
 * chord lowered by the capo), frets counted from the capo. Undefined when no shape was found.
 */
export function lookupShape(
  chord: ChordData,
  tuning: readonly Pitch[],
  capo = 0,
): ChordShape | undefined {
  const played = shapeOf(chord, capo);
  const key = [
    tuning.map((p) => pitchToMidi(p)).join(','),
    notePc(played.root),
    played.quality,
    played.bass ? notePc(played.bass) : '',
  ].join('|');
  const hit = CACHE.get(key);
  if (hit !== undefined) return hit ?? undefined;
  const shape = compute(played, tuning);
  if (CACHE.size > 500) CACHE.clear();
  CACHE.set(key, shape ?? null);
  return shape;
}

function compute(chord: ChordData, tuning: readonly Pitch[]): ChordShape | undefined {
  const family = tuningFamily(tuning);
  const tones = chordTones(chord);
  const open = openPcs(tuning);
  if (family && !chord.bass) {
    const rootBass = family === 'dropD' || family === 'guitar';
    const found = fromTable(family, chord, tones, open, rootBass);
    if (found) return found;
  }
  return generateShape(chord, tuning);
}

/** Every library entry as a chord name and family, for tests and tooling. */
export function libraryEntries(family: TuningFamily): readonly Entry[] {
  return TABLES[family];
}
