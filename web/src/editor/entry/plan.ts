/** Pure helpers of the editor store: linear event sequences, entry planning, composite commands. */
import {
  CommandError,
  decompose,
  durationTicks,
  findStaff,
  measureLength,
  nominalMeasureLength,
  voiceEventTicks,
  type Command,
  type Duration,
  type Score,
  type ScoreEvent,
} from '../../score';
import { defineCommand } from '../../score/commands/core';

/** One event of a staff voice, in reading order across measures. */
export interface SeqItem {
  readonly id: string;
  readonly event: ScoreEvent;
  readonly measure: number;
  readonly tick: number;
  readonly ticks: number;
  readonly inTuplet: boolean;
}

/** Every event of one voice of one staff, measure after measure. Linear in the score size. */
export function sequenceOf(score: Score, staffId: string, voice: number): SeqItem[] {
  const loc = findStaff(score, staffId);
  if (!loc) return [];
  const out: SeqItem[] = [];
  const measures = score.parts[loc.partIndex]!.staves[loc.staffIndex]!.measures;
  measures.forEach((sm, measure) => {
    const v = sm.voices[voice];
    if (!v) return;
    const ticks = voiceEventTicks(v);
    const tupletIds = v.tuplets.length ? new Set(v.tuplets.flatMap((t) => t.eventIds)) : null;
    let tick = 0;
    v.events.forEach((event, i) => {
      out.push({
        id: event.id,
        event,
        measure,
        tick,
        ticks: ticks[i]!,
        inTuplet: tupletIds?.has(event.id) ?? false,
      });
      tick += ticks[i]!;
    });
  });
  return out;
}

const EPS = 1e-6;

/** Index of the event that covers a cursor position (the one starting there, else containing it). */
export function indexAt(seq: readonly SeqItem[], measure: number, tick: number): number {
  return seq.findIndex(
    (s) => s.measure === measure && s.tick <= tick + EPS && tick < s.tick + s.ticks - EPS,
  );
}

/** Length in ticks of a measure that may not exist yet (appended measures copy the last one). */
export function lengthOf(score: Score, measure: number): number {
  const count = score.measures.length;
  return measure < count ? measureLength(score, measure) : nominalMeasureLength(score, count - 1);
}

export interface Piece {
  readonly measure: number;
  readonly tick: number;
  readonly duration: Duration;
}

/**
 * Splits an event of `duration` starting at (measure, tick) into the pieces that fit the
 * barlines: one piece when it fits, else the largest aligned values up to the barline, then the
 * remainder in the next measure(s). Callers tie the pieces together for notes.
 */
export function planPieces(
  score: Score,
  measure: number,
  tick: number,
  duration: Duration,
): Piece[] {
  let remaining = durationTicks(duration);
  if (tick + remaining <= lengthOf(score, measure)) return [{ measure, tick, duration }];
  const pieces: Piece[] = [];
  let m = measure;
  let t = tick;
  while (remaining > 0) {
    const space = lengthOf(score, m) - t;
    if (space <= 0) {
      m++;
      t = 0;
      continue;
    }
    const take = Math.min(space, remaining);
    let at = t;
    for (const d of decompose(take, t)) {
      pieces.push({ measure: m, tick: at, duration: d });
      at += durationTicks(d);
    }
    remaining -= take;
    m++;
    t = 0;
  }
  return pieces;
}

/**
 * Runs `required` in order, then `optional` ones that are skipped when they refuse
 * (`CommandError`). One undo step. Commands must be built once: a redo replays the same ids.
 */
export function composite(
  name: string,
  required: readonly Command[],
  optional: readonly Command[] = [],
): Command {
  return defineCommand(name, (score) => {
    let s = score;
    for (const c of required) s = c.apply(s);
    for (const c of optional) {
      try {
        s = c.apply(s);
      } catch (e) {
        if (!(e instanceof CommandError)) throw e;
      }
    }
    return s;
  });
}
