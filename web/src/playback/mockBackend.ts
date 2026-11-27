import type { AudioBackend } from './backend';

/**
 * A silent backend driven by the wall clock, for the browser tests (`window.__polymniaAudio = 'mock'`
 * before the page loads). It records what the controller asked for in `window.__polymniaAudioLog`.
 */
export interface MockLog {
  notes: { staffId: string; midi: number; time: number; duration: number }[];
  clicks: { time: number; accent: boolean }[];
  muted: string[];
  sets: string[];
  stops: number;
}

export class MockBackend implements AudioBackend {
  readonly log: MockLog = { notes: [], clicks: [], muted: [], sets: [], stops: 0 };

  constructor() {
    (window as unknown as { __polymniaAudioLog?: MockLog }).__polymniaAudioLog = this.log;
  }

  start(): Promise<void> {
    return Promise.resolve();
  }
  now(): number {
    return performance.now() / 1000;
  }
  outputLatency(): number {
    return 0;
  }
  loadSets(sets: readonly string[]): Promise<void> {
    this.log.sets.push(...sets);
    return Promise.resolve();
  }
  setStaves(): void {
    /* nothing to build */
  }
  setMuted(staffId: string, muted: boolean): void {
    const i = this.log.muted.indexOf(staffId);
    if (muted && i < 0) this.log.muted.push(staffId);
    if (!muted && i >= 0) this.log.muted.splice(i, 1);
  }
  note(staffId: string, midi: number, time: number, duration: number): void {
    if (this.log.muted.includes(staffId)) return;
    this.log.notes.push({ staffId, midi, time, duration });
  }
  click(time: number, accent: boolean): void {
    this.log.clicks.push({ time, accent });
  }
  stopAll(): void {
    this.log.stops++;
  }
  dispose(): void {
    /* nothing to release */
  }
}
