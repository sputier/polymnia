import type { IdGen } from '../ids';
import { canTie, findEvent, voiceEventTicks } from '../query';
import { decompose, durationTicks, MIN_TICKS } from '../ticks';
import type {
  Duration,
  NoteEvent,
  NotePitch,
  RestEvent,
  Score,
  ScoreEvent,
  Staff,
  StaffMeasure,
  Voice,
} from '../types';

/**
 * An edit. `apply` is pure and deterministic (same input, same output, same generated ids) and
 * returns the very same Score reference when the edit changes nothing.
 * `invert(before)` returns the command that restores `before` exactly.
 */
export interface Command {
  readonly name: string;
  apply(score: Score): Score;
  invert(before: Score): Command;
}

export type CommandErrorCode =
  | 'not-found'
  | 'invalid-argument'
  | 'bad-position'
  | 'exceeds-measure'
  | 'tuplet-conflict'
  | 'last-pitch'
  | 'duplicate-pitch'
  | 'no-tie-target'
  | 'pitch-out-of-range'
  | 'last-measure'
  | 'not-a-note'
  | 'no-tuning';

/** Thrown by `apply` when an edit is not allowed. The score is never partially modified. */
export class CommandError extends Error {
  readonly code: CommandErrorCode;
  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
  }
}

/** Command that jumps to a stored score. Structural sharing makes the snapshot nearly free. */
export function restoreCommand(target: Score): Command {
  return {
    name: 'restore',
    apply: () => target,
    invert: (before) => restoreCommand(before),
  };
}

export function defineCommand(name: string, apply: (score: Score) => Score): Command {
  return { name, apply, invert: (before) => restoreCommand(before) };
}

// ---------------------------------------------------------------------------------------------
// Path-copying helpers: only the objects on the path to the change are copied.
// ---------------------------------------------------------------------------------------------

export interface VoiceAddress {
  readonly partIndex: number;
  readonly staffIndex: number;
  readonly measure: number;
  readonly voiceIndex: number;
}

function replaceAt<T>(arr: readonly T[], i: number, value: T): readonly T[] {
  const copy = arr.slice();
  copy[i] = value;
  return copy;
}

export function mapStaff(
  score: Score,
  partIndex: number,
  staffIndex: number,
  fn: (s: Staff) => Staff,
): Score {
  const part = score.parts[partIndex]!;
  const staff = part.staves[staffIndex]!;
  const next = fn(staff);
  if (next === staff) return score;
  return {
    ...score,
    parts: replaceAt(score.parts, partIndex, {
      ...part,
      staves: replaceAt(part.staves, staffIndex, next),
    }),
  };
}

export function mapStaffMeasure(
  score: Score,
  a: { partIndex: number; staffIndex: number; measure: number },
  fn: (m: StaffMeasure) => StaffMeasure,
): Score {
  return mapStaff(score, a.partIndex, a.staffIndex, (staff) => {
    const sm = staff.measures[a.measure]!;
    const next = fn(sm);
    return next === sm ? staff : { ...staff, measures: replaceAt(staff.measures, a.measure, next) };
  });
}

export function mapVoice(score: Score, a: VoiceAddress, fn: (v: Voice) => Voice): Score {
  return mapStaffMeasure(score, a, (sm) => {
    const v = sm.voices[a.voiceIndex]!;
    const next = fn(v);
    return next === v ? sm : { ...sm, voices: replaceAt(sm.voices, a.voiceIndex, next) };
  });
}

// ---------------------------------------------------------------------------------------------
// Consistency maintenance
// ---------------------------------------------------------------------------------------------

function withoutTie(p: NotePitch): NotePitch {
  const copy: { tieToNext?: boolean } & NotePitch = { ...p };
  delete copy.tieToNext;
  return copy;
}

function untieInvalid(e: NoteEvent, next: ScoreEvent | undefined): NoteEvent {
  if (!e.pitches.some((p) => p.tieToNext && !canTie(p, next))) return e;
  return {
    ...e,
    pitches: e.pitches.map((p) => (p.tieToNext && !canTie(p, next) ? withoutTie(p) : p)),
  };
}

/** Clears tieToNext flags that no longer point at the same pitch (voice `a` and its neighbours). */
export function pruneTies(score: Score, a: VoiceAddress): Score {
  const staff = score.parts[a.partIndex]!.staves[a.staffIndex]!;
  const voice = staff.measures[a.measure]?.voices[a.voiceIndex];
  if (!voice) return score;
  const nextFirst = staff.measures[a.measure + 1]?.voices[a.voiceIndex]?.events[0];

  let events = voice.events;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind !== 'note') continue;
    const fixed = untieInvalid(e, events[i + 1] ?? nextFirst);
    if (fixed !== e) {
      if (events === voice.events) events = events.slice();
      (events as ScoreEvent[])[i] = fixed;
    }
  }
  let out = events === voice.events ? score : mapVoice(score, a, (v) => ({ ...v, events }));

  const prevVoice = staff.measures[a.measure - 1]?.voices[a.voiceIndex];
  const prevLast = prevVoice?.events[prevVoice.events.length - 1];
  if (prevVoice && prevLast?.kind === 'note') {
    const fixed = untieInvalid(prevLast, voice.events[0]);
    if (fixed !== prevLast) {
      const pe = prevVoice.events.slice();
      pe[pe.length - 1] = fixed;
      out = mapVoice(out, { ...a, measure: a.measure - 1 }, (v) => ({ ...v, events: pe }));
    }
  }
  return out;
}

/** Drops slurs that touch a removed event. */
export function pruneSlurs(score: Score, removed: ReadonlySet<string>): Score {
  if (removed.size === 0 || score.slurs.length === 0) return score;
  const slurs = score.slurs.filter(
    (s) => !removed.has(s.startEventId) && !removed.has(s.endEventId),
  );
  return slurs.length === score.slurs.length ? score : { ...score, slurs };
}

/** Replaces a voice then restores tie/slur consistency. */
export function commitVoice(
  score: Score,
  a: VoiceAddress,
  voice: Voice,
  removed: ReadonlySet<string> = new Set(),
): Score {
  const next = mapVoice(score, a, () => voice);
  return pruneTies(pruneSlurs(next, removed), a);
}

export function addressOf(l: {
  partIndex: number;
  staffIndex: number;
  measure: number;
  voiceIndex: number;
}): VoiceAddress {
  return {
    partIndex: l.partIndex,
    staffIndex: l.staffIndex,
    measure: l.measure,
    voiceIndex: l.voiceIndex,
  };
}

export function requireEvent(score: Score, eventId: string) {
  const loc = findEvent(score, eventId);
  if (!loc) throw new CommandError('not-found', `No event with id "${eventId}"`);
  return loc;
}

export function requireNote(score: Score, eventId: string) {
  const loc = requireEvent(score, eventId);
  if (loc.event.kind !== 'note')
    throw new CommandError('not-a-note', `Event "${eventId}" is a rest`);
  return { ...loc, event: loc.event };
}

/** Replaces one event in place (same position, same duration) and restores consistency. */
export function replaceEvent(
  score: Score,
  eventId: string,
  fn: (e: ScoreEvent) => ScoreEvent,
  removed?: ReadonlySet<string>,
): Score {
  const loc = requireEvent(score, eventId);
  const next = fn(loc.event);
  if (next === loc.event) return score;
  const events = loc.voice.events.slice();
  events[loc.index] = next;
  return commitVoice(score, addressOf(loc), { ...loc.voice, events }, removed);
}

// ---------------------------------------------------------------------------------------------
// Voice splicing (the overwrite rule used by note entry and duration changes)
// ---------------------------------------------------------------------------------------------

export function makeRest(id: string, duration: Duration): RestEvent {
  return { kind: 'rest', id, duration };
}

export function restsFor(from: number, to: number, gen: IdGen): RestEvent[] {
  return decompose(to - from, from).map((d) => makeRest(gen(), d));
}

/** Cuts an event down to `ticks`, splitting into tied notes when the length is not one duration. */
function cutEvent(ev: ScoreEvent, ticks: number, offset: number, gen: IdGen): ScoreEvent[] {
  const durations = decompose(ticks, offset);
  return durations.map((duration, i): ScoreEvent => {
    const id = i === 0 ? ev.id : gen();
    if (ev.kind === 'rest') return makeRest(id, duration);
    const last = i === durations.length - 1;
    return {
      kind: 'note',
      id,
      duration,
      pitches: last ? ev.pitches : ev.pitches.map((p) => ({ ...p, tieToNext: true })),
    };
  });
}

export interface SpliceResult {
  readonly voice: Voice;
  /** Ids of events that no longer exist. */
  readonly removed: ReadonlySet<string>;
}

/**
 * Overwrite rule (MuseScore-like). `replacement` is written at tick `start`; the region
 * [start, max(end, start + replacement length)) is cleared. Events fully inside are removed, an
 * event starting before `start` is cut (tied notes if needed), the part of an event that sticks out
 * after the region becomes rests, and any remaining gap is filled with rests. Nothing ever
 * overflows `length`: that throws `exceeds-measure`. Tuplet members in the region throw
 * `tuplet-conflict`.
 */
export function spliceVoice(
  voice: Voice,
  length: number,
  start: number,
  end: number,
  replacement: readonly ScoreEvent[],
  gen: IdGen,
): SpliceResult {
  const repLen = replacement.reduce((n, e) => n + durationTicks(e.duration), 0);
  const regionEnd = Math.max(end, start + repLen);
  if (repLen % MIN_TICKS !== 0) {
    throw new CommandError('invalid-argument', 'Duration is not on the 120-tick grid');
  }
  if (start < 0 || start % MIN_TICKS !== 0)
    throw new CommandError('bad-position', `Bad tick ${start}`);
  if (regionEnd > length) {
    throw new CommandError(
      'exceeds-measure',
      `Event would end at ${regionEnd}, measure ends at ${length}`,
    );
  }
  const ticks = voiceEventTicks(voice);
  const inTuplet = new Set(voice.tuplets.flatMap((t) => t.eventIds));

  const before: ScoreEvent[] = [];
  const after: ScoreEvent[] = [];
  const overlapped: string[] = [];
  let gapEnd = regionEnd;
  let s = 0;
  voice.events.forEach((ev, i) => {
    const e = s + ticks[i]!;
    if (e <= start) before.push(ev);
    else if (s >= regionEnd) after.push(ev);
    else {
      if (inTuplet.has(ev.id)) {
        throw new CommandError('tuplet-conflict', 'The edit would overwrite part of a tuplet');
      }
      overlapped.push(ev.id);
      if (s < start) before.push(...cutEvent(ev, start - s, s, gen));
      if (e > regionEnd) gapEnd = e;
    }
    s = e;
  });
  const gap = restsFor(start + repLen, gapEnd, gen);
  const events = [...before, ...replacement, ...gap, ...after];
  const kept = new Set(events.map((e) => e.id));
  return {
    voice: { ...voice, events },
    removed: new Set(overlapped.filter((id) => !kept.has(id))),
  };
}

/** Resizes a voice to a new measure length: pads with rests or truncates (cutting the last event). */
export function fitVoice(
  voice: Voice,
  oldLength: number,
  newLength: number,
  gen: IdGen,
): SpliceResult {
  if (newLength === oldLength) return { voice, removed: new Set() };
  if (newLength > oldLength) {
    return {
      voice: { ...voice, events: [...voice.events, ...restsFor(oldLength, newLength, gen)] },
      removed: new Set(),
    };
  }
  const ticks = voiceEventTicks(voice);
  const inTuplet = new Set(voice.tuplets.flatMap((t) => t.eventIds));
  const events: ScoreEvent[] = [];
  const removed = new Set<string>();
  let s = 0;
  voice.events.forEach((ev, i) => {
    const e = s + ticks[i]!;
    if (e <= newLength) events.push(ev);
    else {
      if (inTuplet.has(ev.id))
        throw new CommandError('tuplet-conflict', 'The change would cut a tuplet');
      if (s < newLength) events.push(...cutEvent(ev, newLength - s, s, gen));
      else removed.add(ev.id);
    }
    s = e;
  });
  return { voice: { ...voice, events }, removed };
}
