/** Hit testing and event bounding boxes, computed from the layout alone (no DOM, no VexFlow). */
import type { Pitch } from '../score/types';
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
  /** Natural pitch on the staff line or space under the point (standard staves only). */
  readonly pitch?: Pitch;
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

  const result: HitResult = {
    systemIndex: system.index,
    partId: slot.partId,
    staffId: slot.staffId,
    measureIndex: measure.index,
    ...(eventId !== undefined ? { eventId } : {}),
  };
  if (
    slot.type === 'standard' &&
    Math.abs(local - slot.top - slot.height / 2) <= slot.height / 2 + 3.5 * slot.space
  ) {
    return { ...result, pitch: pitchAtY(local - slot.top, measure.clefs[slotIndex]!, slot.space) };
  }
  return result;
}
