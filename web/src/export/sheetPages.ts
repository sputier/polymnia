/**
 * Pages of the printed chord sheet (#60): the grid of measures (four per row), then the diagrams of
 * the chords used for one part. Same page model as the score (`Page` = drawing items in points, y
 * down), so the PDF writer and the PNG renderer need nothing new. No engraver: chord names are plain
 * text (Helvetica, or Inter outlines beyond WinAnsi) and the diagrams are drawn from the same
 * geometry as the screen view.
 */
import {
  buildChordSheet,
  capoShapeOf,
  sheetRows,
  shapeFor,
  usedChords,
  SHEET_PER_ROW,
  type ShapeLookup,
} from '../chords/sheet';
import { diagramGeometry, type DiagramGeometry } from '../chords/sheetDiagram';
import { formatChord, type NoteNaming } from '../score/chords';
import type { Part, Score } from '../score/types';
import {
  MARGIN_BOTTOM,
  MARGIN_TOP,
  MARGIN_X,
  PAPER_SIZES,
  TITLE_BLOCK,
  fitText,
  pageNumber,
  textWidth,
  titleBlock,
  type Page,
  type Paper,
} from './pages';
import type { Item, PathItem } from './svgItems';
import type { Seg } from './paths';

export interface SheetOptions {
  readonly naming: NoteNaming;
  /** The part whose diagrams are printed (none: no diagram section). */
  readonly part?: Part | undefined;
  readonly lookup?: ShapeLookup | undefined;
  /** Heading of the diagram section. */
  readonly diagramsLabel: string;
  /** `Capo 2`, written after the part name. */
  readonly capoLabel?: ((fret: number) => string) | undefined;
}

const ROW_HEIGHT = 38;
const CHORD_SIZE = 15;
const BEAT_SIZE = 6.5;
const NUMBER_SIZE = 6;
const CELL_PAD = 3;
const DIAGRAM_CELL_W = 64;
const CAPTION_SIZE = 9;
const CAPTION_ROOM = 14;
const HEADING_SIZE = 11;

const KAPPA = 0.5523;

function stroke(segs: readonly Seg[], lineWidth: number): PathItem {
  return { kind: 'path', segs, fill: false, stroke: true, lineWidth, dash: [] };
}
function fill(segs: readonly Seg[]): PathItem {
  return { kind: 'path', segs, fill: true, stroke: false, lineWidth: 0, dash: [] };
}

function circle(cx: number, cy: number, r: number): Seg[] {
  const k = r * KAPPA;
  return [
    ['M', cx + r, cy],
    ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r],
    ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
    ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r],
    ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy],
    ['Z'],
  ];
}

function rectSegs(x: number, y: number, w: number, h: number): Seg[] {
  return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
}

/** A diagram at (x, y), its geometry units taken as points. */
export function diagramItems(g: DiagramGeometry, x: number, y: number): Item[] {
  const items: Item[] = [];
  for (const l of g.lines)
    items.push(
      stroke(
        [
          ['M', x + l.x1, y + l.y1],
          ['L', x + l.x2, y + l.y2],
        ],
        l.w,
      ),
    );
  for (const r of g.rects) items.push(fill(rectSegs(x + r.x, y + r.y, r.w, r.h)));
  for (const c of g.circles) {
    const segs = circle(x + c.cx, y + c.cy, c.r);
    items.push(c.fill ? fill(segs) : stroke(segs, 0.8));
  }
  for (const t of g.texts)
    items.push({
      kind: 'text',
      x: x + t.x,
      y: y + t.y,
      size: t.size,
      text: t.text,
      align: t.align,
    });
  return items;
}

/** Builds the pages of the chord sheet of `score`. */
export function buildSheetPages(
  score: Score,
  title: string,
  paper: Paper,
  opts: SheetOptions,
  measure: (text: string, size: number) => number = textWidth,
): Page[] {
  const { width, height } = PAPER_SIZES[paper];
  const inner = width - 2 * MARGIN_X;
  const bottom = height - MARGIN_BOTTOM;
  const pages: Page[] = [];
  let items: Item[] = [];
  let y = MARGIN_TOP;
  const newPage = () => {
    items = [];
    pages.push({ width, height, items });
    y = MARGIN_TOP;
  };
  newPage();
  items.push(...titleBlock(width, score, title, measure));
  y += TITLE_BLOCK;

  const sheet = buildChordSheet(score);
  const cellW = inner / SHEET_PER_ROW;
  for (const row of sheetRows(sheet)) {
    if (y + ROW_HEIGHT > bottom) newPage();
    row.forEach((m, col) => {
      const x = MARGIN_X + col * cellW;
      items.push(stroke(rectSegs(x, y, cellW, ROW_HEIGHT), 0.6));
      items.push({
        kind: 'text',
        x: x + 3,
        y: y + NUMBER_SIZE + 2,
        size: NUMBER_SIZE,
        text: String(m.index + 1),
        align: 'start',
      });
      const baseline = y + ROW_HEIGHT / 2 + 8;
      if (m.repeat) {
        items.push({
          kind: 'text',
          x: x + cellW / 2,
          y: baseline + 1,
          size: 20,
          text: '%',
          align: 'middle',
        });
        return;
      }
      const several = m.chords.length > 1;
      const slot = cellW / Math.max(1, m.chords.length);
      m.chords.forEach(({ chord, beat }, i) => {
        const cx = x + (i + 0.5) * slot;
        const room = slot - 2 * CELL_PAD;
        let size = CHORD_SIZE;
        const text = formatChord(chord, opts.naming);
        while (size > 8 && measure(text, size) > room) size -= 1;
        items.push({
          kind: 'text',
          x: cx,
          y: several ? baseline - 3 : baseline,
          size,
          text: fitText(text, size, room, measure),
          align: 'middle',
        });
        if (several)
          items.push({
            kind: 'text',
            x: cx,
            y: baseline + 6,
            size: BEAT_SIZE,
            text: String(beat),
            align: 'middle',
          });
      });
    });
    y += ROW_HEIGHT;
  }

  const part = opts.part;
  if (part) {
    const chords = usedChords(sheet);
    const cells = chords.flatMap((chord) => {
      const shape = shapeFor(chord, part, opts.lookup);
      if (!shape) return [];
      const played = capoShapeOf(part, chord);
      const name = formatChord(chord, opts.naming);
      return [
        {
          geometry: diagramGeometry(shape, shape.frets.length),
          caption: played ? `${name} (${formatChord(played, opts.naming)})` : name,
        },
      ];
    });
    if (cells.length > 0) {
      const perRow = Math.max(1, Math.floor(inner / DIAGRAM_CELL_W));
      const heading = [opts.diagramsLabel, part.name, part.capo ? opts.capoLabel?.(part.capo) : '']
        .filter((s) => s)
        .join(' - ');
      const tallest = Math.max(...cells.map((c) => c.geometry.height)) + CAPTION_ROOM;
      y += 22;
      // The heading never ends a page alone: it moves with the first row of diagrams.
      if (y + HEADING_SIZE + 8 + tallest > bottom) newPage();
      items.push({
        kind: 'text',
        x: MARGIN_X,
        y: y + HEADING_SIZE,
        size: HEADING_SIZE,
        text: fitText(heading, HEADING_SIZE, inner, measure),
        align: 'start',
      });
      y += HEADING_SIZE + 12;
      for (let i = 0; i < cells.length; i += perRow) {
        if (y + tallest > bottom) newPage();
        cells.slice(i, i + perRow).forEach((c, col) => {
          const x = MARGIN_X + col * DIAGRAM_CELL_W;
          items.push(...diagramItems(c.geometry, x + (DIAGRAM_CELL_W - c.geometry.width) / 2, y));
          items.push({
            kind: 'text',
            x: x + DIAGRAM_CELL_W / 2,
            y: y + tallest - 3,
            size: CAPTION_SIZE,
            text: fitText(c.caption, CAPTION_SIZE, DIAGRAM_CELL_W - 4, measure),
            align: 'middle',
          });
        });
        y += tallest + 6;
      }
    }
  }

  pages.forEach((p, i) => p.items.push(pageNumber(width, height, i, pages.length)));
  return pages;
}
