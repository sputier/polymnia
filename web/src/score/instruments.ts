import { pitchToMidi, soundingPitch } from './pitch';
import type { Alter, Clef, Part, Pitch, StepName } from './types';

export interface InstrumentDef {
  readonly id: string;
  readonly names: { readonly en: string; readonly fr: string };
  /** Abbreviated name, drawn on every system after the first. */
  readonly short: { readonly en: string; readonly fr: string };
  /** Default clef first; the others are common alternatives. */
  readonly clefs: readonly Clef[];
  /** Written to sounding transposition in semitones (classical guitar: -12). */
  readonly transposition: number;
  /** Sounding range, inclusive. */
  readonly range: { readonly low: Pitch; readonly high: Pitch };
  /** General MIDI program number (0-based) for playback. */
  readonly gmProgram: number;
  /** Fretted instruments: open-string sounding pitches, high string to low string. */
  readonly strings?: readonly Pitch[];
  readonly frets?: number;
  /** Notation for this instrument is usually a grand staff (piano). */
  readonly staves: 1 | 2;
}

const p = (step: StepName, octave: number, alter: Alter = 0): Pitch => ({ step, alter, octave });

export const INSTRUMENTS: readonly InstrumentDef[] = [
  {
    id: 'piano',
    names: { en: 'Piano', fr: 'Piano' },
    short: { en: 'Pno.', fr: 'Pno.' },
    clefs: ['treble', 'bass'],
    transposition: 0,
    range: { low: p('A', 0), high: p('C', 8) },
    gmProgram: 0,
    staves: 2,
  },
  {
    id: 'voice',
    names: { en: 'Voice', fr: 'Voix' },
    short: { en: 'Vo.', fr: 'Voix' },
    clefs: ['treble', 'bass'],
    transposition: 0,
    range: { low: p('C', 3), high: p('A', 5) },
    gmProgram: 52,
    staves: 1,
  },
  {
    id: 'flute',
    names: { en: 'Flute', fr: 'Flûte' },
    short: { en: 'Fl.', fr: 'Fl.' },
    clefs: ['treble'],
    transposition: 0,
    range: { low: p('C', 4), high: p('C', 7) },
    gmProgram: 73,
    staves: 1,
  },
  {
    id: 'clarinet',
    names: { en: 'Clarinet in B♭', fr: 'Clarinette en si♭' },
    short: { en: 'Cl.', fr: 'Cl.' },
    clefs: ['treble'],
    transposition: -2,
    range: { low: p('D', 3), high: p('B', 6, -1) },
    gmProgram: 71,
    staves: 1,
  },
  {
    id: 'double-bass',
    names: { en: 'Double bass', fr: 'Contrebasse' },
    short: { en: 'D.B.', fr: 'Cb.' },
    clefs: ['bass', 'tenor'],
    transposition: -12,
    range: { low: p('E', 1), high: p('G', 4) },
    gmProgram: 43,
    staves: 1,
  },
  {
    id: 'violin',
    names: { en: 'Violin', fr: 'Violon' },
    short: { en: 'Vln.', fr: 'Vln.' },
    clefs: ['treble'],
    transposition: 0,
    range: { low: p('G', 3), high: p('E', 7) },
    gmProgram: 40,
    staves: 1,
  },
  {
    id: 'cello',
    names: { en: 'Cello', fr: 'Violoncelle' },
    short: { en: 'Vc.', fr: 'Vc.' },
    clefs: ['bass', 'tenor', 'treble'],
    transposition: 0,
    range: { low: p('C', 2), high: p('A', 5) },
    gmProgram: 42,
    staves: 1,
  },
  {
    id: 'guitar-classical',
    names: { en: 'Classical guitar', fr: 'Guitare classique' },
    short: { en: 'Gtr.', fr: 'Guit.' },
    clefs: ['treble-8vb'],
    transposition: -12,
    range: { low: p('E', 2), high: p('B', 5) },
    gmProgram: 24,
    strings: [p('E', 4), p('B', 3), p('G', 3), p('D', 3), p('A', 2), p('E', 2)],
    frets: 19,
    staves: 1,
  },
  {
    id: 'guitar-steel',
    names: { en: 'Steel-string guitar', fr: 'Guitare folk' },
    short: { en: 'Gtr.', fr: 'Guit.' },
    clefs: ['treble-8vb'],
    transposition: -12,
    range: { low: p('E', 2), high: p('C', 6) },
    gmProgram: 25,
    strings: [p('E', 4), p('B', 3), p('G', 3), p('D', 3), p('A', 2), p('E', 2)],
    frets: 20,
    staves: 1,
  },
  {
    id: 'ukulele-soprano',
    names: { en: 'Soprano ukulele', fr: 'Ukulélé soprano' },
    short: { en: 'Uke', fr: 'Uk.' },
    clefs: ['treble'],
    transposition: 0,
    range: { low: p('C', 4), high: p('C', 6) },
    gmProgram: 24,
    strings: [p('A', 4), p('E', 4), p('C', 4), p('G', 4)],
    frets: 15,
    staves: 1,
  },
  {
    id: 'ukulele-concert',
    names: { en: 'Concert ukulele', fr: 'Ukulélé concert' },
    short: { en: 'Uke', fr: 'Uk.' },
    clefs: ['treble'],
    transposition: 0,
    range: { low: p('C', 4), high: p('D', 6) },
    gmProgram: 24,
    strings: [p('A', 4), p('E', 4), p('C', 4), p('G', 4)],
    frets: 18,
    staves: 1,
  },
  {
    id: 'ukulele-tenor',
    names: { en: 'Tenor ukulele', fr: 'Ukulélé ténor' },
    short: { en: 'Uke', fr: 'Uk.' },
    clefs: ['treble'],
    transposition: 0,
    range: { low: p('C', 4), high: p('D', 6, 1) },
    gmProgram: 24,
    strings: [p('A', 4), p('E', 4), p('C', 4), p('G', 4)],
    frets: 19,
    staves: 1,
  },
  {
    id: 'ukulele-tenor-low-g',
    names: { en: 'Tenor ukulele (low G)', fr: 'Ukulélé ténor (sol grave)' },
    short: { en: 'Uke', fr: 'Uk.' },
    clefs: ['treble'],
    transposition: 0,
    range: { low: p('G', 3), high: p('D', 6, 1) },
    gmProgram: 24,
    strings: [p('A', 4), p('E', 4), p('C', 4), p('G', 3)],
    frets: 19,
    staves: 1,
  },
  {
    id: 'ukulele-baritone',
    names: { en: 'Baritone ukulele', fr: 'Ukulélé baryton' },
    short: { en: 'Uke', fr: 'Uk.' },
    clefs: ['treble'],
    transposition: 0,
    range: { low: p('D', 3), high: p('G', 5) },
    gmProgram: 24,
    strings: [p('E', 4), p('B', 3), p('G', 3), p('D', 3)],
    frets: 19,
    staves: 1,
  },
];

const BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]));

export function getInstrument(id: string): InstrumentDef | undefined {
  return BY_ID.get(id);
}

/**
 * Name drawn on the systems after the first: the catalog short name when the part still carries the
 * catalog name (English or French), else the given name, shortened to 8 characters with a dot.
 */
export function shortPartName(part: {
  readonly name: string;
  readonly instrument: string;
}): string {
  const def = BY_ID.get(part.instrument);
  if (def) {
    if (part.name === def.names.en) return def.short.en;
    if (part.name === def.names.fr) return def.short.fr;
  }
  const name = part.name.trim();
  return name.length > 8 ? `${name.slice(0, 7)}.` : name;
}

/** Effective open-string tuning of a part: its override, else the catalog tuning. */
export function partTuning(part: Part): readonly Pitch[] | undefined {
  return part.tuning ?? getInstrument(part.instrument)?.strings;
}

/** Fret count of a part's instrument (catalog value, else the schema maximum is the only bound). */
export function partFrets(part: Part): number | undefined {
  return getInstrument(part.instrument)?.frets;
}

/** Sounding MIDI number of an open string + capo + fret. */
export function fretToMidi(open: Pitch, capo: number, fret: number): number {
  return pitchToMidi(open) + capo + fret;
}

/**
 * Range check for out-of-range warnings (not errors): is this written pitch within the instrument's
 * sounding range? `transposition` defaults to the instrument's own.
 */
export function isInRange(
  instrument: InstrumentDef,
  written: Pitch,
  transposition = instrument.transposition,
): boolean {
  const midi = pitchToMidi(soundingPitch(written, transposition));
  return midi >= pitchToMidi(instrument.range.low) && midi <= pitchToMidi(instrument.range.high);
}
