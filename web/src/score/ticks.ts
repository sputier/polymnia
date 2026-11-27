import type { Duration, NoteBase, TimeSignature } from './types';

/** Integer time unit. 960 is divisible by 2^n, 3 and 5, so triplets and quintuplets stay exact. */
export const TICKS_PER_QUARTER = 960;
/** Smallest unit of a measure position / measure length (a 32nd note). */
export const MIN_TICKS = 120;

const BASE_TICKS: Record<NoteBase, number> = {
  whole: 4 * TICKS_PER_QUARTER,
  half: 2 * TICKS_PER_QUARTER,
  quarter: TICKS_PER_QUARTER,
  eighth: TICKS_PER_QUARTER / 2,
  '16th': TICKS_PER_QUARTER / 4,
  '32nd': TICKS_PER_QUARTER / 8,
};

export const NOTE_BASES: readonly NoteBase[] = [
  'whole',
  'half',
  'quarter',
  'eighth',
  '16th',
  '32nd',
];

export function baseTicks(base: NoteBase): number {
  return BASE_TICKS[base];
}

/** Nominal ticks of a duration (tuplet scaling is applied separately, see voiceEventTicks). */
export function durationTicks(d: Duration): number {
  const b = BASE_TICKS[d.base];
  return (b * (2 ** (d.dots + 1) - 1)) / 2 ** d.dots;
}

export function timeSignatureTicks(t: TimeSignature): number {
  return (t.beats * 4 * TICKS_PER_QUARTER) / t.beatType;
}

/**
 * Splits `ticks` starting at measure offset `offset` into representable durations that respect the
 * beat grid: each piece is the largest undotted value aligned on its own length (a gap of 3 eighths
 * at offset 480 gives eighth + quarter). A value followed by half its length, starting aligned on
 * the larger one, is merged into a dotted value (half + quarter at offset 0 gives a dotted half).
 * Needs `ticks` and `offset` to be multiples of 120.
 */
export function decompose(ticks: number, offset: number): Duration[] {
  if (ticks % MIN_TICKS !== 0 || offset % MIN_TICKS !== 0) {
    throw new RangeError(`Cannot represent ${ticks} ticks at offset ${offset}`);
  }
  const pieces: { base: NoteBase; ticks: number; pos: number }[] = [];
  let remaining = ticks;
  let pos = offset;
  while (remaining > 0) {
    const base = NOTE_BASES.find((b) => BASE_TICKS[b] <= remaining && pos % BASE_TICKS[b] === 0)!;
    pieces.push({ base, ticks: BASE_TICKS[base], pos });
    remaining -= BASE_TICKS[base];
    pos += BASE_TICKS[base];
  }
  const out: Duration[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    if (next && next.ticks * 2 === p.ticks && p.pos % p.ticks === 0) {
      out.push({ base: p.base, dots: 1 });
      i++;
    } else out.push({ base: p.base, dots: 0 });
  }
  return out;
}
