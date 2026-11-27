import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupShape } from '../chords/library';
import {
  chordStaffId,
  createScore,
  getInstrument,
  parseChord,
  setCapo,
  setChord,
  type Score,
} from '../score';
import { guitarChords, pianoChords } from '../score/fixtures';
import type { AudioBackend } from './backend';
import { closeVoicing, STRUM_TICKS, voiceChord } from './chordVoicing';
import { PlaybackController } from './controller';
import { buildTimeline } from './timeline';

const chord = (text: string) => parseChord(text)!;
const strings = (id: string) => getInstrument(id)!.strings!;

describe('voiceChord', () => {
  it('plays the shape of the diagram on a guitar', () => {
    // C: x32010 -> C3 E3 G3 C4 E4
    expect(
      voiceChord(chord('C'), { tuning: strings('guitar-steel'), capo: 0, lookup: lookupShape }),
    ).toEqual([48, 52, 55, 60, 64]);
    // G: 320003
    expect(
      voiceChord(chord('G'), { tuning: strings('guitar-steel'), capo: 0, lookup: lookupShape }),
    ).toEqual([43, 47, 50, 55, 59, 67]);
  });

  it('sounds the symbol with a capo: the shape is lowered, the capo raises it back', () => {
    const notes = voiceChord(chord('D'), {
      tuning: strings('guitar-steel'),
      capo: 2,
      lookup: lookupShape,
    });
    // The C shape x32010 two frets higher: D3 F#3 A3 D4 F#4... counted from the capo.
    expect(notes).toEqual([50, 54, 57, 62, 66]);
    expect(new Set(notes.map((n) => n % 12))).toEqual(new Set([2, 6, 9]));
  });

  it('plays a ukulele chord low to high whatever the string order', () => {
    expect(
      voiceChord(chord('C'), { tuning: strings('ukulele-concert'), capo: 0, lookup: lookupShape }),
    ).toEqual([60, 64, 67, 72]);
  });

  it('plays the custom fingering of a chord as it is drawn', () => {
    const notes = voiceChord(chord('G'), {
      tuning: strings('guitar-steel'),
      capo: 0,
      frame: { frets: [3, 3, 0, 0, 2, 3], base: 1 },
    });
    expect(notes).toEqual([43, 47, 50, 55, 62, 67]);
  });

  it('falls back to a close voicing without a library or a tuning', () => {
    expect(voiceChord(chord('C'), { capo: 0 })).toEqual(closeVoicing(chord('C')));
    expect(voiceChord(chord('C'), { tuning: strings('guitar-steel'), capo: 0 })).toEqual(
      closeVoicing(chord('C')),
    );
  });

  it('ignores a frame that does not fit the strings', () => {
    expect(
      voiceChord(chord('C'), {
        tuning: strings('ukulele-concert'),
        capo: 0,
        frame: { frets: [0, 0], base: 1 },
      }),
    ).toEqual(closeVoicing(chord('C')));
  });
});

describe('closeVoicing', () => {
  it('puts the bass low and the chord above middle C', () => {
    expect(closeVoicing(chord('C'))).toEqual([48, 60, 64, 67]);
    expect(closeVoicing(chord('Am7/G'))).toEqual([43, 57, 60, 64, 67]);
  });

  it('keeps every chord tone, in tune', () => {
    for (const name of ['F#m7b5', 'Bbmaj7', 'E7#9', 'Dsus4', 'C6/9', 'Cadd9', 'G/B']) {
      const notes = closeVoicing(chord(name));
      const pcs = new Set(notes.map((n) => n % 12));
      const root = chord(name).root;
      const rootPc =
        ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[root.step] + root.alter + 12) % 12;
      expect(pcs.has(rootPc), name).toBe(true);
      expect(notes.length).toBeLessThanOrEqual(6);
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(40);
      expect(Math.max(...notes)).toBeLessThanOrEqual(80);
    }
  });

  it('plays a thirteenth chord with five notes at most above the bass', () => {
    expect(closeVoicing(chord('C13')).length).toBeLessThanOrEqual(6);
  });
});

function withChords(score: Score, entries: [number, number, string][], part = 0): Score {
  let s = score;
  for (const [measure, tick, text] of entries) {
    s = setChord({
      staffId: chordStaffId(s.parts[part]!),
      measure,
      tick,
      chord: chord(text),
    }).apply(s);
  }
  return s;
}

describe('timeline with chords', () => {
  const piano = withChords(createScore({ measures: 2, instruments: ['piano'] }), [
    [0, 0, 'C'],
    [0, 1920, 'G'],
    [1, 960, 'Am'],
  ]);

  it('does not play chords unless asked', () => {
    expect(buildTimeline(piano).notes).toHaveLength(0);
    expect(buildTimeline(piano, { chords: 'off' }).notes).toHaveLength(0);
  });

  it('plays block chords until the next symbol or the end of the measure', () => {
    const { notes } = buildTimeline(piano, { chords: 'block' });
    const at = (tick: number) => notes.filter((n) => n.startTick === tick);
    expect(at(0).map((n) => n.midi)).toEqual(closeVoicing(chord('C')));
    expect(at(0).every((n) => n.endTick === 1920)).toBe(true);
    expect(at(1920).every((n) => n.endTick === 3840)).toBe(true);
    // The A minor chord rings to the end of its measure (3840 + 3840).
    expect(at(3840 + 960).every((n) => n.endTick === 7680)).toBe(true);
    expect(notes.every((n) => n.eventIds.length === 0)).toBe(true);
    expect(notes.every((n) => n.staffId === piano.parts[0]!.staves[0]!.id)).toBe(true);
  });

  it('staggers the strings of a strum, low string first', () => {
    const { notes } = buildTimeline(piano, { chords: 'strum' });
    const first = notes.filter((n) => n.startTick < 1920);
    expect(first.map((n) => n.startTick)).toEqual(first.map((_, k) => k * STRUM_TICKS));
    expect(first.map((n) => n.midi)).toEqual([...first.map((n) => n.midi)].sort((a, b) => a - b));
  });

  it('keeps the notes sorted by start', () => {
    const { notes } = buildTimeline(piano, { chords: 'strum' });
    const starts = notes.map((n) => n.startTick);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('mixes with the notes of the score', () => {
    const base = buildTimeline(pianoChords);
    const withChordsOn = buildTimeline(pianoChords, { chords: 'block' });
    expect(withChordsOn.notes.length).toBeGreaterThan(base.notes.length);
    expect(withChordsOn.spans).toEqual(base.spans);
  });

  it("plays a guitar chord as its diagram, on the part's staff", () => {
    const { notes } = buildTimeline(guitarChords, { chords: 'block', lookup: lookupShape });
    const g = notes.filter((n) => n.startTick === 0 && n.eventIds.length === 0);
    expect(g.map((n) => n.midi)).toEqual([43, 47, 50, 55, 59, 67]);
  });

  it('plays the sounding chord with a capo', () => {
    let s = withChords(createScore({ measures: 1, instruments: ['guitar-steel'] }), [[0, 0, 'D']]);
    s = setCapo({ partId: s.parts[0]!.id, capo: 2 }).apply(s);
    const { notes } = buildTimeline(s, { chords: 'block', lookup: lookupShape });
    expect(notes.map((n) => n.midi % 12).sort((a, b) => a - b)).toEqual(
      expect.arrayContaining([2, 6, 9]),
    );
    expect(new Set(notes.map((n) => n.midi % 12))).toEqual(new Set([2, 6, 9]));
  });

  it('does not play the chords of a tab staff that repeats the standard staff twice', () => {
    const s = withChords(createScore({ measures: 1, instruments: ['guitar-steel'] }), [
      [0, 0, 'C'],
    ]);
    expect(buildTimeline(s, { chords: 'block' }).notes.length).toBeGreaterThan(0);
  });
});

class FakeBackend implements AudioBackend {
  clock = 100;
  notes: { staffId: string; midi: number; time: number }[] = [];
  start() {
    return Promise.resolve();
  }
  now() {
    return this.clock;
  }
  outputLatency() {
    return 0;
  }
  loadSets() {
    return Promise.resolve();
  }
  setStaves() {}
  setMuted() {}
  note(staffId: string, midi: number, time: number) {
    this.notes.push({ staffId, midi, time });
  }
  click() {}
  stopAll() {}
  dispose() {}
}

describe('PlaybackController and chords', () => {
  let backend: FakeBackend;
  let controller: PlaybackController;
  beforeEach(() => {
    vi.useFakeTimers();
    backend = new FakeBackend();
    controller = new PlaybackController(() => Promise.resolve(backend));
    controller.setScore(
      withChords(createScore({ measures: 2, instruments: ['guitar-steel'] }), [
        [0, 0, 'C'],
        [0, 1920, 'G'],
        [1, 0, 'Am'],
      ]),
    );
  });
  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it('mutes the chords by default', async () => {
    expect(controller.getState().chords).toBe('off');
    await controller.play();
    backend.clock += 1;
    vi.advanceTimersByTime(300);
    expect(backend.notes.length).toBe(0);
  });

  it('plays them once the option is on, and keeps the playhead', async () => {
    controller.seekTick(3840);
    const tick = controller.positionTick();
    await controller.setChordPlayback('strum');
    expect(controller.getState().chords).toBe('strum');
    expect(controller.positionTick()).toBe(tick);
    await controller.play();
    backend.clock += 0.2;
    vi.advanceTimersByTime(400);
    expect(backend.notes.length).toBeGreaterThan(0);
  });

  it('stops playback when the option changes', async () => {
    await controller.play();
    expect(controller.getState().status).toBe('playing');
    await controller.setChordPlayback('block');
    expect(controller.getState().status).toBe('stopped');
    await controller.setChordPlayback('off');
    expect(controller.getTimeline()!.notes).toHaveLength(0);
  });

  it('does nothing when the mode is the same', async () => {
    const before = controller.getState();
    await controller.setChordPlayback('off');
    expect(controller.getState()).toBe(before);
  });
});
