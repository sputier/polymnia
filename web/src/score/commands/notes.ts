import { fretToMidi, partFrets, partTuning } from '../instruments';
import { idGen, newId } from '../ids';
import { LIMITS } from '../limits';
import { fingerPitches } from '../fretting';
import { comparePitch, midiToPitch, pitchEquals, pitchToMidi, shiftOctaves } from '../pitch';
import { findStaff, keyFifthsAt, measureLength, voiceEventTicks } from '../query';
import type {
  Alter,
  Duration,
  NoteBase,
  NoteEvent,
  NotePitch,
  Pitch,
  Score,
  ScoreEvent,
  Voice,
} from '../types';
import {
  addressOf,
  CommandError,
  commitVoice,
  defineCommand,
  makeRest,
  mapVoice,
  pruneTies,
  replaceEvent,
  requireEvent,
  requireNote,
  spliceVoice,
  type Command,
  type VoiceAddress,
} from './core';

const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function assertPitch(p: Pitch): void {
  const midi = pitchToMidi(p);
  if (
    !STEP_NAMES.includes(p.step) ||
    !Number.isInteger(p.alter) ||
    Math.abs(p.alter) > 2 ||
    !Number.isInteger(p.octave) ||
    midi < 0 ||
    midi > 127
  ) {
    throw new CommandError(
      'pitch-out-of-range',
      'Pitch must be a valid spelled pitch in MIDI range 0..127',
    );
  }
}

function plain(p: Pitch): NotePitch {
  return { step: p.step, alter: p.alter, octave: p.octave };
}

function sorted(pitches: readonly NotePitch[]): NotePitch[] {
  return pitches.slice().sort(comparePitch);
}

function withNotePitches(e: NoteEvent, pitches: readonly NotePitch[]): NoteEvent {
  return { ...e, pitches: sorted(pitches) };
}

function pitchAt(e: NoteEvent, index: number): NotePitch {
  const p = e.pitches[index];
  if (!p) throw new CommandError('invalid-argument', `No pitch at index ${index}`);
  return p;
}

function assertNoDuplicate(e: NoteEvent, p: Pitch, except = -1): void {
  if (e.pitches.some((q, k) => k !== except && pitchEquals(q, p))) {
    throw new CommandError('duplicate-pitch', 'The chord already contains this pitch');
  }
}

/** Pitches of the last note of the voice before `tick` (in the previous measure if need be). */
function previousNotePitches(
  voice: Voice,
  score: Score,
  addr: VoiceAddress,
  tick: number,
): readonly NotePitch[] | undefined {
  const ticks = voiceEventTicks(voice);
  let pos = 0;
  let last: NoteEvent | undefined;
  for (let i = 0; i < voice.events.length && pos < tick - 1e-6; i++) {
    const e = voice.events[i]!;
    if (e.kind === 'note') last = e;
    pos += ticks[i]!;
  }
  if (last) return last.pitches;
  const staff = score.parts[addr.partIndex]!.staves[addr.staffIndex]!;
  const prev = staff.measures[addr.measure - 1]?.voices[addr.voiceIndex];
  for (let i = (prev?.events.length ?? 0) - 1; i >= 0; i--) {
    const e = prev!.events[i]!;
    if (e.kind === 'note') return e.pitches;
  }
  return undefined;
}

/** Replace the pitch at `pitchIndex` (default 0). Tie and fretting of that pitch are dropped. */
export function setPitch(p: { eventId: string; pitchIndex?: number; pitch: Pitch }): Command {
  return defineCommand('setPitch', (score) => {
    assertPitch(p.pitch);
    const idx = p.pitchIndex ?? 0;
    return replaceEvent(score, p.eventId, (e) => {
      if (e.kind !== 'note') throw new CommandError('not-a-note', 'Cannot set the pitch of a rest');
      const old = pitchAt(e, idx);
      if (pitchEquals(old, p.pitch) && !old.tieToNext && !old.fretting) return e;
      assertNoDuplicate(e, p.pitch, idx);
      return withNotePitches(
        e,
        e.pitches.map((q, k) => (k === idx ? plain(p.pitch) : q)),
      );
    });
  });
}

/** Change only the accidental (alter) of a pitch, keeping step and octave. */
export function setAccidental(p: { eventId: string; pitchIndex?: number; alter: Alter }): Command {
  return defineCommand('setAccidental', (score) => {
    const { event } = requireNote(score, p.eventId);
    const old = pitchAt(event, p.pitchIndex ?? 0);
    return setPitch({
      eventId: p.eventId,
      pitchIndex: p.pitchIndex,
      pitch: { step: old.step, alter: p.alter, octave: old.octave },
    }).apply(score);
  });
}

export function addPitch(p: { eventId: string; pitch: Pitch }): Command {
  return defineCommand('addPitch', (score) => {
    assertPitch(p.pitch);
    return replaceEvent(score, p.eventId, (e) => {
      if (e.kind !== 'note') throw new CommandError('not-a-note', 'Cannot add a pitch to a rest');
      if (e.pitches.length >= LIMITS.maxPitchesPerChord) {
        throw new CommandError('invalid-argument', 'Chord is full');
      }
      assertNoDuplicate(e, p.pitch);
      return withNotePitches(e, [...e.pitches, plain(p.pitch)]);
    });
  });
}

/** Removing the last pitch is refused: use deleteEvent. */
export function removePitch(p: { eventId: string; pitchIndex: number }): Command {
  return defineCommand('removePitch', (score) =>
    replaceEvent(score, p.eventId, (e) => {
      if (e.kind !== 'note') throw new CommandError('not-a-note', 'A rest has no pitch');
      pitchAt(e, p.pitchIndex);
      if (e.pitches.length === 1)
        throw new CommandError('last-pitch', 'Use deleteEvent to remove the last pitch');
      return { ...e, pitches: e.pitches.filter((_, k) => k !== p.pitchIndex) };
    }),
  );
}

/** Ties a pitch to the same pitch of the next event of the voice (across barlines), or removes the tie. */
export function toggleTie(p: { eventId: string; pitchIndex?: number }): Command {
  return defineCommand('toggleTie', (score) => {
    const loc = requireNote(score, p.eventId);
    const idx = p.pitchIndex ?? 0;
    const pitch = pitchAt(loc.event, idx);
    const staff = score.parts[loc.partIndex]!.staves[loc.staffIndex]!;
    const next =
      loc.voice.events[loc.index + 1] ??
      staff.measures[loc.measure + 1]?.voices[loc.voiceIndex]?.events[0];
    if (
      !pitch.tieToNext &&
      !(next?.kind === 'note' && next.pitches.some((q) => pitchEquals(q, pitch)))
    ) {
      throw new CommandError('no-tie-target', 'The next event does not contain the same pitch');
    }
    return replaceEvent(score, p.eventId, (e) => {
      const note = e as NoteEvent;
      return {
        ...note,
        pitches: note.pitches.map((q, k) => {
          if (k !== idx) return q;
          if (q.tieToNext) {
            const copy: { tieToNext?: boolean } & NotePitch = { ...q };
            delete copy.tieToNext;
            return copy;
          }
          return { ...q, tieToNext: true };
        }),
      };
    });
  });
}

/** Replaces a note or chord by a rest of the same duration (the id is kept). Slurs on it are removed. */
export function deleteEvent(p: { eventId: string }): Command {
  return defineCommand('deleteEvent', (score) =>
    replaceEvent(
      score,
      p.eventId,
      (e) => (e.kind === 'rest' ? e : makeRest(e.id, e.duration)),
      new Set([p.eventId]),
    ),
  );
}

export type NewEvent =
  | { kind: 'note'; duration: Duration; pitches: readonly Pitch[] }
  | { kind: 'rest'; duration: Duration };

function sameDuration(a: Duration, b: Duration): boolean {
  return a.base === b.base && a.dots === b.dots;
}

/**
 * Writes a note, chord or rest at `tick` (offset in the measure, multiple of 120) of a voice, using
 * the overwrite rule of `spliceVoice`: following events are consumed, leftovers become rests, an
 * event that would not fit in the measure is refused (`exceeds-measure`, no automatic tie across the
 * barline in V1). Writing over a tuplet member with the same nominal duration replaces it in place.
 */
export function putEvent(p: {
  staffId: string;
  measure: number;
  voice?: number;
  tick: number;
  event: NewEvent;
  /** Id of the new event; generated when omitted. */
  id?: string;
}): Command {
  const seed = newId('p');
  return defineCommand('putEvent', (score) => {
    const sl = findStaff(score, p.staffId);
    if (!sl) throw new CommandError('not-found', `No staff "${p.staffId}"`);
    const addr: VoiceAddress = {
      ...sl,
      measure: p.measure,
      voiceIndex: p.voice ?? 0,
    };
    const voice =
      score.parts[sl.partIndex]!.staves[sl.staffIndex]!.measures[p.measure]?.voices[
        addr.voiceIndex
      ];
    if (!voice) throw new CommandError('bad-position', 'No such measure or voice');
    let ev: ScoreEvent;
    const id = p.id ?? `${seed}-e`;
    if (p.event.kind === 'rest') ev = makeRest(id, p.event.duration);
    else {
      p.event.pitches.forEach(assertPitch);
      if (p.event.pitches.length === 0)
        throw new CommandError('invalid-argument', 'A note needs a pitch');
      if (p.event.pitches.length > LIMITS.maxPitchesPerChord) {
        throw new CommandError('invalid-argument', 'Too many pitches');
      }
      ev = {
        kind: 'note',
        id,
        duration: p.event.duration,
        pitches: sorted(p.event.pitches.map(plain)),
      };
      // On a tab staff the frets are derived by the fingering algorithm, staying near the previous
      // note; the tab editor (setFretting) refines them.
      const part = score.parts[sl.partIndex]!;
      if (part.staves[sl.staffIndex]!.type === 'tab') {
        const before = previousNotePitches(voice, score, addr, p.tick);
        const frets = fingerPitches(part, ev.pitches, before);
        ev = {
          ...ev,
          pitches: ev.pitches.map((q, k) => {
            const fretting = frets[k];
            return fretting ? { ...q, fretting } : q;
          }),
        };
      }
      const dup = ev.pitches.find(
        (q, k) => ev.kind === 'note' && ev.pitches.findIndex((r) => pitchEquals(q, r)) !== k,
      );
      if (dup) throw new CommandError('duplicate-pitch', 'The chord repeats a pitch');
    }

    // In-place replacement of a tuplet member.
    const ticks = voiceEventTicks(voice);
    let s = 0;
    for (let i = 0; i < voice.events.length; i++) {
      const old = voice.events[i]!;
      if (s === p.tick) {
        const tuplet = voice.tuplets.find((t) => t.eventIds.includes(old.id));
        if (tuplet && sameDuration(old.duration, ev.duration)) {
          const events = voice.events.slice();
          events[i] = ev;
          const tuplets = voice.tuplets.map((t) =>
            t === tuplet ? { ...t, eventIds: t.eventIds.map((x) => (x === old.id ? id : x)) } : t,
          );
          return commitVoice(score, addr, { ...voice, events, tuplets }, new Set([old.id]));
        }
      }
      s += ticks[i]!;
    }

    const len = measureLength(score, p.measure);
    const res = spliceVoice(voice, len, p.tick, p.tick, [ev], idGen(seed));
    return commitVoice(score, addr, res.voice, res.removed);
  });
}

function changeDurationIn(score: Score, eventId: string, duration: Duration, seed: string): Score {
  const loc = requireEvent(score, eventId);
  if (sameDuration(loc.event.duration, duration)) return score;
  if (loc.voice.tuplets.some((t) => t.eventIds.includes(eventId))) {
    throw new CommandError('tuplet-conflict', 'Cannot change the duration of a tuplet member');
  }
  const ticks = voiceEventTicks(loc.voice);
  let start = 0;
  for (let i = 0; i < loc.index; i++) start += ticks[i]!;
  const end = start + ticks[loc.index]!;
  const replacement: ScoreEvent = { ...loc.event, duration };
  const res = spliceVoice(
    loc.voice,
    measureLength(score, loc.measure),
    start,
    end,
    [replacement],
    idGen(seed),
  );
  return commitVoice(score, addressOf(loc), res.voice, res.removed);
}

/**
 * Overflow rule: a longer event overwrites the events that follow in its measure (leftover time
 * becomes rests); a shorter one leaves rests after it. If it would pass the barline the command
 * throws `exceeds-measure`.
 */
export function changeDuration(p: { eventId: string; duration: Duration }): Command {
  const seed = newId('d');
  return defineCommand('changeDuration', (score) =>
    changeDurationIn(score, p.eventId, p.duration, seed),
  );
}

/** Adds a single dot, or removes dots when already dotted. Same overflow rule as changeDuration. */
export function toggleDot(p: { eventId: string }): Command {
  const seed = newId('t');
  return defineCommand('toggleDot', (score) => {
    const { event } = requireEvent(score, p.eventId);
    const duration: Duration = { base: event.duration.base, dots: event.duration.dots > 0 ? 0 : 1 };
    return changeDurationIn(score, p.eventId, duration, seed);
  });
}

const HALVED: Partial<Record<NoteBase, NoteBase>> = {
  whole: 'half',
  half: 'quarter',
  quarter: 'eighth',
  eighth: '16th',
  '16th': '32nd',
};

/**
 * Turns an undotted event into a 3:2 triplet of the next shorter value, occupying the same time.
 * The first slot keeps the event (id, pitches), the other two are rests.
 */
export function createTriplet(p: { eventId: string }): Command {
  const seed = newId('tr');
  return defineCommand('createTriplet', (score) => {
    const loc = requireEvent(score, p.eventId);
    const base = HALVED[loc.event.duration.base];
    if (!base || loc.event.duration.dots !== 0) {
      throw new CommandError(
        'invalid-argument',
        'Only undotted events down to the 16th can become a triplet',
      );
    }
    if (loc.voice.tuplets.some((t) => t.eventIds.includes(p.eventId))) {
      throw new CommandError('tuplet-conflict', 'The event is already in a tuplet');
    }
    const gen = idGen(seed);
    const duration: Duration = { base, dots: 0 };
    const r1 = makeRest(gen(), duration);
    const r2 = makeRest(gen(), duration);
    const events = loc.voice.events.slice();
    events.splice(loc.index, 1, { ...loc.event, duration }, r1, r2);
    const tuplet = { id: gen(), actual: 3, normal: 2, eventIds: [p.eventId, r1.id, r2.id] };
    return commitVoice(score, addressOf(loc), {
      ...loc.voice,
      events,
      tuplets: [...loc.voice.tuplets, tuplet],
    });
  });
}

/**
 * Transposes the notes among `eventIds` (rests are ignored) by `semitones` (12 = one octave up).
 * Whole octaves keep the spelling; other intervals are spelled from the key signature at the
 * measure. All or nothing: a pitch outside MIDI 0..127 refuses the whole command. Fretting is dropped.
 */
export function transpose(p: { eventIds: readonly string[]; semitones: number }): Command {
  return defineCommand('transpose', (score) => {
    if (!Number.isInteger(p.semitones))
      throw new CommandError('invalid-argument', 'semitones must be an integer');
    if (p.semitones === 0 || p.eventIds.length === 0) return score;
    const groups = new Map<string, { addr: VoiceAddress; voice: Voice; ids: Set<string> }>();
    for (const id of p.eventIds) {
      const loc = requireEvent(score, id);
      if (loc.event.kind !== 'note') continue;
      const key = `${loc.partIndex}/${loc.staffIndex}/${loc.measure}/${loc.voiceIndex}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { addr: addressOf(loc), voice: loc.voice, ids: new Set() }));
      g.ids.add(id);
    }
    let out = score;
    for (const g of groups.values()) {
      const fifths = keyFifthsAt(score, g.addr.measure);
      const moved = (q: NotePitch): NotePitch => {
        const next =
          p.semitones % 12 === 0
            ? shiftOctaves(q, p.semitones / 12)
            : midiToPitch(pitchToMidi(q) + p.semitones, fifths, p.semitones < 0);
        // The tie flag is kept; pruneTies clears it if the partner did not move the same way.
        return q.tieToNext ? { ...next, tieToNext: true } : plain(next);
      };
      const events = g.voice.events.map((e) =>
        e.kind === 'note' && g.ids.has(e.id) ? withNotePitches(e, e.pitches.map(moved)) : e,
      );
      for (const e of events) if (e.kind === 'note') e.pitches.forEach(assertPitch);
      out = mapVoice(out, g.addr, (v) => ({ ...v, events }));
    }
    for (const g of groups.values()) out = pruneTies(out, g.addr);
    return out;
  });
}

/** Sets the fretting of a pitch and derives the written pitch from string, fret, capo and transposition. */
export function setFretting(p: {
  eventId: string;
  pitchIndex?: number;
  string: number;
  fret: number;
}): Command {
  return defineCommand('setFretting', (score) => {
    const loc = requireNote(score, p.eventId);
    const part = score.parts[loc.partIndex]!;
    const tuning = partTuning(part);
    if (!tuning) throw new CommandError('no-tuning', 'The part has no tuning');
    const open = tuning[p.string - 1];
    const maxFret = partFrets(part) ?? LIMITS.maxFret;
    if (
      !Number.isInteger(p.string) ||
      !open ||
      !Number.isInteger(p.fret) ||
      p.fret < 0 ||
      p.fret > maxFret
    ) {
      throw new CommandError('invalid-argument', 'String or fret out of range for this instrument');
    }
    const idx = p.pitchIndex ?? 0;
    pitchAt(loc.event, idx);
    const written = midiToPitch(
      fretToMidi(open, part.capo ?? 0, p.fret) - part.transposition,
      keyFifthsAt(score, loc.measure),
    );
    assertPitch(written);
    assertNoDuplicate(loc.event, written, idx);
    if (loc.event.pitches.some((q, k) => k !== idx && q.fretting?.string === p.string)) {
      throw new CommandError('invalid-argument', 'Another note of the chord is on this string');
    }
    // The user chose this position: automatic fingering will never move it.
    const entry: NotePitch = {
      ...written,
      ...(loc.event.pitches[idx]!.tieToNext && pitchEquals(loc.event.pitches[idx]!, written)
        ? { tieToNext: true }
        : {}),
      fretting: { string: p.string, fret: p.fret, manual: true },
    };
    return replaceEvent(score, p.eventId, (e) =>
      withNotePitches(
        e as NoteEvent,
        (e as NoteEvent).pitches.map((q, k) => (k === idx ? entry : q)),
      ),
    );
  });
}

function position(score: Score, eventId: string) {
  const loc = requireEvent(score, eventId);
  const ticks = voiceEventTicks(loc.voice);
  let offset = 0;
  for (let i = 0; i < loc.index; i++) offset += ticks[i]!;
  return { loc, offset };
}

/** Adds a slur between two events of the same staff (start strictly before end). */
export function addSlur(p: { startEventId: string; endEventId: string; id?: string }): Command {
  const seed = newId('s');
  return defineCommand('addSlur', (score) => {
    const a = position(score, p.startEventId);
    const b = position(score, p.endEventId);
    if (a.loc.partIndex !== b.loc.partIndex || a.loc.staffIndex !== b.loc.staffIndex) {
      throw new CommandError('invalid-argument', 'A slur must stay on one staff');
    }
    if (
      a.loc.measure > b.loc.measure ||
      (a.loc.measure === b.loc.measure && a.offset >= b.offset)
    ) {
      throw new CommandError('invalid-argument', 'A slur must end after it starts');
    }
    if (
      score.slurs.some((s) => s.startEventId === p.startEventId && s.endEventId === p.endEventId)
    ) {
      return score;
    }
    return {
      ...score,
      slurs: [
        ...score.slurs,
        { id: p.id ?? seed, startEventId: p.startEventId, endEventId: p.endEventId },
      ],
    };
  });
}

export function removeSlur(p: { slurId: string }): Command {
  return defineCommand('removeSlur', (score) => {
    if (!score.slurs.some((s) => s.id === p.slurId)) {
      throw new CommandError('not-found', `No slur "${p.slurId}"`);
    }
    return { ...score, slurs: score.slurs.filter((s) => s.id !== p.slurId) };
  });
}
