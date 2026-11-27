/**
 * Chord symbols as sound. Pure: a chord, the part's tuning and a way to look up a fretboard shape
 * in, sounding MIDI numbers out.
 *
 * - Strings (guitar, ukulele...): the shape of the diagram, string by string, with the capo
 *   (a shape counts frets from the capo, so the sounding pitch is the symbol's). The chord is what
 *   the diagram shows, so what you hear is what you would play.
 * - Everything else: a root-position voicing: the bass note (the slash bass or the root) low, the
 *   chord tones stacked in the octave above middle C.
 */
import { chordTones, notePc, type ChordData } from '../score/chords';
import { pitchToMidi } from '../score/pitch';
import type { ChordFrame, Pitch } from '../score/types';

export type ChordPlayback = 'off' | 'block' | 'strum';

export type ShapeLookup = (
  chord: ChordData,
  tuning: readonly Pitch[],
  capo: number,
) => ChordFrame | undefined;

export interface VoicingContext {
  /** Open strings of the part (sounding pitches, highest string first), when it has strings. */
  readonly tuning?: readonly Pitch[] | undefined;
  readonly capo: number;
  /** Looks a diagram up (the chord library, loaded lazily); without it strings use the generic voicing. */
  readonly lookup?: ShapeLookup | undefined;
  /** Diagram drawn with the chord (imported from a file), played as is. */
  readonly frame?: ChordFrame | undefined;
}

/** Sounding MIDI numbers of a chord, lowest first. */
export function voiceChord(chord: ChordData, ctx: VoicingContext): number[] {
  if (ctx.tuning) {
    const shape = ctx.frame ?? ctx.lookup?.(chord, ctx.tuning, ctx.capo);
    if (shape && shape.frets.length === ctx.tuning.length) {
      const notes: number[] = [];
      shape.frets.forEach((fret, i) => {
        if (fret >= 0) notes.push(pitchToMidi(ctx.tuning![i]!) + ctx.capo + fret);
      });
      // A re-entrant tuning (ukulele) is not ordered by string: the strum order is by pitch.
      if (notes.length > 0) return notes.sort((a, b) => a - b);
    }
  }
  return closeVoicing(chord);
}

/** The bass low, then the chord tones in one octave above middle C (close position). */
export function closeVoicing(chord: ChordData): number[] {
  const tones = chordTones(chord);
  const root = notePc(chord.root);
  // The root sits between G3 and F#4, so the voicing stays in the middle of the keyboard.
  const base = 60 + (root > 6 ? root - 12 : root);
  const upper = new Set<number>();
  for (const interval of tones.intervals) upper.add(base + (interval % 12));
  let notes = [...upper].sort((a, b) => a - b);
  // A 9th, 11th or 13th chord is not played in full: five notes at most, the fifth goes first.
  if (notes.length > 5) notes = notes.filter((n) => n !== base + 7).slice(0, 5);
  const bass = 48 + (tones.bass > 6 ? tones.bass - 12 : tones.bass);
  return [bass, ...notes];
}

/** Delay between two strings of a strum, in ticks (a few tens of milliseconds at moderate tempi). */
export const STRUM_TICKS = 36;
