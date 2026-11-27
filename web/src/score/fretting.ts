/**
 * Frettings of the notes of a part: which string and fret plays a written pitch (automatic
 * fingering, see `fingering.ts`) and how a staff keeps its frettings stable while it is edited.
 *
 * A fretting is *manual* when the user chose it (typed on the tab, re-fretted, imported from a
 * file): it is kept as long as it is still valid for the pitch, whatever happens around it.
 * Derived frettings are recomputed only when asked (`keep: 'manual'`) or when they became invalid.
 */
import { fingerSequence, type Fretboard, type FingerItem } from './fingering';
import { getInstrument, partFrets, partTuning } from './instruments';
import { pitchToMidi, soundingMidi } from './pitch';
import type { Fretting, NotePitch, Part, Pitch, ScoreEvent, Staff, StaffMeasure } from './types';

/** The strings, capo and frets of a part, or undefined when it has no strings. */
export function fretboardOf(part: Part): Fretboard | undefined {
  const tuning = partTuning(part);
  if (!tuning) return undefined;
  return {
    open: tuning.map(pitchToMidi),
    capo: part.capo ?? 0,
    frets: partFrets(part) ?? 24,
  };
}

/** Sounding MIDI number of a written pitch of the part. */
export function soundingOf(part: Part, written: Pitch): number {
  return soundingMidi(written, part.transposition);
}

/** Does this fretting sound the pitch on this part (string exists, fret in range, same note)? */
export function isValidFretting(board: Fretboard, midi: number, f: Fretting | undefined): boolean {
  if (!f) return false;
  const open = board.open[f.string - 1];
  return (
    open !== undefined &&
    f.fret >= 0 &&
    f.fret <= board.frets &&
    open + board.capo + f.fret === midi
  );
}

function withFretting(p: NotePitch, f: Fretting | undefined): NotePitch {
  const copy: { fretting?: Fretting } & NotePitch = { ...p };
  delete copy.fretting;
  if (f) copy.fretting = f;
  return copy;
}

/**
 * Picks a string and fret for a written pitch: the `prefer`red string when it can play it, else
 * the fingering algorithm for a lone note (open strings first, then the lowest fret). Undefined
 * when no string can play it.
 */
export function assignFretting(part: Part, written: Pitch, prefer?: number): Fretting | undefined {
  const board = fretboardOf(part);
  if (!board) return undefined;
  const midi = soundingOf(part, written);
  if (prefer !== undefined && prefer >= 1 && prefer <= board.open.length) {
    const f = { string: prefer, fret: midi - board.open[prefer - 1]! - board.capo };
    if (isValidFretting(board, midi, f)) return f;
  }
  return fingerSequence(board, [{ midis: [midi] }])[0]![0];
}

/**
 * Frettings for the pitches of a new note or chord, following `before` (the pitches of the
 * previous note of the voice) so the hand stays where it was. One entry per pitch.
 */
export function fingerPitches(
  part: Part,
  pitches: readonly Pitch[],
  before?: readonly NotePitch[],
): (Fretting | undefined)[] {
  const board = fretboardOf(part);
  if (!board) return pitches.map(() => undefined);
  const items: FingerItem[] = [];
  if (
    before?.length &&
    before.every((q) => isValidFretting(board, soundingOf(part, q), q.fretting))
  ) {
    items.push({
      midis: before.map((q) => soundingOf(part, q)),
      fixed: before.map((q) => q.fretting),
    });
  }
  items.push({ midis: pitches.map((q) => soundingOf(part, q)) });
  return fingerSequence(board, items)[items.length - 1]!;
}

export type KeepMode = 'none' | 'manual' | 'valid';

/**
 * Recomputes the frettings of the notes of `staff`, voice by voice, across measures.
 * - `keep: 'valid'`: every valid fretting stays; only missing or invalid ones are (re)computed.
 * - `keep: 'manual'`: only valid manual frettings stay.
 * - `keep: 'none'`: everything is recomputed.
 * `reset` lists events whose frettings are recomputed whatever `keep` says (and lose their manual flag).
 * Notes no string can play lose their fretting. Untouched objects are reused (same references).
 */
export function refretStaffNotes(
  part: Part,
  staff: Staff,
  keep: KeepMode,
  reset?: ReadonlySet<string>,
): Staff {
  const board = fretboardOf(part);
  if (!board) return staff;
  const voices = Math.max(0, ...staff.measures.map((sm) => sm.voices.length));
  let edited: StaffMeasure[] | undefined;
  for (let vi = 0; vi < voices; vi++) {
    interface Ref {
      m: number;
      i: number;
      event: Extract<ScoreEvent, { kind: 'note' }>;
    }
    const refs: Ref[] = [];
    staff.measures.forEach((sm, m) =>
      sm.voices[vi]?.events.forEach((event, i) => {
        if (event.kind === 'note') refs.push({ m, i, event });
      }),
    );
    if (!refs.length) continue;
    let anyFree = false;
    const items: FingerItem[] = refs.map(({ event }) => {
      const midis = event.pitches.map((q) => soundingOf(part, q));
      const fixed = event.pitches.map((q, k) => {
        const f = q.fretting;
        if (!f || reset?.has(event.id) || keep === 'none') return undefined;
        if (!isValidFretting(board, midis[k]!, f)) return undefined;
        return keep === 'valid' || f.manual ? f : undefined;
      });
      if (fixed.some((f) => !f)) anyFree = true;
      return { midis, fixed };
    });
    // Nothing to compute, and every fretting is already valid and fixed.
    if (!anyFree) continue;
    const result = fingerSequence(board, items);
    refs.forEach((ref, r) => {
      const next = result[r]!;
      let changed = false;
      const fixed = items[r]!.fixed!;
      const pitches = ref.event.pitches.map((q, k) => {
        if (fixed[k]) return q;
        const f = next[k];
        const old = q.fretting;
        if (!old && !f) return q;
        if (old && f && old.string === f.string && old.fret === f.fret && !old.manual) return q;
        changed = true;
        return withFretting(q, f);
      });
      if (!changed) return;
      edited ??= staff.measures.slice();
      const sm = edited[ref.m]!;
      const voice = sm.voices[vi]!;
      const events = voice.events.slice();
      events[ref.i] = { ...ref.event, pitches };
      const voicesCopy = sm.voices.slice();
      voicesCopy[vi] = { ...voice, events };
      edited[ref.m] = { ...sm, voices: voicesCopy };
    });
  }
  return edited ? { ...staff, measures: edited } : staff;
}

export interface UnplayableEvent {
  readonly eventId: string;
  readonly partId: string;
  readonly instrument: string;
  readonly measure: number;
}

/**
 * Notes of tab staves that no string can play (no valid fretting: below the lowest string, above
 * the last fret, under a capo). The tab draws a "?" for them and the editor warns.
 */
export function unplayableEvents(score: { readonly parts: readonly Part[] }): UnplayableEvent[] {
  const out: UnplayableEvent[] = [];
  for (const part of score.parts) {
    const board = fretboardOf(part);
    if (!board) continue;
    for (const staff of part.staves) {
      if (staff.type !== 'tab') continue;
      staff.measures.forEach((sm, measure) => {
        for (const v of sm.voices) {
          for (const e of v.events) {
            if (e.kind !== 'note') continue;
            const bad = e.pitches.some(
              (q) => !isValidFretting(board, soundingOf(part, q), q.fretting),
            );
            if (bad) {
              out.push({ eventId: e.id, partId: part.id, instrument: part.instrument, measure });
            }
          }
        }
      });
    }
  }
  return out;
}

/** Has the instrument strings (catalog) or does the part carry its own tuning? */
export function isFrettedPart(part: Part): boolean {
  return !!getInstrument(part.instrument)?.strings || !!part.tuning;
}
