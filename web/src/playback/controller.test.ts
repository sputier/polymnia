import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildScore } from '../score/fixtures/dsl';
import type { AudioBackend } from './backend';
import { LOOKAHEAD_SECONDS, PlaybackController } from './controller';

class FakeBackend implements AudioBackend {
  clock = 100;
  notes: { staffId: string; midi: number; time: number; duration: number }[] = [];
  clicks: { time: number; accent: boolean }[] = [];
  muted = new Set<string>();
  sets: string[] = [];
  stops = 0;
  started = false;
  start() {
    this.started = true;
    return Promise.resolve();
  }
  now() {
    return this.clock;
  }
  outputLatency() {
    return 0;
  }
  loadSets(sets: readonly string[]) {
    this.sets.push(...sets);
    return Promise.resolve();
  }
  setStaves() {}
  setMuted(id: string, m: boolean) {
    if (m) this.muted.add(id);
    else this.muted.delete(id);
  }
  note(staffId: string, midi: number, time: number, duration: number) {
    if (!this.muted.has(staffId)) this.notes.push({ staffId, midi, time, duration });
  }
  click(time: number, accent: boolean) {
    this.clicks.push({ time, accent });
  }
  stopAll() {
    this.stops++;
  }
  dispose() {}
}

// 120 bpm: a quarter note lasts 0.5 s.
const melody = buildScore({
  title: 'm',
  tempoBpm: 120,
  parts: [
    { name: 'A', instrument: 'flute', staves: [{ measures: ['C4:q D4:q E4:q F4:q', 'G4:w'] }] },
    { name: 'B', instrument: 'cello', staves: [{ measures: ['C3:w', 'G2:w'] }] },
  ],
});

let backend: FakeBackend;
let controller: PlaybackController;

/** Moves the audio clock and lets the 100 ms scheduler run. */
function advance(seconds: number) {
  const step = 0.1;
  for (let t = 0; t < seconds - 1e-9; t += step) {
    backend.clock += step;
    vi.advanceTimersByTime(100);
  }
}

async function started() {
  await controller.play();
  // play() has set the origin 0.08 s after "now".
}

beforeEach(() => {
  vi.useFakeTimers();
  backend = new FakeBackend();
  controller = new PlaybackController(() => Promise.resolve(backend));
  controller.setScore(melody);
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

describe('play / pause / stop', () => {
  it('starts the audio, loads only the sets of the staves and plays', async () => {
    await started();
    expect(backend.started).toBe(true);
    expect(new Set(backend.sets)).toEqual(new Set(['flute', 'cello']));
    expect(controller.getState().status).toBe('playing');
    // First notes are scheduled immediately, up to the look-ahead horizon.
    const flute = backend.notes.filter((n) => n.midi === 60 + 0);
    expect(flute.length).toBeGreaterThan(0);
  });

  it('schedules notes at the right audio times', async () => {
    await started();
    advance(3);
    const t0 = 100 + 0.08;
    const d = backend.notes.find((n) => n.midi === 62)!; // D4: second quarter
    expect(d.time).toBeCloseTo(t0 + 0.5);
    expect(d.duration).toBeCloseTo(0.5);
    const g = backend.notes.find((n) => n.midi === 67)!; // G4: second measure
    expect(g.time).toBeCloseTo(t0 + 2);
    expect(g.duration).toBeCloseTo(2);
  });

  it('schedules ahead of the clock by the look-ahead, not all at once', async () => {
    await started();
    const latest = Math.max(...backend.notes.map((n) => n.time));
    expect(latest).toBeLessThan(backend.clock + LOOKAHEAD_SECONDS + 0.01);
  });

  it('pause keeps the position and resume continues from it', async () => {
    await started();
    advance(1.1); // 1.02 s of music after the lead
    controller.pause();
    expect(controller.getState().status).toBe('paused');
    const tick = controller.positionTick();
    expect(tick).toBeGreaterThan(1800);
    expect(tick).toBeLessThan(2100);
    const before = backend.notes.length;
    advance(2); // time passes while paused: nothing is played
    expect(backend.notes.length).toBe(before);
    expect(controller.positionTick()).toBe(tick);
    backend.notes = [];
    await controller.play();
    // Mid-note resume: no re-attack; the next flute note (F4, due at 1.5 s) is under 0.5 s away.
    const flute = backend.notes.filter((n) => n.midi >= 60 && n.midi < 70);
    expect(flute[0]!.midi).toBe(65);
    expect(flute[0]!.time).toBeGreaterThan(backend.clock + 0.08);
    expect(flute[0]!.time).toBeLessThan(backend.clock + 0.08 + 0.55);
  });

  it('stop goes back to the start and silences the sound', async () => {
    await started();
    advance(1);
    const stops = backend.stops;
    controller.stop();
    expect(controller.getState().status).toBe('stopped');
    expect(controller.positionTick()).toBe(0);
    expect(backend.stops).toBeGreaterThan(stops);
  });

  it('stops by itself after the last note', async () => {
    await started();
    advance(5.5);
    expect(controller.getState().status).toBe('stopped');
    expect(controller.positionTick()).toBe(0);
  });

  it('toggle plays then pauses', async () => {
    controller.toggle();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().status).toBe('playing');
    controller.toggle();
    expect(controller.getState().status).toBe('paused');
  });

  it('reports an audio failure without throwing', async () => {
    const failing = new PlaybackController(() => Promise.reject(new Error('no audio')));
    failing.setScore(melody);
    await failing.play();
    expect(failing.getState()).toMatchObject({ status: 'stopped', error: 'audio', loading: false });
  });
});

describe('seek and play from selection', () => {
  it('home goes back to the start', async () => {
    await started();
    advance(1);
    controller.home();
    expect(controller.positionTick()).toBeLessThan(200);
    expect(controller.getState().status).toBe('playing');
  });

  it('starts from the first selected event', async () => {
    const timeline = controller.getTimeline()!;
    const g = timeline.spans.find((s) => !s.rest && s.startTick === 3840)!;
    expect(controller.tickOfEvents([g.id])).toBe(3840);
    controller.seekTick(3840);
    await started();
    const notes = backend.notes.filter((n) => n.midi === 67 || n.midi === 62);
    expect(notes.map((n) => n.midi)).toEqual([67]); // nothing from measure 1
    expect(notes[0]!.time).toBeCloseTo(100.08);
  });

  it('tickOfEvents is undefined without a known event', () => {
    expect(controller.tickOfEvents([])).toBeUndefined();
    expect(controller.tickOfEvents(['nope'])).toBeUndefined();
  });
});

describe('tempo', () => {
  it('half speed doubles every time and duration', async () => {
    controller.setTempoScale(0.5);
    await started();
    advance(3);
    const d = backend.notes.find((n) => n.midi === 62)!;
    expect(d.time).toBeCloseTo(100.08 + 1);
    expect(d.duration).toBeCloseTo(1);
    expect(controller.getState().bpm).toBe(60);
  });

  it('keeps the position when the tempo changes while playing', async () => {
    await started();
    advance(1.1);
    const before = controller.positionTick();
    controller.setTempoScale(2);
    expect(Math.abs(controller.positionTick() - before)).toBeLessThan(300);
    expect(controller.getState().status).toBe('playing');
  });

  it('clamps the scale', () => {
    controller.setTempoScale(10);
    expect(controller.getState().tempoScale).toBe(2);
    controller.setTempoScale(0);
    expect(controller.getState().tempoScale).toBe(0.25);
  });
});

describe('loop', () => {
  it('replays the looped range forever and never goes past its end', async () => {
    // Loop the second quarter and the third quarter of measure 1: ticks 960..1920 -> 0.5..1.5 s.
    controller.setLoop(true, { fromTick: 960, toTick: 1920 });
    controller.seekTick(960);
    await started();
    advance(3.2);
    const d = backend.notes.filter((n) => n.midi === 62);
    expect(d.length).toBeGreaterThanOrEqual(3);
    // One pass lasts a quarter note: 0.5 s.
    expect(d[1]!.time - d[0]!.time).toBeCloseTo(0.5);
    expect(backend.notes.some((n) => n.midi === 64 || n.midi === 67)).toBe(false);
    expect(controller.getState().status).toBe('playing');
  });

  it('cuts a note at the loop end', async () => {
    controller.setLoop(true, { fromTick: 0, toTick: 480 }); // half a quarter
    await started();
    advance(0.5);
    const c = backend.notes.find((n) => n.midi === 60)!;
    expect(c.duration).toBeCloseTo(0.25);
  });

  it('loops the whole score when no range is given', async () => {
    controller.setLoop(true);
    await started();
    advance(5);
    const firstNotes = backend.notes.filter((n) => n.midi === 60);
    expect(firstNotes.length).toBeGreaterThanOrEqual(2);
    expect(controller.getState().status).toBe('playing');
  });

  it('computes the range of a selection', () => {
    const timeline = controller.getTimeline()!;
    const ids = timeline.spans
      .filter((s) => s.startTick >= 960 && s.endTick <= 1920 && !s.rest)
      .map((s) => s.id);
    expect(controller.spanOfEvents(ids)).toEqual({ fromTick: 960, toTick: 1920 });
  });

  it('turning the loop off keeps playing to the end', async () => {
    controller.setLoop(true, { fromTick: 0, toTick: 960 });
    await started();
    advance(2);
    controller.setLoop(false);
    advance(6);
    expect(controller.getState().status).toBe('stopped');
  });
});

describe('metronome', () => {
  it('clicks every beat with an accent on the first beat of the measure', async () => {
    controller.setMetronome(true);
    await started();
    advance(2.2);
    const times = backend.clicks.filter((c) => c.time < 100.08 + 1.99);
    expect(times.map((c) => c.accent)).toEqual([true, false, false, false]);
    expect(times[1]!.time - times[0]!.time).toBeCloseTo(0.5);
  });

  it('is silent when off', async () => {
    await started();
    advance(2);
    expect(backend.clicks).toEqual([]);
  });
});

describe('mute and solo', () => {
  const staffIds = () => controller.getTimeline()!.staves.map((s) => s.staffId);

  it('mutes a staff and unmutes it', async () => {
    const [a] = staffIds();
    controller.setMuted(a!, true);
    await started();
    expect(backend.muted.has(a!)).toBe(true);
    advance(1);
    expect(backend.notes.every((n) => n.staffId !== a)).toBe(true);
    controller.setMuted(a!, false);
    expect(backend.muted.has(a!)).toBe(false);
  });

  it('solo silences the other staves', async () => {
    const [a, b] = staffIds();
    await started();
    controller.setSolo(b!, true);
    expect(backend.muted.has(a!)).toBe(true);
    expect(backend.muted.has(b!)).toBe(false);
    controller.setSolo(b!, false);
    expect(backend.muted.size).toBe(0);
  });
});

describe('frames (cursor and highlight)', () => {
  it('reports the notes under the playhead while playing', async () => {
    const frames: { noteIds: readonly string[]; spanIds: readonly string[] }[] = [];
    controller.onFrame((f) => frames.push(f));
    await started();
    const timeline = controller.getTimeline()!;
    const idOf = (midiTick: number, staff: number) =>
      timeline.spans.filter((s) => s.startTick === midiTick)[staff]!.id;
    advance(0.7); // 0.62 s of music: second quarter (D4)
    const last = frames.at(-1)!;
    expect(last.noteIds).toContain(idOf(960, 0));
    expect(last.noteIds).not.toContain(idOf(0, 0));
  });

  it('shows the cursor at a seek position and clears it on stop', () => {
    const frames: { spanIds: readonly string[] }[] = [];
    controller.onFrame((f) => frames.push(f));
    controller.seekTick(3840);
    expect(frames.at(-1)!.spanIds.length).toBeGreaterThan(0);
    controller.stop();
    expect(frames.at(-1)!.spanIds).toEqual([]);
  });
});

describe('score changes', () => {
  it('stops playing when the score is edited and keeps the playhead', async () => {
    await started();
    advance(1.1);
    const tick = controller.positionTick();
    controller.setScore({ ...melody, meta: { ...melody.meta, title: 'edited' } });
    expect(controller.getState().status).toBe('stopped');
    expect(Math.abs(controller.positionTick() - tick)).toBeLessThan(1);
  });
});

describe('previewNote', () => {
  it('plays the written pitch transposed, on the instrument of the part', async () => {
    const guitar = buildScore({
      title: 'g',
      parts: [{ name: 'G', instrument: 'guitar-classical', staves: [{ measures: ['E4:w'] }] }],
    });
    controller.setScore(guitar);
    await controller.previewNote(guitar.parts[0]!.id, { step: 'E', alter: 0, octave: 4 });
    expect(backend.sets).toEqual(['guitar-nylon']);
    expect(backend.notes).toHaveLength(1);
    expect(backend.notes[0]!.midi).toBe(64 - 12);
    expect(backend.notes[0]!.time).toBeGreaterThanOrEqual(backend.clock);
  });

  it('ignores an unknown part', async () => {
    await controller.previewNote('nope', { step: 'C', alter: 0, octave: 4 });
    expect(backend.notes).toEqual([]);
  });

  it('does not throw when the audio cannot start', async () => {
    const failing = new PlaybackController(() => Promise.reject(new Error('blocked')));
    failing.setScore(melody);
    await expect(
      failing.previewNote(melody.parts[0]!.id, { step: 'C', alter: 0, octave: 4 }),
    ).resolves.toBeUndefined();
  });
});
