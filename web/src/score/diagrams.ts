/**
 * Which chord symbols show a fretboard diagram. Model-level and pure: the editor, the engraver, the
 * MusicXML export and the playback all read it. The diagrams themselves are drawn by the engraver
 * (engraving/drawChords.ts) from the lazy chord library (chords/library.ts).
 */
import { formatChord } from './chords';
import { partTuning } from './instruments';
import type { Part, Score } from './types';

/** Number of strings a part's diagrams have (undefined: no diagrams for this instrument). */
export function diagramStrings(part: Part): number | undefined {
  return partTuning(part)?.length;
}

/**
 * Ids of the chord symbols that show a diagram: for parts with strings, the part's mode (first
 * occurrence of each chord, or all) and the per-chord flag, which wins over the mode.
 */
export function diagramPlan(score: Score): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const part of score.parts) {
    if (diagramStrings(part) === undefined) continue;
    const mode = part.chordDiagrams;
    const seen = new Set<string>();
    for (const staff of part.staves) {
      for (const sm of staff.measures) {
        for (const c of sm.chords ?? []) {
          const key = formatChord(c) + (c.frame ? '|f' : '');
          const first = !seen.has(key);
          seen.add(key);
          if (c.diagram !== undefined ? c.diagram : mode === 'all' || (mode === 'first' && first))
            ids.add(c.id);
        }
      }
    }
  }
  return ids;
}

/** True when any chord of the score can ask for a diagram (loads the chord library). */
export function needsChordLibrary(score: Score): boolean {
  for (const part of score.parts) {
    if (diagramStrings(part) === undefined) continue;
    if (part.chordDiagrams) {
      for (const staff of part.staves)
        for (const sm of staff.measures) if (sm.chords?.length) return true;
    } else {
      for (const staff of part.staves)
        for (const sm of staff.measures) if (sm.chords?.some((c) => c.diagram)) return true;
    }
  }
  return false;
}
