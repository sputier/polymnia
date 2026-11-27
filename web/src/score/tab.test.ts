import { buildTimeline } from '../playback/timeline';
import { describe, expect, it } from 'vitest';
import {
  autoFinger,
  CommandError,
  createScore,
  deserialize,
  ensureFretting,
  findEvent,
  History,
  moveToString,
  pitchOfFretting,
  putEvent,
  refretStaffNotes,
  serialize,
  setCapo,
  setFretting,
  setStaffLayout,
  setTabRests,
  setTuning,
  syncCompanionStaff,
  tuningPresets,
  unplayableEvents,
  validateScore,
  type Command,
  type Fretting,
  type NotePitch,
  type Pitch,
  type Score,
} from './index';

const P = (step: Pitch['step'], octave: number, alter: Pitch['alter'] = 0): Pitch => ({
  step,
  alter,
  octave,
});
const Q = { base: 'eighth', dots: 0 } as const;

/** apply + undo + redo: undo restores the very same reference, redo gives an equal score. */
function cycle(score: Score, cmd: Command, check: (after: Score) => void): Score {
  expect(validateScore(score)).toEqual([]);
  const h = new History(score);
  const after = h.execute(cmd);
  expect(validateScore(after)).toEqual([]);
  check(after);
  expect(h.undo()).toBe(score);
  expect(h.redo()).toStrictEqual(after);
  return after;
}

const guitar = createScore({ measures: 2, instruments: ['guitar-classical'] });
const guitarId = guitar.parts[0]!.id;
const tabOnly = setStaffLayout({ partId: guitarId, layout: 'tab' }).apply(guitar);
const both = setStaffLayout({ partId: guitarId, layout: 'standard+tab' }).apply(guitar);
const tabId = tabOnly.parts[0]!.staves[0]!.id;

/** Writes notes of the given written pitches (guitar: written an octave above the sound) at 0, 1, 2... */
function withNotes(score: Score, staffId: string, pitches: Pitch[][]): Score {
  let s = score;
  pitches.forEach((chord, i) => {
    s = putEvent({
      staffId,
      measure: 0,
      tick: i * 480,
      id: `n${i}`,
      event: { kind: 'note', duration: Q, pitches: chord },
    }).apply(s);
  });
  return s;
}

const fretsOf = (score: Score, id: string): (Fretting | undefined)[] => {
  const e = findEvent(score, id)!.event;
  return e.kind === 'note' ? e.pitches.map((p) => p.fretting) : [];
};
/** The i-th note (rests skipped) of the first measure of the tab staff. */
const tabEvent = (score: Score, i: number) =>
  score.parts[0]!.staves.find((s) => s.type === 'tab')!.measures[0]!.voices[0]!.events.filter(
    (e) => e.kind === 'note',
  )[i]!;
const tabFret = (score: Score, i: number): Fretting | undefined => {
  const e = tabEvent(score, i);
  return e.kind === 'note' ? e.pitches[0]!.fretting : undefined;
};

describe('derived frettings follow the hand', () => {
  it('a scale entered on a tab staff stays in the first position', () => {
    // Written pitches an octave above the sound: C4 D4 E4 F4 G4 sounds C3 D3 E3 F3 G3.
    const s = withNotes(
      tabOnly,
      tabId,
      [P('C', 4), P('D', 4), P('E', 4), P('F', 4), P('G', 4)].map((p) => [p]),
    );
    expect(validateScore(s)).toEqual([]);
    const frets = ['n0', 'n1', 'n2', 'n3', 'n4'].map((id) => fretsOf(s, id)[0]!);
    expect(frets.map((f) => `${f.string}:${f.fret}`)).toEqual(['5:3', '4:0', '4:2', '4:3', '3:0']);
  });

  it('a chord entered on a tab staff gets one string per note', () => {
    const s = withNotes(tabOnly, tabId, [[P('C', 4), P('E', 4), P('G', 4), P('C', 5), P('E', 5)]]);
    expect(fretsOf(s, 'n0').map((f) => `${f!.string}:${f!.fret}`)).toEqual([
      '5:3',
      '4:2',
      '3:0',
      '2:1',
      '1:0',
    ]);
  });
});

describe('setFretting (user choice)', () => {
  const base = withNotes(tabOnly, tabId, [[P('G', 4)], [P('A', 4)]]);

  it('marks the fretting as manual and derives the written pitch; undo/redo exact', () => {
    cycle(base, setFretting({ eventId: 'n0', string: 4, fret: 5 }), (a) => {
      expect(fretsOf(a, 'n0')).toEqual([{ string: 4, fret: 5, manual: true }]);
      const e = findEvent(a, 'n0')!.event;
      expect(e.kind === 'note' && e.pitches[0]).toMatchObject({ step: 'G', octave: 4 });
    });
  });

  it('refuses a string already used by the chord', () => {
    const chord = withNotes(tabOnly, tabId, [[P('E', 4), P('G', 4)]]);
    const h = new History(chord);
    const used = fretsOf(chord, 'n0')[1]!;
    expect(() =>
      h.execute(setFretting({ eventId: 'n0', pitchIndex: 0, string: used.string, fret: 0 })),
    ).toThrow(CommandError);
  });

  it('keeps user frettings when only the other notes are recomputed', () => {
    const forced = setFretting({ eventId: 'n0', string: 4, fret: 5 }).apply(base);
    const staff = forced.parts[0]!.staves[0]!;
    const redone = refretStaffNotes(forced.parts[0]!, staff, 'manual');
    expect(redone.measures[0]!.voices[0]!.events[0]).toBe(staff.measures[0]!.voices[0]!.events[0]);
    // The second note is derived again, near the forced position.
    const second = redone.measures[0]!.voices[0]!.events[1]!;
    if (second.kind !== 'note') throw new Error('expected a note');
    expect(second.pitches[0]!.fretting!.fret).toBeGreaterThanOrEqual(2);
  });

  it('refretting an untouched staff returns the very same object', () => {
    const staff = base.parts[0]!.staves[0]!;
    expect(refretStaffNotes(base.parts[0]!, staff, 'valid')).toBe(staff);
  });
});

describe('moveToString', () => {
  const base = withNotes(tabOnly, tabId, [[P('A', 4)]]); // sounding A3: 5:12? derived lowest: 3:2

  it('moves to the adjacent string keeping the pitch, and is manual', () => {
    const before = fretsOf(base, 'n0')[0]!;
    cycle(base, moveToString({ eventId: 'n0', direction: 'down' }), (a) => {
      const f = fretsOf(a, 'n0')[0]!;
      expect(f.string).toBe(before.string + 1);
      expect(f.manual).toBe(true);
      expect(f.fret).toBe(before.fret + 5 - (before.string === 2 ? 1 : 0));
    });
  });

  it('up goes towards the first string (and back)', () => {
    const down = moveToString({ eventId: 'n0', direction: 'down' }).apply(base);
    const back = moveToString({ eventId: 'n0', direction: 'up' }).apply(down);
    expect(fretsOf(back, 'n0')[0]!.string).toBe(fretsOf(base, 'n0')[0]!.string);
  });

  it('refuses when no string can play the pitch', () => {
    const low = withNotes(tabOnly, tabId, [[P('E', 3)]]); // sounding E2: only the sixth string, open
    const h = new History(low);
    expect(() => h.execute(moveToString({ eventId: 'n0', direction: 'down' }))).toThrow(
      CommandError,
    );
    expect(() => h.execute(moveToString({ eventId: 'n0', direction: 'up' }))).toThrow(CommandError);
  });
});

describe('autoFinger and ensureFretting', () => {
  it('autoFinger hands a manual fretting back to the algorithm', () => {
    const forced = setFretting({ eventId: 'n0', string: 4, fret: 5 }).apply(
      withNotes(tabOnly, tabId, [[P('G', 4)]]),
    );
    cycle(forced, autoFinger({ eventIds: ['n0'] }), (a) => {
      expect(fretsOf(a, 'n0')[0]).toEqual({ string: 3, fret: 0 });
    });
  });

  it('ensureFretting fills the missing frettings and is a no-op otherwise', () => {
    const base = withNotes(tabOnly, tabId, [[P('A', 4)]]);
    expect(ensureFretting({ staffId: tabId }).apply(base)).toBe(base);
    const stripped = {
      ...base,
      parts: [
        {
          ...base.parts[0]!,
          staves: [
            {
              ...base.parts[0]!.staves[0]!,
              measures: base.parts[0]!.staves[0]!.measures.map((m, i) =>
                i === 0
                  ? {
                      ...m,
                      voices: [
                        {
                          ...m.voices[0]!,
                          events: m.voices[0]!.events.map((e) =>
                            e.id === 'n0' && e.kind === 'note'
                              ? { ...e, pitches: [{ step: 'A', alter: 0, octave: 4 } as NotePitch] }
                              : e,
                          ),
                        },
                      ],
                    }
                  : m,
              ),
            },
          ],
        },
      ],
    } as Score;
    expect(fretsOf(stripped, 'n0')[0]).toBeUndefined();
    cycle(stripped, ensureFretting({ staffId: tabId }), (a) => {
      expect(fretsOf(a, 'n0')[0]).toBeDefined();
    });
  });
});

describe('standard + TAB stability', () => {
  const [std, tab] = both.parts[0]!.staves;
  const type = (staffId: string, tick: number, id: string, pitch: Pitch) =>
    putEvent({
      staffId,
      measure: 0,
      tick,
      id,
      event: { kind: 'note', duration: Q, pitches: [pitch] },
    });

  it('a fretting chosen on the tab survives edits of the standard staff', () => {
    let s = type(tab!.id, 0, 't0', P('G', 4)).apply(both);
    s = syncCompanionStaff({ staffId: tab!.id }).apply(s);
    const id = tabEvent(s, 0).id;
    s = setFretting({ eventId: id, string: 4, fret: 5 }).apply(s);
    // Edit another note on the standard staff: the tab is rebuilt from it.
    s = type(std!.id, 960, 's1', P('A', 4)).apply(s);
    s = syncCompanionStaff({ staffId: std!.id }).apply(s);
    expect(tabFret(s, 0)).toEqual({ string: 4, fret: 5, manual: true });
    expect(tabFret(s, 1)).toBeDefined();
    expect(validateScore(s)).toEqual([]);
  });

  it('derived frettings of untouched notes do not move when a later note is edited', () => {
    let s = type(std!.id, 0, 's0', P('C', 4)).apply(both);
    s = type(std!.id, 960, 's1', P('E', 4)).apply(s);
    s = syncCompanionStaff({ staffId: std!.id }).apply(s);
    const first = [tabFret(s, 0), tabFret(s, 1)];
    s = type(std!.id, 1920, 's2', P('A', 5)).apply(s);
    s = syncCompanionStaff({ staffId: std!.id }).apply(s);
    expect([tabFret(s, 0), tabFret(s, 1)]).toEqual(first);
  });

  it('the standard staff follows a fret typed on the tab (written pitch from string + fret + transposition)', () => {
    let s = type(tab!.id, 0, 't0', P('C', 4)).apply(both);
    s = setFretting({ eventId: 't0', string: 2, fret: 3 }).apply(s); // sounding D4, written D5 (guitar)
    s = syncCompanionStaff({ staffId: tab!.id }).apply(s);
    const e =
      std === undefined ? undefined : s.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events[0]!;
    expect(e && e.kind === 'note' && e.pitches[0]).toMatchObject({ step: 'D', octave: 5 });
  });
});

describe('tuning, capo and manual frettings', () => {
  const base = withNotes(tabOnly, tabId, [[P('G', 4)]]);
  const forced = setFretting({ eventId: 'n0', string: 4, fret: 5 }).apply(base);

  it('a capo makes the fretting invalid: it is recomputed (frets count from the capo)', () => {
    cycle(forced, setCapo({ partId: guitarId, capo: 2 }), (a) => {
      const f = fretsOf(a, 'n0')[0]!;
      // Sounding G3 on D3 + capo 2 + fret 3 = G3 (still the 4th string, three frets above the capo).
      expect(f.fret + 2 + 50).toBe(55);
    });
  });

  it('a manual fretting survives a tuning change that keeps it valid', () => {
    // Drop D only changes the sixth string: the fretting on the fourth is still right.
    const dropD = tuningPresets('guitar-classical').find((t) => t.id === 'drop-d')!;
    const after = setTuning({ partId: guitarId, tuning: dropD.strings }).apply(forced);
    expect(fretsOf(after, 'n0')[0]).toEqual({ string: 4, fret: 5, manual: true });
  });

  it('a pitch no string can play is reported as unplayable and drawn as such', () => {
    const capo = setCapo({ partId: guitarId, capo: 5 }).apply(
      withNotes(tabOnly, tabId, [[P('E', 3)]]), // sounding E2: below the capoed sixth string (A2)
    );
    expect(fretsOf(capo, 'n0')[0]).toBeUndefined();
    expect(unplayableEvents(capo)).toHaveLength(1);
    expect(unplayableEvents(base)).toHaveLength(0);
  });
});

describe('setTabRests and the file format', () => {
  it('toggles showRests, undo/redo exact', () => {
    cycle(tabOnly, setTabRests({ staffId: tabId, show: true }), (a) => {
      expect(a.parts[0]!.staves[0]!.showRests).toBe(true);
      expect(deserialize(serialize(a)).parts[0]!.staves[0]!.showRests).toBe(true);
    });
    expect(setTabRests({ staffId: tabId, show: false }).apply(tabOnly)).toBe(tabOnly);
    expect(() =>
      setTabRests({ staffId: both.parts[0]!.staves[0]!.id, show: true }).apply(both),
    ).toThrow(CommandError);
  });

  it('the manual flag round trips through serialize/deserialize', () => {
    const s = setFretting({ eventId: 'n0', string: 4, fret: 5 }).apply(
      withNotes(tabOnly, tabId, [[P('G', 4)]]),
    );
    expect(deserialize(serialize(s))).toStrictEqual(s);
  });

  it('pitchOfFretting spells from the key and the transposition', () => {
    expect(pitchOfFretting(tabOnly, tabId, 0, 1, 0)).toMatchObject({ step: 'E', octave: 5 }); // guitar: written an octave up
    expect(pitchOfFretting(tabOnly, tabId, 0, 7, 0)).toBeUndefined();
    expect(pitchOfFretting(tabOnly, tabId, 0, 1, 99)).toBeUndefined();
  });
});

describe('playback of tablature', () => {
  it('a TAB-only part with a capo sounds string + capo + fret', () => {
    // Open B string with the capo on fret 2 sounds C#4 (61); G string (G3 = 55) + capo 2 + fret 6 = 63.
    let s = setCapo({ partId: guitarId, capo: 2 }).apply(tabOnly);
    s = withNotes(s, tabId, [[P('C', 5, 1)], [P('C', 5)]]);
    s = setFretting({ eventId: 'n0', string: 2, fret: 0 }).apply(s);
    s = setFretting({ eventId: 'n1', string: 3, fret: 6 }).apply(s);
    const tl = buildTimeline(s);
    expect(tl.notes.map((n) => n.midi)).toEqual([61, 55 + 2 + 6]);
    expect(tl.notes).toHaveLength(2);
  });

  it('a standard + TAB part is played once, from the staff being typed on', () => {
    let s = both;
    s = putEvent({
      staffId: both.parts[0]!.staves[1]!.id,
      measure: 0,
      tick: 0,
      id: 't0',
      event: { kind: 'note', duration: Q, pitches: [P('C', 5)] },
    }).apply(s);
    s = setFretting({ eventId: 't0', string: 1, fret: 3 }).apply(s); // G4 sounding
    s = syncCompanionStaff({ staffId: both.parts[0]!.staves[1]!.id }).apply(s);
    const tl = buildTimeline(s);
    expect(tl.notes.map((n) => n.midi)).toEqual([67]);
  });
});
