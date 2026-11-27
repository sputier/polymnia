// Extracts Inter glyph outlines (Regular 400) for the PDF export into src/export/inter/*.json.
// PDF text outside WinAnsi (Latin Extended, Greek, Cyrillic) is drawn as vector outlines, like the
// Bravura music glyphs, because the PDF writer embeds no font file. One JSON file per script, each
// loaded on demand by `import()` only when the document needs it. Inter is SIL OFL 1.1 (see
// THIRD_PARTY_NOTICES.md). Source: the @fontsource/inter woff subsets.
// Usage (from web/): node scripts/export/build-text-outlines.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UNITS = 1000; // outlines are stored on a 1000 units per em grid
const OUT = join(root, 'src/export/inter');
mkdirSync(OUT, { recursive: true });

// Block name -> fontsource subsets and the code point ranges kept from them.
const BLOCKS = {
  latin: {
    files: ['latin'],
    ranges: [
      [0x20, 0x7e],
      [0xa0, 0xff],
      [0x2010, 0x2027],
      [0x2030, 0x203a],
      [0x131, 0x131],
      [0x152, 0x153],
      [0x160, 0x161],
      [0x178, 0x178],
      [0x17d, 0x17e],
      [0x192, 0x192],
      [0x2c6, 0x2c6],
      [0x2da, 0x2dc],
      [0x20ac, 0x20ac],
      [0x2122, 0x2122],
      [0x2212, 0x2212],
    ],
  },
  'latin-ext': {
    files: ['latin-ext'],
    ranges: [
      [0x100, 0x24f],
      [0x1e00, 0x1eff],
      [0x20a0, 0x20bf],
    ],
  },
  greek: {
    files: ['greek', 'greek-ext'],
    ranges: [
      [0x370, 0x3ff],
      [0x1f00, 0x1fff],
    ],
  },
  cyrillic: {
    files: ['cyrillic', 'cyrillic-ext'],
    ranges: [[0x400, 0x52f]],
  },
};

const load = (name) => {
  const b = readFileSync(
    join(root, `node_modules/@fontsource/inter/files/inter-${name}-400-normal.woff`),
  );
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

for (const [block, { files, ranges }] of Object.entries(BLOCKS)) {
  const fonts = files.map(load);
  const glyphs = {};
  for (const [from, to] of ranges) {
    for (let cp = from; cp <= to; cp++) {
      for (const font of fonts) {
        const glyph = font.charToGlyph(String.fromCodePoint(cp));
        if (!glyph || glyph.index === 0) continue;
        const k = UNITS / font.unitsPerEm;
        const r = (n) => Math.round(n * k);
        let path = '';
        let px = 0;
        let py = 0;
        // Relative coordinates compress better; y up (font units), flipped when drawn.
        const rel = (x, y) => {
          const s = `${r(x) - px} ${r(y) - py}`;
          px = r(x);
          py = r(y);
          return s;
        };
        for (const c of glyph.path.commands) {
          if (c.type === 'M') path += `M${rel(c.x, c.y)}`;
          else if (c.type === 'L') path += `L${rel(c.x, c.y)}`;
          else if (c.type === 'Q') {
            const a = rel(c.x1, c.y1);
            path += `Q${a} ${rel(c.x, c.y)}`;
          } else if (c.type === 'C') {
            const a = rel(c.x1, c.y1);
            const b = rel(c.x2, c.y2);
            path += `C${a} ${b} ${rel(c.x, c.y)}`;
          } else if (c.type === 'Z') path += 'Z';
        }
        glyphs[cp.toString(16)] = [r(glyph.advanceWidth), path];
        break;
      }
    }
  }
  const file = join(OUT, `${block}.json`);
  writeFileSync(file, JSON.stringify({ units: UNITS, glyphs }) + '\n');
  console.log(`${block}: ${Object.keys(glyphs).length} glyphs -> ${file}`);
}
