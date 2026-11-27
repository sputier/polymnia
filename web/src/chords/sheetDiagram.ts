/**
 * Geometry of a fretboard diagram for the chord sheet, as plain primitives (lines, circles,
 * rectangles, a fret number). One description feeds the on-screen SVG and the PDF/PNG pages, so the
 * two cannot drift apart. Units are arbitrary (the callers scale); strings are vertical, the lowest
 * on the left, the nut at the top. `frets` is highest string first (as `ChordFrame`).
 */
import type { ChordFrame } from '../score/types';

const STRING_GAP = 8;
const FRET_GAP = 10;
const FRETS = 4;
/** Room above the nut for the open and muted markers. */
const MARKER = 11;
/** Room left of the grid for the fret number of a shape that is not at the nut. */
const LABEL = 10;
const PAD = 3;

export interface DiagramLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly w: number;
}
export interface DiagramCircle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** Filled dot (a fretted string) or an open ring (an open string). */
  readonly fill: boolean;
}
export interface DiagramRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export interface DiagramText {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly text: string;
  readonly align: 'start' | 'middle' | 'end';
}

export interface DiagramGeometry {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly DiagramLine[];
  readonly circles: readonly DiagramCircle[];
  readonly rects: readonly DiagramRect[];
  readonly texts: readonly DiagramText[];
}

function rowsNeeded(shape: ChordFrame): number {
  const top = Math.max(0, ...shape.frets);
  return Math.max(FRETS, top > 0 ? top - shape.base + 1 : 1);
}

/** The drawing of `shape` on `strings` strings. */
export function diagramGeometry(shape: ChordFrame, strings: number): DiagramGeometry {
  const rows = rowsNeeded(shape);
  const gx = LABEL + PAD;
  const gy = MARKER + PAD;
  const gridW = (strings - 1) * STRING_GAP;
  const gridH = rows * FRET_GAP;
  const sx = (string: number) => gx + (strings - string) * STRING_GAP;
  const lines: DiagramLine[] = [];
  const circles: DiagramCircle[] = [];
  const rects: DiagramRect[] = [];
  const texts: DiagramText[] = [];

  for (let s = 1; s <= strings; s++)
    lines.push({ x1: sx(s), y1: gy, x2: sx(s), y2: gy + gridH, w: 0.7 });
  for (let r = 1; r <= rows; r++)
    lines.push({ x1: gx, y1: gy + r * FRET_GAP, x2: gx + gridW, y2: gy + r * FRET_GAP, w: 0.7 });
  // Thick nut at the start of the neck; higher up the first line is an ordinary fret.
  lines.push({ x1: gx, y1: gy, x2: gx + gridW, y2: gy, w: shape.base === 1 ? 2.4 : 0.7 });

  shape.frets.forEach((f, i) => {
    const cx = sx(i + 1);
    const cy = gy - 5;
    if (f === 0) circles.push({ cx, cy, r: 2, fill: false });
    else if (f < 0) {
      lines.push({ x1: cx - 1.8, y1: cy - 1.8, x2: cx + 1.8, y2: cy + 1.8, w: 0.8 });
      lines.push({ x1: cx - 1.8, y1: cy + 1.8, x2: cx + 1.8, y2: cy - 1.8, w: 0.8 });
    }
  });

  const rowY = (fret: number) => gy + (fret - shape.base + 0.5) * FRET_GAP;
  const radius = 3;
  if (shape.barre) {
    const b = shape.barre;
    const left = sx(b.to);
    const right = sx(b.from);
    const cy = rowY(b.fret);
    rects.push({ x: left, y: cy - radius, w: right - left, h: radius * 2 });
    circles.push({ cx: left, cy, r: radius, fill: true }, { cx: right, cy, r: radius, fill: true });
  }
  shape.frets.forEach((f, i) => {
    const row = f - shape.base;
    if (f > 0 && row >= 0 && row < rows)
      circles.push({ cx: sx(i + 1), cy: rowY(f), r: radius, fill: true });
  });
  if (shape.base > 1)
    texts.push({
      x: gx - 3,
      y: gy + FRET_GAP * 0.5 + 3,
      size: 8,
      text: String(shape.base),
      align: 'end',
    });

  return { width: gx + gridW + PAD, height: gy + gridH + PAD, lines, circles, rects, texts };
}

/** Screen reader description: `x 3 2 0 1 0` (muted as x, highest string first), with the starting fret. */
export function diagramDescription(shape: ChordFrame): string {
  const frets = shape.frets.map((f) => (f < 0 ? 'x' : String(f))).join(' ');
  return shape.base > 1 ? `${frets} (${shape.base})` : frets;
}
