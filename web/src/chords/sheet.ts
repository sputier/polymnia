/**
 * The chord sheet model: what a lead-sheet grid shows, built from the score. Pure (no DOM, no
 * fonts), shared by the screen view (`ChordSheet.tsx`) and the PDF/PNG export (`export/sheetPages.ts`).
 *
 * - Every measure lists the chord symbols of the score (all parts and staves, one per tick).
 * - A measure repeats the previous one (`%`) when it holds the same chords at the same positions, or
 *   when it is a single chord at the first beat that is the chord already sounding.
 * - A measure with several chords shows the beat of each (`beat` is 1 based, whole or fractional).
 */
import { formatChord, shapeOf, type ChordData } from '../score/chords';
import { diagramStrings } from '../score/diagrams';
import { partTuning } from '../score/instruments';
import { timeSignatureAt } from '../score/query';
import { TICKS_PER_QUARTER } from '../score/ticks';
import type { ChordSymbol, Part, Pitch, Score } from '../score/types';
import type { ChordShape } from './library';

/** Measures per row of the grid. */
export const SHEET_PER_ROW = 4;

export interface SheetChord {
  readonly chord: ChordSymbol;
  /** Beat of the measure, 1 based (`3`, or `2.5` for an offbeat). */
  readonly beat: number;
}

export interface SheetMeasure {
  /** Index in `score.measures` (0 based). */
  readonly index: number;
  readonly chords: readonly SheetChord[];
  /** Shown as `%`: the same as the previous measure. */
  readonly repeat: boolean;
}

/** Beat of `tick` in `measure` (the beat unit is the denominator of the time signature). */
export function beatOf(score: Score, measure: number, tick: number): number {
  const unit = (4 * TICKS_PER_QUARTER) / timeSignatureAt(score, measure).beatType;
  return Math.round((tick / unit + 1) * 100) / 100;
}

/** The chords of one measure over every part and staff, sorted by tick, one per tick (the first wins). */
function measureChords(score: Score, index: number): SheetChord[] {
  const byTick = new Map<number, ChordSymbol>();
  for (const part of score.parts)
    for (const staff of part.staves)
      for (const c of staff.measures[index]?.chords ?? [])
        if (!byTick.has(c.tick)) byTick.set(c.tick, c);
  return [...byTick.values()]
    .sort((a, b) => a.tick - b.tick)
    .map((chord) => ({ chord, beat: beatOf(score, index, chord.tick) }));
}

const signature = (chords: readonly SheetChord[]): string =>
  chords.map((c) => `${c.chord.tick}:${formatChord(c.chord)}`).join(' ');

export function buildChordSheet(score: Score): SheetMeasure[] {
  const out: SheetMeasure[] = [];
  let previous = '';
  /** The chord sounding at the end of the previous measures, as text. */
  let sounding = '';
  for (let index = 0; index < score.measures.length; index++) {
    const chords = measureChords(score, index);
    const sig = signature(chords);
    const first = chords[0];
    const repeat =
      first !== undefined &&
      (sig === previous ||
        (chords.length === 1 && first.chord.tick === 0 && formatChord(first.chord) === sounding));
    out.push({ index, chords, repeat });
    if (first !== undefined) {
      previous = sig;
      sounding = formatChord(chords[chords.length - 1]!.chord);
    } else previous = '';
  }
  return out;
}

/** The grid rows (`perRow` measures each; the last one may be shorter). */
export function sheetRows<T>(measures: readonly T[], perRow = SHEET_PER_ROW): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < measures.length; i += perRow) rows.push(measures.slice(i, i + perRow));
  return rows;
}

/** The parts that can show diagrams (guitar, ukulele...), in score order. */
export function diagramParts(score: Score): Part[] {
  return score.parts.filter((p) => diagramStrings(p) !== undefined);
}

/** The distinct chords used, in order of first appearance (a chord with its own frame is its own entry). */
export function usedChords(sheet: readonly SheetMeasure[]): ChordSymbol[] {
  const seen = new Map<string, ChordSymbol>();
  for (const m of sheet)
    for (const { chord } of m.chords) {
      const key =
        formatChord(chord) +
        (chord.frame ? `|${chord.frame.frets.join(',')}@${chord.frame.base}` : '');
      if (!seen.has(key)) seen.set(key, chord);
    }
  return [...seen.values()];
}

export type ShapeLookup = (
  chord: ChordData,
  tuning: readonly Pitch[],
  capo?: number,
) => ChordShape | undefined;

/** The diagram of a chord on a part (its own frame wins, else the library with the part's tuning and capo). */
export function shapeFor(
  chord: ChordSymbol,
  part: Part,
  lookup: ShapeLookup | undefined,
): ChordShape | undefined {
  if (chord.frame) return chord.frame;
  const tuning = partTuning(part);
  return tuning && lookup ? lookup(chord, tuning, part.capo ?? 0) : undefined;
}

/** The shape to play with a capo (`D (C)`), when the part asks for it. */
export function capoShapeOf(part: Part, chord: ChordSymbol): ChordData | undefined {
  return part.chordCapoShapes && part.capo ? shapeOf(chord, part.capo) : undefined;
}
