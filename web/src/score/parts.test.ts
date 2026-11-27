import { describe, expect, it } from 'vitest';
import {
  addPart,
  assignFretting,
  changeInstrument,
  clefAt,
  CommandError,
  createScore,
  History,
  matchTuningPreset,
  movePart,
  outOfRangeEvents,
  partRange,
  putEvent,
  removePart,
  renamePart,
  setCapo,
  setClef,
  setKeySignature,
  setStaffLayout,
  setTempo,
  setTuning,
  staffLayoutOf,
  syncCompanionStaff,
  tempoAt,
  tuningPresets,
  validateScore,
  type Command,
  type Pitch,
  type Score,
} from './index';
import { celloClefChanges, guitarArpeggio, pianoGrandStaff, ukuleleMelody } from './fixtures';

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

function refuses(score: Score, cmd: Command, code: string) {
  const h = new History(score);
  expect(() => h.execute(cmd)).toThrow(CommandError);
  try {
    cmd.apply(score);
  } catch (e) {
    expect((e as CommandError).code).toBe(code);
  }
  expect(h.score).toBe(score);
}

const noteAt = (s: Score, part: number, staff: number, measure: number, i = 0) => {
  const e = s.parts[part]!.staves[staff]!.measures[measure]!.voices[0]!.events[i]!;
  if (e.kind !== 'note') throw new Error('not a note');
  return e;
};

describe('addPart / removePart / movePart / renamePart', () => {
  const base = createScore({ measures: 3, instruments: ['guitar-steel'] });

  it('adds a cello after the guitar with empty measures matching the score', () => {
    cycle(base, addPart({ instrument: 'cello' }), (a) => {
      expect(a.parts).toHaveLength(2);
      const cello = a.parts[1]!;
      expect(cello.instrument).toBe('cello');
      expect(cello.name).toBe('Cello');
      expect(cello.staves).toHaveLength(1);
      expect(cello.staves[0]!.clef).toBe('bass');
      expect(cello.staves[0]!.measures).toHaveLength(3);
    });
  });

  it('adds a piano grand staff at a given index, with a custom name', () => {
    cycle(base, addPart({ instrument: 'piano', index: 0, name: 'Keys' }), (a) => {
      expect(a.parts[0]!.name).toBe('Keys');
      expect(a.parts[0]!.staves.map((s) => s.clef)).toEqual(['treble', 'bass']);
    });
  });

  it('adds a guitar with standard + tab or tab only', () => {
    cycle(base, addPart({ instrument: 'guitar-classical', layout: 'standard+tab' }), (a) => {
      expect(a.parts[1]!.staves.map((s) => s.type)).toEqual(['standard', 'tab']);
    });
    cycle(base, addPart({ instrument: 'ukulele-tenor', layout: 'tab' }), (a) => {
      expect(a.parts[1]!.staves.map((s) => s.type)).toEqual(['tab']);
    });
  });

  it('uses the pickup length of the measures', () => {
    const s = setKeySignature({ measure: 0, fifths: 0 }).apply(
      createScore({ measures: 2, instruments: ['piano'] }),
    );
    expect(validateScore(addPart({ instrument: 'flute' }).apply(s))).toEqual([]);
  });

  it('refuses an unknown instrument and a bad index', () => {
    refuses(base, addPart({ instrument: 'theremin' }), 'not-found');
    refuses(base, addPart({ instrument: 'cello', index: 5 }), 'bad-position');
  });

  it('removes a part and its slurs; the last part cannot be removed', () => {
    const two = addPart({ instrument: 'cello' }).apply(base);
    cycle(two, removePart({ partId: two.parts[0]!.id }), (a) => {
      expect(a.parts.map((p) => p.instrument)).toEqual(['cello']);
    });
    refuses(base, removePart({ partId: base.parts[0]!.id }), 'last-part');
    refuses(two, removePart({ partId: 'nope' }), 'not-found');
  });

  it('removing a part drops the slurs on its notes', () => {
    const score = celloClefChanges;
    const withSlur: Score = {
      ...score,
      slurs: [
        {
          id: 'sl1',
          startEventId: noteAt(score, 0, 0, 0, 0).id,
          endEventId: noteAt(score, 0, 0, 0, 1).id,
        },
      ],
    };
    const two = addPart({ instrument: 'flute' }).apply(withSlur);
    const after = removePart({ partId: two.parts[0]!.id }).apply(two);
    expect(after.slurs).toEqual([]);
  });

  it('moves parts', () => {
    const three = addPart({ instrument: 'flute' }).apply(
      addPart({ instrument: 'cello' }).apply(base),
    );
    cycle(three, movePart({ partId: three.parts[2]!.id, toIndex: 0 }), (a) => {
      expect(a.parts.map((p) => p.instrument)).toEqual(['flute', 'guitar-steel', 'cello']);
    });
    expect(movePart({ partId: three.parts[1]!.id, toIndex: 1 }).apply(three)).toBe(three);
    refuses(three, movePart({ partId: three.parts[1]!.id, toIndex: 3 }), 'bad-position');
  });

  it('renames a part (trimmed), no-op when unchanged', () => {
    cycle(base, renamePart({ partId: base.parts[0]!.id, name: '  Lead  ' }), (a) => {
      expect(a.parts[0]!.name).toBe('Lead');
    });
    expect(renamePart({ partId: base.parts[0]!.id, name: base.parts[0]!.name }).apply(base)).toBe(
      base,
    );
    refuses(
      base,
      renamePart({ partId: base.parts[0]!.id, name: 'x'.repeat(101) }),
      'invalid-argument',
    );
  });
});

describe('changeInstrument', () => {
  it('keeps the sounding pitch: guitar to ukulele moves the written pitch down an octave', () => {
    const before = noteAt(guitarArpeggio, 0, 0, 0, 0); // written A3, sounds A2
    expect(before.pitches[0]).toMatchObject({ step: 'A', octave: 3 });
    cycle(
      guitarArpeggio,
      changeInstrument({ partId: guitarArpeggio.parts[0]!.id, instrument: 'ukulele-tenor' }),
      (a) => {
        const part = a.parts[0]!;
        expect(part.instrument).toBe('ukulele-tenor');
        expect(part.transposition).toBe(0);
        expect(noteAt(a, 0, 0, 0, 0).pitches[0]).toMatchObject({ step: 'A', octave: 2 });
        expect(part.staves[0]!.clef).toBe('treble');
        // both staves are kept (standard + tab) and the tab is refretted for 4 strings
        expect(part.staves.map((s) => s.type)).toEqual(['standard', 'tab']);
      },
    );
  });

  it('transposing instruments: piano to B-flat clarinet raises the written pitch by a tone', () => {
    const score = createScore({ measures: 1, instruments: ['piano'] });
    const id = 'ev';
    const withNote = putEvent({
      staffId: score.parts[0]!.staves[0]!.id,
      measure: 0,
      tick: 0,
      id,
      event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('C', 4)] },
    }).apply(score);
    const after = changeInstrument({ partId: score.parts[0]!.id, instrument: 'clarinet' }).apply(
      withNote,
    );
    expect(validateScore(after)).toEqual([]);
    expect(noteAt(after, 0, 0, 0, 0).pitches[0]).toMatchObject({ step: 'D', octave: 4 });
    // and back: the original written pitch returns
    const back = changeInstrument({ partId: score.parts[0]!.id, instrument: 'piano' }).apply(after);
    expect(noteAt(back, 0, 0, 0, 0).pitches[0]).toMatchObject({ step: 'C', alter: 0, octave: 4 });
  });

  it('cello to violin: clef falls back to treble, cello clef changes are removed', () => {
    const part = celloClefChanges.parts[0]!;
    expect(part.staves[0]!.measures.some((m) => m.clef)).toBe(true);
    cycle(celloClefChanges, changeInstrument({ partId: part.id, instrument: 'violin' }), (a) => {
      const staff = a.parts[0]!.staves[0]!;
      expect(staff.clef).toBe('treble');
      // tenor was not a violin clef; treble is allowed and stays
      expect(staff.measures.every((m) => !m.clef || m.clef === 'treble')).toBe(true);
    });
  });

  it('violin to cello keeps the treble clef (an allowed cello clef)', () => {
    const score = createScore({ measures: 1, instruments: ['violin'] });
    const after = changeInstrument({ partId: score.parts[0]!.id, instrument: 'cello' }).apply(
      score,
    );
    expect(after.parts[0]!.staves[0]!.clef).toBe('treble');
  });

  it('single staff to piano adds an empty bass staff; piano to one staff needs an empty second staff', () => {
    const solo = createScore({ measures: 2, instruments: ['flute'] });
    cycle(solo, changeInstrument({ partId: solo.parts[0]!.id, instrument: 'piano' }), (a) => {
      expect(a.parts[0]!.staves.map((s) => s.clef)).toEqual(['treble', 'bass']);
    });
    const piano = createScore({ measures: 2, instruments: ['piano'] });
    cycle(piano, changeInstrument({ partId: piano.parts[0]!.id, instrument: 'flute' }), (a) => {
      expect(a.parts[0]!.staves).toHaveLength(1);
    });
    // the left hand holds notes: refused
    refuses(
      pianoGrandStaff,
      changeInstrument({ partId: pianoGrandStaff.parts[0]!.id, instrument: 'flute' }),
      'not-empty',
    );
  });

  it('drops tuning and capo, renames when asked, no-op for the same instrument', () => {
    const tuned = setCapo({ partId: guitarArpeggio.parts[0]!.id, capo: 2 }).apply(guitarArpeggio);
    const after = changeInstrument({
      partId: tuned.parts[0]!.id,
      instrument: 'guitar-classical',
      name: 'x',
    }).apply(tuned);
    expect(after).toBe(tuned);
    cycle(
      tuned,
      changeInstrument({ partId: tuned.parts[0]!.id, instrument: 'guitar-steel', name: 'Folk' }),
      (a) => {
        expect(a.parts[0]!.capo).toBeUndefined();
        expect(a.parts[0]!.name).toBe('Folk');
      },
    );
  });

  it('tab-only guitar to piano converts the tab staff to a standard staff', () => {
    const tabOnly = setStaffLayout({ partId: guitarArpeggio.parts[0]!.id, layout: 'tab' }).apply(
      guitarArpeggio,
    );
    const after = changeInstrument({ partId: tabOnly.parts[0]!.id, instrument: 'piano' }).apply(
      tabOnly,
    );
    expect(validateScore(after)).toEqual([]);
    expect(after.parts[0]!.staves.map((s) => s.type)).toEqual(['standard', 'standard']);
  });
});

describe('setStaffLayout', () => {
  const guitar = createScore({ measures: 2, instruments: ['guitar-classical'] });
  const withNotes = putEvent({
    staffId: guitar.parts[0]!.staves[0]!.id,
    measure: 0,
    tick: 0,
    id: 'n1',
    event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('A', 3)] },
  }).apply(guitar);

  it('standard to tab keeps the staff and derives the frets', () => {
    cycle(withNotes, setStaffLayout({ partId: guitar.parts[0]!.id, layout: 'tab' }), (a) => {
      const staff = a.parts[0]!.staves[0]!;
      expect(a.parts[0]!.staves).toHaveLength(1);
      expect(staff.id).toBe(withNotes.parts[0]!.staves[0]!.id);
      expect(staff.type).toBe('tab');
      expect(noteAt(a, 0, 0, 0).pitches[0]!.fretting).toEqual({ string: 5, fret: 0 });
    });
  });

  it('standard + tab builds the TAB staff from the standard one', () => {
    cycle(
      withNotes,
      setStaffLayout({ partId: guitar.parts[0]!.id, layout: 'standard+tab' }),
      (a) => {
        expect(staffLayoutOf(a.parts[0]!)).toBe('standard+tab');
        expect(noteAt(a, 0, 1, 0).id).not.toBe(noteAt(a, 0, 0, 0).id);
        expect(noteAt(a, 0, 1, 0).pitches[0]!.fretting).toEqual({ string: 5, fret: 0 });
      },
    );
  });

  it('tab to standard returns a standard staff with the instrument clef', () => {
    const tab = setStaffLayout({ partId: guitar.parts[0]!.id, layout: 'tab' }).apply(withNotes);
    cycle(tab, setStaffLayout({ partId: guitar.parts[0]!.id, layout: 'standard' }), (a) => {
      expect(a.parts[0]!.staves[0]).toMatchObject({ type: 'standard', clef: 'treble-8vb' });
    });
  });

  it('is a no-op when already in that layout; refused for non-fretted instruments', () => {
    expect(setStaffLayout({ partId: guitar.parts[0]!.id, layout: 'standard' }).apply(guitar)).toBe(
      guitar,
    );
    const cello = createScore({ instruments: ['cello'] });
    refuses(cello, setStaffLayout({ partId: cello.parts[0]!.id, layout: 'tab' }), 'no-tuning');
  });

  it('entering a note on a tab staff derives its fret', () => {
    const tab = setStaffLayout({ partId: guitar.parts[0]!.id, layout: 'tab' }).apply(guitar);
    const after = putEvent({
      staffId: tab.parts[0]!.staves[0]!.id,
      measure: 0,
      tick: 0,
      id: 'n',
      event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('E', 4)] },
    }).apply(tab);
    expect(validateScore(after)).toEqual([]);
    expect(noteAt(after, 0, 0, 0).pitches[0]!.fretting).toEqual({ string: 4, fret: 2 });
  });
});

describe('syncCompanionStaff', () => {
  const guitar = createScore({ measures: 2, instruments: ['guitar-classical'] });
  const both = setStaffLayout({ partId: guitar.parts[0]!.id, layout: 'standard+tab' }).apply(
    guitar,
  );
  const [std, tab] = both.parts[0]!.staves;
  const edit = (staffId: string, measure: number, pitch: Pitch, id: string) =>
    putEvent({
      staffId,
      measure,
      tick: 0,
      id,
      event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [pitch] },
    });

  it('rebuilds the TAB staff from an edit of the standard staff, reusing event ids', () => {
    const edited = edit(std!.id, 1, P('E', 4), 'n2').apply(both);
    expect(edited.parts[0]!.staves[1]!.measures[1]!.voices[0]!.events[0]!.kind).toBe('rest'); // stale until synced
    const synced = cycle(edited, syncCompanionStaff({ staffId: std!.id }), (a) => {
      expect(noteAt(a, 0, 1, 1).pitches[0]).toMatchObject({ step: 'E', octave: 4 });
      expect(noteAt(a, 0, 1, 1).pitches[0]!.fretting).toEqual({ string: 4, fret: 2 });
      expect(a.parts[0]!.staves[1]!.id).toBe(tab!.id);
    });
    // Already in step: nothing changes (same reference).
    expect(syncCompanionStaff({ staffId: std!.id }).apply(synced)).toBe(synced);
  });

  it('works the other way: an edit made on the TAB staff rebuilds the standard staff', () => {
    const edited = edit(tab!.id, 0, P('A', 3), 't1').apply(both);
    const synced = syncCompanionStaff({ staffId: tab!.id }).apply(edited);
    expect(validateScore(synced)).toEqual([]);
    expect(noteAt(synced, 0, 0, 0).pitches[0]).toMatchObject({ step: 'A', octave: 3 });
    expect(noteAt(synced, 0, 0, 0).pitches[0]!.fretting).toBeUndefined();
    expect(synced.parts[0]!.staves[0]!.id).toBe(std!.id);
  });

  it('is a no-op for other layouts and refuses an unknown staff', () => {
    expect(syncCompanionStaff({ staffId: guitar.parts[0]!.staves[0]!.id }).apply(guitar)).toBe(
      guitar,
    );
    expect(() => syncCompanionStaff({ staffId: 'nope' }).apply(guitar)).toThrow(CommandError);
  });
});

describe('tuning and capo', () => {
  const dropD = tuningPresets('guitar-steel').find((t) => t.id === 'drop-d')!;

  it('has presets for guitar (incl. drop D) and ukulele (incl. low G)', () => {
    expect(tuningPresets('guitar-steel').map((t) => t.id)).toEqual(
      expect.arrayContaining(['standard', 'drop-d', 'dadgad']),
    );
    expect(tuningPresets('ukulele-tenor').map((t) => t.id)).toContain('low-g');
    expect(tuningPresets('cello')).toEqual([]);
    for (const id of ['guitar-steel', 'ukulele-soprano', 'ukulele-baritone']) {
      for (const t of tuningPresets(id)) {
        expect(t.strings).toHaveLength(tuningPresets(id)[0]!.strings.length);
      }
    }
  });

  it('drop D: low strings re-fretted, the range extends down to D2', () => {
    cycle(
      guitarArpeggio,
      setTuning({ partId: guitarArpeggio.parts[0]!.id, tuning: dropD.strings }),
      (a) => {
        expect(a.parts[0]!.tuning).toHaveLength(6);
        expect(partRange(a.parts[0]!)!.low).toEqual(P('D', 2));
        // A3 written (A2 sounding) stays on the A string
        expect(noteAt(a, 0, 0, 0).pitches[0]!.fretting).toEqual({ string: 5, fret: 0 });
      },
    );
    const detuned = setTuning({ partId: guitarArpeggio.parts[0]!.id, tuning: dropD.strings }).apply(
      guitarArpeggio,
    );
    expect(matchTuningPreset('guitar-steel', detuned.parts[0]!.tuning!)?.id).toBe('drop-d');
  });

  it('a D2 note is out of range in standard tuning but not in drop D', () => {
    const g = createScore({ measures: 1, instruments: ['guitar-steel'] });
    const low = putEvent({
      staffId: g.parts[0]!.staves[0]!.id,
      measure: 0,
      tick: 0,
      id: 'low',
      event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('D', 3)] }, // sounds D2
    }).apply(g);
    expect(outOfRangeEvents(low).map((e) => e.eventId)).toEqual(['low']);
    const tuned = setTuning({ partId: g.parts[0]!.id, tuning: dropD.strings }).apply(low);
    expect(outOfRangeEvents(tuned)).toEqual([]);
  });

  it('standard tuning equals the catalog: no override stored, null resets', () => {
    const std = tuningPresets('guitar-steel')[0]!;
    expect(
      setTuning({ partId: guitarArpeggio.parts[0]!.id, tuning: std.strings }).apply(guitarArpeggio),
    ).toBe(guitarArpeggio);
    const tuned = setTuning({ partId: guitarArpeggio.parts[0]!.id, tuning: dropD.strings }).apply(
      guitarArpeggio,
    );
    const reset = setTuning({ partId: tuned.parts[0]!.id, tuning: null }).apply(tuned);
    expect(reset.parts[0]!.tuning).toBeUndefined();
  });

  it('low-G ukulele: the G string sounds an octave lower', () => {
    const low = tuningPresets('ukulele-tenor').find((t) => t.id === 'low-g')!;
    cycle(
      ukuleleMelody,
      setTuning({ partId: ukuleleMelody.parts[0]!.id, tuning: low.strings }),
      (a) => {
        expect(a.parts[0]!.tuning![3]).toEqual(P('G', 3));
      },
    );
  });

  it('refuses a wrong string count, bad pitches and non-fretted parts', () => {
    const id = guitarArpeggio.parts[0]!.id;
    refuses(guitarArpeggio, setTuning({ partId: id, tuning: [P('E', 4)] }), 'invalid-argument');
    refuses(
      guitarArpeggio,
      setTuning({ partId: id, tuning: dropD.strings.map(() => P('C', 12)) }),
      'invalid-argument',
    );
    refuses(
      celloClefChanges,
      setTuning({ partId: celloClefChanges.parts[0]!.id, tuning: null }),
      'no-tuning',
    );
  });

  it('capo: frets shift down, sounding pitch unchanged; refused out of bounds', () => {
    const id = guitarArpeggio.parts[0]!.id;
    cycle(guitarArpeggio, setCapo({ partId: id, capo: 2 }), (a) => {
      expect(a.parts[0]!.capo).toBe(2);
      // E4 written (E3 sounding) was string 4 fret 2: now string 4 fret 0
      expect(noteAt(a, 0, 0, 0, 1).pitches[0]!.fretting).toEqual({ string: 4, fret: 0 });
    });
    const capoed = setCapo({ partId: id, capo: 2 }).apply(guitarArpeggio);
    expect(setCapo({ partId: id, capo: 0 }).apply(capoed).parts[0]!.capo).toBeUndefined();
    refuses(guitarArpeggio, setCapo({ partId: id, capo: 13 }), 'invalid-argument');
    refuses(guitarArpeggio, setCapo({ partId: id, capo: -1 }), 'invalid-argument');
    refuses(
      celloClefChanges,
      setCapo({ partId: celloClefChanges.parts[0]!.id, capo: 2 }),
      'no-tuning',
    );
  });

  it('assignFretting prefers the given string, else the lowest fret', () => {
    const part = guitarArpeggio.parts[0]!;
    expect(assignFretting(part, P('E', 4))).toEqual({ string: 4, fret: 2 });
    expect(assignFretting(part, P('E', 4), 5)).toEqual({ string: 5, fret: 7 });
    expect(assignFretting(part, P('C', 2))).toBeUndefined();
  });
});

describe('measure attributes: tempo, key, clef', () => {
  const score = createScore({ measures: 4, instruments: ['guitar-steel', 'cello'] });

  it('setTempo sets and clears a tempo change at a measure', () => {
    const changed = cycle(score, setTempo({ measure: 2, bpm: 72 }), (a) => {
      expect(tempoAt(a, 1)).toBe(100);
      expect(tempoAt(a, 2)).toBe(72);
      expect(tempoAt(a, 3)).toBe(72);
    });
    cycle(changed, setTempo({ measure: 2, bpm: null }), (a) => {
      expect(tempoAt(a, 3)).toBe(100);
    });
    expect(setTempo({ measure: 2, bpm: null }).apply(score)).toBe(score);
    refuses(score, setTempo({ measure: 0, bpm: 5 }), 'invalid-argument');
    refuses(score, setTempo({ measure: 9, bpm: 90 }), 'bad-position');
  });

  it('cello clef switching bass, tenor, treble at a measure', () => {
    const cello = score.parts[1]!.staves[0]!;
    let s = score;
    s = cycle(s, setClef({ staffId: cello.id, measure: 1, clef: 'tenor' }), (a) => {
      expect(clefAt(a.parts[1]!.staves[0]!, 0)).toBe('bass');
      expect(clefAt(a.parts[1]!.staves[0]!, 1)).toBe('tenor');
    });
    s = setClef({ staffId: cello.id, measure: 3, clef: 'treble' }).apply(s);
    expect(clefAt(s.parts[1]!.staves[0]!, 3)).toBe('treble');
    expect(validateScore(s)).toEqual([]);
  });
});
