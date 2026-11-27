/**
 * Draws chord symbols and fretboard diagrams of one measure with the VexFlow render context (SVG
 * text and paths only, so the export can turn everything into PDF/PNG). Positions come from the
 * layout: the symbol starts at the x of its column, the diagram is centered under it.
 */
import type { RenderContext } from 'vexflow/core';
import type { ChordData } from '../score/chords';
import { partTuning } from '../score/instruments';
import type { ChordFrame, ChordSymbol, Part, Pitch } from '../score/types';
import { CHORD, capoShape, chordLabel, chordText, diagramWidth, type ChordLabel } from './chords';
import type { PlacedMeasure, StaffSlot } from './layout';

/** Looks a diagram up; installed once the lazy chord library has loaded. */
export type ShapeLookup = (
  chord: ChordData,
  tuning: readonly Pitch[],
  capo: number,
) => ChordFrame | undefined;

let lookup: ShapeLookup | undefined;

/** Installs the shape lookup (the engraver does it after loading the chord library). */
export function setShapeLookup(fn: ShapeLookup | undefined): void {
  lookup = fn;
}

export function hasShapeLookup(): boolean {
  return lookup !== undefined;
}

type Group = { setAttribute(name: string, value: string): void };

function openGroup(ctx: RenderContext, cls: string): Group {
  return (ctx as unknown as { openGroup(cls: string): SVGGElement }).openGroup(cls);
}

function closeGroup(ctx: RenderContext): void {
  (ctx as unknown as { closeGroup(): void }).closeGroup();
}

/** Draws every chord symbol (and diagram) of a staff slot in a placed measure. */
export function drawChordsOf(
  ctx: RenderContext,
  part: Part,
  slot: StaffSlot,
  m: PlacedMeasure,
  slotIndex: number,
  chords: readonly ChordSymbol[],
): void {
  const placed = m.shape.chords[slotIndex];
  if (!placed || placed.length === 0) return;
  const byId = new Map(chords.map((c) => [c.id, c]));
  // One save for the whole measure: it clones the context state, which is not cheap.
  ctx.save();
  font = '';
  for (const slotChord of placed) {
    const chord = byId.get(slotChord.id);
    if (!chord) continue;
    const label = chordLabel(chord, capoShape(part, chord));
    const x = m.colX[slotChord.col]! - 2;
    const block = slotChord.width;
    const group = openGroup(ctx, 'pm-chord');
    group.setAttribute('data-chord-id', chord.id);
    group.setAttribute('data-chord', chordText(chord));
    drawLabel(ctx, label, x + (block - label.width) / 2, slot.chordY);
    if (slotChord.diagram) {
      const tuning = partTuning(part);
      const shape =
        chord.frame ?? (tuning && lookup ? lookup(chord, tuning, part.capo ?? 0) : undefined);
      if (shape && tuning) {
        const w = diagramWidth(tuning.length);
        drawDiagram(ctx, shape, tuning.length, x + (block - w) / 2, slot.diagramY, chord);
      }
    }
    closeGroup(ctx);
  }
  ctx.restore();
}

/** The font the context holds, to skip setting it again for every run. */
let font = '';

function setFont(ctx: RenderContext, family: string, size: number): void {
  const key = `${family}/${size}`;
  if (key === font) return;
  font = key;
  ctx.setFont(family, `${size}px`, 'normal');
}

/** Text of a symbol: one text element per run (root, quality, raised extension...). */
function drawLabel(ctx: RenderContext, label: ChordLabel, x: number, y: number): void {
  for (const run of label.runs) {
    setFont(ctx, run.font === 'music' ? 'Bravura' : TEXT_FONT, run.size);
    ctx.fillText(run.text, x + run.x, y + run.dy);
  }
}

const TEXT_FONT = 'Inter, system-ui, sans-serif';

/** Fretboard diagram: strings are vertical (lowest on the left), the nut is at the top. */
function drawDiagram(
  ctx: RenderContext,
  shape: ChordFrame,
  n: number,
  x: number,
  y: number,
  chord: ChordSymbol,
): void {
  const group = openGroup(ctx, 'pm-diagram');
  group.setAttribute('data-chord-id', chord.id);
  group.setAttribute('data-frets', shape.frets.join(','));
  const gap = CHORD.stringGap;
  const gx = x + CHORD.labelWidth + 2;
  const gy = y + CHORD.marker;
  const rows = Math.max(CHORD.frets, rowsNeeded(shape));
  const fretGap = (CHORD.frets * CHORD.fretGap) / rows;
  const width = (n - 1) * gap;
  const height = rows * fretGap;
  const sx = (string: number) => gx + (n - string) * gap;

  ctx.setLineWidth(0.8);
  ctx.beginPath();
  for (let s = 1; s <= n; s++) {
    ctx.moveTo(sx(s), gy);
    ctx.lineTo(sx(s), gy + height);
  }
  for (let r = 1; r <= rows; r++) {
    ctx.moveTo(gx, gy + r * fretGap);
    ctx.lineTo(gx + width, gy + r * fretGap);
  }
  ctx.stroke();
  // The nut is thick at the neck's start; higher up, the first line is a normal fret and the
  // fret number tells where the window is.
  ctx.setLineWidth(shape.base === 1 ? 2.6 : 0.8);
  ctx.beginPath();
  ctx.moveTo(gx - 0.4, gy);
  ctx.lineTo(gx + width + 0.4, gy);
  ctx.stroke();

  // Open and muted strings above the nut.
  shape.frets.forEach((f, i) => {
    const cx = sx(i + 1);
    const cy = gy - 4.2;
    if (f === 0) {
      ctx.setLineWidth(0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, 1.9, 0, Math.PI * 2, false);
      ctx.stroke();
    } else if (f < 0) {
      ctx.setLineWidth(0.9);
      ctx.beginPath();
      ctx.moveTo(cx - 1.8, cy - 1.8);
      ctx.lineTo(cx + 1.8, cy + 1.8);
      ctx.moveTo(cx - 1.8, cy + 1.8);
      ctx.lineTo(cx + 1.8, cy - 1.8);
      ctx.stroke();
    }
  });

  // Barre, then the fretted dots.
  const rowY = (fret: number) => gy + (fret - shape.base + 0.5) * fretGap;
  const radius = Math.min(2.7, fretGap * 0.36);
  if (shape.barre) {
    const b = shape.barre;
    const left = sx(b.to);
    const right = sx(b.from);
    const cy = rowY(b.fret);
    ctx.fillRect(left, cy - radius, right - left, radius * 2);
    for (const cx of [left, right]) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2, false);
      ctx.fill();
    }
  }
  shape.frets.forEach((f, i) => {
    if (f <= 0) return;
    const row = f - shape.base;
    if (row < 0 || row >= rows) return;
    ctx.beginPath();
    ctx.arc(sx(i + 1), rowY(f), radius, 0, Math.PI * 2, false);
    ctx.fill();
  });

  if (shape.base > 1) {
    setFont(ctx, TEXT_FONT, 9);
    const label = String(shape.base);
    ctx.fillText(label, gx - 3 - label.length * 5.4, gy + fretGap * 0.5 + 3.2);
  }
  closeGroup(ctx);
}

function rowsNeeded(shape: ChordFrame): number {
  const top = Math.max(0, ...shape.frets);
  return top > 0 ? top - shape.base + 1 : 1;
}
