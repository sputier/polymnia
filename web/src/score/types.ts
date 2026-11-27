/** Score model types. Everything is readonly: edits produce new objects (see commands/). */

export const SCHEMA_VERSION = 1 as const;

export type StepName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Alter = -2 | -1 | 0 | 1 | 2;

/** Spelled pitch (not a MIDI number) so accidentals survive MusicXML round trips. */
export interface Pitch {
  readonly step: StepName;
  readonly alter: Alter;
  /** Scientific octave: C4 is middle C. Range -1..9 (MIDI 0..127). */
  readonly octave: number;
}

/** Position on a fretted instrument. `string` is 1-based, 1 = highest string (as in tab notation). */
export interface Fretting {
  readonly string: number;
  readonly fret: number;
}

/** A pitch inside a note. Written pitch (see docs/score-format.md, "Transposition"). */
export interface NotePitch extends Pitch {
  /** Present only when true: this pitch is tied to the same pitch in the next event of the voice. */
  readonly tieToNext?: boolean;
  readonly fretting?: Fretting;
}

export type NoteBase = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';
export interface Duration {
  readonly base: NoteBase;
  readonly dots: 0 | 1 | 2;
}

export interface NoteEvent {
  readonly kind: 'note';
  readonly id: string;
  readonly duration: Duration;
  /** One pitch = single note, several = chord. Never empty. */
  readonly pitches: readonly NotePitch[];
}
export interface RestEvent {
  readonly kind: 'rest';
  readonly id: string;
  readonly duration: Duration;
}
export type ScoreEvent = NoteEvent | RestEvent;

/** Tuplet group. Members are consecutive events of one voice; their nominal durations are scaled by normal/actual. */
export interface Tuplet {
  readonly id: string;
  readonly actual: number;
  readonly normal: number;
  readonly eventIds: readonly string[];
}

export interface Voice {
  readonly id: string;
  readonly events: readonly ScoreEvent[];
  readonly tuplets: readonly Tuplet[];
}

export type Clef = 'treble' | 'bass' | 'alto' | 'tenor' | 'treble-8vb' | 'percussion';
export type StaffType = 'standard' | 'tab';

export interface StaffMeasure {
  /** Clef change taking effect at the start of this measure (measure 0 uses `Staff.clef`). */
  readonly clef?: Clef;
  /** At least one voice. Voice 0 is the main voice. */
  readonly voices: readonly Voice[];
}

export interface Staff {
  readonly id: string;
  /** Initial clef. */
  readonly clef: Clef;
  readonly type: StaffType;
  /** Parallel to `Score.measures`. */
  readonly measures: readonly StaffMeasure[];
}

export interface Part {
  readonly id: string;
  readonly name: string;
  /** Instrument catalog id (see instruments.ts); custom ids are allowed. */
  readonly instrument: string;
  /** Written to sounding transposition in semitones (guitar: -12). Notes store the written pitch. */
  readonly transposition: number;
  /** Tuning override, sounding pitches, high string to low string. Defaults to the catalog tuning. */
  readonly tuning?: readonly Pitch[];
  /** Capo fret (fretted instruments), 0 or absent = none. */
  readonly capo?: number;
  readonly staves: readonly Staff[];
}

export interface TimeSignature {
  readonly beats: number;
  readonly beatType: 1 | 2 | 4 | 8 | 16 | 32;
}

/** Attributes shared by every staff for one measure. Time/key/tempo are sparse: absent = same as before. */
export interface MeasureInfo {
  readonly id: string;
  readonly time?: TimeSignature;
  /** Key signature as number of sharps (positive) or flats (negative), -7..7. */
  readonly keyFifths?: number;
  /** Tempo change (quarter notes per minute) starting at this measure. */
  readonly tempoBpm?: number;
  /** Actual length in ticks when shorter than the time signature (pickup, truncated last measure). */
  readonly length?: number;
}

export interface Slur {
  readonly id: string;
  readonly startEventId: string;
  readonly endEventId: string;
}

export interface ScoreMeta {
  readonly title: string;
  readonly composer: string;
  readonly tempoBpm: number;
}

export interface Score {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly id?: string;
  readonly meta: ScoreMeta;
  readonly measures: readonly MeasureInfo[];
  readonly parts: readonly Part[];
  readonly slurs: readonly Slur[];
}

export interface Issue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}
