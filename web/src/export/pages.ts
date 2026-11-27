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
/** Engraving px to points: a staff space (10 px) becomes 6 pt, about 2.1 mm, a usual printed size. */
const BASE_SCALE = 0.6;

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

/** Cuts `layout` into pages: greedy, a system never splits. Pure. */
export function planPages(layout: Layout, paper: Paper, scale: number): number[][] {
  const { height } = PAPER_SIZES[paper];
  const body = height - MARGIN_TOP - MARGIN_BOTTOM;
  const pages: number[][] = [];
  let current: number[] = [];
  let first = 0;
  for (const system of layout.systems) {
    const used = (system.y + system.height - first) * scale;
    const room = body - (pages.length === 0 ? TITLE_BLOCK : 0);
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
): { scale: number; width: number } {
  const { width, height } = PAPER_SIZES[paper];
  const body = height - MARGIN_TOP - MARGIN_BOTTOM - TITLE_BLOCK;
  const scale = tallestSystem > 0 ? Math.min(BASE_SCALE, body / tallestSystem) : BASE_SCALE;
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
  for (const i of systems) {
    const group = groups[i];
    if (!group) continue;
    const s = plan.scale;
    const converted = convertSvg(group, [s, 0, 0, s, MARGIN_X, top - first * s]);
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
