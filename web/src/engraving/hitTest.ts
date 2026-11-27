/** Hit testing and event bounding boxes, computed from the layout alone (no DOM, no VexFlow). */
import type { Pitch } from '../score/types';
import { CHORD, DIAGRAM_HEIGHT } from './chords';
import { pitchAtY, yOfStep } from './notation';
import type { EventSlot, Layout, PlacedMeasure, StaffSlot, SystemLayout } from './layout';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface EventBox extends Rect {
  readonly eventId: string;
  readonly partId: string;
  readonly staffId: string;
  readonly measureIndex: number;
}

export interface HitResult {
  readonly systemIndex: number;
  readonly partId: string;
  readonly staffId: string;
  readonly measureIndex: number;
  /** Event under the point, when there is one. */
  readonly eventId?: string;
  /** Tick (offset in the measure) of the column nearest to the point: where a click enters a note. */
  readonly tick?: number;
  /** String under the point, 1 = highest (tab staves only). */
  readonly string?: number;
  /** Natural pitch on the staff line or space under the point (standard staves only). */
  readonly pitch?: Pitch;
  /** Chord symbol (or its diagram) under the point; `staffId` is then the staff that carries it. */
  readonly chord?: { readonly id: string; readonly tick: number };
}

const HEAD_W = 14;
const PAD_X = 4;
const PAD_Y = 5;

function slotBox(
  system: SystemLayout,
  slot: StaffSlot,
  m: PlacedMeasure,
  slotIndex: number,
  e: EventSlot,
): EventBox {
  const x = m.colX[e.col]!;
  const clef = m.clefs[slotIndex]!;
  let top: number;
  let bottom: number;
  if (slot.type === 'tab') {
    const strings = e.strings.filter((s) => s > 0);
    const lo = strings.length ? Math.min(...strings) : 1;
    const hi = strings.length ? Math.max(...strings) : slot.lines;
    top = slot.top + (lo - 1) * slot.space - slot.space / 2;
    bottom = slot.top + (hi - 1) * slot.space + slot.space / 2;
  } else if (e.kind === 'rest') {
    top = slot.top + slot.height / 2 - slot.space;
    bottom = slot.top + slot.height / 2 + slot.space;
  } else {
    const ys = e.steps.map((s) => slot.top + yOfStep(s, clef, slot.space));
    top = Math.min(...ys) - slot.space / 2;
    bottom = Math.max(...ys) + slot.space / 2;
  }
  return {
    eventId: e.id,
    partId: slot.partId,
    staffId: slot.staffId,
    measureIndex: m.index,
    x,
    y: system.y + top,
    w: HEAD_W,
    h: bottom - top,
  };
}

/** Bounding box of every event of the layout (for selection and playback highlighting). */
export function eventBoxes(layout: Layout): EventBox[] {
  const out: EventBox[] = [];
  for (const system of layout.systems) {
    for (const m of system.measures) {
      system.staves.forEach((slot, s) => {
        for (const e of m.shape.staves[s]!) out.push(slotBox(system, slot, m, s, e));
      });
    }
  }
  return out;
}

/** Bounding box of one event, or undefined when it is not in the layout. */
export function eventBox(layout: Layout, eventId: string): EventBox | undefined {
  for (const system of layout.systems) {
    for (const m of system.measures) {
      for (let s = 0; s < system.staves.length; s++) {
        const e = m.shape.staves[s]!.find((x) => x.id === eventId);
        if (e) return slotBox(system, system.staves[s]!, m, s, e);
      }
    }
  }
  return undefined;
}

/** Chord symbol or diagram under a point of a measure (local y is relative to the system top). */
function chordAt(
  measure: PlacedMeasure,
  system: SystemLayout,
  x: number,
  local: number,
): { slot: StaffSlot; id: string; tick: number } | undefined {
  for (let s = 0; s < system.staves.length; s++) {
    const slot = system.staves[s]!;
    for (const c of measure.shape.chords[s] ?? []) {
      const left = measure.colX[c.col]! - 2 - 3;
      if (x < left || x > left + c.width + 6) continue;
      const inSymbol = local >= slot.chordY - 14 && local <= slot.chordY + 5;
      const inDiagram =
        c.diagram && local >= slot.diagramY && local <= slot.diagramY + DIAGRAM_HEIGHT;
      if (inSymbol || inDiagram) return { slot, id: c.id, tick: c.tick };
    }
  }
  return undefined;
}

/** Where the text field of a chord symbol goes: top left of the symbol, SVG coordinates. */
export function chordAnchor(
  layout: Layout,
  staffId: string,
  measure: number,
  tick: number,
): { x: number; y: number } | undefined {
  for (const system of layout.systems) {
    if (measure < system.firstMeasure || measure > system.lastMeasure) continue;
    const m = system.measures.find((p) => p.index === measure);
    const s = system.staves.findIndex((slot) => slot.staffId === staffId);
    if (!m || s < 0) return undefined;
    const slot = system.staves[s]!;
    const cols = m.shape.columns;
    // The column of the tick, else the position between the columns around it.
    let x = m.noteStartX + 8;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i]!;
      if (col.tick <= tick) x = m.colX[i]!;
      else {
        const prev = cols[i - 1];
        const from = prev ? m.colX[i - 1]! : m.noteStartX + 8;
        const span = col.tick - (prev?.tick ?? 0);
        x = from + ((m.colX[i]! - from) * (tick - (prev?.tick ?? 0))) / span;
        break;
      }
      if (i === cols.length - 1 && tick > col.tick) {
        x = m.colX[i]! + Math.min(m.noteEndX - m.colX[i]! - 30, (tick - col.tick) / 16);
      }
    }
    return { x: x - 2, y: system.y + slot.chordY - CHORD.size };
  }
  return undefined;
}

/**
 * Maps a point (SVG coordinates) to the staff, measure and event under it. Returns null outside
 * every system. Between two staves the nearest one wins.
 */
export function hitTest(layout: Layout, x: number, y: number): HitResult | null {
  const system = layout.systems.find((s) => y >= s.y && y < s.y + s.height + 6);
  if (!system) return null;
  const local = y - system.y;
  const measure = system.measures.find((m) => x >= m.x && x < m.x + m.width);
  if (!measure) return null;

  // A chord symbol or diagram is a target of its own.
  const chordHit = chordAt(measure, system, x, local);
  if (chordHit) {
    return {
      systemIndex: system.index,
      partId: chordHit.slot.partId,
      staffId: chordHit.slot.staffId,
      measureIndex: measure.index,
      tick: chordHit.tick,
      chord: { id: chordHit.id, tick: chordHit.tick },
    };
  }

  let slotIndex = 0;
  let best = Infinity;
  system.staves.forEach((slot, i) => {
    const d = local < slot.top ? slot.top - local : Math.max(0, local - (slot.top + slot.height));
    if (d < best) {
      best = d;
      slotIndex = i;
    }
  });
  const slot = system.staves[slotIndex]!;

  let eventId: string | undefined;
  let bestDist = Infinity;
  for (const e of measure.shape.staves[slotIndex]!) {
    const box = slotBox(system, slot, measure, slotIndex, e);
    if (x < box.x - PAD_X || x > box.x + box.w + PAD_X) continue;
    if (y < box.y - PAD_Y || y > box.y + box.h + PAD_Y) continue;
    const d = Math.abs(y - (box.y + box.h / 2));
    if (d < bestDist) {
      bestDist = d;
      eventId = e.id;
    }
  }

  let tick: number | undefined;
  let bestX = Infinity;
  measure.shape.columns.forEach((col, i) => {
    const d = Math.abs(x - (measure.colX[i]! + HEAD_W / 2));
    if (d < bestX) {
      bestX = d;
      tick = col.tick;
    }
  });

  const result: HitResult = {
    systemIndex: system.index,
    partId: slot.partId,
    staffId: slot.staffId,
    measureIndex: measure.index,
    ...(tick !== undefined ? { tick } : {}),
    ...(eventId !== undefined ? { eventId } : {}),
    ...(slot.type === 'tab'
      ? {
          string: Math.min(
            slot.lines,
            Math.max(1, Math.round((local - slot.top) / slot.space) + 1),
          ),
        }
      : {}),
  };
  if (
    slot.type === 'standard' &&
    Math.abs(local - slot.top - slot.height / 2) <= slot.height / 2 + 3.5 * slot.space
  ) {
    return { ...result, pitch: pitchAtY(local - slot.top, measure.clefs[slotIndex]!, slot.space) };
  }
  return result;
}
