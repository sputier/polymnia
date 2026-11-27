/** Which sample set sounds an instrument of the catalog. No audio here: it stays in the main bundle. */

export type SampleSetId =
  | 'piano'
  | 'guitar-nylon'
  | 'guitar-steel'
  | 'ukulele'
  | 'clarinet'
  | 'cello'
  | 'violin'
  | 'double-bass'
  | 'flute'
  | 'voice';

export const SAMPLE_SET_IDS: readonly SampleSetId[] = [
  'piano',
  'guitar-nylon',
  'guitar-steel',
  'ukulele',
  'clarinet',
  'cello',
  'violin',
  'double-bass',
  'flute',
  'voice',
];

export interface SetChoice {
  readonly set: SampleSetId;
  /** True when no recording of the instrument exists and another one stands in (docs/playback.md). */
  readonly standIn: boolean;
}

const DIRECT: Readonly<Record<string, SampleSetId>> = {
  piano: 'piano',
  flute: 'flute',
  voice: 'voice',
  violin: 'violin',
  cello: 'cello',
  clarinet: 'clarinet',
  'double-bass': 'double-bass',
  'guitar-classical': 'guitar-nylon',
  'guitar-steel': 'guitar-steel',
  'ukulele-soprano': 'ukulele',
  'ukulele-concert': 'ukulele',
  'ukulele-tenor': 'ukulele',
  'ukulele-tenor-low-g': 'ukulele',
  'ukulele-baritone': 'ukulele',
};

/** Unknown or custom instruments sound as a piano. */
export function sampleSetFor(instrument: string): SetChoice {
  const direct = DIRECT[instrument];
  if (direct) return { set: direct, standIn: false };
  return { set: 'piano', standIn: true };
}
