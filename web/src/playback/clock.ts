/**
 * Time maths for playback. Pure.
 *
 * "Score seconds" are seconds at 100 % tempo, following the tempo changes of the score. The real
 * duration is `score seconds / tempoScale`.
 */
import { TICKS_PER_QUARTER } from '../score';
import type { TempoSegment } from './timeline';

export interface TempoMap {
  ticksToSeconds(tick: number): number;
  secondsToTicks(seconds: number): number;
}

export function makeTempoMap(segments: readonly TempoSegment[]): TempoMap {
  const segs = segments.length ? segments : [{ tick: 0, bpm: 120 }];
  const secPerTick = segs.map((s) => 60 / (s.bpm * TICKS_PER_QUARTER));
  const startSec: number[] = [0];
  for (let i = 1; i < segs.length; i++) {
    startSec.push(startSec[i - 1]! + (segs[i]!.tick - segs[i - 1]!.tick) * secPerTick[i - 1]!);
  }
  return {
    ticksToSeconds(tick) {
      let i = segs.length - 1;
      while (i > 0 && segs[i]!.tick > tick) i--;
      return startSec[i]! + (tick - segs[i]!.tick) * secPerTick[i]!;
    },
    secondsToTicks(seconds) {
      let i = segs.length - 1;
      while (i > 0 && startSec[i]! > seconds) i--;
      return segs[i]!.tick + (seconds - startSec[i]!) / secPerTick[i]!;
    },
  };
}

export interface LoopRange {
  readonly startSec: number;
  readonly endSec: number;
}

/** Shortest loop the engine accepts (guards the scheduler against a zero-length loop). */
export const MIN_LOOP_SECONDS = 0.05;

/** Score seconds reached `elapsed` score-seconds after starting at `startSec`, wrapping in the loop. */
export function scoreSecondsAt(startSec: number, elapsed: number, loop?: LoopRange): number {
  if (!loop || loop.endSec - loop.startSec < MIN_LOOP_SECONDS) return startSec + elapsed;
  const length = loop.endSec - loop.startSec;
  const first = loop.endSec - startSec;
  if (elapsed < first) return startSec + elapsed;
  return loop.startSec + ((elapsed - first) % length);
}

export interface Leg {
  /** Elapsed score-seconds (since the start of playback) at which this leg begins. */
  readonly elapsed: number;
  /** Score-seconds range played, [from, to). */
  readonly from: number;
  readonly to: number;
}

/**
 * Splits the elapsed window [e0, e1) into legs of continuous score time: one leg without a loop,
 * several when the window crosses the loop end.
 */
export function legsBetween(startSec: number, e0: number, e1: number, loop?: LoopRange): Leg[] {
  const legs: Leg[] = [];
  const looping = loop && loop.endSec - loop.startSec >= MIN_LOOP_SECONDS;
  let e = e0;
  for (let guard = 0; e < e1 && guard < 10_000; guard++) {
    const from = scoreSecondsAt(startSec, e, loop);
    const room = looping ? loop.endSec - from : Infinity;
    const len = Math.min(e1 - e, room);
    if (len <= 0) {
      // Exactly on the loop end: the next instant is the loop start.
      e += 1e-9;
      continue;
    }
    legs.push({ elapsed: e, from, to: from + len });
    e += len;
  }
  return legs;
}

/** First index in `sorted` whose `key` is >= `value` (binary search). */
export function lowerBound<T>(
  sorted: readonly T[],
  value: number,
  key: (item: T) => number,
): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(sorted[mid]!) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Which staves are heard: solo wins over mute. */
export function audibleStaves(
  staffIds: readonly string[],
  muted: ReadonlySet<string>,
  solo: ReadonlySet<string>,
): Set<string> {
  const anySolo = staffIds.some((id) => solo.has(id));
  return new Set(staffIds.filter((id) => (anySolo ? solo.has(id) : !muted.has(id))));
}
