import type { SampleSetId } from './instrumentSets';

/**
 * What the controller needs from an audio engine. The real one wraps Tone.js (`toneBackend.ts`,
 * a lazy chunk); the browser tests plug a silent one (`mockBackend.ts`).
 */
export interface AudioBackend {
  /** Starts the audio context. Must run inside a user gesture the first time. */
  start(): Promise<void>;
  /** Audio clock, in seconds. */
  now(): number;
  /** Seconds between a sound being scheduled at `t` and being heard (output latency). */
  outputLatency(): number;
  /** Downloads and decodes the sample sets (resolves immediately for sets already loaded). */
  loadSets(sets: readonly SampleSetId[]): Promise<void>;
  /** One channel (sampler + mute) per staff. Called again when the staves change. */
  setStaves(staves: readonly { id: string; set: SampleSetId }[]): void;
  setMuted(staffId: string, muted: boolean): void;
  /** Plays `midi` on a staff channel at audio time `time` for `duration` seconds. */
  note(staffId: string, midi: number, time: number, duration: number, velocity: number): void;
  /** Metronome click at audio time `time`. */
  click(time: number, accent: boolean): void;
  /** Silences everything scheduled or sounding. */
  stopAll(): void;
  dispose(): void;
}

export type BackendFactory = () => Promise<AudioBackend>;
