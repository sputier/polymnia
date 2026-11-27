import type { Alter, Pitch, StepName } from './types';

const STEP_SEMITONE: Record<StepName, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const STEPS: readonly StepName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export function pitchToMidi(p: Pitch): number {
  return (p.octave + 1) * 12 + STEP_SEMITONE[p.step] + p.alter;
}

export function pitchEquals(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.alter === b.alter && a.octave === b.octave;
}

/** Ordering by height, then spelling (stable chord ordering). */
export function comparePitch(a: Pitch, b: Pitch): number {
  return (
    pitchToMidi(a) - pitchToMidi(b) ||
    STEPS.indexOf(a.step) - STEPS.indexOf(b.step) ||
    a.alter - b.alter
  );
}

const SHARP_ORDER: readonly StepName[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly StepName[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Alteration a key signature applies to a natural step. */
export function keyAlter(step: StepName, fifths: number): Alter {
  if (fifths > 0 && SHARP_ORDER.indexOf(step) < fifths) return 1;
  if (fifths < 0 && FLAT_ORDER.indexOf(step) < -fifths) return -1;
  return 0;
}

const SHARP_SPELL: readonly (readonly [StepName, Alter])[] = [
  ['C', 0],
  ['C', 1],
  ['D', 0],
  ['D', 1],
  ['E', 0],
  ['F', 0],
  ['F', 1],
  ['G', 0],
  ['G', 1],
  ['A', 0],
  ['A', 1],
  ['B', 0],
];
const FLAT_SPELL: readonly (readonly [StepName, Alter])[] = [
  ['C', 0],
  ['D', -1],
  ['D', 0],
  ['E', -1],
  ['E', 0],
  ['F', 0],
  ['G', -1],
  ['G', 0],
  ['A', -1],
  ['A', 0],
  ['B', -1],
  ['B', 0],
];

function build(midi: number, step: StepName, alter: Alter): Pitch {
  return { step, alter, octave: Math.floor((midi - STEP_SEMITONE[step] - alter) / 12) - 1 };
}

/**
 * Spells a MIDI number. Diatonic notes of the key signature use the key's spelling; other notes use
 * sharps in sharp keys and flats in flat keys (C major: sharps unless `preferFlats`).
 */
export function midiToPitch(midi: number, fifths = 0, preferFlats = false): Pitch {
  const pc = ((midi % 12) + 12) % 12;
  for (const step of STEPS) {
    const alter = keyAlter(step, fifths);
    if ((((STEP_SEMITONE[step] + alter) % 12) + 12) % 12 === pc) return build(midi, step, alter);
  }
  const flats = fifths < 0 || (fifths === 0 && preferFlats);
  const [step, alter] = (flats ? FLAT_SPELL : SHARP_SPELL)[pc]!;
  return build(midi, step, alter);
}

export function shiftOctaves(p: Pitch, octaves: number): Pitch {
  return { step: p.step, alter: p.alter, octave: p.octave + octaves };
}

/**
 * Pitch heard when a written pitch is played on a transposing instrument (playback helper).
 * Whole-octave transpositions keep the spelling; others use the default spelling.
 */
export function soundingPitch(written: Pitch, transposition: number): Pitch {
  if (transposition % 12 === 0) return shiftOctaves(written, transposition / 12);
  return midiToPitch(pitchToMidi(written) + transposition, 0, transposition < 0);
}

export function soundingMidi(written: Pitch, transposition: number): number {
  return pitchToMidi(written) + transposition;
}
