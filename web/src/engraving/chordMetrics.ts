/** Sizes of chord symbols and fretboard diagrams, px (see chords.ts and drawChords.ts). */
export const CHORD = {
  /** Font size of the symbol, px. */
  size: 15,
  supSize: 10.5,
  capoSize: 12,
  /** Baseline offset of raised text, px (up). */
  supRaise: 5.5,
  /** Height of one row of symbols, px. */
  row: 20,
  /** Baseline of the symbol above the top staff line (no diagram), px. */
  baseline: 18,
  /** Space between a diagram and the staff, px. */
  clearance: 12,
  stringGap: 6,
  fretGap: 8,
  /** Rows of frets drawn. */
  frets: 4,
  /** Row of open and muted markers above the nut, px. */
  marker: 9,
  /** Room left of the grid for the fret number of a shape that is not at the nut, px. */
  labelWidth: 9,
  /** Minimum clear space between two symbols, px. */
  gap: 6,
} as const;

/** Height of a diagram box (markers + fret rows). */
export const DIAGRAM_HEIGHT = CHORD.marker + CHORD.frets * CHORD.fretGap + 2;
/** Extra height reserved above a staff that carries diagrams. */
export const DIAGRAM_BAND = DIAGRAM_HEIGHT + 4;

export function diagramWidth(strings: number): number {
  return (strings - 1) * CHORD.stringGap + CHORD.labelWidth + 4;
}
