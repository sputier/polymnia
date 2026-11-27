/** Tuning presets, effective range and automatic fretting of fretted parts. */
import { getInstrument } from './instruments';
import { pitchToMidi, soundingPitch } from './pitch';
import type { Alter, Part, Pitch, Score, StepName, Voice } from './types';

const p = (step: StepName, octave: number, alter: Alter = 0): Pitch => ({ step, alter, octave });

export interface TuningPreset {
  readonly id: string;
  readonly names: { readonly en: string; readonly fr: string };
  /** Sounding open-string pitches, high string to low string. */
  readonly strings: readonly Pitch[];
}

const GUITAR_PRESETS: readonly TuningPreset[] = [
  {
    id: 'standard',
    names: { en: 'Standard (E A D G B E)', fr: 'Standard (mi la ré sol si mi)' },
    strings: [p('E', 4), p('B', 3), p('G', 3), p('D', 3), p('A', 2), p('E', 2)],
  },
  {
    id: 'drop-d',
    names: { en: 'Drop D (D A D G B E)', fr: 'Drop D (ré la ré sol si mi)' },
    strings: [p('E', 4), p('B', 3), p('G', 3), p('D', 3), p('A', 2), p('D', 2)],
  },
  {
    id: 'dadgad',
    names: { en: 'DADGAD', fr: 'DADGAD' },
    strings: [p('D', 4), p('A', 3), p('G', 3), p('D', 3), p('A', 2), p('D', 2)],
  },
  {
    id: 'open-g',
    names: { en: 'Open G (D G D G B D)', fr: 'Sol ouvert (ré sol ré sol si ré)' },
    strings: [p('D', 4), p('B', 3), p('G', 3), p('D', 3), p('G', 2), p('D', 2)],
  },
  {
    id: 'open-d',
    names: { en: 'Open D (D A D F♯ A D)', fr: 'Ré ouvert (ré la ré fa♯ la ré)' },
    strings: [p('D', 4), p('A', 3), p('F', 3, 1), p('D', 3), p('A', 2), p('D', 2)],
  },
  {
    id: 'half-step-down',
    names: { en: 'Half step down (E♭ standard)', fr: 'Demi-ton plus bas (mi♭ standard)' },
    strings: [
      p('E', 4, -1),
      p('B', 3, -1),
      p('G', 3, -1),
      p('D', 3, -1),
      p('A', 2, -1),
      p('E', 2, -1),
    ],
  },
  {
    id: 'whole-step-down',
    names: { en: 'Whole step down (D standard)', fr: 'Ton plus bas (ré standard)' },
    strings: [p('D', 4), p('A', 3), p('F', 3), p('C', 3), p('G', 2), p('D', 2)],
  },
];

const UKULELE_PRESETS: readonly TuningPreset[] = [
  {
    id: 'reentrant-gcea',
    names: { en: 'Standard re-entrant (G C E A)', fr: 'Standard re-entrant (sol do mi la)' },
    strings: [p('A', 4), p('E', 4), p('C', 4), p('G', 4)],
  },
  {
    id: 'low-g',
    names: { en: 'Low G (G C E A)', fr: 'Sol grave (sol do mi la)' },
    strings: [p('A', 4), p('E', 4), p('C', 4), p('G', 3)],
  },
  {
    id: 'baritone',
    names: { en: 'Baritone (D G B E)', fr: 'Baryton (ré sol si mi)' },
    strings: [p('E', 4), p('B', 3), p('G', 3), p('D', 3)],
  },
  {
    id: 'd-tuning',
    names: { en: 'D tuning (A D F♯ B)', fr: 'Accordage en ré (la ré fa♯ si)' },
    strings: [p('B', 4), p('F', 4, 1), p('D', 4), p('A', 4)],
  },
];

/** Tuning presets of an instrument (empty for instruments without strings). */
export function tuningPresets(instrumentId: string): readonly TuningPreset[] {
  const strings = getInstrument(instrumentId)?.strings;
  if (!strings) return [];
  if (instrumentId.startsWith('guitar')) return GUITAR_PRESETS;
  if (instrumentId.startsWith('ukulele'))
    return UKULELE_PRESETS.filter((x) => x.strings.length === strings.length);
  return [];
}

/** The preset matching a tuning exactly (by sounding pitch), if any. */
export function matchTuningPreset(
  instrumentId: string,
  tuning: readonly Pitch[],
): TuningPreset | undefined {
  return tuningPresets(instrumentId).find(
    (t) =>
      t.strings.length === tuning.length &&
      t.strings.every((s, i) => pitchToMidi(s) === pitchToMidi(tuning[i]!)),
  );
}

/**
 * Sounding range of a part: the catalog range, extended down to the lowest open string of its own
 * tuning (drop D has a D2). Undefined for unknown instruments.
 */
export function partRange(part: Part): { low: Pitch; high: Pitch } | undefined {
  const inst = getInstrument(part.instrument);
  if (!inst) return undefined;
  let low = inst.range.low;
  for (const s of part.tuning ?? []) if (pitchToMidi(s) < pitchToMidi(low)) low = s;
  return { low, high: inst.range.high };
}

/** Is a written pitch inside the part's range (see `partRange`)? Unknown instruments are always in range. */
export function isPartInRange(part: Part, written: Pitch): boolean {
  const range = partRange(part);
  if (!range) return true;
  const midi = pitchToMidi(soundingPitch(written, part.transposition));
  return midi >= pitchToMidi(range.low) && midi <= pitchToMidi(range.high);
}

export interface OutOfRangeEvent {
  readonly eventId: string;
  readonly partId: string;
  readonly instrument: string;
  readonly measure: number;
  /** Sounding pitch of the first note of the event that is outside the range. */
  readonly sounding: Pitch;
  /** Sounding range of the part. */
  readonly low: Pitch;
  readonly high: Pitch;
}

/** Per-voice cache: a voice that did not change (same object) is not scanned again. */
const voiceHits = new WeakMap<Voice, { sig: string; hits: { eventId: string; bad: Pitch }[] }>();

/**
 * Notes outside the range of their part's instrument, for the editor warnings (same rule as
 * `rangeWarnings`). Cheap on every keystroke: only voices that changed are scanned.
 */
export function outOfRangeEvents(score: Score): OutOfRangeEvent[] {
  const out: OutOfRangeEvent[] = [];
  for (const part of score.parts) {
    const range = partRange(part);
    if (!range) continue;
    const low = pitchToMidi(range.low);
    const high = pitchToMidi(range.high);
    const sig = `${low}:${high}:${part.transposition}`;
    const hasStandard = part.staves.some((x) => x.type === 'standard');
    for (const staff of part.staves) {
      // A TAB staff repeating a standard staff of the part would list every note twice.
      if (staff.type === 'tab' && hasStandard) continue;
      staff.measures.forEach((sm, measure) => {
        for (const v of sm.voices) {
          let entry = voiceHits.get(v);
          if (entry?.sig !== sig) {
            const hits: { eventId: string; bad: Pitch }[] = [];
            for (const e of v.events) {
              if (e.kind !== 'note') continue;
              const bad = e.pitches.find((q) => {
                const midi = pitchToMidi(q) + part.transposition;
                return midi < low || midi > high;
              });
              if (bad) hits.push({ eventId: e.id, bad });
            }
            entry = { sig, hits };
            voiceHits.set(v, entry);
          }
          for (const h of entry.hits) {
            out.push({
              eventId: h.eventId,
              partId: part.id,
              instrument: part.instrument,
              measure,
              sounding: soundingPitch(h.bad, part.transposition),
              low: range.low,
              high: range.high,
            });
          }
        }
      });
    }
  }
  return out;
}
