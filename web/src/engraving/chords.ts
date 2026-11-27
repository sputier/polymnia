/**
 * Chord symbols and fretboard diagrams, the pure part: typography (runs of text with sizes and
 * offsets), widths for the layout, and which chords show a diagram. No VexFlow, no DOM.
 *
 * Typography: the symbol is set in the UI font (Inter) at 15 px. The root and bass letters are on
 * the baseline; `m`, `maj`, `dim`, `aug` and `sus` stay on it too; numbers, alterations and added
 * tones are raised and smaller. Sharps and flats are Bravura glyphs (SMuFL), never the characters
 * `#` and `b`, so they look like music accidentals and export as vector outlines.
 */
import {
  formatChord,
  qualityRuns,
  shapeOf,
  solfegeName,
  type ChordData,
  type NoteNaming,
} from '../score/chords';
import { diagramStrings } from '../score/diagrams';
import type { ChordNote, ChordSymbol, Part } from '../score/types';

import { getChordNaming } from './chordNaming';
import { CHORD, DIAGRAM_BAND, DIAGRAM_HEIGHT, diagramWidth } from './chordMetrics';

export { CHORD, DIAGRAM_BAND, DIAGRAM_HEIGHT, diagramWidth };

// ---------------------------------------------------------------------------------------------
// Text runs
// ---------------------------------------------------------------------------------------------

export interface TextRun {
  readonly text: string;
  /** `music` is a SMuFL code point drawn with Bravura. */
  readonly font: 'text' | 'music';
  readonly size: number;
  readonly x: number;
  /** Offset from the baseline, px (negative = up). */
  readonly dy: number;
}

export interface ChordLabel {
  readonly runs: readonly TextRun[];
  readonly width: number;
}

const GLYPH = { sharp: '', flat: '', doubleSharp: '', doubleFlat: '' };
/** Advance of the accidental glyphs, in em. */
const GLYPH_ADVANCE: Record<string, number> = {
  [GLYPH.sharp]: 0.3,
  [GLYPH.flat]: 0.24,
  [GLYPH.doubleSharp]: 0.3,
  [GLYPH.doubleFlat]: 0.46,
};

const NARROW = new Set('ijlt1fr()/,.');
const WIDE = new Set('mwMW');

/** Width of text in Inter, in em (an estimate that is good enough to keep symbols apart). */
function charEm(ch: string): number {
  if (WIDE.has(ch)) return ch === 'M' || ch === 'W' ? 0.9 : 0.86;
  if (ch === '(' || ch === ')') return 0.34;
  if (ch === '/') return 0.4;
  if (NARROW.has(ch)) return 0.33;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  if (ch >= '0' && ch <= '9') return 0.6;
  return 0.56;
}

class Builder {
  runs: TextRun[] = [];
  x = 0;

  constructor(private readonly naming: NoteNaming) {}

  text(text: string, size: number, dy = 0): void {
    if (text === '') return;
    this.runs.push({ text, font: 'text', size, x: this.x, dy });
    for (const ch of text) this.x += charEm(ch) * size;
  }

  accidental(alter: number, size: number, dy = 0): void {
    const list =
      alter === 1
        ? [GLYPH.sharp]
        : alter === -1
          ? [GLYPH.flat]
          : alter === 2
            ? [GLYPH.doubleSharp]
            : alter === -2
              ? [GLYPH.doubleFlat]
              : [];
    for (const g of list) {
      // SMuFL accidentals are centred on the staff line they sit on: lift them to the x-height.
      const lift = g === GLYPH.flat || g === GLYPH.doubleFlat ? 0.2 : 0.3;
      this.runs.push({ text: g, font: 'music', size, x: this.x + 0.5, dy: dy - lift * size });
      this.x += (GLYPH_ADVANCE[g] ?? 0.3) * size + 1;
    }
  }

  note(n: ChordNote, size: number): void {
    this.text(this.naming === 'solfege' ? solfegeName(n.step) : n.step, size);
    this.accidental(n.alter, size);
  }

  /** Raised text where `#` and `b` followed by a digit are accidentals. */
  raised(text: string): void {
    const size = CHORD.supSize;
    const dy = -CHORD.supRaise;
    let plain = '';
    const flush = () => {
      this.text(plain, size, dy);
      plain = '';
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const next = text[i + 1];
      if (ch === '#') {
        flush();
        this.accidental(1, size, dy);
      } else if (ch === 'b' && next !== undefined && next >= '0' && next <= '9') {
        flush();
        this.accidental(-1, size, dy);
      } else plain += ch;
    }
    flush();
  }
}

function chordRuns(b: Builder, chord: ChordData, size: number): void {
  b.note(chord.root, size);
  for (const run of qualityRuns(chord.quality)) {
    if (run.sup) b.raised(run.text);
    else b.text(run.text, size);
  }
  if (chord.bass) {
    b.text('/', size);
    b.note(chord.bass, size);
  }
}

/**
 * The text of a chord symbol. With `shape`, the shape the player forms with a capo follows in
 * parentheses and a smaller size: `D (C)`.
 */
export function chordLabel(
  chord: ChordData,
  shape?: ChordData,
  naming: NoteNaming = getChordNaming(),
): ChordLabel {
  const b = new Builder(naming);
  chordRuns(b, chord, CHORD.size);
  if (shape) {
    b.x += 3;
    b.text('(', CHORD.capoSize);
    chordRuns(b, shape, CHORD.capoSize);
    b.text(')', CHORD.capoSize);
  }
  return { runs: b.runs, width: b.x };
}

/** Text read by screen readers and tooltips (`F#m7b5/A`). */
export function chordText(chord: ChordData, naming: NoteNaming = getChordNaming()): string {
  return formatChord(chord, naming);
}

// ---------------------------------------------------------------------------------------------
// Which chords show a diagram, and how wide a chord is
// ---------------------------------------------------------------------------------------------

/** The shape chord for display next to a symbol, or undefined when it is not wanted. */
export function capoShape(part: Part, chord: ChordSymbol): ChordData | undefined {
  if (!part.chordCapoShapes || !part.capo) return undefined;
  return shapeOf(chord, part.capo);
}

export interface ChordWidthOptions {
  readonly part: Part;
  readonly diagram: boolean;
}

/** Horizontal room a chord needs, label and diagram together, px. */
export function chordWidth(chord: ChordSymbol, opts: ChordWidthOptions): number {
  const label = chordLabel(chord, capoShape(opts.part, chord));
  const strings = diagramStrings(opts.part);
  const d = opts.diagram && strings !== undefined ? diagramWidth(strings) : 0;
  return Math.max(label.width, d);
}

// The model-level helpers live in the score module (the editor needs them without the typography).
export { diagramPlan, diagramStrings, needsChordLibrary } from '../score/diagrams';
