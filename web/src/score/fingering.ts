/**
 * Automatic fingering of fretted instruments (guitar, ukulele...): chooses a string and a fret for
 * every pitch of a sequence of notes and chords so the fretting hand moves as little as possible.
 * Pure: MIDI numbers in, `{ string, fret }` out. No Score types, so it is easy to test and to bench.
 *
 * What it optimizes (see `docs/score-format.md`, "Fingering"):
 * - stay near the previous hand position (the lowest fretted fret of the previous event; open
 *   strings do not move the hand, the position carries over them);
 * - prefer open strings and low positions when nothing forces otherwise;
 * - respect the stretch of the hand: the fretted notes of one chord span at most 4 frets (5 with a
 *   penalty); one note per string;
 * - chords keep their strings close together (no needless skipped strings);
 * - re-entrant tunings (ukulele G C E A) need no special case: strings are only looked up by pitch.
 *
 * The result is a global optimum of the sequence (Viterbi over a few candidates per event). Events
 * whose fretting the user chose are passed as `fixed` and never change; they anchor their neighbours.
 */
import type { Fretting } from './types';

export interface Fretboard {
  /** Sounding MIDI number of each open string, high string to low string (string 1 first). */
  readonly open: readonly number[];
  /** Capo fret: frets are counted from the capo (fret 0 = the capoed string). */
  readonly capo: number;
  /** Highest playable fret (counted from the capo). */
  readonly frets: number;
}

export interface FingerItem {
  /** Sounding MIDI numbers of the notes played together (a single note or a chord). */
  readonly midis: readonly number[];
  /** Frettings the user chose, parallel to `midis` (undefined entries are free). */
  readonly fixed?: readonly (Fretting | undefined)[];
}

export interface FingerOptions {
  /** Widest span, in frets, of the fretted notes of one chord (default 4). */
  readonly maxStretch?: number;
}

const BEAM = 8;
const STRETCH_PENALTY = [0, 0, 0, 0.3, 1.2];
const OVER_STRETCH = 60;
const FRETTED = 0.35;
const FRET_COST = 0.12;
const MOVE_COST = 1;
const MOVE_FREE = 1;
const STRING_COST = 0.15;
const SKIPPED_STRING = 0.45;
const OPEN_IN_POSITION = 0.4;

interface Candidate {
  /** Fretting of each pitch of the item (undefined: this pitch cannot be played). */
  readonly picks: readonly (Fretting | undefined)[];
  readonly cost: number;
  /** Lowest fretted fret, or null when every note is an open string. */
  readonly anchor: number | null;
  readonly strings: number;
}

interface State {
  readonly cand: Candidate;
  total: number;
  prev: number;
  /** Hand position after this state along its best path. */
  hand: number | null;
}

/** All the ways to play the pitches of an item, cheapest first (at most `BEAM`). */
function candidatesFor(board: Fretboard, item: FingerItem, maxStretch: number): Candidate[] {
  const n = item.midis.length;
  const strings = board.open.length;
  // Options per pitch: [string index, fret].
  const options: [number, number][][] = item.midis.map((midi, k) => {
    const fixed = item.fixed?.[k];
    if (fixed) return [[fixed.string - 1, fixed.fret]];
    const out: [number, number][] = [];
    for (let s = 0; s < strings; s++) {
      const fret = midi - board.open[s]! - board.capo;
      if (fret >= 0 && fret <= board.frets) out.push([s, fret]);
    }
    return out;
  });
  // Pitches nobody can play are left out of the search and reported as undefined.
  const playable = options.map((o, k) => (o.length ? k : -1)).filter((k) => k >= 0);
  // Fewest options first: prunes the search early.
  const order = playable.slice().sort((a, b) => options[a]!.length - options[b]!.length);
  const found: { picks: (Fretting | undefined)[]; cost: number }[] = [];
  const picks: ([number, number] | undefined)[] = new Array<[number, number] | undefined>(n).fill(
    undefined,
  );
  const used = new Array<boolean>(strings).fill(false);

  const score = (): number => {
    let lo = Infinity;
    let hi = -Infinity;
    let fretted = 0;
    let cost = 0;
    let minString = Infinity;
    let maxString = -Infinity;
    let count = 0;
    for (const p of picks) {
      if (!p) continue;
      count++;
      minString = Math.min(minString, p[0]);
      maxString = Math.max(maxString, p[0]);
      if (p[1] > 0) {
        fretted++;
        lo = Math.min(lo, p[1]);
        hi = Math.max(hi, p[1]);
        cost += FRETTED + FRET_COST * p[1];
      }
    }
    if (fretted > 1) {
      const span = hi - lo;
      cost +=
        span <= maxStretch
          ? (STRETCH_PENALTY[span] ?? 1.2)
          : span === maxStretch + 1
            ? 4
            : OVER_STRETCH + span;
    }
    if (count > 1) cost += SKIPPED_STRING * (maxString - minString + 1 - count);
    return cost;
  };

  const walk = (i: number): void => {
    if (found.length > 4000) return;
    if (i === order.length) {
      found.push({
        picks: picks.map((p) => (p ? { string: p[0] + 1, fret: p[1] } : undefined)),
        cost: score(),
      });
      return;
    }
    const k = order[i]!;
    for (const o of options[k]!) {
      if (used[o[0]]) continue;
      used[o[0]] = true;
      picks[k] = o;
      walk(i + 1);
      picks[k] = undefined;
      used[o[0]] = false;
    }
  };
  walk(0);

  if (!found.length) {
    // More pitches than free strings: the cheapest pitches get a string, the rest stay unplayable.
    const taken = new Array<boolean>(strings).fill(false);
    const out: (Fretting | undefined)[] = new Array<Fretting | undefined>(n).fill(undefined);
    for (const k of order) {
      const best = options[k]!.filter((o) => !taken[o[0]]).sort((a, b) => a[1] - b[1])[0];
      if (!best) continue;
      taken[best[0]] = true;
      out[k] = { string: best[0] + 1, fret: best[1] };
    }
    return [toCandidate(out, 100)];
  }

  found.sort((a, b) => a.cost - b.cost);
  return found.slice(0, BEAM).map((f) => toCandidate(f.picks, f.cost));
}

function toCandidate(picks: (Fretting | undefined)[], cost: number): Candidate {
  let anchor: number | null = null;
  for (const p of picks)
    if (p && p.fret > 0) anchor = anchor === null ? p.fret : Math.min(anchor, p.fret);
  let mean = 0;
  let count = 0;
  for (const p of picks) {
    if (p) {
      mean += p.string;
      count++;
    }
  }
  return { picks, cost, anchor, strings: count ? mean / count : 0 };
}

function transition(from: State, to: Candidate): number {
  let cost = Math.abs(from.cand.strings - to.strings) * STRING_COST;
  if (to.anchor !== null && from.hand !== null) {
    const d = Math.abs(to.anchor - from.hand);
    cost += Math.max(0, d - MOVE_FREE) * MOVE_COST + d * 0.2;
  } else if (to.anchor === null && from.hand !== null && from.hand > 3) {
    // An open string in the middle of a high position is rarely the natural choice.
    cost += Math.min(2.5, OPEN_IN_POSITION * (from.hand - 3));
  }
  return cost;
}

/**
 * Frettings of every pitch of every item (`undefined` where a pitch is out of the instrument's
 * reach). Same length and order as `items`; `fixed` frettings come back unchanged.
 */
export function fingerSequence(
  board: Fretboard,
  items: readonly FingerItem[],
  options: FingerOptions = {},
): (Fretting | undefined)[][] {
  const maxStretch = options.maxStretch ?? 4;
  const layers: State[][] = [];
  for (let i = 0; i < items.length; i++) {
    const cands = candidatesFor(board, items[i]!, maxStretch);
    const prev = layers[i - 1];
    layers.push(
      cands.map((cand): State => {
        if (!prev) return { cand, total: cand.cost, prev: -1, hand: cand.anchor };
        let best = 0;
        let bestTotal = Infinity;
        for (let j = 0; j < prev.length; j++) {
          const t = prev[j]!.total + transition(prev[j]!, cand);
          if (t < bestTotal) {
            bestTotal = t;
            best = j;
          }
        }
        return {
          cand,
          total: bestTotal + cand.cost,
          prev: best,
          hand: cand.anchor ?? prev[best]!.hand,
        };
      }),
    );
  }
  const out: (Fretting | undefined)[][] = new Array<(Fretting | undefined)[]>(items.length);
  let at = -1;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    if (at < 0) {
      at = 0;
      for (let j = 1; j < layer.length; j++) if (layer[j]!.total < layer[at]!.total) at = j;
    }
    const state = layer[at]!;
    out[i] = state.cand.picks.slice();
    at = state.prev;
  }
  return out;
}

/** Fingering of a single note given the previous hand position (the lowest fretted fret) if known. */
export function fingerNote(
  board: Fretboard,
  midi: number,
  previous?: Fretting,
): Fretting | undefined {
  const items: FingerItem[] = previous
    ? [
        {
          midis: [board.open[previous.string - 1]! + board.capo + previous.fret],
          fixed: [previous],
        },
      ]
    : [];
  items.push({ midis: [midi] });
  return fingerSequence(board, items)[items.length - 1]![0];
}
