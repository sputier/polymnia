/**
 * Reads the SVG the engraver produced and turns it into a flat list of drawing items (paths and
 * text), in the SVG's own coordinates. Both page back ends (PDF, canvas) draw from this list, so
 * they never depend on the theme: colors are dropped (ink is black), CSS classes are ignored, hit
 * areas and overlays are skipped.
 *
 * VexFlow draws music symbols as `<text>` with Bravura code points; those become the glyph's
 * vector outline (see `bravura-outlines.json`), the other text stays text.
 */
import outlines from './bravura-outlines.json';
import { parsePath, transformSegs, type Seg } from './paths';

export interface PathItem {
  readonly kind: 'path';
  readonly segs: readonly Seg[];
  readonly fill: boolean;
  readonly stroke: boolean;
  readonly lineWidth: number;
  readonly dash: readonly number[];
}

export interface TextItem {
  readonly kind: 'text';
  readonly x: number;
  readonly y: number;
  /** Font size in the item's units. */
  readonly size: number;
  readonly text: string;
  readonly align: 'start' | 'middle' | 'end';
}

export type Item = PathItem | TextItem;

export interface Conversion {
  readonly items: Item[];
  /** Things the output cannot represent, by name (feeds the export report). */
  readonly dropped: Record<string, number>;
}

interface Style {
  fill: boolean;
  stroke: boolean;
  lineWidth: number;
  dash: number[];
  size: number;
  anchor: 'start' | 'middle' | 'end';
}

const UPM = outlines.unitsPerEm;
const GLYPHS = new Map<number, Seg[]>();

function glyphSegs(codePoint: number): Seg[] | undefined {
  let segs = GLYPHS.get(codePoint);
  if (!segs) {
    const d = (outlines.glyphs as Record<string, string>)[codePoint.toString(16).toUpperCase()];
    segs = d ? parsePath(d) : undefined;
    if (segs) GLYPHS.set(codePoint, segs);
  }
  return segs;
}

/** True when the Bravura outlines cover this character. */
export function hasGlyph(codePoint: number): boolean {
  return glyphSegs(codePoint) !== undefined;
}

const isPrivateUse = (cp: number) => cp >= 0xe000 && cp <= 0xf8ff;

function fontSizePx(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const m = /^\s*([\d.]+)\s*(pt|px)?\s*$/.exec(value);
  if (!m) return fallback;
  return Number(m[1]) * (m[2] === 'pt' ? 96 / 72 : 1);
}

function parseDash(value: string | null): number[] {
  if (!value || value === 'none') return [];
  const nums = value
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
  return nums.length > 0 && nums.some((n) => n > 0) ? nums : [];
}

const paint = (value: string | null, inherited: boolean): boolean =>
  value === null ? inherited : value !== 'none' && value !== 'transparent';

/** Converts the children of `root` (an `<svg>` or a `<g>`), with `matrix` applied to everything. */
export function convertSvg(
  root: Element,
  matrix: readonly number[] = [1, 0, 0, 1, 0, 0],
): Conversion {
  const items: Item[] = [];
  const dropped: Record<string, number> = {};
  const drop = (name: string) => (dropped[name] = (dropped[name] ?? 0) + 1);

  const walk = (el: Element, parent: Style, m: readonly number[]) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'defs' || tag === 'title' || tag === 'desc') return;
    if (el.getAttribute('opacity') === '0' || el.getAttribute('display') === 'none') return;
    if (el.getAttribute('aria-hidden') === 'true' && el.classList.contains('pm-overlay')) return;
    if (el.classList.contains('pm-overlay') || el.classList.contains('pm-cursor-layer')) return;

    const style: Style = {
      fill: paint(el.getAttribute('fill'), parent.fill),
      stroke: paint(el.getAttribute('stroke'), parent.stroke),
      lineWidth: el.hasAttribute('stroke-width')
        ? Number(el.getAttribute('stroke-width'))
        : parent.lineWidth,
      dash: el.hasAttribute('stroke-dasharray')
        ? parseDash(el.getAttribute('stroke-dasharray'))
        : parent.dash,
      size: el.hasAttribute('font-size')
        ? fontSizePx(el.getAttribute('font-size'), parent.size)
        : parent.size,
      anchor: (el.getAttribute('text-anchor') as Style['anchor'] | null) ?? parent.anchor,
    };
    if (!Number.isFinite(style.lineWidth)) style.lineWidth = parent.lineWidth;

    let local = m;
    const transform = el.getAttribute('transform');
    if (transform) {
      const parsed = parseTransform(transform);
      if (!parsed) drop('svg-transform');
      else local = multiply(m, parsed);
    }

    switch (tag) {
      case 'path': {
        const segs = parsePath(el.getAttribute('d') ?? '');
        if (!segs) return drop('svg-path');
        pushPath(transformSegs(segs, local), style, local);
        return;
      }
      case 'rect': {
        const x = Number(el.getAttribute('x') ?? 0);
        const y = Number(el.getAttribute('y') ?? 0);
        const w = Number(el.getAttribute('width') ?? 0);
        const h = Number(el.getAttribute('height') ?? 0);
        if (!(w > 0) || !(h > 0)) return;
        const rect: Seg[] = [
          ['M', x, y],
          ['L', x + w, y],
          ['L', x + w, y + h],
          ['L', x, y + h],
          ['Z'],
        ];
        pushPath(transformSegs(rect, local), style, local);
        return;
      }
      case 'line': {
        const seg: Seg[] = [
          ['M', Number(el.getAttribute('x1') ?? 0), Number(el.getAttribute('y1') ?? 0)],
          ['L', Number(el.getAttribute('x2') ?? 0), Number(el.getAttribute('y2') ?? 0)],
        ];
        pushPath(transformSegs(seg, local), { ...style, fill: false }, local);
        return;
      }
      case 'text': {
        pushText(el, style, local);
        return;
      }
      case 'svg':
      case 'g':
        for (const child of Array.from(el.children)) walk(child, style, local);
        return;
      default:
        drop(`svg-${tag}`);
    }
  };

  const pushPath = (segs: Seg[], style: Style, m: readonly number[]) => {
    const scale = Math.sqrt(Math.abs(m[0]! * m[3]! - m[1]! * m[2]!));
    const stroke = style.stroke && style.lineWidth > 0;
    if (!style.fill && !stroke) return;
    items.push({
      kind: 'path',
      segs,
      fill: style.fill,
      stroke,
      lineWidth: style.lineWidth * scale,
      dash: style.dash.map((d) => d * scale),
    });
  };

  const pushText = (el: Element, style: Style, m: readonly number[]) => {
    const text = el.textContent ?? '';
    const scale = Math.sqrt(Math.abs(m[0]! * m[3]! - m[1]! * m[2]!));
    const x = Number(el.getAttribute('x') ?? 0);
    const y = Number(el.getAttribute('y') ?? 0);
    let plain = '';
    const flush = () => {
      if (plain === '') return;
      items.push({
        kind: 'text',
        x: m[0]! * x + m[2]! * y + m[4]!,
        y: m[1]! * x + m[3]! * y + m[5]!,
        size: style.size * scale,
        text: plain,
        align: style.anchor,
      });
      plain = '';
    };
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (!isPrivateUse(cp)) {
        plain += ch;
        continue;
      }
      flush();
      const segs = glyphSegs(cp);
      if (!segs) {
        drop(`glyph-U+${cp.toString(16).toUpperCase()}`);
        continue;
      }
      const k = style.size / UPM;
      const placed = transformSegs(segs, multiply(m, [k, 0, 0, k, x, y]));
      pushPath(placed, { ...style, fill: true, stroke: false }, m);
    }
    flush();
  };

  walk(
    root,
    { fill: true, stroke: false, lineWidth: 1, dash: [], size: 13.33, anchor: 'start' },
    matrix,
  );
  return { items, dropped };
}

/** Parses `translate`, `scale`, `matrix` (and chains of them). */
function parseTransform(value: string): number[] | undefined {
  let m = [1, 0, 0, 1, 0, 0];
  const re = /(translate|scale|matrix)\(([^)]*)\)/g;
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    found = true;
    const n = match[2]!
      .split(/[\s,]+/)
      .filter((s) => s !== '')
      .map(Number);
    if (n.some((v) => !Number.isFinite(v))) return undefined;
    let t: number[];
    if (match[1] === 'translate') t = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    else if (match[1] === 'scale') t = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (n.length === 6) t = n;
    else return undefined;
    m = multiply(m, t);
  }
  return found ? m : undefined;
}

/** `a` then `b` in SVG order: the result applies `b` first, then `a`. */
export function multiply(a: readonly number[], b: readonly number[]): number[] {
  return [
    a[0]! * b[0]! + a[2]! * b[1]!,
    a[1]! * b[0]! + a[3]! * b[1]!,
    a[0]! * b[2]! + a[2]! * b[3]!,
    a[1]! * b[2]! + a[3]! * b[3]!,
    a[0]! * b[4]! + a[2]! * b[5]! + a[4]!,
    a[1]! * b[4]! + a[3]! * b[5]! + a[5]!,
  ];
}
