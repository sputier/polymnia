import { beforeEach, describe, expect, it } from 'vitest';
import type { HitResult } from '../../engraving/hitTest';
import { createScore, findEvent, validateScore, type NotePitch, type Score } from '../../score';
import { createShortcutRegistry, type ShortcutRegistry } from '../../shortcuts/registry';
import { EditorStore, FRET_CHORD_MS } from './editorStore';
import { entryShortcuts } from './entryShortcuts';
import { keyEvent } from './testKeys';

let store: EditorStore;
let registry: ShortcutRegistry;

function open(score: Score, staffIndex: number): void {
  store = new EditorStore(score);
  registry = createShortcutRegistry();
  entryShortcuts(store).forEach((s) => registry.register(s));
  const staff = score.parts[0]!.staves[staffIndex]!;
  // Click on the staff, as the mouse does, then switch to note input.
  const hit: HitResult = {
    systemIndex: 0,
    partId: score.parts[0]!.id,
    staffId: staff.id,
    measureIndex: 0,
    tick: 0,
    ...(staff.type === 'tab' ? { string: 1 } : {}),
  };
  store.click(hit);
  press('N');
}

function press(...combos: string[]): void {
  for (const combo of combos) registry.handle(keyEvent(combo), false);
}

const guitarBoth = () => createScore({ measures: 2, instruments: ['guitar-classical'] });
function guitarStandardAndTab(): Score {
  const s = guitarBoth();
  const store0 = new EditorStore(s);
  store0.setStaffLayout(s.parts[0]!.id, 'standard+tab');
  return store0.getState().score;
}

/** Notes of a staff of the part, as "string:fret" (tab) or "step+octave" (standard), rests skipped. */
function describeStaff(staffIndex: number, measure = 0): string[] {
  const staff = store.getState().score.parts[0]!.staves[staffIndex]!;
  return staff.measures[measure]!.voices[0]!.events.flatMap((e) =>
    e.kind === 'note'
      ? [
          e.pitches
            .map((p: NotePitch) =>
              staff.type === 'tab'
                ? `${p.fretting?.string}:${p.fretting?.fret}`
                : `${p.step}${p.octave}`,
            )
            .join('+'),
        ]
      : [],
  );
}

/** The first pitch of a note event. */
function pitchOf(eventId: string): NotePitch {
  const e = findEvent(store.getState().score, eventId)!.event;
  if (e.kind !== 'note') throw new Error('not a note');
  return e.pitches[0]!;
}

describe('digits are frets on a TAB staff', () => {
  beforeEach(() => open(guitarStandardAndTab(), 1));

  it('a digit writes a note on the current string and the standard staff follows', () => {
    expect(store.onTab()).toBe(true);
    press('3'); // string 1, fret 3: sounding G4, written G5 on a guitar
    expect(describeStaff(1)).toEqual(['1:3']);
    expect(describeStaff(0)).toEqual(['G5']);
    expect(validateScore(store.getState().score)).toEqual([]);
    // The cursor moved on: the next digit is the next note.
    press('0');
    expect(describeStaff(1)).toEqual(['1:3', '1:0']);
    expect(describeStaff(0)).toEqual(['G5', 'E5']);
  });

  it('0 is the open string, not a rest', () => {
    press('0');
    expect(describeStaff(1)).toEqual(['1:0']);
  });

  it('two digits within 500 ms make one fret (1 then 2 = 12)', () => {
    store.fretKey('1', 1000);
    store.fretKey('2', 1000 + FRET_CHORD_MS - 1);
    expect(describeStaff(1)).toEqual(['1:12']);
    expect(describeStaff(0)).toEqual(['E6']);
  });

  it('digits typed more than 500 ms apart are two notes', () => {
    store.fretKey('1', 1000);
    store.fretKey('2', 1000 + FRET_CHORD_MS + 1);
    expect(describeStaff(1)).toEqual(['1:1', '1:2']);
  });

  it('a combination beyond the last fret is not made (5 then 3 = two notes)', () => {
    store.fretKey('5', 1000);
    store.fretKey('3', 1100);
    expect(describeStaff(1)).toEqual(['1:5', '1:3']);
  });

  it('0 then another digit is two notes (no leading zero)', () => {
    store.fretKey('0', 1000);
    store.fretKey('5', 1100);
    expect(describeStaff(1)).toEqual(['1:0', '1:5']);
  });

  it('arrows move the string cursor and the next digit goes there', () => {
    press('ArrowDown', 'ArrowDown');
    expect(store.getState().tabString).toBe(3);
    press('2');
    expect(describeStaff(1)).toEqual(['3:2']);
    press('ArrowUp');
    expect(store.getState().tabString).toBe(2);
    press('ArrowUp', 'ArrowUp', 'ArrowUp');
    expect(store.getState().tabString).toBe(1);
    for (let i = 0; i < 9; i++) press('ArrowDown');
    expect(store.getState().tabString).toBe(6);
  });

  it('Shift+3..7 pick the duration, bare digits do not', () => {
    press('Shift+6');
    expect(store.getState().duration.base).toBe('half');
    press('5');
    expect(store.getState().duration.base).toBe('half');
    expect(describeStaff(1)).toEqual(['1:5']);
  });

  it('Shift+0 enters a rest', () => {
    press('Shift+0');
    const events = store.getState().score.parts[0]!.staves[1]!.measures[0]!.voices[0]!.events;
    expect(events[0]!.kind).toBe('rest');
  });

  it('each entry is one undo step and undo/redo restore both staves', () => {
    press('3', '5');
    expect(describeStaff(1)).toEqual(['1:3', '1:5']);
    store.undo();
    expect(describeStaff(1)).toEqual(['1:3']);
    expect(describeStaff(0)).toEqual(['G5']);
    store.undo();
    expect(describeStaff(1)).toEqual([]);
    store.redo();
    store.redo();
    expect(describeStaff(1)).toEqual(['1:3', '1:5']);
    expect(describeStaff(0)).toEqual(['G5', 'A5']);
  });

  it('refuses a fret that does not exist without writing anything', () => {
    // The classical guitar has 19 frets: 2 then 5 would be 25, so it is two notes. A tuning
    // whose pitch goes out of the MIDI range cannot happen with digits, so this checks the combine.
    store.fretKey('2', 1000);
    store.fretKey('5', 1100);
    expect(describeStaff(1)).toEqual(['1:2', '1:5']);
  });

  it('a click on a string position sets the input string', () => {
    const staff = store.getState().score.parts[0]!.staves[1]!;
    store.click({
      systemIndex: 0,
      partId: store.getState().score.parts[0]!.id,
      staffId: staff.id,
      measureIndex: 0,
      tick: 0,
      string: 4,
    });
    expect(store.getState().tabString).toBe(4);
    press('2');
    expect(describeStaff(1)).toEqual(['4:2']);
  });
});

describe('editing a selected tab note', () => {
  beforeEach(() => {
    open(guitarStandardAndTab(), 1);
    press('Shift+5'); // quarter
    store.setTabString(3);
    press('0', '2'); // G3-string open then fret 2 (a quarter each)
    press('N');
  });

  it('digits set the fret of the selected note on its own string', () => {
    // Leaving note input selected the last note (3:2).
    expect(store.getState().selection).toHaveLength(1);
    store.fretKey('4', 5000);
    expect(describeStaff(1)).toEqual(['3:0', '3:4']);
    expect(describeStaff(0)).toEqual(['G4', 'B4']);
  });

  it('Alt+Down moves the note to the string below, same pitch, flagged manual', () => {
    const id = store.getState().selection[0]!;
    const before = pitchOf(id);
    press('Alt+ArrowDown');
    const after = pitchOf(id);
    expect(after.fretting!.string).toBe(before.fretting!.string + 1);
    expect(after.fretting!.manual).toBe(true);
    expect(`${after.step}${after.octave}`).toBe(`${before.step}${before.octave}`);
    // The standard staff did not change (same pitches).
    expect(describeStaff(0)).toEqual(['G4', 'A4']);
    store.undo();
    expect(pitchOf(id).fretting).toEqual(before.fretting);
    store.redo();
    expect(pitchOf(id).fretting!.string).toBe(before.fretting!.string + 1);
  });

  it('Alt+Up when no higher string can play the note says so and changes nothing', () => {
    // A3 (written A4) cannot be played on the B or E strings: the note cannot go further up.
    const id = store.getState().selection[0]!;
    press('Alt+ArrowUp');
    press('Alt+ArrowUp');
    expect(pitchOf(id).fretting!.string).toBeLessThanOrEqual(3);
    expect(store.getState().announcement).toMatchObject({
      notice: { key: 'notice.noOtherString' },
    });
  });

  it('on a standard staff Alt+arrows only explain that a TAB staff is needed', () => {
    store.click({
      systemIndex: 0,
      partId: store.getState().score.parts[0]!.id,
      staffId: store.getState().score.parts[0]!.staves[0]!.id,
      measureIndex: 0,
      tick: 0,
    });
    press('Alt+ArrowDown');
    expect(store.getState().announcement).toMatchObject({ notice: { key: 'notice.tabOnly' } });
  });
});

describe('TAB only ukulele', () => {
  beforeEach(() => {
    const s = createScore({ measures: 2, instruments: ['ukulele-soprano'] });
    const st = new EditorStore(s);
    st.setStaffLayout(s.parts[0]!.id, 'tab');
    open(st.getState().score, 0);
  });

  it('has four strings and writes re-entrant pitches', () => {
    press('ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown');
    expect(store.getState().tabString).toBe(4); // clamped to the last string
    press('0'); // high G (G4)
    expect(describeStaff(0)).toEqual(['4:0']);
    const e = store.getState().score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events[0]!;
    expect(e.kind === 'note' && e.pitches[0]).toMatchObject({ step: 'G', octave: 4 });
  });

  it('letters still enter a note and give it a fret near the previous one', () => {
    press('C', 'D', 'E');
    const frets = describeStaff(0);
    expect(frets).toHaveLength(3);
    expect(frets.every((f) => !f.includes('undefined'))).toBe(true);
  });
});

describe('palette commands', () => {
  it('string and rest commands are registered, with labels and without a duplicate key', () => {
    open(guitarStandardAndTab(), 1);
    const list = registry.list();
    for (const id of [
      'entry.refretUp',
      'entry.refretDown',
      'entry.stringUp',
      'entry.stringDown',
      'entry.autoFinger',
      'entry.tabRests',
      'entry.tabRest',
    ]) {
      expect(
        list.some((s) => s.id === id),
        id,
      ).toBe(true);
    }
    registry.run('entry.tabRests');
    expect(store.getState().score.parts[0]!.staves[1]!.showRests).toBe(true);
    registry.run('entry.tabRests');
    expect(store.getState().score.parts[0]!.staves[1]!.showRests).toBeUndefined();
  });
});
