/**
 * VexFlow configuration. The core entry of VexFlow carries no font: Bravura is loaded here from
 * our own hashed woff2 (see fonts.ts) and the text font is the UI font (Inter, already self-hosted),
 * so nothing is embedded as a data URL in the JavaScript chunk.
 *
 * Glyph metrics ship with the library; the font file only provides the pixels, so a late font
 * never changes the layout. `loadEngravingFonts()` never rejects.
 */
import { Font, VexFlow } from 'vexflow/core';
import { BRAVURA_URL } from './fonts';

VexFlow.setFonts('Bravura');
VexFlow.setTextFonts('Inter', 'system-ui', 'sans-serif');

let ready: Promise<void> | undefined;

/** Starts loading the music font (once). Resolves when it is loaded, or when it failed. */
export function loadEngravingFonts(): Promise<void> {
  ready ??= Font.load('Bravura', BRAVURA_URL, { display: 'block' }).then(
    () => undefined,
    () => undefined, // the score renders anyway; glyphs show up once the font is available
  );
  return ready;
}
