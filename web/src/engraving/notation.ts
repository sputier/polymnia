/**
 * Pure notation helpers shared by the layout (widths, hit testing) and the VexFlow renderer:
 * staff geometry, accidental state, tick positions and beam groups. No VexFlow, no DOM.
 */
import { keyAlter, pitchEquals, STEPS } from '../score/pitch';
import { TICKS_PER_QUARTER, durationTicks } from '../score/ticks';
import type {
  Clef,
  NotePitch,
  Pitch,
  ScoreEvent,
  StaffMeasure,
  StepName,
  TimeSignature,
  Voice,
} from '../score/types';

/** Distance between two staff lines, in px. */
export const STAFF_SPACE = 10;
/** Line spacing of tab staves, in px (VexFlow default for tablature). */
export const TAB_SPACE = 13;

/** Diatonic index of a pitch: C0 = 0, D0 = 1, ..., C1 = 7. One unit is half a staff space. */
export function stepIndex(p: Pick<Pitch, 'step' | 'octave'>): number {
  return p.octave * 7 + STEPS.indexOf(p.step);
}

/** Diatonic index of the top line of the staff for each clef. */
const TOP_LINE: Record<Clef, number> = {
  treble: 38, // F5
  'treble-8vb': 38, // written pitch: same position as the treble clef, the "8" only transposes
  bass: 26, // A3
  alto: 32, // G4
  tenor: 30, // E4
  percussion: 38,
};

/** Diatonic index sitting on the middle line (where rests are drawn). */
export function middleLine(clef: Clef): number {
  return TOP_LINE[clef] - 4;
}

/** Y of a diatonic index, relative to the top line of the staff (grows downwards). */
export function yOfStep(index: number, clef: Clef, space = STAFF_SPACE): number {
  return (TOP_LINE[clef] - index) * (space / 2);
}

/** Natural pitch drawn at `y` (relative to the top staff line): used to turn a click into a pitch. */
export function pitchAtY(y: number, clef: Clef, space = STAFF_SPACE): Pitch {
  const index = TOP_LINE[clef] - Math.round(y / (space / 2));
  const octave = Math.floor(index / 7);
  return { step: STEPS[index - octave * 7] as StepName, alter: 0, octave };
}

export type AccidentalGlyph = '#' | 'b' | 'n' | '##' | 'bb';

const GLYPH: Record<number, AccidentalGlyph> = { 1: '#', [-1]: 'b', 2: '##', [-2]: 'bb' };

function pitchKey(p: Pitch): string {
  return `${p.step}${p.octave}`;
}

/** Tied-in pitches per voice index: pitches tied from the last event of the previous measure. */
export type TieIn = readonly (ReadonlySet<string> | undefined)[];

export function tiedInKey(p: Pitch): string {
  return `${p.step}${p.alter}${p.octave}`;
}

/** Pitches tied from the end of `prev` into the first event of each voice of the next measure. */
export function tieInFrom(prev: StaffMeasure | undefined): TieIn {
  if (!prev) return [];
  return prev.voices.map((v) => {
    const last = v.events[v.events.length - 1];
    if (last?.kind !== 'note') return undefined;
    const keys = last.pitches.filter((p) => p.tieToNext).map(tiedInKey);
    return keys.length ? new Set(keys) : undefined;
  });
}

/**
 * Accidental to print for every pitch of every note of a staff measure (null = none), following the
 * key signature and the accidentals already written earlier in the measure (any voice, by time).
 * A pitch tied from the previous measure never repeats its accidental.
 */
export function accidentalsFor(
  measure: StaffMeasure,
  keyFifths: number,
  tieIn: TieIn = [],
): Map<string, (AccidentalGlyph | null)[]> {
  const out = new Map<string, (AccidentalGlyph | null)[]>();
  const items: { start: number; voice: number; event: ScoreEvent; first: boolean }[] = [];
  measure.voices.forEach((voice, v) => {
    let pos = 0;
    const ticks = eventTicks(voice);
    voice.events.forEach((event, i) => {
      items.push({ start: pos, voice: v, event, first: i === 0 });
      pos += ticks[i]!;
    });
  });
  items.sort((a, b) => a.start - b.start || a.voice - b.voice);
  const state = new Map<string, number>();
  for (const { voice, event, first } of items) {
    if (event.kind !== 'note') continue;
    const glyphs = event.pitches.map((p) => {
      const key = pitchKey(p);
      const current = state.get(key) ?? keyAlter(p.step, keyFifths);
      state.set(key, p.alter);
      if (first && tieIn[voice]?.has(tiedInKey(p))) return null;
      if (p.alter === current) return null;
      return p.alter === 0 ? 'n' : GLYPH[p.alter]!;
    });
    out.set(event.id, glyphs);
  }
  return out;
}

/** Ticks of each event of a voice (tuplet scaling applied). */
export function eventTicks(voice: Voice): number[] {
  if (!voice.tuplets.length) return voice.events.map((e) => durationTicks(e.duration));
  const ratio = new Map<string, number>();
  for (const t of voice.tuplets) for (const id of t.eventIds) ratio.set(id, t.normal / t.actual);
  return voice.events.map((e) => durationTicks(e.duration) * (ratio.get(e.id) ?? 1));
}

/** Rounds fractional tick positions so equal moments compare equal. */
export function tickKey(tick: number): number {
  return Math.round(tick * 1000) / 1000;
}

/** Pitches of a note sorted from bottom to top on the staff (VexFlow order), keeping original indices. */
export function sortedByStaffPosition(pitches: readonly NotePitch[]): NotePitch[] {
  return [...pitches].sort((a, b) => stepIndex(a) - stepIndex(b) || a.alter - b.alter);
}

/** True when two adjacent pitches of a chord are a second apart (noteheads are displaced). */
export function hasSecond(pitches: readonly NotePitch[]): boolean {
  const s = sortedByStaffPosition(pitches);
  for (let i = 1; i < s.length; i++) if (stepIndex(s[i]!) - stepIndex(s[i - 1]!) === 1) return true;
  return false;
}

/** Length in ticks of a beam group: the beat, or the dotted quarter in compound meters. */
export function beamGroupTicks(time: TimeSignature): number {
  const unit = (4 * TICKS_PER_QUARTER) / time.beatType;
  if (time.beatType >= 8 && time.beats % 3 === 0 && time.beats > 3) return unit * 3;
  return time.beatType >= 8 ? unit * 2 : unit;
}

/**
 * Groups of consecutive notes (indices into voice.events) to beam together: notes shorter than a
 * quarter, never across a beat group boundary, never across a rest. Needs two notes or more.
 */
export function beamGroups(voice: Voice, time: TimeSignature): number[][] {
  const group = beamGroupTicks(time);
  const ticks = eventTicks(voice);
  const groups: number[][] = [];
  let current: number[] = [];
  let currentBucket = -1;
  let pos = 0;
  const flush = () => {
    if (current.length >= 2) groups.push(current);
    current = [];
  };
  voice.events.forEach((event, i) => {
    const beamable = event.kind === 'note' && durationTicks(event.duration) < TICKS_PER_QUARTER;
    const bucket = Math.floor((pos + 1e-6) / group);
    if (!beamable || bucket !== currentBucket) flush();
    if (beamable) {
      current.push(i);
      currentBucket = bucket;
    }
    pos += ticks[i]!;
  });
  flush();
  return groups;
}

export function samePitchIndex(pitches: readonly NotePitch[], p: Pitch): number {
  return pitches.findIndex((q) => pitchEquals(q, p));
}
