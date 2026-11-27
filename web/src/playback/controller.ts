/**
 * Playback controller: transport state, look-ahead scheduling, position for the cursor.
 *
 * It owns no audio code: it talks to an `AudioBackend` that is loaded lazily (Tone.js is a separate
 * chunk, see docs/playback.md). Everything here is plain TypeScript, so the transport logic is
 * unit tested with a fake backend. The cursor is not React state: `onFrame` listeners are called
 * from `requestAnimationFrame`.
 */
import { soundingMidi } from '../score';
import type { Pitch, Score } from '../score';
import type { AudioBackend, BackendFactory } from './backend';
import {
  audibleStaves,
  legsBetween,
  lowerBound,
  makeTempoMap,
  scoreSecondsAt,
  type LoopRange,
  type TempoMap,
} from './clock';
import { sampleSetFor } from './instrumentSets';
import { buildTimeline, type EventSpan, type Timeline } from './timeline';

export type PlaybackStatus = 'stopped' | 'playing' | 'paused';

export interface PlaybackState {
  readonly status: PlaybackStatus;
  /** Samples are downloading or decoding. */
  readonly loading: boolean;
  readonly error: 'audio' | null;
  readonly loop: boolean;
  /** 1 = the tempo written in the score. */
  readonly tempoScale: number;
  readonly metronome: boolean;
  readonly muted: ReadonlySet<string>;
  readonly solo: ReadonlySet<string>;
  /** Tempo in force at the playhead, quarter notes per minute, already scaled. */
  readonly bpm: number;
}

export interface PlaybackFrame {
  readonly tick: number;
  /** Notes sounding now (highlight). */
  readonly noteIds: readonly string[];
  /** Notes and rests at the playhead (cursor position). */
  readonly spanIds: readonly string[];
}

export const TEMPO_SCALE_MIN = 0.25;
export const TEMPO_SCALE_MAX = 2;
/** How far ahead of the audio clock notes are scheduled. Large enough to ride out a busy UI thread. */
export const LOOKAHEAD_SECONDS = 1.2;
const SCHEDULE_INTERVAL_MS = 100;
const LEAD_SECONDS = 0.08;
const NOTE_VELOCITY = 0.8;
const PREVIEW_SECONDS = 0.7;
const TAIL_SECONDS = 0.6;

interface Timed {
  readonly timeline: Timeline;
  readonly tempo: TempoMap;
  readonly noteStart: readonly number[];
  readonly noteEnd: readonly number[];
  readonly beatSec: readonly number[];
  readonly totalSec: number;
  readonly maxSpanTicks: number;
}

function timeScore(score: Score): Timed {
  const timeline = buildTimeline(score);
  const tempo = makeTempoMap(timeline.tempo);
  return {
    timeline,
    tempo,
    noteStart: timeline.notes.map((n) => tempo.ticksToSeconds(n.startTick)),
    noteEnd: timeline.notes.map((n) => tempo.ticksToSeconds(n.endTick)),
    beatSec: timeline.beats.map((b) => tempo.ticksToSeconds(b.tick)),
    totalSec: tempo.ticksToSeconds(timeline.totalTicks),
    maxSpanTicks: timeline.spans.reduce((m, s) => Math.max(m, s.endTick - s.startTick), 0),
  };
}

export class PlaybackController {
  private state: PlaybackState = {
    status: 'stopped',
    loading: false,
    error: null,
    loop: false,
    tempoScale: 1,
    metronome: false,
    muted: new Set(),
    solo: new Set(),
    bpm: 120,
  };
  private readonly listeners = new Set<() => void>();
  private readonly frameListeners = new Set<(frame: PlaybackFrame) => void>();

  private score: Score | undefined;
  private timed: Timed | undefined;
  private backend: AudioBackend | undefined;
  private backendPromise: Promise<AudioBackend> | undefined;
  private preparedFor: Score | undefined;

  /** Playhead in score seconds while stopped or paused. */
  private positionSec = 0;
  private loopRange: LoopRange | undefined;
  // Running state.
  private startSec = 0;
  private t0 = 0;
  private scheduledElapsed = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private raf: number | undefined;
  private lastFrameKey = '';
  /** Increments on every start/stop so that an async `play()` can tell it was superseded. */
  private run = 0;
  /** Milliseconds from the last `play()` to its first scheduled note (measured in the e2e tests). */
  lastStartMs = 0;

  constructor(private readonly factory: BackendFactory) {}

  // ---- Observation ----------------------------------------------------------------------------
  getState = (): PlaybackState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called on every animation frame while playing, and on every seek. Not React state. */
  onFrame(listener: (frame: PlaybackFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** Current playhead in ticks (for the cursor and for tests). */
  positionTick(): number {
    const timed = this.ensureTimed();
    return timed ? timed.tempo.secondsToTicks(this.currentSec()) : 0;
  }

  getTimeline(): Timeline | undefined {
    return this.ensureTimed()?.timeline;
  }

  private set(patch: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ---- Score ----------------------------------------------------------------------------------
  /** Gives the controller the score to play. Editing stops playback and keeps the playhead. */
  setScore(score: Score): void {
    if (score === this.score) return;
    const tick = this.timed ? this.positionTick() : 0;
    this.score = score;
    this.timed = undefined;
    if (this.state.status === 'playing') {
      this.halt();
      this.set({ status: 'stopped' });
    }
    const timed = this.ensureTimed();
    this.positionSec = timed
      ? timed.tempo.ticksToSeconds(Math.min(tick, timed.timeline.totalTicks))
      : 0;
    this.loopRange = undefined;
    if (this.state.loop) this.set({ loop: false });
    if (this.state.status === 'paused') this.set({ status: 'stopped' });
    this.set({ bpm: this.bpmAt(this.positionSec) });
  }

  private ensureTimed(): Timed | undefined {
    if (!this.timed && this.score) this.timed = timeScore(this.score);
    return this.timed;
  }

  private bpmAt(sec: number): number {
    const timed = this.ensureTimed();
    if (!timed) return 120;
    const tick = timed.tempo.secondsToTicks(sec);
    let bpm = timed.timeline.tempo[0]?.bpm ?? 120;
    for (const seg of timed.timeline.tempo) if (seg.tick <= tick) bpm = seg.bpm;
    return Math.round(bpm * this.state.tempoScale);
  }

  // ---- Backend --------------------------------------------------------------------------------
  /** Starts fetching the audio engine (call on the first user interaction: it is a lazy chunk). */
  warmUp(): void {
    void this.getBackend().catch(() => undefined);
  }

  private getBackend(): Promise<AudioBackend> {
    this.backendPromise ??= this.factory().then((b) => (this.backend = b));
    return this.backendPromise;
  }

  /** Channels for the staves of the score, with only the sample sets they need. */
  private async prepare(only?: readonly string[]): Promise<AudioBackend> {
    const backend = await this.getBackend();
    const timed = this.ensureTimed();
    if (!timed) return backend;
    const staves = timed.timeline.staves.map((s) => ({
      id: s.staffId,
      set: sampleSetFor(s.instrument).set,
    }));
    const wanted = new Set(staves.filter((s) => !only || only.includes(s.id)).map((s) => s.set));
    if (this.preparedFor !== this.score) {
      backend.setStaves(staves);
      this.preparedFor = this.score;
      this.applyMutes();
    }
    await backend.loadSets([...wanted]);
    return backend;
  }

  // ---- Transport ------------------------------------------------------------------------------
  async play(): Promise<void> {
    if (this.state.status === 'playing') return;
    const t0 = performance.now();
    const run = ++this.run;
    this.set({ error: null });
    let backend: AudioBackend;
    try {
      // Start the context first: this is the part that needs the user gesture.
      const pending = this.getBackend();
      this.set({ loading: true });
      const b = await pending;
      await b.start();
      backend = await this.prepare();
    } catch {
      if (run === this.run) this.set({ loading: false, error: 'audio' });
      return;
    }
    if (run !== this.run) return;
    this.set({ loading: false });
    this.startAt(backend, this.positionSec);
    this.lastStartMs = performance.now() - t0;
  }

  pause(): void {
    if (this.state.status !== 'playing') return;
    const sec = this.currentSec();
    this.halt();
    this.positionSec = sec;
    this.set({ status: 'paused' });
    this.emitFrame(true);
  }

  /** Stops and returns the playhead to the start of the score. */
  stop(): void {
    this.halt();
    this.positionSec = 0;
    this.set({ status: 'stopped', bpm: this.bpmAt(0) });
    this.emitFrame(true);
  }

  toggle(): void {
    if (this.state.status === 'playing') this.pause();
    else void this.play();
  }

  /** Moves the playhead (restarts the sound when playing). */
  seekTick(tick: number): void {
    const timed = this.ensureTimed();
    if (!timed) return;
    const sec = timed.tempo.ticksToSeconds(Math.max(0, Math.min(tick, timed.timeline.totalTicks)));
    if (this.state.status === 'playing' && this.backend) {
      this.startAt(this.backend, sec);
      return;
    }
    this.positionSec = sec;
    this.set({ status: 'stopped', bpm: this.bpmAt(sec) });
    this.emitFrame(true);
  }

  /** Home: back to the start of the score. */
  home(): void {
    this.seekTick(0);
  }

  /** Start tick of the earliest of these events (play from selection). */
  tickOfEvents(ids: readonly string[]): number | undefined {
    const timed = this.ensureTimed();
    if (!timed || ids.length === 0) return undefined;
    const set = new Set(ids);
    let min: number | undefined;
    for (const span of timed.timeline.spans) {
      if (set.has(span.id) && (min === undefined || span.startTick < min)) min = span.startTick;
    }
    return min;
  }

  /**
   * Loops [fromTick, toTick) (or the whole score without arguments). Turning it off keeps playing.
   */
  setLoop(on: boolean, range?: { fromTick: number; toTick: number }): void {
    const timed = this.ensureTimed();
    if (!on || !timed) {
      this.loopRange = undefined;
      this.set({ loop: false });
      this.restartIfPlaying();
      return;
    }
    const from = range?.fromTick ?? 0;
    const to = range?.toTick ?? timed.timeline.totalTicks;
    this.loopRange = {
      startSec: timed.tempo.ticksToSeconds(from),
      endSec: timed.tempo.ticksToSeconds(Math.max(to, from)),
    };
    this.set({ loop: true });
    this.restartIfPlaying();
  }

  /** Tick range covered by these events: what "loop the selection" loops. */
  spanOfEvents(ids: readonly string[]): { fromTick: number; toTick: number } | undefined {
    const timed = this.ensureTimed();
    if (!timed || ids.length === 0) return undefined;
    const set = new Set(ids);
    let from = Infinity;
    let to = -Infinity;
    for (const span of timed.timeline.spans) {
      if (!set.has(span.id)) continue;
      from = Math.min(from, span.startTick);
      to = Math.max(to, span.endTick);
    }
    return Number.isFinite(from) ? { fromTick: from, toTick: to } : undefined;
  }

  setTempoScale(scale: number): void {
    const clamped = Math.min(TEMPO_SCALE_MAX, Math.max(TEMPO_SCALE_MIN, scale));
    if (clamped === this.state.tempoScale) return;
    const sec = this.state.status === 'playing' ? this.currentSec() : this.positionSec;
    this.state = { ...this.state, tempoScale: clamped };
    this.set({ bpm: this.bpmAt(sec) });
    if (this.state.status === 'playing' && this.backend) this.startAt(this.backend, sec);
  }

  setMetronome(on: boolean): void {
    this.set({ metronome: on });
  }

  setMuted(staffId: string, muted: boolean): void {
    const next = new Set(this.state.muted);
    if (muted) next.add(staffId);
    else next.delete(staffId);
    this.set({ muted: next });
    this.applyMutes();
  }

  setSolo(staffId: string, solo: boolean): void {
    const next = new Set(this.state.solo);
    if (solo) next.add(staffId);
    else next.delete(staffId);
    this.set({ solo: next });
    this.applyMutes();
  }

  private applyMutes(): void {
    const timed = this.timed;
    if (!this.backend || !timed) return;
    const ids = timed.timeline.staves.map((s) => s.staffId);
    const audible = audibleStaves(ids, this.state.muted, this.state.solo);
    for (const id of ids) this.backend.setMuted(id, !audible.has(id));
  }

  // ---- Preview --------------------------------------------------------------------------------
  /**
   * Plays one note right now (note entry feedback). `pitch` is the written pitch; the part
   * transposition is applied. Silent when the audio cannot start (no user gesture yet).
   */
  async previewNote(partId: string, pitch: Pitch): Promise<void> {
    const timed = this.ensureTimed();
    const staff = timed?.timeline.staves.find((s) => s.partId === partId);
    const part = this.score?.parts.find((p) => p.id === partId);
    if (!timed || !staff || !part) return;
    try {
      const pending = this.getBackend();
      const backend = await pending;
      await backend.start();
      await this.prepare([staff.staffId]);
      backend.note(
        staff.staffId,
        soundingMidi(pitch, part.transposition),
        backend.now() + 0.01,
        PREVIEW_SECONDS,
        NOTE_VELOCITY,
      );
    } catch {
      // Preview is a nicety: never surface an audio failure while typing.
    }
  }

  // ---- Engine ---------------------------------------------------------------------------------
  private restartIfPlaying(): void {
    if (this.state.status === 'playing' && this.backend) {
      this.startAt(this.backend, this.currentSec());
    }
  }

  private startAt(backend: AudioBackend, sec: number): void {
    const timed = this.ensureTimed();
    if (!timed) return;
    this.clearTimers();
    backend.stopAll();
    let start = sec >= timed.totalSec ? 0 : sec;
    const loop = this.state.loop ? this.loopRange : undefined;
    if (loop && (start >= loop.endSec || start < 0)) start = loop.startSec;
    this.startSec = start;
    this.t0 = backend.now() + LEAD_SECONDS;
    this.scheduledElapsed = 0;
    this.set({ status: 'playing', bpm: this.bpmAt(start) });
    this.schedule();
    this.timer = setInterval(() => this.schedule(), SCHEDULE_INTERVAL_MS);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Stops the sound and the timers; the caller sets the status. */
  private halt(): void {
    this.run++;
    this.clearTimers();
    this.backend?.stopAll();
  }

  private clearTimers(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.timer = undefined;
    this.raf = undefined;
  }

  /** Playhead in score seconds, compensating the output latency. */
  private currentSec(): number {
    if (this.state.status !== 'playing' || !this.backend) return this.positionSec;
    const timed = this.timed;
    const elapsed = Math.max(
      0,
      (this.backend.now() - this.backend.outputLatency() - this.t0) * this.state.tempoScale,
    );
    const loop = this.state.loop ? this.loopRange : undefined;
    const sec = scoreSecondsAt(this.startSec, elapsed, loop);
    return timed ? Math.min(sec, timed.totalSec) : sec;
  }

  /** Schedules everything that starts before the look-ahead horizon. */
  private schedule(): void {
    const backend = this.backend;
    const timed = this.timed;
    if (!backend || !timed || this.state.status !== 'playing') return;
    const scale = this.state.tempoScale;
    const horizon = (backend.now() + LOOKAHEAD_SECONDS - this.t0) * scale;
    if (horizon <= this.scheduledElapsed) return;
    const loop = this.state.loop ? this.loopRange : undefined;
    const legs = legsBetween(this.startSec, this.scheduledElapsed, horizon, loop);
    const { timeline } = timed;
    for (const leg of legs) {
      // Without a loop, nothing is scheduled past the end of the score.
      const to = loop ? leg.to : Math.min(leg.to, timed.totalSec + 1e-6);
      const at = (sec: number) => this.t0 + (leg.elapsed + (sec - leg.from)) / scale;
      for (
        let i = lowerBound(timed.noteStart, leg.from, (s) => s);
        i < timeline.notes.length;
        i++
      ) {
        const start = timed.noteStart[i]!;
        if (start >= to) break;
        const note = timeline.notes[i]!;
        // Inside a loop a note stops at the loop end.
        const end = loop ? Math.min(timed.noteEnd[i]!, loop.endSec) : timed.noteEnd[i]!;
        backend.note(note.staffId, note.midi, at(start), (end - start) / scale, NOTE_VELOCITY);
      }
      if (this.state.metronome) {
        for (let i = lowerBound(timed.beatSec, leg.from, (s) => s); i < timed.beatSec.length; i++) {
          const sec = timed.beatSec[i]!;
          if (sec >= to) break;
          backend.click(at(sec), timeline.beats[i]!.accent);
        }
      }
    }
    this.scheduledElapsed = horizon;
  }

  private frame = (): void => {
    this.raf = undefined;
    if (this.state.status !== 'playing') return;
    const timed = this.timed;
    if (!timed) return;
    const loop = this.state.loop ? this.loopRange : undefined;
    if (!loop && this.finished(timed)) {
      this.finish();
      return;
    }
    this.emitFrame(false);
    this.raf = requestAnimationFrame(this.frame);
  };

  private finished(timed: Timed): boolean {
    const backend = this.backend;
    if (!backend) return true;
    const elapsed = (backend.now() - this.t0) * this.state.tempoScale;
    return this.startSec + elapsed >= timed.totalSec + TAIL_SECONDS;
  }

  private finish(): void {
    this.halt();
    this.positionSec = 0;
    this.set({ status: 'stopped', bpm: this.bpmAt(0) });
    this.emitFrame(true);
  }

  // ---- Frames ---------------------------------------------------------------------------------
  private emitFrame(force: boolean): void {
    if (this.frameListeners.size === 0) return;
    const timed = this.timed;
    if (!timed) return;
    const tick = timed.tempo.secondsToTicks(this.currentSec());
    const { noteIds, spanIds } = this.activeAt(timed, tick);
    const status = this.state.status;
    const key = `${status}|${spanIds.join(',')}|${noteIds.join(',')}`;
    if (!force && key === this.lastFrameKey) return;
    this.lastFrameKey = key;
    // Highlight only while playing; a stopped playhead at the start shows no cursor.
    const frame: PlaybackFrame = {
      tick,
      noteIds: status === 'playing' ? noteIds : [],
      spanIds: status === 'stopped' && this.positionSec === 0 ? [] : spanIds,
    };
    this.frameListeners.forEach((l) => l(frame));
  }

  private activeAt(timed: Timed, tick: number): { noteIds: string[]; spanIds: string[] } {
    const spans = timed.timeline.spans;
    const noteIds: string[] = [];
    const spanIds: string[] = [];
    const first = lowerBound(spans, tick - timed.maxSpanTicks, (s) => s.startTick);
    for (let i = first; i < spans.length; i++) {
      const s: EventSpan = spans[i]!;
      if (s.startTick > tick) break;
      if (tick >= s.endTick) continue;
      spanIds.push(s.id);
      if (!s.rest) noteIds.push(s.id);
    }
    return { noteIds, spanIds };
  }

  dispose(): void {
    this.halt();
    this.backend?.dispose();
    this.backend = undefined;
    this.backendPromise = undefined;
  }
}
