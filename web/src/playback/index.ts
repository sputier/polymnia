/**
 * Playback entry point. Importing this adds a few KB to the editor: the audio engine (Tone.js and
 * the samples) is only fetched by `warmUp()` / the first `play()` / the first `previewNote()`.
 */
import type { Pitch } from '../score';
import type { AudioBackend } from './backend';
import { PlaybackController } from './controller';

export { PlaybackController, TEMPO_SCALE_MAX, TEMPO_SCALE_MIN } from './controller';
export type { PlaybackFrame, PlaybackState, PlaybackStatus } from './controller';
export { sampleSetFor } from './instrumentSets';

async function createBackend(): Promise<AudioBackend> {
  // Browser tests silence the audio (docs/playback.md, "Testing").
  if ((window as unknown as { __polymniaAudio?: string }).__polymniaAudio === 'mock') {
    const { MockBackend } = await import('./mockBackend');
    return new MockBackend();
  }
  // Tone.js creates its clock in a blob Web Worker when it loads, which the Content-Security-Policy
  // (script-src 'self') forbids. It falls back to a timer when new Worker throws, so workers are
  // hidden from it for the instant its module evaluates (docs/playback.md, "Content-Security-Policy").
  const real = window.Worker;
  window.Worker = function Worker() {
    throw new Error('Workers are disabled while Tone.js loads');
  } as unknown as typeof Worker;
  try {
    const { ToneBackend } = await import('./toneBackend');
    return new ToneBackend();
  } finally {
    window.Worker = real;
  }
}

/** The one controller of the page. */
export const playback = new PlaybackController(createBackend);

/**
 * Plays a short note immediately, on the instrument of `partId`: the editor calls it when a note is
 * entered. `pitch` is the written pitch (the part transposition is applied).
 */
export function previewNote(partId: string, pitch: Pitch): void {
  void playback.previewNote(partId, pitch);
}
