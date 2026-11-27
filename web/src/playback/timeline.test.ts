import { describe, expect, it } from 'vitest';
import { buildScore } from '../score/fixtures/dsl';
import type { NoteEvent } from '../score';
import { makeTempoMap } from './clock';
import { beatTicks, buildTimeline } from './timeline';

const staff = (...measures: string[]) => ({ measures });

function one(measures: string[], extra: Record<string, unknown> = {}, instrument = 'flute') {
  return buildScore({
    title: 't',
    parts: [{ name: 'P', instrument, staves: [staff(...measures)] }],
    ...extra,
  });
}

describe('buildTimeline', () => {
  it('places notes on the 960 ticks per quarter grid, rests included in the spans', () => {
    const tl = buildTimeline(one(['C4:q r:q E4:h']));
    expect(tl.notes.map((n) => [n.startTick, n.endTick])).toEqual([
      [0, 960],
      [1920, 3840],
    ]);
    expect(tl.spans.map((s) => [s.startTick, s.endTick, s.rest])).toEqual([
      [0, 960, false],
      [960, 1920, true],
      [1920, 3840, false],
    ]);
    expect(tl.totalTicks).toBe(3840);
  });

  it('handles dots and double dots', () => {
    const tl = buildTimeline(one(['C4:q. D4:e E4:h..']));
    expect(tl.notes.map((n) => n.endTick - n.startTick)).toEqual([1440, 480, 3360]);
  });

  it('plays triplets at two thirds of their nominal length', () => {
    const tl = buildTimeline(one(['(3 C4:e D4:e E4:e) F4:h']));
    expect(tl.notes.map((n) => [n.startTick, n.endTick])).toEqual([
      [0, 320],
      [320, 640],
      [640, 960],
      [960, 2880],
    ]);
  });

  it('numbers the measures from their real lengths', () => {
    const tl = buildTimeline(one(['C4:w', 'D4:w']));
    expect(tl.measureStarts).toEqual([0, 3840]);
    expect(tl.notes[1]!.startTick).toBe(3840);
  });

  it('puts every chord pitch at the same start', () => {
    const tl = buildTimeline(one(['C4+E4+G4:h r:h']));
    expect(tl.notes.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(new Set(tl.notes.map((n) => n.startTick))).toEqual(new Set([0]));
    // One span for the chord event.
    expect(tl.spans.filter((s) => !s.rest)).toHaveLength(1);
  });

  describe('ties', () => {
    it('merges tied notes, also across a barline, into one sounding note', () => {
      const tl = buildTimeline(one(['C4:h D4:q E4:q~', 'E4:h r:h']));
      const e = tl.notes.find((n) => n.midi === 64)!;
      expect(e.startTick).toBe(2880);
      expect(e.endTick).toBe(3840 + 1920);
      expect(e.eventIds).toHaveLength(2);
      expect(tl.notes).toHaveLength(3);
      // The two events keep their own spans (each one lights up for its own duration).
      expect(tl.spans.filter((s) => e.eventIds.includes(s.id))).toHaveLength(2);
    });

    it('merges a chain of three tied notes', () => {
      const tl = buildTimeline(one(['C4:q~ C4:q~ C4:h~', 'C4:w']));
      expect(tl.notes).toHaveLength(1);
      expect(tl.notes[0]!.endTick).toBe(3840 + 3840);
    });

    it('ties one pitch of a chord only', () => {
      const base = one(['D4:h C4+E4:h', 'C4:h r:h']);
      // Tie only the C of the chord (the DSL ties a whole event).
      const voice = base.parts[0]!.staves[0]!.measures[0]!.voices[0]!;
      const chord = voice.events[1] as NoteEvent;
      const patched = {
        ...chord,
        pitches: chord.pitches.map((p, i) => (i === 0 ? { ...p, tieToNext: true } : p)),
      };
      const score = {
        ...base,
        parts: base.parts.map((part) => ({
          ...part,
          staves: part.staves.map((st) => ({
            ...st,
            measures: st.measures.map((sm, mi) =>
              mi === 0
                ? {
                    ...sm,
                    voices: [{ ...sm.voices[0]!, events: [voice.events[0]!, patched] }],
                  }
                : sm,
            ),
          })),
        })),
      };
      const tl = buildTimeline(score);
      const c = tl.notes.filter((n) => n.midi === 60);
      const e = tl.notes.filter((n) => n.midi === 64);
      expect(c).toHaveLength(1);
      expect(c[0]!.endTick).toBe(3840 + 1920);
      expect(e).toHaveLength(1);
    });

    it('re-attacks when the next note is a different pitch', () => {
      const tl = buildTimeline(one(['C4:h D4:h']));
      expect(tl.notes).toHaveLength(2);
    });
  });

  describe('sounding pitch', () => {
    it('applies the part transposition (classical guitar sounds an octave below the written note)', () => {
      const tl = buildTimeline(one(['E4:w'], {}, 'guitar-classical'));
      expect(tl.notes[0]!.midi).toBe(64 - 12);
    });

    it('transposes a B-flat clarinet down a major second', () => {
      const tl = buildTimeline(one(['D5:w'], {}, 'clarinet'));
      expect(tl.notes[0]!.midi).toBe(74 - 2);
    });

    it('does not shift a capo again: the written pitch already includes it', () => {
      const score = buildScore({
        title: 'capo',
        parts: [
          {
            name: 'G',
            instrument: 'guitar-classical',
            capo: 2,
            // Open B string (written B4 = sounding B3) with the capo on fret 2 sounds C#4.
            staves: [{ measures: ['C#5@2.0:w'] }],
          },
        ],
      });
      // Written C#5, an octave lower when it sounds: C#4 = 61.
      expect(buildTimeline(score).notes[0]!.midi).toBe(61);
    });
  });

  describe('several parts and staves', () => {
    const score = buildScore({
      title: 'two',
      parts: [
        {
          name: 'Piano',
          instrument: 'piano',
          staves: [
            { clef: 'treble', measures: ['C5:w'] },
            { clef: 'bass', measures: ['C3:h G2:h'] },
          ],
        },
        { name: 'Cello', instrument: 'cello', staves: [{ measures: ['E2:w'] }] },
      ],
    });
    const tl = buildTimeline(score);

    it('lists a staff channel per staff', () => {
      expect(tl.staves.map((s) => [s.partIndex, s.staffIndex, s.instrument])).toEqual([
        [0, 0, 'piano'],
        [0, 1, 'piano'],
        [1, 0, 'cello'],
      ]);
    });

    it('tags each note with its staff and part', () => {
      const byStaff = new Map<string, number>();
      for (const n of tl.notes) byStaff.set(n.staffId, (byStaff.get(n.staffId) ?? 0) + 1);
      expect([...byStaff.values()].sort()).toEqual([1, 1, 2]);
      expect(tl.notes.filter((n) => n.partId === score.parts[1]!.id)).toHaveLength(1);
    });
  });

  it('plays every voice of a staff', () => {
    const tl = buildTimeline(
      buildScore({
        title: 'v',
        parts: [
          { name: 'P', instrument: 'piano', staves: [{ measures: [['C5:w', 'E4:h G4:h']] }] },
        ],
      }),
    );
    expect(tl.notes).toHaveLength(3);
  });

  describe('tempo', () => {
    it('keeps the score tempo, then follows tempo changes at the measure they start', () => {
      const score = one(['C4:w', 'D4:w', 'E4:w'], {
        tempoBpm: 120,
        measureInfo: { 1: { tempoBpm: 60 }, 2: { tempoBpm: 60 } },
      });
      const tl = buildTimeline(score);
      expect(tl.tempo).toEqual([
        { tick: 0, bpm: 120 },
        { tick: 3840, bpm: 60 },
      ]);
      const map = makeTempoMap(tl.tempo);
      // One 4/4 measure at 120 = 2 s, then at 60 = 4 s.
      expect(map.ticksToSeconds(3840)).toBeCloseTo(2);
      expect(map.ticksToSeconds(7680)).toBeCloseTo(6);
      expect(map.secondsToTicks(6)).toBeCloseTo(7680);
      expect(map.secondsToTicks(3)).toBeCloseTo(3840 + 960);
    });
  });

  describe('pickup measures', () => {
    const score = one(['G4:q', 'C5:h C5:q C5:q'], { measureInfo: { 0: { length: 960 } } });
    const tl = buildTimeline(score);

    it('starts the second measure after the short first one', () => {
      expect(tl.measureStarts).toEqual([0, 960]);
      expect(tl.totalTicks).toBe(960 + 3840);
      expect(tl.notes[1]!.startTick).toBe(960);
    });

    it('counts the pickup as the last beat of the bar for the metronome (no accent)', () => {
      expect(tl.beats[0]).toEqual({ tick: 0, accent: false });
      expect(tl.beats[1]).toEqual({ tick: 960, accent: true });
    });
  });

  describe('metronome beats', () => {
    it('accents the first beat of each measure', () => {
      const tl = buildTimeline(one(['C4:w', 'C4:w']));
      expect(tl.beats.map((b) => [b.tick, b.accent])).toEqual([
        [0, true],
        [960, false],
        [1920, false],
        [2880, false],
        [3840, true],
        [4800, false],
        [5760, false],
        [6720, false],
      ]);
    });

    it('clicks dotted quarters in 6/8', () => {
      expect(beatTicks(6, 8)).toBe(1440);
      expect(beatTicks(3, 4)).toBe(960);
      expect(beatTicks(3, 8)).toBe(480);
      expect(beatTicks(2, 2)).toBe(1920);
    });
  });

  it('returns an empty timeline for a score without notes', () => {
    const tl = buildTimeline(one(['r:w']));
    expect(tl.notes).toEqual([]);
    expect(tl.totalTicks).toBe(3840);
  });
});
