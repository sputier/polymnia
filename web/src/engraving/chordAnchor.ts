import { CHORD } from './chordMetrics';
import type { Layout } from './layout';

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
