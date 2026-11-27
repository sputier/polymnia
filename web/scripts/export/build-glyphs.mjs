// Extracts the Bravura outlines the engraver can draw into src/export/bravura-outlines.json.
// The PDF and PNG exports draw music glyphs as vector paths (the font is served as woff2, which no
// PDF viewer can embed), so they need the outlines. Bravura is SIL OFL 1.1 (see THIRD_PARTY_NOTICES.md).
// Usage (from web/): node scripts/export/build-glyphs.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const font = opentype.parse(
  (() => {
    const b = readFileSync(join(root, 'node_modules/@vexflow-fonts/bravura/bravura.otf'));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  })(),
);

// SMuFL blocks VexFlow draws: staff and brackets, repeats, clefs, time signatures, noteheads,
// notes and flags, accidentals, articulations, rests, dynamics, ornaments, tuplets, tab.
const RANGES = [
  [0xe000, 0xe00f], // brace, brackets
  [0xe050, 0xe06e], // clefs, tab clef
  [0xe080, 0xe09f], // time signature digits
  [0xe0a0, 0xe0bf], // noteheads
  [0xe1e7, 0xe1e8], // augmentation dots
  [0xe240, 0xe24f], // flags
  [0xe260, 0xe26f], // accidentals
  [0xe4e0, 0xe4ef], // rests
  [0xe880, 0xe88f], // tuplet digits
];

const round = (n) => Math.round(n);
const glyphs = {};
for (const [from, to] of RANGES) {
  for (let cp = from; cp <= to; cp++) {
    const glyph = font.charToGlyph(String.fromCodePoint(cp));
    if (!glyph || glyph.index === 0) continue;
    const parts = [];
    for (const c of glyph.getPath(0, 0, font.unitsPerEm).commands) {
      // Flip y (the font is y up, the page y down): getPath already does, at size = unitsPerEm.
      if (c.type === 'M' || c.type === 'L') parts.push(`${c.type}${round(c.x)} ${round(c.y)}`);
      else if (c.type === 'C')
        parts.push(
          `C${round(c.x1)} ${round(c.y1)} ${round(c.x2)} ${round(c.y2)} ${round(c.x)} ${round(c.y)}`,
        );
      else if (c.type === 'Q')
        parts.push(`Q${round(c.x1)} ${round(c.y1)} ${round(c.x)} ${round(c.y)}`);
      else if (c.type === 'Z') parts.push('Z');
    }
    if (parts.length > 0) glyphs[cp.toString(16).toUpperCase()] = parts.join('');
  }
}

const out = join(root, 'src/export/bravura-outlines.json');
writeFileSync(out, JSON.stringify({ unitsPerEm: font.unitsPerEm, glyphs }) + '\n');
console.log(`${Object.keys(glyphs).length} glyphs, unitsPerEm ${font.unitsPerEm} -> ${out}`);
