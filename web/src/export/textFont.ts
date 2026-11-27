/**
 * Text beyond WinAnsi for the PDF: Inter outlines (SIL OFL 1.1) drawn as vector paths, like the
 * Bravura music glyphs, plus an invisible text layer so the text stays selectable and searchable.
 * The outline tables (`inter/*.json`, built by `scripts/export/build-text-outlines.mjs`) are loaded
 * with `import()` only when a document has such text, one file per script, so the common case
 * (Latin-1 titles) pays nothing. Characters with no outline (CJK, symbols) are drawn as `?` and
 * reported, but their real code point is still in the text layer.
 */
import type { Seg } from './paths';

/** Glyph table of one block: `[advance, path]` per code point (hex), on a `units` em grid. */
interface Table {
  readonly units: number;
  readonly glyphs: Readonly<Record<string, readonly [number, string]>>;
}

export type Block = 'latin' | 'latin-ext' | 'greek' | 'cyrillic';

const LOADERS: Record<Block, () => Promise<{ default: Table }>> = {
  latin: () => import('./inter/latin.json') as unknown as Promise<{ default: Table }>,
  'latin-ext': () => import('./inter/latin-ext.json') as unknown as Promise<{ default: Table }>,
  greek: () => import('./inter/greek.json') as unknown as Promise<{ default: Table }>,
  cyrillic: () => import('./inter/cyrillic.json') as unknown as Promise<{ default: Table }>,
};

/** Windows-1252 code points above U+00FF that WinAnsi can show. */
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

const inWinAnsi = (cp: number) =>
  (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp);

/** True when Helvetica/WinAnsi cannot show `text`: it then goes through the outline path. */
export function needsUnicode(text: string): boolean {
  for (const ch of text.normalize('NFC')) if (!inWinAnsi(ch.codePointAt(0)!)) return true;
  return false;
}

/** Code points above U+00FF that the Inter latin subset (not latin-ext) holds. */
const LATIN_EXTRA = new Set([
  0x131, 0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2da, 0x2db, 0x2dc,
]);

/** The outline block that holds a code point, if any. */
export function blockOf(cp: number): Block | undefined {
  if (cp >= 0x20 && cp <= 0xff) return 'latin';
  if (LATIN_EXTRA.has(cp)) return 'latin';
  if (cp >= 0x2010 && cp <= 0x203a) return 'latin';
  if (cp === 0x20ac || cp === 0x2122 || cp === 0x2212) return 'latin';
  if ((cp >= 0x100 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff)) return 'latin-ext';
  if (cp >= 0x20a0 && cp <= 0x20bf) return 'latin-ext';
  if ((cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff)) return 'greek';
  if (cp >= 0x400 && cp <= 0x52f) return 'cyrillic';
  return undefined;
}

export interface Outline {
  /** Advance on a 1000 units per em grid. */
  readonly advance: number;
  /** Segments on that grid, y up. */
  readonly segs: readonly Seg[];
}

const NOTDEF_ADVANCE = 600;
const num = /-?\d+/g;

/** Decodes `M dx dy L dx dy Q dx1 dy1 dx dy C ... Z` (every point relative to the previous one). */
function decode(d: string): Seg[] {
  const segs: Seg[] = [];
  let x = 0;
  let y = 0;
  const re = /([MLQCZ])([^MLQCZ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const n = (m[2]!.match(num) ?? []).map(Number);
    switch (m[1]) {
      case 'M':
        x += n[0]!;
        y += n[1]!;
        segs.push(['M', x, y]);
        break;
      case 'L':
        x += n[0]!;
        y += n[1]!;
        segs.push(['L', x, y]);
        break;
      case 'Q': {
        const cx = x + n[0]!;
        const cy = y + n[1]!;
        const ex = cx + n[2]!;
        const ey = cy + n[3]!;
        segs.push([
          'C',
          x + (2 / 3) * (cx - x),
          y + (2 / 3) * (cy - y),
          ex + (2 / 3) * (cx - ex),
          ey + (2 / 3) * (cy - ey),
          ex,
          ey,
        ]);
        x = ex;
        y = ey;
        break;
      }
      case 'C': {
        const x1 = x + n[0]!;
        const y1 = y + n[1]!;
        const x2 = x1 + n[2]!;
        const y2 = y1 + n[3]!;
        x = x2 + n[4]!;
        y = y2 + n[5]!;
        segs.push(['C', x1, y1, x2, y2, x, y]);
        break;
      }
      default:
        segs.push(['Z']);
    }
  }
  return segs;
}

/** Loaded outlines of the blocks a document needs. */
export class TextFont {
  private readonly tables: Table[];
  private readonly cache = new Map<number, Outline | null>();
  /** Code points drawn as `?` because no outline exists. */
  readonly missing = new Set<number>();

  constructor(tables: Table[]) {
    this.tables = tables;
  }

  glyph(cp: number): Outline | undefined {
    let hit = this.cache.get(cp);
    if (hit === undefined) {
      const key = cp.toString(16);
      hit = null;
      for (const t of this.tables) {
        const g = t.glyphs[key];
        if (g) {
          hit = { advance: g[0], segs: decode(g[1]) };
          break;
        }
      }
      this.cache.set(cp, hit);
    }
    return hit ?? undefined;
  }

  /** The outline to draw for `cp`: its own, or the `?` (recorded as missing). */
  drawable(cp: number): Outline {
    const own = this.glyph(cp);
    if (own) return own;
    this.missing.add(cp);
    return this.glyph(0x3f) ?? { advance: NOTDEF_ADVANCE, segs: [] };
  }

  /** Advance of `cp` in 1/1000 em. */
  advance(cp: number): number {
    return this.glyph(cp)?.advance ?? this.glyph(0x3f)?.advance ?? NOTDEF_ADVANCE;
  }

  /** Width of `text` in points at `size`. */
  width(text: string, size: number): number {
    let w = 0;
    for (const ch of text.normalize('NFC')) w += this.advance(ch.codePointAt(0)!);
    return (w * size) / 1000;
  }
}

/** Blocks needed to draw all `texts` (always `latin`, for the characters mixed in). */
export function blocksFor(texts: Iterable<string>): Set<Block> {
  const blocks = new Set<Block>();
  for (const text of texts) {
    if (!needsUnicode(text)) continue;
    blocks.add('latin');
    for (const ch of text.normalize('NFC')) {
      const b = blockOf(ch.codePointAt(0)!);
      if (b) blocks.add(b);
    }
  }
  return blocks;
}

/** Loads the outline tables `texts` need, or `undefined` when WinAnsi is enough. */
export async function loadTextFont(texts: Iterable<string>): Promise<TextFont | undefined> {
  const blocks = blocksFor(texts);
  if (blocks.size === 0) return undefined;
  const tables = await Promise.all([...blocks].map(async (b) => (await LOADERS[b]()).default));
  return new TextFont(tables);
}

/** Text width for page layout: Inter for text that needs it, the Helvetica table otherwise. */
export function measurer(
  font: TextFont | undefined,
  helvetica: (text: string, size: number) => number,
): (text: string, size: number) => number {
  return (text, size) =>
    font && needsUnicode(text) ? font.width(text, size) : helvetica(text, size);
}

/**
 * Text layer of one PDF: assigns a CID to every code point used by outlined text and writes the
 * Type0 font objects (not embedded, only used in invisible text) with a ToUnicode CMap.
 */
export class TextLayer {
  private readonly cids = new Map<number, number>();
  private readonly cps: number[] = [];

  constructor(readonly font: TextFont) {}

  get used(): boolean {
    return this.cps.length > 0;
  }

  /** Hex string of the CIDs of `text` (two bytes each). */
  hex(text: string): string {
    let out = '';
    for (const ch of text.normalize('NFC')) {
      const cp = ch.codePointAt(0)!;
      let cid = this.cids.get(cp);
      if (cid === undefined) {
        cid = this.cps.length + 1;
        this.cids.set(cp, cid);
        this.cps.push(cp);
      }
      out += cid.toString(16).padStart(4, '0');
    }
    return `<${out}>`;
  }

  /** Widths array `[1 [w1 w2 ...]]` (CID order) in 1/1000 em. */
  widths(): string {
    return `[1 [${this.cps.map((cp) => Math.round(this.font.advance(cp))).join(' ')}]]`;
  }

  /** ToUnicode CMap source. */
  toUnicode(): string {
    const utf16 = (cp: number) => {
      const s = String.fromCodePoint(cp);
      let h = '';
      for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
      return h;
    };
    const blocks: string[] = [];
    for (let i = 0; i < this.cps.length; i += 100) {
      const rows = this.cps
        .slice(i, i + 100)
        .map((cp, k) => `<${(i + k + 1).toString(16).padStart(4, '0')}> <${utf16(cp)}>`);
      blocks.push(`${rows.length} beginbfchar\n${rows.join('\n')}\nendbfchar`);
    }
    return [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      ...blocks,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n');
  }
}
