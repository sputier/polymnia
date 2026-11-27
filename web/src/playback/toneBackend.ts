/**
 * The real audio engine: Tone.js samplers, one channel per staff. This module is the only one that
 * imports Tone.js, and it is only ever loaded with `import()`: Tone.js is a separate chunk that the
 * first screen never downloads.
 */
import {
  Context,
  Frequency,
  Sampler,
  Synth,
  ToneAudioBuffer,
  Volume,
  getContext,
  setContext,
  start,
} from 'tone';
import type { AudioBackend } from './backend';
import type { SampleSetId } from './instrumentSets';
import { sampleUrls } from './sampleUrls';

/** Plucked and struck instruments ring after the note ends; bowed and blown ones stop quickly. */
const RELEASE: Record<SampleSetId, number> = {
  piano: 0.6,
  'guitar-nylon': 0.7,
  ukulele: 0.5,
  clarinet: 0.15,
  cello: 0.25,
  violin: 0.25,
  'double-bass': 0.25,
  flute: 0.15,
};

type Buffers = Record<number, ToneAudioBuffer>;

interface Channel {
  readonly sampler: Sampler;
  readonly volume: Volume;
}

export class ToneBackend implements AudioBackend {
  /** Decoded samples by set; the promise is shared by every staff that uses the set. */
  private readonly loading = new Map<SampleSetId, Promise<Buffers>>();
  private readonly loaded = new Map<SampleSetId, Buffers>();
  private wanted = new Map<string, SampleSetId>();
  private channels = new Map<string, Channel>();
  private readonly muted = new Set<string>();
  private clicker: Synth | undefined;

  constructor() {
    // 'playback' trades latency for robustness against a busy main thread (docs/playback.md).
    setContext(new Context({ latencyHint: 'playback', lookAhead: 0.2, clockSource: 'timeout' }));
  }

  async start(): Promise<void> {
    await start();
  }

  now(): number {
    return getContext().currentTime;
  }

  outputLatency(): number {
    const raw = getContext().rawContext as AudioContext;
    return raw.outputLatency || raw.baseLatency || 0;
  }

  async loadSets(sets: readonly SampleSetId[]): Promise<void> {
    await Promise.all(sets.map((s) => this.load(s)));
  }

  private load(set: SampleSetId): Promise<Buffers> {
    let promise = this.loading.get(set);
    if (!promise) {
      const entries = Object.entries(sampleUrls(set));
      promise = Promise.all(
        entries.map(async ([midi, url]) => [midi, await ToneAudioBuffer.fromUrl(url)] as const),
      ).then((list) => {
        const buffers = Object.fromEntries(list);
        this.loaded.set(set, buffers);
        return buffers;
      });
      // A failed download can be retried by the next play.
      promise.catch(() => this.loading.delete(set));
      this.loading.set(set, promise);
    }
    return promise;
  }

  setStaves(staves: readonly { id: string; set: SampleSetId }[]): void {
    for (const c of this.channels.values()) {
      c.sampler.dispose();
      c.volume.dispose();
    }
    this.channels = new Map();
    this.wanted = new Map(staves.map((s) => [s.id, s.set]));
  }

  /** Created on first use, once the samples of the set are decoded. */
  private channel(staffId: string): Channel | undefined {
    const existing = this.channels.get(staffId);
    if (existing) return existing;
    const set = this.wanted.get(staffId);
    const buffers = set && this.loaded.get(set);
    if (!set || !buffers) return undefined;
    const volume = new Volume({ volume: 0, mute: this.muted.has(staffId) }).toDestination();
    const sampler = new Sampler({ urls: buffers, release: RELEASE[set] }).connect(volume);
    const channel = { sampler, volume };
    this.channels.set(staffId, channel);
    return channel;
  }

  setMuted(staffId: string, muted: boolean): void {
    if (muted) this.muted.add(staffId);
    else this.muted.delete(staffId);
    const channel = this.channels.get(staffId);
    if (channel) channel.volume.mute = muted;
  }

  note(staffId: string, midi: number, time: number, duration: number, velocity: number): void {
    if (this.muted.has(staffId)) return;
    this.channel(staffId)?.sampler.triggerAttackRelease(
      Frequency(midi, 'midi').toFrequency(),
      Math.max(0.05, duration),
      time,
      velocity,
    );
  }

  click(time: number, accent: boolean): void {
    this.clicker ??= new Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
      volume: -8,
    }).toDestination();
    this.clicker.triggerAttackRelease(accent ? 1568 : 1046, 0.03, time, accent ? 1 : 0.7);
  }

  stopAll(): void {
    for (const c of this.channels.values()) c.sampler.releaseAll();
    // Clicks scheduled ahead cannot be cancelled one by one: drop the synth.
    this.clicker?.dispose();
    this.clicker = undefined;
  }

  dispose(): void {
    this.stopAll();
    for (const c of this.channels.values()) {
      c.sampler.dispose();
      c.volume.dispose();
    }
    this.channels.clear();
  }
}
