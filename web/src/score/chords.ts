/**
 * Chord symbols: parsing, normalization, spelling, transposition and chord tones. Pure TypeScript.
 *
 * A chord symbol is stored as three parts: a spelled root, a normalized quality suffix (`m7b5`,
 * `maj7`, `7#9`...) and an optional spelled bass note. The suffix is the canonical text produced by
 * `formatQuality(parseQuality(text))`, so every input spelling of a chord (`CM7`, `C^7`, `Cmaj7`)
 * is stored the same way. Chord symbols name concert (sounding) pitches.
 */
import { midiToPitch } from './pitch';
import type { Alter, ChordNote, ChordSymbol, StepName } from './types';

const STEP_PC: Record<StepName, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STEP_NAMES: readonly StepName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Longest quality suffix stored (also the schema limit). */
export const MAX_QUALITY_LENGTH = 24;

/** Pitch class (0..11) of a spelled note. */
export function notePc(n: ChordNote): number {
  return (((STEP_PC[n.step] + n.alter) % 12) + 12) % 12;
}

export function sameNote(a: ChordNote, b: ChordNote | undefined): boolean {
  return !!b && a.step === b.step && a.alter === b.alter;
}

// ---------------------------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------------------------

/** Structured form of a quality suffix (what the chord tones and MusicXML are derived from). */
export interface Quality {
  readonly minor: boolean;
  readonly dim: boolean;
  readonly aug: boolean;
  /** Power chord (`5`): root and fifth only. */
  readonly power: boolean;
  readonly sus: 0 | 2 | 4;
  /** Seventh: none, dominant (or diminished with `dim`), or major. */
  readonly seventh: 0 | 7 | 11;
  /** Highest stacked extension: 0, 9, 11 or 13. */
  readonly ext: 0 | 9 | 11 | 13;
  /** Added sixth: 6, or 69 for a sixth with a ninth. */
  readonly sixth: 0 | 6 | 69;
  /** Altered degrees in canonical order (`b5`, `#5`, `b9`, `#9`, `#11`, `b13`). */
  readonly alt: readonly string[];
  /** Added tones (`add9`...), as the degree numbers. */
  readonly add: readonly number[];
}

const ALT_ORDER = ['b5', '#5', 'b9', '#9', '#11', 'b13'] as const;
const ADD_ORDER = [2, 4, 9, 11, 13] as const;

interface Draft {
  minor: boolean;
  dim: boolean;
  aug: boolean;
  power: boolean;
  sus: 0 | 2 | 4;
  seventh: 0 | 7 | 11;
  ext: 0 | 9 | 11 | 13;
  sixth: 0 | 6 | 69;
  halfDim: boolean;
  alt: Set<string>;
  add: Set<number>;
}

const MIN_WORDS = ['minor', 'Minor', 'min', 'Min', 'mi', 'm', '-', '−', '–'];
const DIM_WORDS = ['dim', 'Dim', '°', 'o'];
const AUG_WORDS = ['aug', 'Aug', '+'];

function startsWithAny(s: string, words: readonly string[]): string | undefined {
  for (const w of words) if (s.startsWith(w)) return w;
  return undefined;
}

/** Parses a quality suffix (what follows the root, without the bass). Null when it is not a chord. */
export function parseQuality(text: string): Quality | null {
  let s = text
    .replace(/[\s()[\],]/g, '')
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b');
  if (s.length > 40) return null;
  const d: Draft = {
    minor: false,
    dim: false,
    aug: false,
    power: false,
    sus: 0,
    seventh: 0,
    ext: 0,
    sixth: 0,
    halfDim: false,
    alt: new Set(),
    add: new Set(),
  };
  let numbers = 0;
  const eat = (n: number) => {
    s = s.slice(n);
  };
  while (s.length > 0) {
    // Major seventh marker (checked before the minor markers: "maj" starts with "m").
    const maj = /^(major|Major|maj|Maj|MAJ|M|Δ|∆|\^)/.exec(s)?.[1] ?? /^(ma|Ma)(?=\d)/.exec(s)?.[1];
    if (maj) {
      eat(maj.length);
      const digit = /^(13|11|9|7)/.exec(s)?.[1];
      if (digit) {
        eat(digit.length);
        d.seventh = 11;
        if (digit !== '7') d.ext = Number(digit) as 9 | 11 | 13;
        numbers++;
      } else if (d.minor) {
        d.seventh = 11; // "mmaj" without a digit: minor with a major seventh
      }
      continue;
    }
    const min = numbers === 0 && !d.minor ? startsWithAny(s, MIN_WORDS) : undefined;
    if (min) {
      d.minor = true;
      eat(min.length);
      continue;
    }
    const dim = startsWithAny(s, DIM_WORDS);
    if (dim) {
      d.dim = true;
      eat(dim.length);
      continue;
    }
    const aug = startsWithAny(s, AUG_WORDS);
    if (aug) {
      d.aug = true;
      eat(aug.length);
      continue;
    }
    if (s.startsWith('ø') || s.startsWith('Ø')) {
      d.minor = true;
      d.halfDim = true;
      d.seventh = d.seventh || 7;
      d.alt.add('b5');
      numbers++;
      eat(1);
      if (s.startsWith('7')) eat(1);
      continue;
    }
    const sus = /^sus(2|4)?/i.exec(s);
    if (sus) {
      d.sus = sus[1] === '2' ? 2 : 4;
      eat(sus[0].length);
      continue;
    }
    const add = /^add(13|11|9|4|2)/i.exec(s);
    if (add) {
      d.add.add(Number(add[1]));
      eat(add[0].length);
      continue;
    }
    const six9 = /^6\/?9/.exec(s);
    if (six9) {
      d.sixth = 69;
      eat(six9[0].length);
      numbers++;
      continue;
    }
    const num = /^(13|11|9|7|6|5)/.exec(s)?.[1];
    if (num) {
      eat(num.length);
      if (num === '5') {
        d.power = true;
        continue;
      }
      numbers++;
      if (num === '6') d.sixth = 6;
      else if (num === '7') d.seventh = d.seventh || 7;
      else {
        d.ext = Number(num) as 9 | 11 | 13;
        d.seventh = d.seventh || 7;
      }
      continue;
    }
    const alt = /^([#b+-])(5|9|11|13)/.exec(s);
    if (alt) {
      const sign = alt[1] === '#' || alt[1] === '+' ? '#' : 'b';
      const key = `${sign}${alt[2]}`;
      if (!(ALT_ORDER as readonly string[]).includes(key)) return null;
      d.alt.add(key);
      eat(alt[0].length);
      continue;
    }
    return null;
  }
  if (numbers > 2) return null;
  if (d.power && (d.minor || d.dim || d.aug || d.sus || d.seventh || d.ext || d.sixth)) {
    return null;
  }
  if (d.sus && (d.minor || d.dim)) return null;
  if (d.dim && d.aug) return null;
  if (d.dim && d.alt.has('b5')) d.alt.delete('b5'); // already diminished
  if (d.aug && d.alt.has('#5')) d.alt.delete('#5');
  if (d.sixth && d.seventh) return null;
  if (d.alt.has('b5') && d.alt.has('#5')) return null;
  // Added tones that the stack already contains are redundant.
  if (d.sixth === 69) d.add.delete(9);
  if (d.ext >= 9) d.add.delete(9);
  if (d.ext >= 11) d.add.delete(11);
  if (d.ext === 13) d.add.delete(13);
  return {
    minor: d.minor,
    dim: d.dim,
    aug: d.aug,
    power: d.power,
    sus: d.sus,
    seventh: d.seventh,
    ext: d.ext,
    sixth: d.sixth,
    alt: ALT_ORDER.filter((a) => d.alt.has(a)),
    add: ADD_ORDER.filter((a) => d.add.has(a)),
  };
}

/** Canonical suffix of a parsed quality. `parseQuality(formatQuality(q))` gives `q` back. */
export function formatQuality(q: Quality): string {
  if (q.power) return '5';
  let s = '';
  if (q.dim) s += 'dim';
  else if (q.aug) s += 'aug';
  else if (q.minor) s += 'm';
  if (q.sixth === 69) s += '6/9';
  else if (q.sixth === 6) s += '6';
  else if (q.seventh === 11) {
    // A minor-major chord reads "m(maj7)"; a major one "maj7" (or "maj9"...).
    const top = q.ext || 7;
    s += q.minor && !q.dim ? `(maj${top})` : `maj${top}`;
  } else if (q.ext) s += String(q.ext);
  else if (q.seventh === 7) s += '7';
  for (const a of q.alt) s += a;
  if (q.sus) s += `sus${q.sus}`;
  for (const a of q.add) s += `add${a}`;
  return s;
}

/** Normalizes a quality suffix. Null when it is not recognized. */
export function normalizeQuality(text: string): string | null {
  const q = parseQuality(text);
  if (!q) return null;
  const out = formatQuality(q);
  return out.length <= MAX_QUALITY_LENGTH ? out : null;
}

// ---------------------------------------------------------------------------------------------
// Roots, parsing a whole symbol
// ---------------------------------------------------------------------------------------------

/** What identifies a chord, without its position in the score. */
export interface ChordData {
  readonly root: ChordNote;
  readonly quality: string;
  readonly bass?: ChordNote;
}

const FRENCH_ROOTS: readonly (readonly [string, StepName])[] = [
  ['sol', 'G'],
  ['do', 'C'],
  ['ré', 'D'],
  ['re', 'D'],
  ['mi', 'E'],
  ['fa', 'F'],
  ['la', 'A'],
  ['si', 'B'],
];

function readAccidental(s: string): { alter: Alter; length: number } {
  let alter = 0;
  let i = 0;
  for (; i < s.length && i < 2; i++) {
    const c = s[i]!;
    if (c === '#' || c === '♯') alter += 1;
    else if (c === 'b' || c === '♭') alter -= 1;
    else if (c === 'x' || c === '𝄪') alter += 2;
    else break;
  }
  if (alter > 2 || alter < -2) return { alter: 0, length: 0 };
  return { alter: alter as Alter, length: i };
}

interface NoteRead {
  readonly note: ChordNote;
  readonly length: number;
}

/** Possible readings of a note at the start of the text: French names first, then letters A to G. */
function readNotes(s: string): NoteRead[] {
  const out: NoteRead[] = [];
  const lower = s.toLowerCase();
  if (/^[A-Z]/.test(s)) {
    for (const [name, step] of FRENCH_ROOTS) {
      if (!lower.startsWith(name)) continue;
      const acc = readAccidental(s.slice(name.length));
      out.push({ note: { step, alter: acc.alter }, length: name.length + acc.length });
      break;
    }
  }
  const letter = s[0]?.toUpperCase();
  if (letter && /^[A-G]$/.test(letter)) {
    // Lowercase letters are accepted ("am7").
    const acc = readAccidental(s.slice(1));
    out.push({ note: { step: letter as StepName, alter: acc.alter }, length: 1 + acc.length });
  }
  return out;
}

/**
 * Parses chord text: C, Am7, G/B, F#m7b5, Bbmaj7, Dsus4, E7#9, Cadd9, C6/9, and
 * French note names (Do, Rém7, Sol/Si). Returns the normalized chord, or null for anything
 * that is not a chord. Whitespace around the text is ignored; the empty string is not a chord.
 * "Faug" is F augmented, not the French "Fa" followed by "ug": a reading must parse completely.
 */
export function parseChord(input: string): ChordData | null {
  const text = input.trim();
  if (text.length === 0 || text.length > 40) return null;
  for (const rootRead of readNotes(text)) {
    const chord = parseWithRoot(text, rootRead);
    if (chord) return chord;
  }
  return null;
}

function parseWithRoot(text: string, rootRead: NoteRead): ChordData | null {
  let rest = text.slice(rootRead.length);
  let bass: ChordNote | undefined;
  const slash = rest.lastIndexOf('/');
  if (slash >= 0) {
    // "6/9" is a sixth-ninth chord, not a bass note.
    const tail = rest.slice(slash + 1).trim();
    const head = rest.slice(0, slash);
    if (!/^\d/.test(tail)) {
      const bassRead = readNotes(tail).find((r) => r.length === tail.length);
      if (!bassRead) return null;
      bass = bassRead.note;
      rest = head;
    }
  }
  const quality = normalizeQuality(rest);
  if (quality === null) return null;
  const data: ChordData = { root: rootRead.note, quality };
  if (bass && !sameNote(bass, rootRead.note)) return { ...data, bass };
  return data;
}

const LETTER_NAME = (n: ChordNote): string =>
  n.step + (n.alter > 0 ? '#'.repeat(n.alter) : 'b'.repeat(-n.alter));
const SOLFEGE: Record<StepName, string> = {
  C: 'Do',
  D: 'Ré',
  E: 'Mi',
  F: 'Fa',
  G: 'Sol',
  A: 'La',
  B: 'Si',
};

export type NoteNaming = 'letters' | 'solfege';

/** Plain text of a chord (`F#m7b5/A`), with letters or French solfège names (`Fa#m7b5/La`). */
export function formatChord(chord: ChordData, naming: NoteNaming = 'letters'): string {
  const name = (n: ChordNote): string =>
    naming === 'letters'
      ? LETTER_NAME(n)
      : SOLFEGE[n.step] + (n.alter > 0 ? '#'.repeat(n.alter) : 'b'.repeat(-n.alter));
  return name(chord.root) + chord.quality + (chord.bass ? `/${name(chord.bass)}` : '');
}

/** Text parts of a chord for typography: the quality is split into a normal and a raised part. */
export interface ChordRun {
  readonly text: string;
  /** Extensions and alterations are drawn smaller and raised. */
  readonly sup: boolean;
}

/**
 * Splits a quality into runs: `m`, `maj`, `dim`, `aug`, `sus` stay on the baseline, numbers,
 * alterations and added tones are superscripts (`maj7` is `maj` then a raised `7`).
 */
export function qualityRuns(quality: string): ChordRun[] {
  const paren = quality.indexOf('(');
  if (paren >= 0) {
    // "m(maj7)": the parenthesized part is one raised run.
    return [...qualityRuns(quality.slice(0, paren)), { text: quality.slice(paren), sup: true }];
  }
  const runs: ChordRun[] = [];
  const push = (text: string, sup: boolean) => {
    const last = runs[runs.length - 1];
    if (last && last.sup === sup) runs[runs.length - 1] = { text: last.text + text, sup };
    else runs.push({ text, sup });
  };
  let i = 0;
  while (i < quality.length) {
    const rest = quality.slice(i);
    const word = /^(maj|dim|aug|sus|add|m)/.exec(rest)?.[1];
    if (word) {
      // "add" is part of the raised extension ("add9"); the other words are baseline.
      push(word, word === 'add');
      i += word.length;
    } else {
      const c = quality[i]!;
      push(c, true);
      i++;
    }
  }
  return runs;
}

/** Spelled name of a pitch class: the common chord-name spelling, flats or sharps. */
const PC_SHARP: readonly (readonly [StepName, Alter])[] = [
  ['C', 0],
  ['C', 1],
  ['D', 0],
  ['D', 1],
  ['E', 0],
  ['F', 0],
  ['F', 1],
  ['G', 0],
  ['G', 1],
  ['A', 0],
  ['A', 1],
  ['B', 0],
];
const PC_FLAT: readonly (readonly [StepName, Alter])[] = [
  ['C', 0],
  ['D', -1],
  ['D', 0],
  ['E', -1],
  ['E', 0],
  ['F', 0],
  ['G', -1],
  ['G', 0],
  ['A', -1],
  ['A', 0],
  ['B', -1],
  ['B', 0],
];

export interface SpellOptions {
  /** Key signature (sharps positive) the chord lives in: decides sharps or flats for the black keys. */
  readonly fifths?: number | undefined;
  /** Used when the key does not decide (C major or unknown). */
  readonly preferFlats?: boolean | undefined;
}

/**
 * Chooses the spelling of a pitch class for a root. Black keys follow the key signature when it
 * has accidentals, else the usual chord-name choice: minor chords on #1 (C#m), #6 (F#m) and #8
 * (G#m) but Bbm and Ebm; major chords Db, Eb, F#, Ab, Bb.
 */
export function spellRoot(pc: number, minor: boolean, opts: SpellOptions = {}): ChordNote {
  const p = ((pc % 12) + 12) % 12;
  const fifths = opts.fifths ?? 0;
  let flats: boolean;
  if (fifths !== 0) flats = fifths < 0;
  else flats = defaultFlats(p, minor);
  const [step, alter] = (flats ? PC_FLAT : PC_SHARP)[p]!;
  return { step, alter };
}

function defaultFlats(pc: number, minor: boolean): boolean {
  switch (pc) {
    case 1:
      return !minor; // Db, C#m
    case 3:
      return true; // Eb, Ebm
    case 6:
      return false; // F#, F#m (Gb only in a flat key)
    case 8:
      return !minor; // Ab, G#m
    case 10:
      return true; // Bb, Bbm
    default:
      return false;
  }
}

/** Transposes a chord by semitones. Whole octaves keep the spelling. */
export function transposeChord(
  chord: ChordData,
  semitones: number,
  opts: SpellOptions = {},
): ChordData {
  if (semitones % 12 === 0) return chord;
  const minor = parseQuality(chord.quality)?.minor ?? false;
  const preferFlats = opts.preferFlats ?? semitones < 0;
  const root = spellRoot(notePc(chord.root) + semitones, minor, { ...opts, preferFlats });
  const out: ChordData = { root, quality: chord.quality };
  if (!chord.bass) return out;
  // The bass follows the sharps/flats family of the new root, else the usual chord-name spelling.
  const bpc = (((notePc(chord.bass) + semitones) % 12) + 12) % 12;
  const family = root.alter !== 0 ? root.alter < 0 : opts.fifths ? opts.fifths < 0 : undefined;
  const { step, alter } = spellRoot(
    bpc,
    false,
    family === undefined ? {} : { fifths: family ? -1 : 1 },
  );
  return { ...out, bass: { step, alter } };
}

// ---------------------------------------------------------------------------------------------
// Chord tones
// ---------------------------------------------------------------------------------------------

export interface ChordTones {
  /** Pitch class of the root and of the bass (the root without a slash bass). */
  readonly root: number;
  readonly bass: number;
  /** Pitch classes a voicing must contain. */
  readonly required: readonly number[];
  /** Pitch classes that may be left out (the fifth, the lower extensions). */
  readonly optional: readonly number[];
  /** Semitone intervals above the root, in stacking order (root first): for playback and MusicXML. */
  readonly intervals: readonly number[];
}

/** Chord tones of a chord. A bass that is not a chord tone is required too. */
export function chordTones(chord: ChordData): ChordTones {
  const q = parseQuality(chord.quality) ?? parseQuality('')!;
  const root = notePc(chord.root);
  const req = new Set<number>([0]);
  const opt = new Set<number>();
  const stack: number[] = [0];
  const has = (a: string) => q.alt.includes(a);
  // Third.
  let third: number | undefined;
  if (q.power) third = undefined;
  else if (q.sus === 2) third = 2;
  else if (q.sus === 4) third = 5;
  else third = q.minor || q.dim ? 3 : 4;
  if (third !== undefined) {
    req.add(third);
    stack.push(third);
  }
  // Fifth.
  let fifth = 7;
  if (q.dim || has('b5')) fifth = 6;
  else if (q.aug || has('#5')) fifth = 8;
  const fifthKept = q.dim || q.aug || has('b5') || has('#5') || q.power;
  (fifthKept ? req : opt).add(fifth);
  stack.push(fifth);
  if (q.sixth) {
    req.add(9);
    stack.push(9);
    if (q.sixth === 69) {
      req.add(2);
      stack.push(14);
    }
  }
  if (q.seventh) {
    const seventh = q.seventh === 11 ? 11 : q.dim ? 9 : 10;
    req.add(seventh);
    stack.push(seventh);
  }
  // Extensions: the top one is required, the ones it implies are optional.
  if (q.ext >= 9) {
    (q.ext === 9 && !has('b9') && !has('#9') ? req : opt).add(2);
    stack.push(14);
  }
  if (q.ext >= 11) {
    (q.ext === 11 ? req : opt).add(5);
    stack.push(17);
  }
  if (q.ext === 13) {
    req.add(9);
    stack.push(21);
  }
  if (has('b9')) {
    req.add(1);
    stack.push(13);
  }
  if (has('#9')) {
    req.add(3);
    stack.push(15);
  }
  if (has('#11')) {
    req.add(6);
    stack.push(18);
  }
  if (has('b13')) {
    req.add(8);
    stack.push(20);
  }
  for (const a of q.add) {
    const interval = a === 2 ? 2 : a === 4 ? 5 : a === 9 ? 2 : a === 11 ? 5 : 9;
    req.add(interval);
    stack.push(a === 2 ? 2 : a === 4 ? 5 : a === 9 ? 14 : a === 11 ? 17 : 21);
  }
  const bass = chord.bass ? notePc(chord.bass) : root;
  const rel = (bass - root + 12) % 12;
  if (chord.bass) {
    if (opt.has(rel)) opt.delete(rel);
    req.add(rel);
  }
  for (const r of req) opt.delete(r);
  const abs = (set: Iterable<number>) => [...set].map((i) => (i + root) % 12);
  return {
    root,
    bass,
    required: abs(req),
    optional: abs(opt),
    intervals: stack.filter((v, i) => stack.indexOf(v) === i),
  };
}

// ---------------------------------------------------------------------------------------------
// Diagrams
// ---------------------------------------------------------------------------------------------

/** The chord a player forms with a capo: the sounding chord lowered by the capo fret. */
export function shapeOf(chord: ChordData, capo: number): ChordData {
  if (capo <= 0) return chord;
  return transposeChord(chord, -capo, { preferFlats: false });
}

/** Chord key used to compare occurrences ("same chord, same bass"). */
export function chordKey(chord: ChordData): string {
  return (
    formatChord(chord) + '|' + notePc(chord.root) + '|' + (chord.bass ? notePc(chord.bass) : '')
  );
}

/** Pitch of the root in a given octave, as a spelled pitch (playback voicings). */
export function chordRootPitch(chord: ChordData, octave: number) {
  const base = (octave + 1) * 12 + notePc(chord.root);
  return midiToPitch(base, 0, chord.root.alter < 0);
}

export const NOTE_STEPS = STEP_NAMES;

/** True when a symbol shows a diagram once the part's display mode is applied. */
export function showsDiagram(
  mode: 'first' | 'all' | undefined,
  chord: Pick<ChordSymbol, 'diagram'>,
  firstOfKind: boolean,
): boolean {
  if (chord.diagram !== undefined) return chord.diagram;
  if (mode === 'all') return true;
  return mode === 'first' && firstOfKind;
}
