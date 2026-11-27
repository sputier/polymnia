import { idGen, newId, type IdGen } from '../ids';
import { findStaff, measureLength, timeSignatureAt } from '../query';
import { MIN_TICKS, timeSignatureTicks } from '../ticks';
import type { Clef, MeasureInfo, Score, StaffMeasure, TimeSignature, Voice } from '../types';
import { LIMITS } from '../limits';
import {
  CommandError,
  defineCommand,
  fitVoice,
  mapStaff,
  mapStaffMeasure,
  mapVoice,
  pruneSlurs,
  pruneTies,
  restsFor,
  type Command,
  type VoiceAddress,
} from './core';

const CLEFS: readonly Clef[] = ['treble', 'bass', 'alto', 'tenor', 'treble-8vb', 'percussion'];
const BEAT_TYPES = [1, 2, 4, 8, 16, 32];

function emptyVoice(length: number, offsetId: string, gen: IdGen): Voice {
  return { id: offsetId, events: restsFor(0, length, gen), tuplets: [] };
}

function forEachVoice(score: Score, measure: number, fn: (a: VoiceAddress) => void): void {
  score.parts.forEach((part, partIndex) =>
    part.staves.forEach((staff, staffIndex) =>
      staff.measures[measure]?.voices.forEach((_, voiceIndex) =>
        fn({ partIndex, staffIndex, measure, voiceIndex }),
      ),
    ),
  );
}

/** Drops the chord symbols that no longer fit in a measure that got shorter. */
function trimChords(score: Score, measure: number, length: number): Score {
  let out = score;
  score.parts.forEach((part, partIndex) =>
    part.staves.forEach((staff, staffIndex) => {
      const chords = staff.measures[measure]?.chords;
      if (!chords || chords.every((c) => c.tick < length)) return;
      out = mapStaffMeasure(out, { partIndex, staffIndex, measure }, (sm) => {
        const kept = chords.filter((c) => c.tick < length);
        const { chords: _old, ...rest } = sm;
        void _old;
        return kept.length > 0 ? { ...rest, chords: kept } : rest;
      });
    }),
  );
  return out;
}

/** After measure attributes changed, fits every voice of every measure whose length changed. */
function refit(prev: Score, next: Score, gen: IdGen): Score {
  let out = next;
  const removed = new Set<string>();
  const touched: VoiceAddress[] = [];
  for (let m = 0; m < next.measures.length; m++) {
    const oldLen = measureLength(prev, m);
    const newLen = measureLength(next, m);
    if (oldLen === newLen) continue;
    if (newLen < oldLen) out = trimChords(out, m, newLen);
    forEachVoice(out, m, (a) => {
      const voice =
        out.parts[a.partIndex]!.staves[a.staffIndex]!.measures[m]!.voices[a.voiceIndex]!;
      const res = fitVoice(voice, oldLen, newLen, gen);
      res.removed.forEach((id) => removed.add(id));
      out = mapVoice(out, a, () => res.voice);
      touched.push(a);
    });
  }
  out = pruneSlurs(out, removed);
  for (const a of touched) out = pruneTies(out, a);
  return out;
}

function updateMeasure(score: Score, index: number, fn: (m: MeasureInfo) => MeasureInfo): Score {
  const m = score.measures[index];
  if (!m) throw new CommandError('bad-position', `No measure ${index}`);
  const next = fn(m);
  if (next === m) return score;
  const measures = score.measures.slice();
  measures[index] = next;
  return { ...score, measures };
}

/**
 * Sets the time signature from `measure` on. Following measures that inherit it change length: their
 * content is padded with rests or truncated (a cut note becomes tied notes, events past the end are
 * dropped). A pickup length on `measure` itself is cleared. Refused (`tuplet-conflict`) if it would
 * cut a tuplet.
 */
export function setTimeSignature(p: { measure: number; time: TimeSignature }): Command {
  const seed = newId('ts');
  return defineCommand('setTimeSignature', (score) => {
    if (
      !Number.isInteger(p.time.beats) ||
      p.time.beats < 1 ||
      p.time.beats > 32 ||
      !BEAT_TYPES.includes(p.time.beatType)
    ) {
      throw new CommandError('invalid-argument', 'Invalid time signature');
    }
    if (timeSignatureTicks(p.time) % MIN_TICKS !== 0) {
      throw new CommandError('invalid-argument', 'Time signature is too fine for the tick grid');
    }
    const cur = score.measures[p.measure];
    if (
      cur &&
      cur.time?.beats === p.time.beats &&
      cur.time.beatType === p.time.beatType &&
      cur.length === undefined
    ) {
      return score;
    }
    const next = updateMeasure(score, p.measure, (m) => {
      const copy: { length?: number } & MeasureInfo = { ...m, time: p.time };
      delete copy.length;
      return copy;
    });
    return refit(score, next, idGen(seed));
  });
}

/** Sets the key signature (number of sharps, negative for flats) from `measure` on. Pitches are untouched. */
export function setKeySignature(p: { measure: number; fifths: number }): Command {
  return defineCommand('setKeySignature', (score) => {
    if (!Number.isInteger(p.fifths) || Math.abs(p.fifths) > 7) {
      throw new CommandError('invalid-argument', 'fifths must be an integer between -7 and 7');
    }
    return updateMeasure(score, p.measure, (m) =>
      m.keyFifths === p.fifths ? m : { ...m, keyFifths: p.fifths },
    );
  });
}

/**
 * Tempo change (quarter notes per minute, 20..400) starting at `measure`, or `null` to remove the
 * change (the tempo in force before it, or the score tempo, applies again).
 */
export function setTempo(p: { measure: number; bpm: number | null }): Command {
  return defineCommand('setTempo', (score) => {
    if (p.bpm !== null && (!Number.isInteger(p.bpm) || p.bpm < 20 || p.bpm > 400)) {
      throw new CommandError('invalid-argument', 'Tempo must be an integer between 20 and 400');
    }
    return updateMeasure(score, p.measure, (m) => {
      if (m.tempoBpm === (p.bpm ?? undefined)) return m;
      const copy: { tempoBpm?: number } & MeasureInfo = { ...m };
      if (p.bpm === null) delete copy.tempoBpm;
      else copy.tempoBpm = p.bpm;
      return copy;
    });
  });
}

/**
 * Pickup / shortened measure: sets the actual length in ticks (multiple of 120, below the time
 * signature) or `null` to restore the full length. Contents are padded or truncated like setTimeSignature.
 */
export function setMeasureLength(p: { measure: number; length: number | null }): Command {
  const seed = newId('ml');
  return defineCommand('setMeasureLength', (score) => {
    const nominal = timeSignatureTicks(timeSignatureAt(score, p.measure));
    if (
      p.length !== null &&
      (!Number.isInteger(p.length) ||
        p.length <= 0 ||
        p.length > nominal ||
        p.length % MIN_TICKS !== 0)
    ) {
      throw new CommandError(
        'invalid-argument',
        `Length must be a multiple of ${MIN_TICKS} up to ${nominal}`,
      );
    }
    const next = updateMeasure(score, p.measure, (m) => {
      if (m.length === (p.length ?? undefined)) return m;
      const copy: { length?: number } & MeasureInfo = { ...m };
      if (p.length === null) delete copy.length;
      else copy.length = p.length;
      return copy;
    });
    return refit(score, next, idGen(seed));
  });
}

/** Clef change at the start of `measure` for one staff (measure 0 sets the staff's initial clef). */
export function setClef(p: { staffId: string; measure: number; clef: Clef }): Command {
  return defineCommand('setClef', (score) => {
    if (!CLEFS.includes(p.clef)) throw new CommandError('invalid-argument', 'Unknown clef');
    const sl = findStaff(score, p.staffId);
    if (!sl) throw new CommandError('not-found', `No staff "${p.staffId}"`);
    return mapStaff(score, sl.partIndex, sl.staffIndex, (staff) => {
      if (p.measure === 0) return staff.clef === p.clef ? staff : { ...staff, clef: p.clef };
      const sm = staff.measures[p.measure];
      if (!sm) throw new CommandError('bad-position', `No measure ${p.measure}`);
      if (sm.clef === p.clef) return staff;
      const measures = staff.measures.slice();
      measures[p.measure] = { ...sm, clef: p.clef };
      return { ...staff, measures };
    });
  });
}

/**
 * Inserts `count` empty (all rests) measures before `index` (`index = measures.length` appends).
 * They inherit the time and key in force; inserting at 0 copies them from the old first measure.
 */
export function insertMeasure(p: { index: number; count?: number }): Command {
  const seed = newId('im');
  return defineCommand('insertMeasure', (score) => {
    const count = p.count ?? 1;
    if (!Number.isInteger(p.index) || p.index < 0 || p.index > score.measures.length) {
      throw new CommandError('bad-position', `Cannot insert at ${p.index}`);
    }
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      score.measures.length + count > LIMITS.maxMeasures
    ) {
      throw new CommandError('invalid-argument', 'Invalid measure count');
    }
    const gen = idGen(seed);
    const first = score.measures[0];
    const infos: MeasureInfo[] = [];
    for (let i = 0; i < count; i++) {
      const info: { id: string; time?: TimeSignature; keyFifths?: number } = { id: gen() };
      if (p.index === 0 && first) {
        if (first.time) info.time = first.time;
        if (first.keyFifths !== undefined) info.keyFifths = first.keyFifths;
      }
      infos.push(info);
    }
    const measures = [
      ...score.measures.slice(0, p.index),
      ...infos,
      ...score.measures.slice(p.index),
    ];
    const next: Score = { ...score, measures };
    const length = measureLength(next, p.index);
    const parts = next.parts.map((part) => ({
      ...part,
      staves: part.staves.map((staff) => {
        const fresh: StaffMeasure[] = infos.map(() => ({
          voices: [emptyVoice(length, gen(), gen)],
        }));
        return {
          ...staff,
          measures: [
            ...staff.measures.slice(0, p.index),
            ...fresh,
            ...staff.measures.slice(p.index),
          ],
        };
      }),
    }));
    let out: Score = { ...next, parts };
    // The measure before the insertion may have tied into what is now a rest.
    if (p.index > 0) forEachVoice(out, p.index - 1, (a) => (out = pruneTies(out, a)));
    return out;
  });
}

/**
 * Deletes a measure. The last remaining measure cannot be deleted. Time, key and tempo changes
 * defined on it move to the next measure when that one has none. Slurs touching its events are
 * removed, ties across the removed barlines are cleared.
 */
export function deleteMeasure(p: { index: number }): Command {
  return defineCommand('deleteMeasure', (score) => {
    const old = score.measures[p.index];
    if (!old) throw new CommandError('bad-position', `No measure ${p.index}`);
    if (score.measures.length === 1)
      throw new CommandError('last-measure', 'Cannot delete the last measure');
    const removed = new Set<string>();
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (const v of staff.measures[p.index]!.voices) v.events.forEach((e) => removed.add(e.id));
      }
    }
    const measures = score.measures.slice();
    measures.splice(p.index, 1);
    const nextInfo = measures[p.index];
    if (nextInfo) {
      const carried: {
        id: string;
        time?: TimeSignature;
        keyFifths?: number;
        tempoBpm?: number;
        length?: number;
      } = { ...nextInfo };
      if (!nextInfo.time && old.time) carried.time = old.time;
      if (nextInfo.keyFifths === undefined && old.keyFifths !== undefined)
        carried.keyFifths = old.keyFifths;
      if (nextInfo.tempoBpm === undefined && old.tempoBpm !== undefined)
        carried.tempoBpm = old.tempoBpm;
      measures[p.index] = carried;
    }
    const parts = score.parts.map((part) => ({
      ...part,
      staves: part.staves.map((staff) => {
        const sm = staff.measures.slice();
        const [gone] = sm.splice(p.index, 1);
        // A clef change on the removed measure moves to the next one unless it has its own.
        const following = sm[p.index];
        if (gone?.clef && following && !following.clef)
          sm[p.index] = { ...following, clef: gone.clef };
        return { ...staff, measures: sm };
      }),
    }));
    let out = pruneSlurs({ ...score, measures, parts }, removed);
    const at = Math.max(0, p.index - 1);
    forEachVoice(out, at, (a) => (out = pruneTies(out, a)));
    return out;
  });
}
