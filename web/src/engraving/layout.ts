/**
 * Layout engine (pure, no VexFlow, no DOM). Turns a score and an available width into systems:
 * each measure gets a width from its content, measures are packed greedily into systems that fit,
 * systems are justified, and every event gets an x position from proportional spacing.
 *
 * Per-measure work (columns, minimum width) is cached: an edit only recomputes the measures whose
 * staff measures changed (the score model shares unchanged objects by reference).
 */
import { getInstrument, shortPartName } from '../score/instruments';
import { clefAt, keyFifthsAt, measureLength, timeSignatureAt } from '../score/query';
import type {
  Clef,
  NoteEvent,
  Part,
  Score,
  ScoreEvent,
  Staff,
  StaffMeasure,
  StaffType,
  TimeSignature,
} from '../score/types';
import { getChordNaming } from './chordNaming';
import { DIAGRAM_BAND, chordWidth, diagramPlan, diagramStrings, CHORD } from './chords';
import {
  STAFF_SPACE,
  TAB_SPACE,
  accidentalsFor,
  eventTicks,
  hasSecond,
  stepIndex,
  tickKey,
  tieInFrom,
  yOfStep,
} from './notation';

export const METRICS = {
  marginX: 10,
  bracket: 16,
  nameGap: 8,
  nameChar: 6.6,
  nameMax: 150,
  clef: 38,
  clefSmall: 28,
  keyBase: 8,
  keyPer: 10,
  time: 26,
  timeWide: 42,
  padLeft: 8,
  padRight: 6,
  minNoteArea: 40,
  /** Spacing curve: stretchBase + stretchPer * log2(gap / 120 + 1), gap in ticks. */
  stretchBase: 1,
  stretchPer: 8,
  /** Notehead (Bravura, 1.18 staff space) plus a minimum gap to the next column. */
  head: 13,
  dot: 6,
  second: 10,
  flag: 4,
  accidentalBase: 3,
  accidentalPer: 10,
  topPad: 36,
  bottomPad: 32,
  staffGap: 48,
  partGap: 56,
  systemGap: 6,
  /** A last system fuller than this ratio of the line is justified; a shorter one is left alone. */
  lastSystemFull: 0.6,
} as const;

export interface StaffSlot {
  readonly partIndex: number;
  readonly staffIndex: number;
  readonly partId: string;
  readonly staffId: string;
  readonly type: StaffType;
  readonly lines: number;
  readonly space: number;
  /** Y of the top staff line, relative to the top of the system. */
  readonly top: number;
  readonly height: number;
  /** Fretboard diagrams are drawn above this staff (room is reserved above it). */
  readonly diagrams: boolean;
  /** Baseline of the chord symbols, relative to the top of the system. */
  readonly chordY: number;
  /** Top of the fretboard diagrams, relative to the top of the system (diagrams only). */
  readonly diagramY: number;
}

export interface Column {
  readonly tick: number;
  /** Space before the notehead (accidentals). */
  readonly lead: number;
  /** Notehead, dots, displaced second, flag. */
  readonly glyph: number;
  /** Proportional space after, from the time to the next column. */
  readonly stretch: number;
}

/** A chord symbol of a staff measure, placed on a column. */
export interface ChordSlot {
  readonly id: string;
  readonly tick: number;
  readonly col: number;
  /** Room the symbol (and its diagram) needs, px. */
  readonly width: number;
  /** A fretboard diagram is drawn with it. */
  readonly diagram: boolean;
}

export interface EventSlot {
  readonly id: string;
  readonly kind: ScoreEvent['kind'];
  readonly voice: number;
  readonly tick: number;
  readonly col: number;
  /** Diatonic indices of the pitches (standard staves). */
  readonly steps: readonly number[];
  /** Strings of the pitches (tab staves), 1 = highest. */
  readonly strings: readonly number[];
  readonly accidentals: number;
}

export interface MeasureShape {
  readonly columns: readonly Column[];
  readonly colByTick: ReadonlyMap<number, number>;
  /** Sum of lead + glyph. */
  readonly fixed: number;
  /** Sum of stretch. */
  readonly stretch: number;
  /** Events of each staff slot (flat index over parts and staves). */
  readonly staves: readonly (readonly EventSlot[])[];
  /** Chord symbols of each staff slot (empty list when the staff has none here). */
  readonly chords: readonly (readonly ChordSlot[])[];
  /** Only rests: the rest is centered in the measure. */
  readonly restOnly: boolean;
}

export interface StartMods {
  /** Clef drawn at the start: full size at a system start, small for a mid-system change. */
  readonly clef: 'full' | 'small' | null;
  readonly key: number | null;
  /** Previous key to cancel with naturals (mid-system key changes only). */
  readonly cancelKey: number | null;
  readonly time: TimeSignature | null;
  readonly width: number;
}

/** Courtesy changes at the end of a system, announcing the next system's first measure. */
export interface EndMods {
  readonly clef: boolean;
  readonly key: number | null;
  readonly cancelKey: number | null;
  readonly time: TimeSignature | null;
  readonly width: number;
}

export interface PlacedMeasure {
  readonly index: number;
  readonly id: string;
  readonly x: number;
  readonly width: number;
  readonly noteStartX: number;
  readonly noteEndX: number;
  readonly start: StartMods;
  readonly end: EndMods | null;
  readonly shape: MeasureShape;
  /** X of the notehead of each column, relative to the system's left edge of the page. */
  readonly colX: readonly number[];
  readonly keyFifths: number;
  readonly time: TimeSignature;
  /** Clef in force for each staff slot. */
  readonly clefs: readonly Clef[];
  readonly final: boolean;
}

export interface SystemLayout {
  readonly index: number;
  readonly y: number;
  readonly height: number;
  readonly x: number;
  readonly right: number;
  readonly firstMeasure: number;
  readonly lastMeasure: number;
  readonly measures: readonly PlacedMeasure[];
  readonly staves: readonly StaffSlot[];
  /** Part names are drawn at the left: full on the first system, abbreviated on the others. */
  readonly names: boolean;
  readonly shortNames: boolean;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly systems: readonly SystemLayout[];
  readonly staves: readonly StaffSlot[];
}

interface CachedShape {
  readonly refs: readonly StaffMeasure[];
  readonly ctx: string;
  readonly shape: MeasureShape;
}

/** Reused between calls so unchanged measures are not recomputed. */
export class LayoutCache {
  readonly shapes = new Map<number, CachedShape>();
}

export function staffSlots(
  score: Score,
  plan: ReadonlySet<string> = diagramPlan(score),
): StaffSlot[] {
  const slots: StaffSlot[] = [];
  let y: number = METRICS.topPad;
  score.parts.forEach((part, partIndex) => {
    part.staves.forEach((staff, staffIndex) => {
      const lines = staff.type === 'tab' ? tabLines(part) : 5;
      const space = staff.type === 'tab' ? TAB_SPACE : STAFF_SPACE;
      const height = (lines - 1) * space;
      // Diagrams need room above the staff; symbols alone fit in the usual gap.
      const diagrams =
        plan.size > 0 && staff.measures.some((sm) => sm.chords?.some((c) => plan.has(c.id)));
      if (diagrams) y += DIAGRAM_BAND;
      slots.push({
        partIndex,
        staffIndex,
        partId: part.id,
        staffId: staff.id,
        type: staff.type,
        lines,
        space,
        top: y,
        height,
        diagrams,
        chordY: y - CHORD.baseline - (diagrams ? DIAGRAM_BAND : 0),
        diagramY: y - CHORD.clearance - (DIAGRAM_BAND - 4),
      });
      const last = staffIndex === part.staves.length - 1;
      y += height + (last ? METRICS.partGap : METRICS.staffGap);
    });
  });
  return slots;
}

function tabLines(part: Part): number {
  return part.tuning?.length ?? getInstrument(part.instrument)?.strings?.length ?? 6;
}

/** Bottom of the last staff + padding: height of a system. */
function systemHeight(slots: readonly StaffSlot[]): number {
  const last = slots[slots.length - 1];
  return last ? last.top + last.height + METRICS.bottomPad : METRICS.topPad + METRICS.bottomPad;
}

export function stretchFor(gapTicks: number): number {
  return METRICS.stretchBase + METRICS.stretchPer * Math.log2(gapTicks / 120 + 1);
}

function keyChangeWidth(fifths: number, cancelKey: number | null): number {
  let w = fifths === 0 ? 0 : METRICS.keyBase + METRICS.keyPer * Math.abs(fifths);
  if (cancelKey !== null) {
    const n = cancelCount(cancelKey, fifths);
    if (n > 0) w += METRICS.keyBase + METRICS.keyPer * n;
  }
  return w;
}

/** Number of naturals needed to go from key `from` to key `to`. */
export function cancelCount(from: number, to: number): number {
  if (from === 0) return 0;
  if (Math.sign(from) !== Math.sign(to) || to === 0) return Math.abs(from);
  return Math.max(0, Math.abs(from) - Math.abs(to));
}

function timeWidth(t: TimeSignature): number {
  return t.beats >= 10 || t.beatType >= 10 ? METRICS.timeWide : METRICS.time;
}

function sameTime(a: TimeSignature, b: TimeSignature): boolean {
  return a.beats === b.beats && a.beatType === b.beatType;
}

function noteSlot(event: NoteEvent, voice: number, tick: number, col: number): EventSlot {
  return {
    id: event.id,
    kind: 'note',
    voice,
    tick,
    col,
    steps: event.pitches.map(stepIndex),
    strings: event.pitches.map((p) => p.fretting?.string ?? 0),
    accidentals: 0,
  };
}

/** Columns and widths of one measure (all staves together, so staves stay aligned). */
export function computeShape(
  score: Score,
  measure: number,
  slots: readonly StaffSlot[],
  refs: readonly StaffMeasure[],
  plan: ReadonlySet<string> = new Set(),
): MeasureShape {
  const key = keyFifthsAt(score, measure);
  const length = measureLength(score, measure);
  interface Raw {
    tick: number;
    ticks: number;
    lead: number;
    glyph: number;
  }
  const byTick = new Map<number, Raw>();
  const touch = (tick: number): Raw => {
    const k = tickKey(tick);
    let raw = byTick.get(k);
    if (!raw) {
      raw = { tick: k, ticks: 0, lead: 0, glyph: METRICS.head };
      byTick.set(k, raw);
    }
    return raw;
  };
  /** A column that only carries a chord symbol: no notehead, so no glyph width. */
  const touchChord = (tick: number): void => {
    const k = tickKey(tick);
    if (!byTick.has(k)) byTick.set(k, { tick: k, ticks: 0, lead: 0, glyph: 0 });
  };
  const staffEvents: { event: ScoreEvent; voice: number; tick: number }[][] = slots.map(() => []);

  slots.forEach((slot, s) => {
    const sm = refs[s]!;
    const tab = slot.type === 'tab';
    const prev =
      measure > 0
        ? score.parts[slot.partIndex]!.staves[slot.staffIndex]!.measures[measure - 1]
        : undefined;
    const acc = tab ? undefined : accidentalsFor(sm, key, tieInFrom(prev));
    sm.voices.forEach((voice, v) => {
      const ticks = eventTicks(voice);
      let pos = 0;
      voice.events.forEach((event, i) => {
        const raw = touch(pos);
        staffEvents[s]!.push({ event, voice: v, tick: pos });
        const dots = event.duration.dots;
        let glyph: number = METRICS.head + dots * METRICS.dot;
        if (
          event.duration.base === 'eighth' ||
          event.duration.base === '16th' ||
          event.duration.base === '32nd'
        )
          glyph += METRICS.flag;
        if (event.kind === 'note') {
          if (!tab && hasSecond(event.pitches)) glyph += METRICS.second;
          const n = acc?.get(event.id)?.filter((g) => g !== null).length ?? 0;
          if (n > 0) {
            raw.lead = Math.max(
              raw.lead,
              METRICS.accidentalBase + METRICS.accidentalPer * Math.min(n, 3),
            );
          }
        }
        raw.glyph = Math.max(raw.glyph, glyph);
        pos += ticks[i]!;
      });
    });
  });

  // Chord symbols: each sits on a column (a chord between two notes gets a column of its own, with
  // no glyph) and keeps clear of the next symbol of its staff and of the end of the measure.
  const chordLists: { id: string; tick: number; width: number; diagram: boolean }[][] = slots.map(
    (slot, s) => {
      const chords = refs[s]!.chords;
      if (!chords) return [];
      const part = score.parts[slot.partIndex]!;
      return chords.map((c) => {
        const diagram = plan.has(c.id);
        touchChord(c.tick);
        return {
          id: c.id,
          tick: tickKey(c.tick),
          width: chordWidth(c, { part, diagram }),
          diagram,
        };
      });
    },
  );

  const ordered = [...byTick.values()].sort((a, b) => a.tick - b.tick);
  if (chordLists.some((l) => l.length > 0)) {
    const index = new Map(ordered.map((r, i) => [r.tick, i]));
    for (const list of chordLists) {
      list.forEach((c, i) => {
        const from = index.get(c.tick)!;
        const nextChord = list[i + 1];
        const to = nextChord ? index.get(nextChord.tick)! : ordered.length;
        // Distance between the notehead x of the two columns, without the proportional space.
        let room = nextChord ? 0 : METRICS.padRight;
        for (let k = from; k < to; k++) {
          room += ordered[k]!.glyph;
          if (k > from) room += ordered[k]!.lead;
        }
        if (nextChord) room += ordered[to]!.lead;
        const need = c.width + CHORD.gap;
        if (room < need) ordered[to - 1]!.glyph += need - room;
      });
    }
  }
  const columns: Column[] = ordered.map((raw, i) => {
    const next = ordered[i + 1]?.tick ?? length;
    return {
      tick: raw.tick,
      lead: raw.lead,
      glyph: raw.glyph,
      stretch: stretchFor(Math.max(next - raw.tick, 120)),
    };
  });
  const colByTick = new Map<number, number>(columns.map((c, i) => [c.tick, i]));
  const eventSlots = staffEvents.map((list, s) =>
    list.map(({ event, voice, tick }) => {
      const col = colByTick.get(tickKey(tick))!;
      if (event.kind === 'rest') {
        return {
          id: event.id,
          kind: 'rest' as const,
          voice,
          tick,
          col,
          steps: [],
          strings: [],
          accidentals: 0,
        };
      }
      void s;
      return noteSlot(event, voice, tick, col);
    }),
  );
  return {
    columns,
    colByTick,
    fixed: columns.reduce((sum, c) => sum + c.lead + c.glyph, 0),
    stretch: columns.reduce((sum, c) => sum + c.stretch, 0),
    staves: eventSlots,
    chords: chordLists.map((list) =>
      list.map((c) => ({
        id: c.id,
        tick: c.tick,
        col: colByTick.get(c.tick)!,
        width: c.width,
        diagram: c.diagram,
      })),
    ),
    restOnly:
      columns.length === 1 &&
      chordLists.every((l) => l.length === 0) &&
      eventSlots.every((l) => l.every((e) => e.kind === 'rest')),
  };
}

function shapeKey(
  score: Score,
  measure: number,
  slots: readonly StaffSlot[],
  plan: ReadonlySet<string>,
): string {
  const t = timeSignatureAt(score, measure);
  const clefs = slots.map((s) => {
    const staff = score.parts[s.partIndex]!.staves[s.staffIndex]!;
    return clefAt(staff, measure);
  });
  // Chord symbols widen the measure: what decides their width is part of the cache identity.
  const chords = slots
    .map((s) => {
      const sm = score.parts[s.partIndex]!.staves[s.staffIndex]!.measures[measure]!;
      if (!sm.chords) return '';
      const part = score.parts[s.partIndex]!;
      const flags = sm.chords.map((c) => (plan.has(c.id) ? 1 : 0)).join('');
      return `${flags}/${diagramStrings(part) ?? 0}/${part.capo ?? 0}/${part.chordCapoShapes ? 1 : 0}/${getChordNaming()}`;
    })
    .join(',');
  return `${keyFifthsAt(score, measure)}|${t.beats}/${t.beatType}|${measureLength(score, measure)}|${clefs.join(',')}|${chords}`;
}

function staffMeasureRefs(
  score: Score,
  measure: number,
  slots: readonly StaffSlot[],
): StaffMeasure[] {
  return slots.map((s) => score.parts[s.partIndex]!.staves[s.staffIndex]!.measures[measure]!);
}

function getShape(
  score: Score,
  measure: number,
  slots: readonly StaffSlot[],
  cache: LayoutCache,
  plan: ReadonlySet<string>,
): MeasureShape {
  const refs = staffMeasureRefs(score, measure, slots);
  const prevRefs = measure > 0 ? staffMeasureRefs(score, measure - 1, slots) : [];
  // Accidentals depend on the previous measure only through ties: include it in the cache identity.
  const all = [...refs, ...prevRefs];
  const ctx = shapeKey(score, measure, slots, plan);
  const hit = cache.shapes.get(measure);
  if (
    hit &&
    hit.ctx === ctx &&
    hit.refs.length === all.length &&
    hit.refs.every((r, i) => r === all[i])
  ) {
    return hit.shape;
  }
  const shape = computeShape(score, measure, slots, refs, plan);
  cache.shapes.set(measure, { refs: all, ctx, shape });
  return shape;
}

function shapeMinNoteArea(shape: MeasureShape): number {
  return Math.max(
    METRICS.minNoteArea,
    METRICS.padLeft + shape.fixed + shape.stretch + METRICS.padRight,
  );
}

function nameBlock(score: Score, short = false): number {
  let max = 0;
  for (const p of score.parts) {
    const text = short ? shortPartName(p) : p.name;
    max = Math.max(max, Math.min(text.length * METRICS.nameChar, METRICS.nameMax));
  }
  return max;
}

function hasBracket(score: Score): boolean {
  return score.parts.length > 1 || score.parts.some((p) => p.staves.length > 1);
}

function startMods(
  score: Score,
  measure: number,
  slots: readonly StaffSlot[],
  systemStart: boolean,
): StartMods {
  const key = keyFifthsAt(score, measure);
  const time = timeSignatureAt(score, measure);
  const prevKey = measure > 0 ? keyFifthsAt(score, measure - 1) : key;
  const prevTime = measure > 0 ? timeSignatureAt(score, measure - 1) : time;
  const keyChanged = measure > 0 && key !== prevKey;
  const timeChanged = measure === 0 || !sameTime(time, prevTime);
  const clefChanged =
    measure > 0 &&
    slots.some((s) => {
      if (s.type === 'tab') return false;
      const staff = score.parts[s.partIndex]!.staves[s.staffIndex]!;
      return clefAt(staff, measure) !== clefAt(staff, measure - 1);
    });
  const clef = systemStart ? 'full' : clefChanged ? 'small' : null;
  const showKey = systemStart ? key !== 0 || false : keyChanged;
  const cancel = !systemStart && keyChanged ? prevKey : null;
  const keyOut = showKey || (keyChanged && key === 0) ? key : null;
  const showTime = timeChanged;
  let width = 0;
  if (clef === 'full') width += METRICS.clef;
  else if (clef === 'small') width += METRICS.clefSmall;
  if (keyOut !== null) width += keyChangeWidth(keyOut, cancel);
  if (showTime) width += timeWidth(time);
  return { clef, key: keyOut, cancelKey: cancel, time: showTime ? time : null, width };
}

function endMods(score: Score, next: number, slots: readonly StaffSlot[]): EndMods | null {
  const key = keyFifthsAt(score, next);
  const prevKey = keyFifthsAt(score, next - 1);
  const time = timeSignatureAt(score, next);
  const prevTime = timeSignatureAt(score, next - 1);
  const keyChanged = key !== prevKey;
  const timeChanged = !sameTime(time, prevTime);
  const clefChanged = slots.some((s) => {
    if (s.type === 'tab') return false;
    const staff = score.parts[s.partIndex]!.staves[s.staffIndex]!;
    return clefAt(staff, next) !== clefAt(staff, next - 1);
  });
  if (!keyChanged && !timeChanged && !clefChanged) return null;
  let width = 0;
  if (clefChanged) width += METRICS.clefSmall;
  if (keyChanged) width += keyChangeWidth(key, prevKey);
  if (timeChanged) width += timeWidth(time);
  return {
    clef: clefChanged,
    key: keyChanged ? key : null,
    cancelKey: keyChanged ? prevKey : null,
    time: timeChanged ? time : null,
    width,
  };
}

function colPositions(shape: MeasureShape, noteStartX: number, noteEndX: number): number[] {
  const area = noteEndX - noteStartX;
  const natural = METRICS.padLeft + shape.fixed + METRICS.padRight;
  const factor = shape.stretch > 0 ? Math.max(0, (area - natural) / shape.stretch) : 0;
  if (shape.restOnly) return [(noteStartX + noteEndX) / 2 - METRICS.head / 2];
  const out: number[] = [];
  let x = noteStartX + METRICS.padLeft;
  for (const c of shape.columns) {
    out.push(x + c.lead);
    x += c.lead + c.glyph + c.stretch * factor;
  }
  return out;
}

export function layoutScore(
  score: Score,
  options: { width: number },
  cache: LayoutCache = new LayoutCache(),
): Layout {
  const plan = diagramPlan(score);
  const slots = staffSlots(score, plan);
  const sysHeight = systemHeight(slots);
  const count = score.measures.length;
  const names = nameBlock(score);
  const shortNames = nameBlock(score, true);
  const bracket = hasBracket(score) ? METRICS.bracket : 0;
  const firstX = METRICS.marginX + (names > 0 ? names + METRICS.nameGap : 0) + bracket;
  const otherX = METRICS.marginX + (shortNames > 0 ? shortNames + METRICS.nameGap : 0) + bracket;
  const right = Math.max(options.width - METRICS.marginX, firstX + METRICS.minNoteArea);

  const shapes: MeasureShape[] = [];
  for (let m = 0; m < count; m++) shapes.push(getShape(score, m, slots, cache, plan));
  for (const k of [...cache.shapes.keys()]) if (k >= count) cache.shapes.delete(k);

  const systems: SystemLayout[] = [];
  let m = 0;
  let y = 0;
  while (m < count) {
    const first = systems.length === 0;
    const x = first ? firstX : otherX;
    const avail = right - x;
    // Greedy packing: natural widths (start modifiers included for the first measure).
    const start0 = startMods(score, m, slots, true);
    let used = 0;
    let last = m;
    const widths: number[] = [];
    for (let k = m; k < count; k++) {
      const mods = k === m ? start0 : startMods(score, k, slots, false);
      const w = mods.width + shapeMinNoteArea(shapes[k]!);
      if (k > m && used + w > avail) break;
      used += w;
      widths.push(w);
      last = k;
    }
    // A courtesy change announcing the next system needs room at the end of this one.
    let end: EndMods | null = null;
    if (last + 1 < count) {
      end = endMods(score, last + 1, slots);
      while (end && used + end.width > avail && last > m) {
        used -= widths.pop()!;
        last--;
        end = endMods(score, last + 1, slots);
      }
    }
    const endWidth = end?.width ?? 0;
    const free = avail - used - endWidth;
    const isLast = last === count - 1;
    // Justify: spread the free space in proportion to each measure's note area.
    const noteAreas = widths.map(
      (w, i) => w - (i === 0 ? start0.width : startMods(score, m + i, slots, false).width),
    );
    const areaTotal = noteAreas.reduce((a, b) => a + b, 0);
    let scale = free > 0 ? 1 + free / areaTotal : 1;
    if (isLast && (used + endWidth) / avail < METRICS.lastSystemFull) scale = 1;
    // A single measure wider than the page: squeeze the proportional space, keep the glyph room.
    let squeeze = 1;
    if (free < 0) {
      const fixedTotal = shapes
        .slice(m, last + 1)
        .reduce((sum, s) => sum + METRICS.padLeft + s.fixed + METRICS.padRight, 0);
      const stretchTotal = shapes.slice(m, last + 1).reduce((sum, s) => sum + s.stretch, 0);
      squeeze = stretchTotal > 0 ? Math.max(0, (areaTotal + free - fixedTotal) / stretchTotal) : 0;
    }

    const placed: PlacedMeasure[] = [];
    let cx = x;
    for (let i = 0; i <= last - m; i++) {
      const k = m + i;
      const mods = i === 0 ? start0 : startMods(score, k, slots, false);
      const area =
        free < 0
          ? METRICS.padLeft + shapes[k]!.fixed + METRICS.padRight + shapes[k]!.stretch * squeeze
          : noteAreas[i]! * scale;
      const isEnd = k === last;
      const courtesy = isEnd ? end : null;
      const width = mods.width + area + (isEnd ? (courtesy?.width ?? 0) : 0);
      const noteStartX = cx + mods.width;
      const noteEndX = cx + width - (courtesy?.width ?? 0);
      const shape = shapes[k]!;
      placed.push({
        index: k,
        id: score.measures[k]!.id,
        x: cx,
        width,
        noteStartX,
        noteEndX,
        start: mods,
        end: courtesy,
        shape,
        colX: colPositions(shape, noteStartX, noteEndX),
        keyFifths: keyFifthsAt(score, k),
        time: timeSignatureAt(score, k),
        clefs: slots.map((s) => clefAt(score.parts[s.partIndex]!.staves[s.staffIndex]!, k)),
        final: k === count - 1,
      });
      cx += width;
    }
    systems.push({
      index: systems.length,
      y,
      height: sysHeight,
      x,
      right: cx,
      firstMeasure: m,
      lastMeasure: last,
      measures: placed,
      staves: slots,
      names: first ? names > 0 : shortNames > 0,
      shortNames: !first,
    });
    y += sysHeight + METRICS.systemGap;
    m = last + 1;
  }
  return { width: options.width, height: y, systems, staves: slots };
}

/** Y (relative to the system top) of the pitch position `step` on a staff slot. */
export function stepY(slot: StaffSlot, clef: Clef, step: number): number {
  return slot.top + yOfStep(step, clef, slot.space);
}

export function slotsOf(score: Score): readonly Staff[] {
  return score.parts.flatMap((p) => p.staves);
}
