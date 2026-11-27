/** Pure pitch logic of note entry: octave choice and accidentals (no store, no DOM). */
import {
  keyAlter,
  keyFifthsAt,
  STEPS,
  voiceEventTicks,
  type Alter,
  type Clef,
  type Pitch,
  type Score,
  type StepName,
} from '../../score';

function stepIndex(p: Pick<Pitch, 'step' | 'octave'>): number {
  return p.octave * 7 + STEPS.indexOf(p.step);
}

/** Pitch of the middle staff line: where the first note is entered when there is no previous one. */
const CLEF_REFERENCE: Record<Clef, Pitch> = {
  treble: { step: 'B', alter: 0, octave: 4 },
  'treble-8vb': { step: 'B', alter: 0, octave: 4 },
  bass: { step: 'D', alter: 0, octave: 3 },
  alto: { step: 'C', alter: 0, octave: 4 },
  tenor: { step: 'A', alter: 0, octave: 3 },
  percussion: { step: 'B', alter: 0, octave: 4 },
};

export function referencePitch(clef: Clef): Pitch {
  return CLEF_REFERENCE[clef];
}

/**
 * MuseScore rule: the octave that puts `step` closest to `reference` (by staff position, not by
 * semitones). A fourth up is nearer than a fifth down: F then B gives the B above.
 */
export function nearestOctave(step: StepName, reference: Pitch): number {
  const up = (((STEPS.indexOf(step) - STEPS.indexOf(reference.step)) % 7) + 7) % 7;
  const delta = up <= 3 ? up : up - 7;
  return Math.floor((stepIndex(reference) + delta) / 7);
}

/**
 * Alteration in force for a step and octave at `tick` of a staff measure: the last accidental
 * written earlier in the measure (any voice) on the same line or space, else the key signature.
 */
export function alterInForce(
  score: Score,
  loc: { partIndex: number; staffIndex: number; measure: number },
  tick: number,
  step: StepName,
  octave: number,
): Alter {
  const sm = score.parts[loc.partIndex]?.staves[loc.staffIndex]?.measures[loc.measure];
  let alter: Alter = keyAlter(step, keyFifthsAt(score, loc.measure));
  let latest = -1;
  for (const voice of sm?.voices ?? []) {
    const ticks = voiceEventTicks(voice);
    let start = 0;
    voice.events.forEach((e, i) => {
      if (e.kind === 'note' && start < tick && start >= latest) {
        for (const p of e.pitches) {
          if (p.step === step && p.octave === octave) {
            alter = p.alter;
            latest = start;
          }
        }
      }
      start += ticks[i]!;
    });
  }
  return alter;
}

/** Beat number (1-based, in units of the time signature's beat) of a tick. */
export function beatOf(beatType: number, tick: number): number {
  return Math.round((tick / ((4 * 960) / beatType) + 1) * 100) / 100;
}
