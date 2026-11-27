/**
 * Page layout of the printed score: engraves the score once at page width (with our own layout,
 * so measures break exactly as on screen at that width), cuts the systems into pages and draws a
 * title block and page numbers. Output is a list of pages, each a list of drawing items in points
 * (y down, origin at the top left corner), the same for PDF and PNG.
 */
import type { Score } from '../score';
import type { Layout } from '../engraving/layout';
import { convertSvg, type Item } from './svgItems';

export type Paper = 'a4' | 'letter';

/** Page sizes in points (1/72 inch). */
export const PAPER_SIZES: Readonly<
  Record<Paper, { readonly width: number; readonly height: number }>
> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

export const MARGIN_X = 48;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 52;
const TITLE_BLOCK = 58;
/** Printed staff space (distance between two staff lines) in millimetres: usual for A4 scores. */
export const DEFAULT_STAFF_SPACE_MM = 1.75;
/** A staff space is 10 engraving px. */
const STAFF_SPACE_PX = 10;
const MM_TO_PT = 72 / 25.4;

/** Engraving px to points for a printed staff space. */
export function printScale(staffSpaceMm: number = DEFAULT_STAFF_SPACE_MM): number {
  return (staffSpaceMm * MM_TO_PT) / STAFF_SPACE_PX;
}

export interface Page {
  readonly width: number;
  readonly height: number;
  readonly items: Item[];
}

export interface PagePlan {
  readonly paper: Paper;
  readonly scale: number;
  /** Systems (indexes into the layout) of each page. */
  readonly pages: readonly (readonly number[])[];
  readonly layout: Layout;
}

/** Height available for systems on a page, in points. */
function bodyRoom(paper: Paper, firstPage: boolean): number {
  return PAPER_SIZES[paper].height - MARGIN_TOP - MARGIN_BOTTOM - (firstPage ? TITLE_BLOCK : 0);
}

/** Largest extra distance (points) added between two systems to fill a page. */
const MAX_SYSTEM_SPREAD = 24;

/**
 * Extra distance between the systems of page `index`: a page that is not the last one spreads its
 * leftover height evenly so it looks filled, within a limit; the last page keeps the natural
 * distance. Pure.
 */
export function systemSpread(plan: PagePlan, index: number): number {
  const systems = plan.pages[index]!;
  if (index === plan.pages.length - 1 || systems.length < 2) return 0;
  const first = plan.layout.systems[systems[0]!]!;
  const last = plan.layout.systems[systems[systems.length - 1]!]!;
  const used = (last.y + last.height - first.y) * plan.scale;
  const left = bodyRoom(plan.paper, index === 0) - used;
  return Math.max(0, Math.min(MAX_SYSTEM_SPREAD, left / (systems.length - 1)));
}

/** Cuts `layout` into pages: greedy, a system never splits. Pure. */
export function planPages(layout: Layout, paper: Paper, scale: number): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let first = 0;
  for (const system of layout.systems) {
    const used = (system.y + system.height - first) * scale;
    const room = bodyRoom(paper, pages.length === 0);
    if (current.length > 0 && used > room) {
      pages.push(current);
      current = [];
    }
    if (current.length === 0) first = system.y;
    current.push(system.index);
  }
  if (current.length > 0) pages.push(current);
  if (pages.length === 0) pages.push([]);
  return pages;
}

/** Width in engraving px for a scale, and the scale that lets the tallest system fit a page. */
export function printGeometry(
  paper: Paper,
  tallestSystem: number,
  staffSpaceMm: number = DEFAULT_STAFF_SPACE_MM,
): { scale: number; width: number } {
  const { width, height } = PAPER_SIZES[paper];
  const body = height - MARGIN_TOP - MARGIN_BOTTOM - TITLE_BLOCK;
  const scale =
    tallestSystem > 0
      ? Math.min(printScale(staffSpaceMm), body / tallestSystem)
      : printScale(staffSpaceMm);
  return { scale, width: (width - 2 * MARGIN_X) / scale };
}

/** Helvetica advance widths (1/1000 em) for U+0020 to U+007E, to align text without a font file. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Width of `text` in Helvetica at `size` points. Other characters count as 556. */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    w += cp >= 32 && cp <= 126 ? HELVETICA[cp - 32]! : 556;
  }
  return (w * size) / 1000;
}

/** Cuts `text` so it fits `max` points at `size`, with an ellipsis. */
export function fitText(text: string, size: number, max: number): string {
  if (textWidth(text, size) <= max) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}...`, size) > max) out = out.slice(0, -1);
  return `${out}...`;
}

/**
 * Builds one page: the systems of `plan.pages[index]` taken from the engraved `svg`, plus the title
 * block on the first page and the page number on all of them.
 */
export function buildPage(
  plan: PagePlan,
  svg: SVGSVGElement,
  index: number,
  score: Score,
  title: string,
  dropped: Record<string, number>,
): Page {
  const { width, height } = PAPER_SIZES[plan.paper];
  const items: Item[] = [];
  const groups = Array.from(svg.children).filter((el) => el.classList.contains('vf-pm-system'));
  const systems = plan.pages[index]!;
  const first = systems.length > 0 ? plan.layout.systems[systems[0]!]!.y : 0;
  let top = MARGIN_TOP;
  if (index === 0) {
    const inner = width - 2 * MARGIN_X;
    if (title.trim() !== '') {
      const text = fitText(title.trim(), 20, inner);
      items.push({
        kind: 'text',
        x: width / 2,
        y: MARGIN_TOP + 18,
        size: 20,
        text,
        align: 'middle',
      });
    }
    const composer = score.meta.composer.trim();
    if (composer !== '') {
      items.push({
        kind: 'text',
        x: width - MARGIN_X,
        y: MARGIN_TOP + 38,
        size: 11,
        text: fitText(composer, 11, inner),
        align: 'end',
      });
    }
    top += TITLE_BLOCK;
  }
  const spread = systemSpread(plan, index);
  for (const [n, i] of systems.entries()) {
    const group = groups[i];
    if (!group) continue;
    const s = plan.scale;
    const converted = convertSvg(group, [s, 0, 0, s, MARGIN_X, top + n * spread - first * s]);
    for (const item of converted.items) items.push(item);
    for (const [name, n] of Object.entries(converted.dropped))
      dropped[name] = (dropped[name] ?? 0) + n;
  }
  items.push({
    kind: 'text',
    x: width / 2,
    y: height - MARGIN_BOTTOM / 2 + 4,
    size: 9,
    text: `${index + 1} / ${plan.pages.length}`,
    align: 'middle',
  });
  return { width, height, items };
}
