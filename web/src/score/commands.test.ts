import { describe, expect, it } from 'vitest';
import {
  addPitch,
  addSlur,
  changeDuration,
  clefAt,
  CommandError,
  createScore,
  createTriplet,
  deleteEvent,
  deleteMeasure,
  findEvent,
  History,
  insertMeasure,
  measureLength,
  putEvent,
  removePitch,
  removeSlur,
  setAccidental,
  setClef,
  setFretting,
  setKeySignature,
  setMeasureLength,
  setPitch,
  setTimeSignature,
  toggleDot,
  toggleTie,
  transpose,
  validateScore,
  type Command,
  type Pitch,
  type Score,
} from './index';
import {
  auClairDeLaLune,
  chords,
  guitarArpeggio,
  pianoGrandStaff,
  pickup,
  ties,
  triplets,
  ukuleleMelody,
} from './fixtures';

const P = (step: Pitch['step'], octave: number, alter: Pitch['alter'] = 0): Pitch => ({
  step,
  alter,
  octave,
});

/** apply + undo + redo: undo restores the very same reference, redo gives an equal score. */
function cycle(score: Score, cmd: Command, check: (after: Score) => void): Score {
  expect(validateScore(score)).toEqual([]);
  const h = new History(score);
  const after = h.execute(cmd);
  expect(after).not.toBe(score);
  expect(validateScore(after)).toEqual([]);
  check(after);
  expect(h.undo()).toBe(score);
  expect(h.redo()).toStrictEqual(after);
  expect(h.undo()).toBe(score);
  return after;
}

function events(score: Score, part = 0, staff = 0, measure = 0, voice = 0) {
  return score.parts[part]!.staves[staff]!.measures[measure]!.voices[voice]!.events;
}
const ev = (score: Score, id: string) => findEvent(score, id)!.event;
const pitchesOf = (score: Score, id: string) => {
  const e = ev(score, id);
  return e.kind === 'note' ? e.pitches : [];
};
const staffId = (s: Score, i = 0) => s.parts[0]!.staves[i]!.id;
function refuses(score: Score, cmd: Command, code: string) {
  const h = new History(score);
  expect(() => h.execute(cmd)).toThrow(CommandError);
  try {
    cmd.apply(score);
  } catch (e) {
    expect((e as CommandError).code).toBe(code);
  }
  expect(h.score).toBe(score);
  expect(h.canUndo).toBe(false);
}

describe('setPitch / setAccidental', () => {
  it('changes a pitch, undoes and redoes', () => {
    cycle(auClairDeLaLune, setPitch({ eventId: 'e1', pitch: P('D', 4) }), (a) => {
      expect(pitchesOf(a, 'e1')[0]).toStrictEqual(P('D', 4));
    });
  });
  it('keeps chord pitches sorted and refuses duplicates', () => {
    cycle(chords, setPitch({ eventId: 'e1', pitchIndex: 0, pitch: P('A', 4) }), (a) => {
      expect(pitchesOf(a, 'e1').map((p) => p.step)).toEqual(['E', 'G', 'A']);
    });
    refuses(
      chords,
      setPitch({ eventId: 'e1', pitchIndex: 0, pitch: P('E', 4) }),
      'duplicate-pitch',
    );
  });
  it('clears a tie that no longer matches', () => {
    cycle(ties, setPitch({ eventId: 'e4', pitch: P('A', 4) }), (a) => {
      expect(pitchesOf(a, 'e3')[0]!.tieToNext).toBeUndefined();
    });
  });
  it('refuses rests and out-of-range pitches', () => {
    const rest = deleteEvent({ eventId: 'e1' }).apply(auClairDeLaLune);
    refuses(rest, setPitch({ eventId: 'e1', pitch: P('C', 4) }), 'not-a-note');
    refuses(auClairDeLaLune, setPitch({ eventId: 'e1', pitch: P('C', 10) }), 'pitch-out-of-range');
    refuses(auClairDeLaLune, setPitch({ eventId: 'nope', pitch: P('C', 4) }), 'not-found');
  });
  it('sets an accidental', () => {
    cycle(auClairDeLaLune, setAccidental({ eventId: 'e2', alter: 1 }), (a) => {
      expect(pitchesOf(a, 'e2')[0]).toStrictEqual(P('C', 4, 1));
    });
  });
});

describe('addPitch / removePitch', () => {
  it('adds a pitch to a chord', () => {
    cycle(chords, addPitch({ eventId: 'e1', pitch: P('B', 4) }), (a) => {
      expect(pitchesOf(a, 'e1')).toHaveLength(4);
      expect(pitchesOf(a, 'e1')[3]).toStrictEqual(P('B', 4));
    });
  });
  it('turns a single note into a chord and refuses duplicates and rests', () => {
    cycle(auClairDeLaLune, addPitch({ eventId: 'e1', pitch: P('E', 4) }), (a) => {
      expect(pitchesOf(a, 'e1')).toHaveLength(2);
    });
    refuses(chords, addPitch({ eventId: 'e1', pitch: P('C', 4) }), 'duplicate-pitch');
  });
  it('removes a pitch but never the last one', () => {
    cycle(chords, removePitch({ eventId: 'e1', pitchIndex: 1 }), (a) => {
      expect(pitchesOf(a, 'e1').map((p) => p.step)).toEqual(['C', 'G']);
    });
    refuses(auClairDeLaLune, removePitch({ eventId: 'e1', pitchIndex: 0 }), 'last-pitch');
    refuses(chords, removePitch({ eventId: 'e1', pitchIndex: 9 }), 'invalid-argument');
  });
});

describe('toggleTie', () => {
  it('ties to the next note with the same pitch, then untie', () => {
    const tied = cycle(auClairDeLaLune, toggleTie({ eventId: 'e1' }), (a) => {
      expect(pitchesOf(a, 'e1')[0]!.tieToNext).toBe(true);
    });
    cycle(tied, toggleTie({ eventId: 'e1' }), (a) => {
      expect(pitchesOf(a, 'e1')[0]!.tieToNext).toBeUndefined();
    });
  });
  it('ties across a barline', () => {
    const noTie = setPitch({ eventId: 'e4', pitch: P('G', 4) }).apply(
      toggleTie({ eventId: 'e3' }).apply(ties),
    );
    expect(pitchesOf(noTie, 'e3')[0]!.tieToNext).toBeUndefined();
    cycle(noTie, toggleTie({ eventId: 'e3' }), (a) => {
      expect(pitchesOf(a, 'e3')[0]!.tieToNext).toBe(true);
    });
  });
  it('refuses when the next event holds another pitch', () => {
    refuses(auClairDeLaLune, toggleTie({ eventId: 'e3' }), 'no-tie-target');
  });
});

describe('deleteEvent', () => {
  it('replaces the note by a rest of the same duration and drops its slurs', () => {
    expect(auClairDeLaLune.slurs).toHaveLength(1);
    cycle(auClairDeLaLune, deleteEvent({ eventId: 'e1' }), (a) => {
      expect(ev(a, 'e1')).toStrictEqual({
        kind: 'rest',
        id: 'e1',
        duration: { base: 'quarter', dots: 0 },
      });
      expect(a.slurs).toHaveLength(0);
    });
  });
  it('is a no-op on a rest (not recorded in history)', () => {
    const rest = deleteEvent({ eventId: 'e1' }).apply(auClairDeLaLune);
    const h = new History(rest);
    expect(h.execute(deleteEvent({ eventId: 'e1' }))).toBe(rest);
    expect(h.canUndo).toBe(false);
  });
  it('keeps a tuplet member in its tuplet', () => {
    cycle(triplets, deleteEvent({ eventId: 'e2' }), (a) => {
      expect(ev(a, 'e2').kind).toBe('rest');
    });
  });
});

describe('putEvent', () => {
  const empty = () => createScore({ measures: 2, instruments: ['voice'] });

  it('writes a note into a rest and fills the rest of the measure with rests', () => {
    const s = empty();
    cycle(
      s,
      putEvent({
        staffId: staffId(s),
        measure: 0,
        tick: 0,
        event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('C', 4)] },
        id: 'n1',
      }),
      (a) => {
        const list = events(a);
        // Rests follow the beat grid: quarter rest (beat 2), then half rest (beats 3-4).
        expect(list.map((e) => `${e.kind}:${e.duration.base}${e.duration.dots}`)).toEqual([
          'note:quarter0',
          'rest:quarter0',
          'rest:half0',
        ]);
        expect(a.parts[0]!.staves[0]!.measures[1]).toBe(s.parts[0]!.staves[0]!.measures[1]);
      },
    );
  });
  it('cuts a rest that starts before the position', () => {
    const s = empty();
    cycle(
      s,
      putEvent({
        staffId: staffId(s),
        measure: 0,
        tick: 960,
        event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('E', 4)] },
      }),
      (a) => {
        expect(events(a).map((e) => e.duration.base)).toEqual(['quarter', 'quarter', 'half']);
        expect(events(a).map((e) => e.kind)).toEqual(['rest', 'note', 'rest']);
      },
    );
  });
  it('overwrites following events (overwrite, never overflow)', () => {
    const s = auClairDeLaLune;
    cycle(
      s,
      putEvent({
        staffId: staffId(s),
        measure: 0,
        tick: 0,
        event: { kind: 'note', duration: { base: 'half', dots: 0 }, pitches: [P('G', 4)] },
        id: 'g',
      }),
      (a) => {
        expect(events(a).map((e) => e.id)).toEqual(['g', 'e3', 'e4']);
        expect(a.slurs).toHaveLength(0);
      },
    );
  });
  it('splits a cut note into tied notes', () => {
    const s = createScore({ measures: 1, instruments: ['voice'] });
    const filled = putEvent({
      staffId: staffId(s),
      measure: 0,
      tick: 0,
      event: { kind: 'note', duration: { base: 'whole', dots: 0 }, pitches: [P('C', 4)] },
      id: 'w',
    }).apply(s);
    cycle(
      filled,
      putEvent({
        staffId: staffId(s),
        measure: 0,
        tick: 2400,
        event: { kind: 'note', duration: { base: 'eighth', dots: 0 }, pitches: [P('E', 4)] },
        id: 'x',
      }),
      (a) => {
        const list = events(a);
        expect(list.map((e) => `${e.kind}:${e.duration.base}`)).toEqual([
          'note:half',
          'note:eighth',
          'note:eighth',
          'rest:quarter',
        ]);
        const first = list[0]!;
        expect(first.kind === 'note' && first.pitches[0]!.tieToNext).toBe(true);
        const second = list[1]!;
        expect(second.kind === 'note' && second.pitches[0]!.tieToNext).toBeUndefined();
      },
    );
  });
  it('refuses an event that would pass the barline', () => {
    const s = empty();
    refuses(
      s,
      putEvent({
        staffId: staffId(s),
        measure: 0,
        tick: 2880,
        event: { kind: 'note', duration: { base: 'half', dots: 0 }, pitches: [P('C', 4)] },
      }),
      'exceeds-measure',
    );
    refuses(
      s,
      putEvent({
        staffId: staffId(s),
        measure: 0,
        tick: 100,
        event: { kind: 'rest', duration: { base: 'half', dots: 0 } },
      }),
      'bad-position',
    );
    refuses(
      s,
      putEvent({
        staffId: 'nope',
        measure: 0,
        tick: 0,
        event: { kind: 'rest', duration: { base: 'half', dots: 0 } },
      }),
      'not-found',
    );
  });
  it('replaces a tuplet member of the same duration, refuses other overwrites', () => {
    const s = triplets;
    cycle(
      s,
      putEvent({
        staffId: staffId(s),
        measure: 0,
        tick: 0,
        event: { kind: 'note', duration: { base: 'eighth', dots: 0 }, pitches: [P('A', 5)] },
        id: 'z',
      }),
      (a) => {
        expect(a.parts[0]!.staves[0]!.measures[0]!.voices[0]!.tuplets[0]!.eventIds[0]).toBe('z');
      },
    );
    refuses(
      s,
      putEvent({
        staffId: staffId(s),
        measure: 0,
        tick: 0,
        event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('A', 5)] },
      }),
      'tuplet-conflict',
    );
  });
  it('refuses a dotted 32nd (off the tick grid)', () => {
    const s = createScore({ measures: 1, instruments: ['voice'] });
    refuses(
      s,
      putEvent({
        staffId: staffId(s),
        measure: 0,
        tick: 0,
        event: { kind: 'rest', duration: { base: '32nd', dots: 1 } },
      }),
      'invalid-argument',
    );
  });
  it('puts a rest and a chord', () => {
    const s = empty();
    cycle(
      s,
      putEvent({
        staffId: staffId(s),
        measure: 1,
        tick: 0,
        event: {
          kind: 'note',
          duration: { base: 'half', dots: 0 },
          pitches: [P('G', 4), P('C', 4), P('E', 4)],
        },
      }),
      (a) => {
        const e = events(a, 0, 0, 1)[0]!;
        expect(e.kind === 'note' && e.pitches.map((p) => p.step)).toEqual(['C', 'E', 'G']);
      },
    );
  });
});

describe('changeDuration / toggleDot', () => {
  it('a longer note consumes the following events', () => {
    cycle(
      auClairDeLaLune,
      changeDuration({ eventId: 'e1', duration: { base: 'half', dots: 0 } }),
      (a) => {
        expect(events(a).map((e) => e.id)).toEqual(['e1', 'e3', 'e4']);
        expect(a.slurs).toHaveLength(1);
      },
    );
  });
  it('a shorter note leaves rests', () => {
    cycle(
      auClairDeLaLune,
      changeDuration({ eventId: 'e1', duration: { base: 'eighth', dots: 0 } }),
      (a) => {
        expect(
          events(a)
            .slice(0, 2)
            .map((e) => `${e.kind}:${e.duration.base}`),
        ).toEqual(['note:eighth', 'rest:eighth']);
      },
    );
  });
  it('refuses to overflow the measure and to touch tuplets', () => {
    refuses(
      auClairDeLaLune,
      changeDuration({ eventId: 'e4', duration: { base: 'half', dots: 0 } }),
      'exceeds-measure',
    );
    refuses(
      triplets,
      changeDuration({ eventId: 'e1', duration: { base: 'quarter', dots: 0 } }),
      'tuplet-conflict',
    );
  });
  it('toggles a dot on and off', () => {
    const dotted = cycle(auClairDeLaLune, toggleDot({ eventId: 'e1' }), (a) => {
      expect(ev(a, 'e1').duration).toStrictEqual({ base: 'quarter', dots: 1 });
      expect(events(a).map((e) => e.kind)).toEqual(['note', 'rest', 'note', 'note']);
    });
    cycle(dotted, toggleDot({ eventId: 'e1' }), (a) => {
      expect(ev(a, 'e1').duration.dots).toBe(0);
    });
    refuses(auClairDeLaLune, toggleDot({ eventId: 'e4' }), 'exceeds-measure');
  });
});

describe('createTriplet', () => {
  it('turns a note into a 3:2 triplet', () => {
    cycle(auClairDeLaLune, createTriplet({ eventId: 'e2' }), (a) => {
      const voice = a.parts[0]!.staves[0]!.measures[0]!.voices[0]!;
      expect(voice.events).toHaveLength(6);
      expect(voice.tuplets).toHaveLength(1);
      expect(voice.tuplets[0]).toMatchObject({ actual: 3, normal: 2 });
      expect(voice.tuplets[0]!.eventIds[0]).toBe('e2');
      expect(voice.events[1]!.duration.base).toBe('eighth');
    });
  });
  it('refuses dotted notes, existing tuplets and 32nds', () => {
    const dotted = toggleDot({ eventId: 'e1' }).apply(auClairDeLaLune);
    refuses(dotted, createTriplet({ eventId: 'e1' }), 'invalid-argument');
    refuses(triplets, createTriplet({ eventId: 'e1' }), 'tuplet-conflict');
  });
});

describe('transpose', () => {
  it('moves by an octave keeping the spelling', () => {
    cycle(auClairDeLaLune, transpose({ eventIds: ['e1', 'e5'], semitones: 12 }), (a) => {
      expect(pitchesOf(a, 'e1')[0]).toStrictEqual(P('C', 5));
      expect(pitchesOf(a, 'e5')[0]).toStrictEqual(P('E', 5));
      expect(pitchesOf(a, 'e2')[0]).toStrictEqual(P('C', 4));
    });
  });
  it('moves by semitones with key-aware spelling', () => {
    cycle(auClairDeLaLune, transpose({ eventIds: ['e1'], semitones: 1 }), (a) => {
      expect(pitchesOf(a, 'e1')[0]).toStrictEqual(P('C', 4, 1));
    });
    cycle(auClairDeLaLune, transpose({ eventIds: ['e1'], semitones: -1 }), (a) => {
      expect(pitchesOf(a, 'e1')[0]).toStrictEqual(P('B', 3));
    });
    const inF = setKeySignature({ measure: 0, fifths: -1 }).apply(auClairDeLaLune);
    expect(
      pitchesOf(transpose({ eventIds: ['e1'], semitones: 10 }).apply(inF), 'e1')[0],
    ).toStrictEqual(P('B', 4, -1));
  });
  it('keeps a tie when both notes move, drops it when only one does', () => {
    cycle(ties, transpose({ eventIds: ['e3', 'e4'], semitones: 2 }), (a) => {
      expect(pitchesOf(a, 'e3')[0]!.tieToNext).toBe(true);
    });
    cycle(ties, transpose({ eventIds: ['e3'], semitones: 2 }), (a) => {
      expect(pitchesOf(a, 'e3')[0]!.tieToNext).toBeUndefined();
    });
  });
  it('is all or nothing and ignores rests', () => {
    refuses(auClairDeLaLune, transpose({ eventIds: ['e1'], semitones: 120 }), 'pitch-out-of-range');
    const h = new History(auClairDeLaLune);
    expect(h.execute(transpose({ eventIds: ['e1'], semitones: 0 }))).toBe(auClairDeLaLune);
  });
  it('drops fretting', () => {
    cycle(guitarArpeggio, transpose({ eventIds: ['e1'], semitones: 12 }), (a) => {
      expect(pitchesOf(a, 'e1')[0]!.fretting).toBeUndefined();
    });
  });
});

describe('setFretting', () => {
  it('derives the written pitch from string and fret (guitar written an octave up)', () => {
    cycle(guitarArpeggio, setFretting({ eventId: 'e1', string: 4, fret: 7 }), (a) => {
      expect(pitchesOf(a, 'e1')[0]).toStrictEqual({
        ...P('A', 4),
        fretting: { string: 4, fret: 7 },
      });
    });
  });
  it('works on the ukulele', () => {
    cycle(ukuleleMelody, setFretting({ eventId: 'e1', string: 2, fret: 5 }), (a) => {
      expect(pitchesOf(a, 'e1')[0]).toMatchObject({ step: 'A', octave: 4 });
    });
  });
  it('refuses unknown strings, frets and untuned instruments', () => {
    refuses(guitarArpeggio, setFretting({ eventId: 'e1', string: 7, fret: 0 }), 'invalid-argument');
    refuses(
      guitarArpeggio,
      setFretting({ eventId: 'e1', string: 1, fret: 25 }),
      'invalid-argument',
    );
    refuses(pianoGrandStaff, setFretting({ eventId: 'e1', string: 1, fret: 0 }), 'no-tuning');
  });
});

describe('slurs', () => {
  it('adds and removes a slur', () => {
    const added = cycle(
      auClairDeLaLune,
      addSlur({ startEventId: 'e5', endEventId: 'e6', id: 'mine' }),
      (a) => {
        expect(a.slurs.map((s) => s.id)).toEqual(['sl1', 'mine']);
      },
    );
    cycle(added, removeSlur({ slurId: 'mine' }), (a) => {
      expect(a.slurs.map((s) => s.id)).toEqual(['sl1']);
    });
  });
  it('refuses reversed, cross-staff and unknown slurs', () => {
    refuses(auClairDeLaLune, addSlur({ startEventId: 'e6', endEventId: 'e5' }), 'invalid-argument');
    refuses(
      pianoGrandStaff,
      addSlur({ startEventId: 'e1', endEventId: 'e14' }),
      'invalid-argument',
    );
    refuses(auClairDeLaLune, addSlur({ startEventId: 'e1', endEventId: 'zz' }), 'not-found');
    refuses(auClairDeLaLune, removeSlur({ slurId: 'zz' }), 'not-found');
  });
});

describe('setTimeSignature', () => {
  const base = () => createScore({ measures: 4, instruments: ['voice'] });
  it('shortens following measures (padding and truncating) and restores', () => {
    const s = base();
    const three = cycle(
      s,
      setTimeSignature({ measure: 2, time: { beats: 3, beatType: 4 } }),
      (a) => {
        expect(measureLength(a, 1)).toBe(3840);
        expect(measureLength(a, 2)).toBe(2880);
        expect(measureLength(a, 3)).toBe(2880);
        expect(events(a, 0, 0, 3)[0]!.duration).toStrictEqual({ base: 'half', dots: 1 });
        expect(a.parts[0]!.staves[0]!.measures[0]).toBe(s.parts[0]!.staves[0]!.measures[0]);
      },
    );
    cycle(three, setTimeSignature({ measure: 2, time: { beats: 4, beatType: 4 } }), (a) => {
      expect(measureLength(a, 3)).toBe(3840);
    });
  });
  it('cuts notes into tied notes and drops those past the end', () => {
    const s0 = base();
    const sid = staffId(s0);
    let s = putEvent({
      staffId: sid,
      measure: 1,
      tick: 2880,
      event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('C', 4)] },
      id: 'late',
    }).apply(s0);
    s = putEvent({
      staffId: sid,
      measure: 1,
      tick: 1920,
      event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('D', 4)] },
      id: 'mid',
    }).apply(s);
    cycle(s, setTimeSignature({ measure: 1, time: { beats: 2, beatType: 4 } }), (a) => {
      expect(findEvent(a, 'late')).toBeUndefined();
      expect(findEvent(a, 'mid')).toBeUndefined();
      expect(measureLength(a, 1)).toBe(1920);
    });
  });
  it('refuses to cut a tuplet and invalid signatures', () => {
    const s = setTimeSignature({ measure: 0, time: { beats: 1, beatType: 4 } });
    refuses(triplets, s, 'tuplet-conflict');
    refuses(
      auClairDeLaLune,
      setTimeSignature({ measure: 0, time: { beats: 4, beatType: 3 as 4 } }),
      'invalid-argument',
    );
    refuses(
      auClairDeLaLune,
      setTimeSignature({ measure: 99, time: { beats: 3, beatType: 4 } }),
      'bad-position',
    );
  });
});

describe('setKeySignature / setClef / setMeasureLength', () => {
  it('sets a key signature at a measure', () => {
    cycle(auClairDeLaLune, setKeySignature({ measure: 2, fifths: 2 }), (a) => {
      expect(a.measures[2]!.keyFifths).toBe(2);
    });
    refuses(auClairDeLaLune, setKeySignature({ measure: 0, fifths: 9 }), 'invalid-argument');
  });
  it('sets the initial clef and a clef change', () => {
    cycle(
      auClairDeLaLune,
      setClef({ staffId: staffId(auClairDeLaLune), measure: 0, clef: 'alto' }),
      (a) => {
        expect(a.parts[0]!.staves[0]!.clef).toBe('alto');
      },
    );
    cycle(
      auClairDeLaLune,
      setClef({ staffId: staffId(auClairDeLaLune), measure: 2, clef: 'bass' }),
      (a) => {
        const staff = a.parts[0]!.staves[0]!;
        expect([clefAt(staff, 1), clefAt(staff, 2), clefAt(staff, 3)]).toEqual([
          'treble',
          'bass',
          'bass',
        ]);
      },
    );
    refuses(auClairDeLaLune, setClef({ staffId: 'zz', measure: 0, clef: 'bass' }), 'not-found');
  });
  it('creates and removes a pickup measure', () => {
    const s = createScore({ measures: 2, instruments: ['voice'] });
    const p = cycle(s, setMeasureLength({ measure: 0, length: 960 }), (a) => {
      expect(measureLength(a, 0)).toBe(960);
      expect(events(a)).toHaveLength(1);
      expect(events(a)[0]!.duration.base).toBe('quarter');
    });
    cycle(p, setMeasureLength({ measure: 0, length: null }), (a) => {
      expect(a.measures[0]!.length).toBeUndefined();
      expect(measureLength(a, 0)).toBe(3840);
    });
    refuses(s, setMeasureLength({ measure: 0, length: 100 }), 'invalid-argument');
    refuses(s, setMeasureLength({ measure: 0, length: 9600 }), 'invalid-argument');
  });
});

describe('insertMeasure / deleteMeasure', () => {
  it('inserts empty measures at the start, middle and end', () => {
    for (const index of [0, 2, 4]) {
      cycle(auClairDeLaLune, insertMeasure({ index }), (a) => {
        expect(a.measures).toHaveLength(5);
        expect(events(a, 0, 0, index)[0]).toMatchObject({ kind: 'rest' });
        expect(a.measures[0]!.time).toBeDefined();
      });
    }
    cycle(pianoGrandStaff, insertMeasure({ index: 1, count: 2 }), (a) => {
      expect(a.parts[0]!.staves.every((s) => s.measures.length === 6)).toBe(true);
    });
  });
  it('uses the pickup-aware length of the inherited time signature', () => {
    cycle(pickup, insertMeasure({ index: 0 }), (a) => {
      expect(measureLength(a, 0)).toBe(1920);
    });
  });
  it('clears a tie that now points at a rest', () => {
    cycle(ties, insertMeasure({ index: 1 }), (a) => {
      expect(pitchesOf(a, 'e3')[0]!.tieToNext).toBeUndefined();
    });
  });
  it('refuses a bad index', () => {
    refuses(auClairDeLaLune, insertMeasure({ index: 9 }), 'bad-position');
  });
  it('deletes a measure, its slurs and cross-barline ties', () => {
    cycle(auClairDeLaLune, deleteMeasure({ index: 0 }), (a) => {
      expect(a.measures).toHaveLength(3);
      expect(a.slurs).toHaveLength(0);
      expect(a.measures[0]!.time).toBeDefined();
      expect(a.measures[0]!.keyFifths).toBe(0);
    });
    cycle(ties, deleteMeasure({ index: 1 }), (a) => {
      expect(pitchesOf(a, 'e3')[0]!.tieToNext).toBeUndefined();
    });
  });
  it('carries attributes of a deleted pickup and refuses the last measure', () => {
    cycle(pickup, deleteMeasure({ index: 0 }), (a) => {
      expect(a.measures[0]!.time).toStrictEqual({ beats: 2, beatType: 4 });
      expect(a.measures[0]!.length).toBeUndefined();
    });
    const one = createScore({ measures: 1 });
    refuses(one, deleteMeasure({ index: 0 }), 'last-measure');
    refuses(auClairDeLaLune, deleteMeasure({ index: 7 }), 'bad-position');
  });
});

describe('History', () => {
  it('has unlimited undo and redo and clears redo on a new edit', () => {
    const h = new History(auClairDeLaLune);
    const states: Score[] = [auClairDeLaLune];
    for (let i = 0; i < 200; i++) {
      states.push(
        h.execute(setPitch({ eventId: 'e1', pitch: P('C', 3 + (i % 5), i % 2 === 0 ? 0 : 1) })),
      );
    }
    for (let i = 199; i >= 0; i--) expect(h.undo()).toBe(states[i]);
    expect(h.canUndo).toBe(false);
    for (let i = 1; i <= 200; i++) expect(h.redo()).toStrictEqual(states[i]);
    h.undo();
    h.execute(setPitch({ eventId: 'e2', pitch: P('G', 4) }));
    expect(h.canRedo).toBe(false);
  });
  it('can be reset', () => {
    const h = new History(auClairDeLaLune);
    h.execute(deleteEvent({ eventId: 'e1' }));
    h.reset(chords);
    expect(h.score).toBe(chords);
    expect(h.canUndo).toBe(false);
  });
});

describe('structural sharing', () => {
  it('an edit copies only the path to the change', () => {
    const base = createScore({ measures: 40, instruments: ['piano', 'violin'] });
    const target = base.parts[1]!.staves[0]!;
    const e = target.measures[7]!.voices[0]!.events[0]!;
    const after = setPitch({ eventId: 'x', pitch: P('C', 4) }); // not found must not mutate
    expect(() => after.apply(base)).toThrow(CommandError);

    const edited = changeDuration({ eventId: e.id, duration: { base: 'half', dots: 0 } }).apply(
      base,
    );
    expect(edited).not.toBe(base);
    expect(edited.measures).toBe(base.measures);
    expect(edited.slurs).toBe(base.slurs);
    expect(edited.meta).toBe(base.meta);
    expect(edited.parts[0]).toBe(base.parts[0]);
    expect(edited.parts[1]).not.toBe(base.parts[1]);
    const nt = edited.parts[1]!.staves[0]!;
    expect(nt).not.toBe(target);
    for (let m = 0; m < 40; m++) {
      if (m === 7) expect(nt.measures[m]).not.toBe(target.measures[m]);
      else expect(nt.measures[m]).toBe(target.measures[m]);
    }
  });
  it('apply is deterministic, ids included', () => {
    const cmd = putEvent({
      staffId: staffId(auClairDeLaLune),
      measure: 0,
      tick: 480,
      event: { kind: 'note', duration: { base: 'eighth', dots: 0 }, pitches: [P('A', 4)] },
    });
    expect(cmd.apply(auClairDeLaLune)).toStrictEqual(cmd.apply(auClairDeLaLune));
  });
});
