/**
 * Minimal PDF 1.4 writer for pages of vector items: filled/stroked paths and text in Helvetica
 * (one of the 14 standard fonts, so nothing to embed). Page content is Flate compressed.
 * Colors are fixed (black ink on the white paper): the output never depends on the app theme.
 */
import { zlibSync } from 'fflate';
import type { Page } from './pages';
import type { Item, PathItem, TextItem } from './svgItems';
import { textWidth } from './pages';
import { needsUnicode, TextLayer, type TextFont } from './textFont';

const enc = new TextEncoder();

/** Windows-1252 code points for U+0080 to U+009F (the rest of Latin-1 maps to itself). */
const CP1252: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** Text as a PDF hex string in WinAnsi; characters the font cannot show become `?`. */
export function winAnsiHex(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    let byte = 0x3f;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) byte = cp;
    else if (CP1252[cp] !== undefined) byte = CP1252[cp]!;
    out += byte.toString(16).padStart(2, '0');
  }
  return `<${out}>`;
}

/** UTF-16BE hex string with a byte order mark (document information strings). */
function utf16Hex(text: string): string {
  let out = 'feff';
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${out}>`;
}

const num = (n: number): string => {
  const s = n.toFixed(2);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

function pathOps(item: PathItem, height: number, out: string[]): void {
  const y = (v: number) => num(height - v);
  for (const s of item.segs) {
    switch (s[0]) {
      case 'M':
        out.push(`${num(s[1])} ${y(s[2])} m`);
        break;
      case 'L':
        out.push(`${num(s[1])} ${y(s[2])} l`);
        break;
      case 'C':
        out.push(`${num(s[1])} ${y(s[2])} ${num(s[3])} ${y(s[4])} ${num(s[5])} ${y(s[6])} c`);
        break;
      case 'Z':
        out.push('h');
        break;
    }
  }
  if (item.fill && item.stroke) out.push('B');
  else if (item.fill) out.push('f');
  else out.push('S');
}

function style(item: PathItem, out: string[]): void {
  if (item.stroke) {
    out.push(`${num(Math.max(item.lineWidth, 0.05))} w`);
    out.push(item.dash.length > 0 ? `[${item.dash.map(num).join(' ')}] 0 d` : '[] 0 d');
  }
}

function textOps(item: TextItem, height: number, out: string[], layer?: TextLayer): void {
  if (layer && needsUnicode(item.text)) {
    outlinedText(item, height, out, layer);
    return;
  }
  const w = textWidth(item.text, item.size);
  const x = item.align === 'middle' ? item.x - w / 2 : item.align === 'end' ? item.x - w : item.x;
  out.push(
    `BT /F1 ${num(item.size)} Tf ${num(x)} ${num(height - item.y)} Td ${winAnsiHex(item.text)} Tj ET`,
  );
}

/**
 * Text outside WinAnsi: glyph outlines (filled paths, Inter metrics) plus the same text invisible
 * (render mode 3) in the Unicode font, so it can be selected, searched and copied.
 */
function outlinedText(item: TextItem, height: number, out: string[], layer: TextLayer): void {
  const { font } = layer;
  const k = item.size / 1000;
  const w = font.width(item.text, item.size);
  let x = item.align === 'middle' ? item.x - w / 2 : item.align === 'end' ? item.x - w : item.x;
  const startX = x;
  const base = height - item.y;
  for (const ch of item.text.normalize('NFC')) {
    const glyph = font.drawable(ch.codePointAt(0)!);
    const px = (v: number) => num(x + v * k);
    const py = (v: number) => num(base + v * k);
    for (const s of glyph.segs) {
      if (s[0] === 'M') out.push(`${px(s[1])} ${py(s[2])} m`);
      else if (s[0] === 'L') out.push(`${px(s[1])} ${py(s[2])} l`);
      else if (s[0] === 'C')
        out.push(`${px(s[1])} ${py(s[2])} ${px(s[3])} ${py(s[4])} ${px(s[5])} ${py(s[6])} c`);
      else out.push('h');
    }
    if (glyph.segs.length > 0) out.push('f');
    x += glyph.advance * k;
  }
  out.push(
    `BT 3 Tr /F2 ${num(item.size)} Tf ${num(startX)} ${num(base)} Td ${layer.hex(item.text)} Tj 0 Tr ET`,
  );
}

/** Content stream of a page (uncompressed). */
export function pageContent(page: Page, layer?: TextLayer): string {
  // White paper first (a viewer in dark mode must not show the sheet dark), then black ink.
  const out: string[] = [`1 g 0 0 ${num(page.width)} ${num(page.height)} re f`, '0 g 0 G 1 J 1 j'];
  for (const item of page.items as Item[]) {
    if (item.kind === 'path') {
      style(item, out);
      pathOps(item, page.height, out);
    } else textOps(item, page.height, out, layer);
  }
  return out.join('\n');
}

export interface PdfInfo {
  readonly title: string;
  readonly author: string;
  readonly creator: string;
}

/** Builds the document. `pages` may be empty-looking but never zero (the caller adds a blank). */
export function buildPdf(
  pages: readonly Page[],
  info: PdfInfo,
  font?: TextFont,
): Uint8Array<ArrayBuffer> {
  const layer = font ? new TextLayer(font) : undefined;
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string | Uint8Array, dict?: string) => {
    offsets[id] = length;
    if (typeof body === 'string') {
      push(`${id} 0 obj\n${body}\nendobj\n`);
    } else {
      push(`${id} 0 obj\n<< ${dict ?? ''} /Length ${body.length} >>\nstream\n`);
      push(body);
      push('\nendstream\nendobj\n');
    }
  };

  // Ids: 1 catalog, 2 page tree, 3 font, 4 info, then per page: page, content.
  const pageId = (i: number) => 5 + i * 2;
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`,
  );
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  object(
    4,
    `<< /Title ${utf16Hex(info.title)} /Author ${utf16Hex(info.author)} /Creator ${utf16Hex(info.creator)} /Producer ${utf16Hex(info.creator)} >>`,
  );
  // Content first: it decides whether the Unicode font (F2) is needed.
  const contents = pages.map((page) =>
    zlibSync(enc.encode(pageContent(page, layer)), { level: 6 }),
  );
  const extra = layer?.used ? 5 + pages.length * 2 : 0;
  pages.forEach((page, i) => {
    const fonts = extra ? `/F1 3 0 R /F2 ${extra} 0 R` : '/F1 3 0 R';
    object(
      pageId(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << ${fonts} >> >> /Contents ${pageId(i) + 1} 0 R >>`,
    );
    object(pageId(i) + 1, contents[i]!, '/Filter /FlateDecode');
  });
  if (layer && extra) {
    // Type0 font, not embedded: it only carries invisible text (the outlines are drawn as paths).
    object(
      extra,
      `<< /Type /Font /Subtype /Type0 /BaseFont /Inter-Regular /Encoding /Identity-H /DescendantFonts [${extra + 1} 0 R] /ToUnicode ${extra + 3} 0 R >>`,
    );
    object(
      extra + 1,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Inter-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${extra + 2} 0 R /DW 600 /W ${layer.widths()} /CIDToGIDMap /Identity >>`,
    );
    object(
      extra + 2,
      '<< /Type /FontDescriptor /FontName /Inter-Regular /Flags 32 /FontBBox [-200 -250 1200 950] /ItalicAngle 0 /Ascent 969 /Descent -241 /CapHeight 727 /StemV 80 >>',
    );
    object(extra + 3, enc.encode(layer.toUnicode()));
  }

  const xref = length;
  const count = 5 + pages.length * 2 + (extra ? 4 : 0);
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out as Uint8Array<ArrayBuffer>;
}
