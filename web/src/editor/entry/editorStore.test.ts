import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HitResult } from '../../engraving/hitTest';
import { createScore, findEvent, type Pitch, type Score } from '../../score';
import { createShortcutRegistry, type ShortcutRegistry } from '../../shortcuts/registry';
import { EditorStore, newEditorScore } from './editorStore';
import { entryShortcuts } from './entryShortcuts';
import { keyEvent } from './testKeys';

let store: EditorStore;
let registry: ShortcutRegistry;

function setup(score: Score = newEditorScore(4)) {
  store = new EditorStore(score);
  registry = createShortcutRegistry();
  entryShortcuts(store).forEach((s) => registry.register(s));
}

/** Presses combos like a keyboard would: `press('N', '5', 'C', 'Shift+E')`. */
function press(...combos: string[]): void {
  for (const combo of combos) registry.handle(keyEvent(combo), false);
}

function events(measure = 0, score = store.getState().score) {
  return score.parts[0]!.staves[0]!.measures[measure]!.voices[0]!.events;
}

/** Compact "C5:quarter" description of the notes of a measure. */
function notes(measure = 0): string[] {
  return events(measure).map((e) =>
    e.kind === 'rest'
      ? `r:${e.duration.base}`
      : `${e.pitches.map((p) => `${p.step}${'#b'.charAt(p.alter > 0 ? 0 : 1).repeat(Math.abs(p.alter))}${p.octave}`).join('+')}:${e.duration.base}${e.duration.dots ? '.' : ''}`,
  );
}

beforeEach(() => setup());

describe('key map (every row of the issue table)', () => {
  it('N toggles note input', () => {
    press('N');
    expect(store.getState().mode).toBe('note');
    press('N');
    expect(store.getState().mode).toBe('select');
  });

  it('3 to 7 set 16th, eighth, quarter, half and whole', () => {
    const bases = { '3': '16th', '4': 'eighth', '5': 'quarter', '6': 'half', '7': 'whole' };
    for (const [key, base] of Object.entries(bases)) {
      press(key);
      expect(store.getState().duration).toEqual({ base, dots: 0 });
    }
  });

  it('1, 2, 8 and 9 do nothing but say so politely', () => {
    press('6');
    for (const key of ['1', '2', '8', '9']) {
      press(key);
      expect(store.getState().duration.base).toBe('half');
      expect(store.getState().announcement).toMatchObject({
        notice: { key: 'notice.durationUnavailable' },
      });
    }
  });

  it('. toggles the augmentation dot', () => {
    press('Period');
    expect(store.getState().duration.dots).toBe(1);
    press('Period');
    expect(store.getState().duration.dots).toBe(0);
  });

  it('a duration key clears the dot', () => {
    press('Period', '4');
    expect(store.getState().duration).toEqual({ base: 'eighth', dots: 0 });
  });

  it('0 enters a rest and advances', () => {
    press('N', '5', '0');
    expect(notes()).toEqual(['r:quarter', 'r:quarter', 'r:half']);
    expect(store.getState().cursor).toEqual({ measure: 0, tick: 960 });
  });

  it('A to G enter notes with the nearest octave', () => {
    press('N', '5', 'C', 'D', 'E', 'F', 'G', 'A', 'B');
    // First note near the middle line (B4 on treble) is C5; then every step stays within a fourth.
    expect(notes(0)).toEqual(['C5:quarter', 'D5:quarter', 'E5:quarter', 'F5:quarter']);
    expect(notes(1)).toEqual(['G5:quarter', 'A5:quarter', 'B5:quarter', 'r:quarter']);
  });

  it('Shift+A to Shift+G add a note to the chord', () => {
    press('N', '5', 'C', 'Shift+E', 'Shift+G');
    expect(notes()[0]).toBe('C5+E5+G5:quarter');
    expect(store.getState().cursor.tick).toBe(960);
  });

  it('+, - and = set the accidental of the next note', () => {
    press('N', '5', 'Plus', 'F', 'Minus', 'B', 'Equal', 'E');
    expect(notes()).toEqual(['F#4:quarter', 'Bb4:quarter', 'E5:quarter', 'r:quarter']);
  });

  it('+ pressed twice cancels the accidental', () => {
    press('N', '5', 'Plus', 'Plus', 'F');
    expect(notes()[0]).toBe('F4:quarter');
  });

  it('+, - and = change the selected notes', () => {
    press('N', '5', 'C', 'D', 'N');
    press('Plus');
    expect(notes()[1]).toBe('D#5:quarter');
    press('Minus');
    expect(notes()[1]).toBe('Db5:quarter');
    press('Equal');
    expect(notes()[1]).toBe('D5:quarter');
  });

  it('Up/Down move the selection by a semitone, Mod+Up/Down by an octave', () => {
    press('N', '5', 'C', 'N');
    press('ArrowUp');
    expect(notes()[0]).toBe('C#5:quarter');
    press('ArrowDown', 'ArrowDown');
    expect(notes()[0]).toBe('B4:quarter');
    press('Mod+ArrowUp');
    expect(notes()[0]).toBe('B5:quarter');
    press('Mod+ArrowDown', 'Mod+ArrowDown');
    expect(notes()[0]).toBe('B3:quarter');
  });

  it('T ties a note to the next one of the same pitch (note input)', () => {
    press('N', '5', 'C', 'T', 'C');
    expect(events()[0]).toMatchObject({ pitches: [{ tieToNext: true }] });
    expect(notes().slice(0, 2)).toEqual(['C5:quarter', 'C5:quarter']);
  });

  it('T on selected notes ties them to the following note', () => {
    press('N', '5', 'C', 'C', 'N', 'ArrowLeft', 'ArrowLeft');
    expect(store.getState().selection).toHaveLength(1);
    press('T');
    expect(events()[0]).toMatchObject({ pitches: [{ tieToNext: true }] });
  });

  it('S slurs the selected range', () => {
    press('N', '5', 'C', 'D', 'E', 'N', 'Shift+ArrowLeft', 'Shift+ArrowLeft');
    press('S');
    const { score } = store.getState();
    expect(score.slurs).toHaveLength(1);
    expect(score.slurs[0]).toMatchObject({
      startEventId: events()[0]!.id,
      endEventId: events()[2]!.id,
    });
    press('S');
    expect(store.getState().score.slurs).toHaveLength(0);
  });

  it('Mod+3 turns the event under the cursor or the selection into a triplet', () => {
    press('N', '5', 'Mod+3');
    expect(store.getState().duration.base).toBe('eighth');
    press('C', 'D', 'E');
    expect(notes()).toEqual(['C5:eighth', 'D5:eighth', 'E5:eighth', 'r:quarter', 'r:half']);
    expect(events()[0]).toBeDefined();
    expect(
      store.getState().score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.tuplets,
    ).toHaveLength(1);
    expect(store.getState().cursor).toEqual({ measure: 0, tick: 960 });
  });

  it('Left/Right move the cursor in note input and the selection otherwise', () => {
    press('N', '5', 'C', 'D', 'ArrowLeft');
    expect(store.getState().cursor).toEqual({ measure: 0, tick: 960 });
    press('ArrowRight');
    expect(store.getState().cursor).toEqual({ measure: 0, tick: 1920 });
    press('N');
    // Nothing was just entered: the event under the cursor is selected.
    expect(store.getState().selection).toEqual([events()[2]!.id]);
    press('ArrowLeft');
    expect(store.getState().selection).toEqual([events()[1]!.id]);
    press('ArrowRight');
    expect(store.getState().selection).toEqual([events()[2]!.id]);
    press('ArrowRight');
    expect(store.getState().selection).toEqual([events(1)[0]!.id]);
  });

  it('Del and Backspace turn the selection into rests', () => {
    press('N', '5', 'C', 'D', 'N');
    press('Delete');
    expect(notes().slice(0, 2)).toEqual(['C5:quarter', 'r:quarter']);
    press('ArrowLeft', 'Backspace');
    expect(notes().slice(0, 2)).toEqual(['r:quarter', 'r:quarter']);
  });

  it('Del in note input deletes the last entered note and steps back', () => {
    press('N', '5', 'C', 'D', 'Delete');
    expect(notes().slice(0, 2)).toEqual(['C5:quarter', 'r:quarter']);
    expect(store.getState().cursor.tick).toBe(960);
  });

  it('Mod+Z, Mod+Y and Mod+Shift+Z undo and redo', () => {
    const initial = store.getState().score;
    press('N', '5', 'C', 'D');
    press('Mod+Z', 'Mod+Z');
    expect(store.getState().score).toBe(initial);
    expect(store.getState().canRedo).toBe(true);
    press('Mod+Y');
    expect(notes().slice(0, 2)).toEqual(['C5:quarter', 'r:quarter']);
    press('Mod+Z');
    press('Mod+Shift+Z', 'Mod+Shift+Z');
    expect(notes().slice(0, 2)).toEqual(['C5:quarter', 'D5:quarter']);
  });

  it('Cmd replaces Ctrl on macOS', () => {
    press('N', '5', 'C');
    registry.handle(keyEvent('Mod+Z', true), true);
    expect(store.getState().canUndo).toBe(false);
    registry.handle(keyEvent('Mod+Shift+Z', true), true);
    expect(store.getState().canUndo).toBe(true);
    // Ctrl+Z does nothing on macOS.
    registry.handle(keyEvent('Mod+Z', false), true);
    expect(store.getState().canUndo).toBe(true);
  });

  it('keeps Ctrl+C and plain letters apart', () => {
    press('N', '5', 'C', 'N');
    press('Mod+C');
    expect(store.getState().announcement).toMatchObject({ notice: { key: 'notice.copied' } });
    expect(notes()[0]).toBe('C5:quarter');
  });
});

describe('the issue scenario: N 5 C D E F 6 G', () => {
  it('writes four quarters then a half note in the next measure', () => {
    press('N', '5', 'C', 'D', 'E', 'F', '6', 'G');
    expect(notes(0)).toEqual(['C5:quarter', 'D5:quarter', 'E5:quarter', 'F5:quarter']);
    expect(notes(1)).toEqual(['G5:half', 'r:half']);
    expect(store.getState().cursor).toEqual({ measure: 1, tick: 1920 });
  });

  it('undoes and redoes it exactly', () => {
    const initial = store.getState().score;
    press('N', '5', 'C', 'D', 'E', 'F', '6', 'G');
    const done = store.getState().score;
    for (let i = 0; i < 5; i++) press('Mod+Z');
    expect(store.getState().score).toBe(initial);
    for (let i = 0; i < 5; i++) press('Mod+Y');
    expect(store.getState().score).toEqual(done);
  });
});

describe('octave choice', () => {
  it('picks the octave nearest to the previous note', () => {
    press('N', '5', 'G', 'C', 'B', 'F');
    // B4 reference: G4 (a third down), C5 (a fourth up), B4 (a second down), F4 (tritone-ish: a fourth down)
    expect(notes(0)).toEqual(['G4:quarter', 'C5:quarter', 'B4:quarter', 'F4:quarter']);
  });

  it('goes down when the target is a fifth or more above', () => {
    press('N', '5', 'C', 'A', 'E');
    expect(notes(0).slice(0, 3)).toEqual(['C5:quarter', 'A4:quarter', 'E4:quarter']);
  });

  it('starts near the middle line of the clef (bass staff)', () => {
    const grand = newEditorScore(2);
    setup(grand);
    store.click({
      systemIndex: 0,
      partId: grand.parts[0]!.id,
      staffId: grand.parts[0]!.staves[1]!.id,
      measureIndex: 0,
      tick: 0,
    } as HitResult);
    press('N', '5', 'C');
    expect(
      store.getState().score.parts[0]!.staves[1]!.measures[0]!.voices[0]!.events[0],
    ).toMatchObject({ pitches: [{ step: 'C', octave: 3 }] });
  });
});

describe('key signature and measure accidentals', () => {
  it('applies the key signature to letters (G major: F is F sharp)', () => {
    setup(createScore({ measures: 2, keyFifths: 1 }));
    press('N', '5', 'F', 'G');
    expect(notes()).toEqual(['F#4:quarter', 'G4:quarter', 'r:half']);
  });

  it('= enters the natural, and the natural stays in force for the measure', () => {
    setup(createScore({ measures: 2, keyFifths: 1 }));
    press('N', '5', 'Equal', 'F', 'F');
    expect(notes().slice(0, 2)).toEqual(['F4:quarter', 'F4:quarter']);
  });

  it('keeps an accidental in force until the barline, then the key applies again', () => {
    setup(createScore({ measures: 2 }));
    press('N', '5', 'Plus', 'F', 'F', 'F', 'F', 'F');
    expect(notes(0)).toEqual(['F#4:quarter', 'F#4:quarter', 'F#4:quarter', 'F#4:quarter']);
    expect(notes(1)[0]).toBe('F4:quarter');
  });

  it('flat keys: B is B flat', () => {
    setup(createScore({ measures: 2, keyFifths: -1 }));
    press('N', '5', 'B');
    expect(notes()[0]).toBe('Bb4:quarter');
  });
});

describe('barlines and appended measures', () => {
  it('appends a measure when the last one is filled, and undo removes it', () => {
    setup(newEditorScore(1));
    const initial = store.getState().score;
    press('N', '5', 'C', 'D', 'E', 'F');
    expect(store.getState().score.measures).toHaveLength(2);
    expect(store.getState().cursor).toEqual({ measure: 1, tick: 0 });
    press('Mod+Z');
    expect(store.getState().score.measures).toHaveLength(1);
    press('Mod+Z', 'Mod+Z', 'Mod+Z');
    expect(store.getState().score).toBe(initial);
  });

  it('splits a note that crosses the barline into tied notes', () => {
    press('N', '7', 'C');
    press('5', 'D');
    press('7', 'E');
    // A whole at beat 2 keeps 3 beats in measure 2 (quarter + half, tied) and 1 beat in measure 3.
    expect(notes(1)[0]).toBe('D5:quarter');
    expect(notes(1).slice(1)).toEqual(['E5:quarter', 'E5:half']);
    const first = events(1)[1]!;
    expect(first).toMatchObject({ pitches: [{ tieToNext: true }] });
    expect(events(2)[0]).toMatchObject({ pitches: [{ step: 'E' }] });
  });

  it('refuses a pitch outside the MIDI range without changing anything', () => {
    press('N', '5', 'C');
    for (let i = 0; i < 6; i++) press('Mod+ArrowDown');
    expect(notes()[0]).toBe('C-1:quarter');
    const before = store.getState().score;
    press('Mod+ArrowDown');
    expect(store.getState().score).toBe(before);
    expect(store.getState().announcement).toMatchObject({ notice: { key: 'notice.pitchRange' } });
  });
});

describe('selection, clipboard, transposition', () => {
  beforeEach(() => {
    press('N', '5', 'C', 'D', 'E', 'F', 'N');
  });

  it('Shift+arrows extend a range from the anchor', () => {
    press('Shift+ArrowLeft', 'Shift+ArrowLeft');
    const ids = events().map((e) => e.id);
    expect(store.getState().selection).toEqual(ids.slice(1, 4));
    press('Shift+ArrowRight');
    expect(store.getState().selection).toEqual(ids.slice(2, 4));
  });

  it('transposes a whole range with the arrows', () => {
    press('Shift+ArrowLeft', 'Shift+ArrowLeft', 'Shift+ArrowLeft');
    press('ArrowUp', 'Mod+ArrowUp');
    expect(notes().slice(0, 4)).toEqual([
      'C#6:quarter',
      'D#6:quarter',
      'F6:quarter',
      'F#6:quarter',
    ]);
    press('Mod+Z', 'Mod+Z');
    expect(notes().slice(0, 4)).toEqual(['C5:quarter', 'D5:quarter', 'E5:quarter', 'F5:quarter']);
  });

  it('copies a range and pastes it at the cursor', () => {
    press('ArrowLeft', 'ArrowLeft', 'Shift+ArrowLeft'); // selects D5 and E5? anchor on E5 then D5
    const picked = store.getState().selection.length;
    expect(picked).toBe(2);
    press('Mod+C');
    // Move to the second measure's first event and paste.
    store.click({
      systemIndex: 0,
      partId: '',
      staffId: store.getState().staffId,
      measureIndex: 1,
      tick: 0,
    } as HitResult);
    press('Mod+V');
    expect(notes(1).slice(0, 2)).toEqual(['C5:quarter', 'D5:quarter']);
    expect(store.getState().selection).toHaveLength(2);
    press('Mod+Z');
    expect(notes(1)[0]).toBe('r:whole');
  });

  it('continues a paste into the next measure, appending measures when needed', () => {
    press('Shift+ArrowLeft', 'Shift+ArrowLeft', 'Shift+ArrowLeft');
    press('Mod+C');
    store.click({
      systemIndex: 0,
      partId: '',
      staffId: store.getState().staffId,
      measureIndex: 3,
      tick: 1920,
    } as HitResult);
    press('Mod+V');
    expect(notes(3).slice(1)).toEqual(['C5:quarter', 'D5:quarter']);
    expect(store.getState().score.measures).toHaveLength(5);
    expect(notes(4).slice(0, 2)).toEqual(['E5:quarter', 'F5:quarter']);
  });

  it('refuses to paste an event that does not fit before the barline', () => {
    setup();
    press('N', '6', 'C', 'N');
    press('Mod+C');
    store.click({
      systemIndex: 0,
      partId: '',
      staffId: store.getState().staffId,
      measureIndex: 2,
      tick: 2880,
    } as HitResult);
    const before = store.getState().score;
    press('Mod+V');
    expect(store.getState().score).toBe(before);
    expect(store.getState().announcement).toMatchObject({ notice: { key: 'notice.noFit' } });
  });

  it('changes the duration of the selected notes', () => {
    press('ArrowLeft', 'ArrowLeft', 'ArrowLeft');
    press('6');
    expect(notes()[0]).toBe('C5:half');
    expect(store.getState().selection).toHaveLength(1);
  });
});

describe('mouse', () => {
  const hit = (over: Partial<HitResult>): HitResult => ({
    systemIndex: 0,
    partId: '',
    staffId: store.getState().staffId,
    measureIndex: 0,
    ...over,
  });

  it('click on a note selects it, shift extends', () => {
    press('N', '5', 'C', 'D', 'E', 'N');
    const ids = events().map((e) => e.id);
    store.click(hit({ eventId: ids[1]! }));
    expect(store.getState().selection).toEqual([ids[1]]);
    store.click(hit({ eventId: ids[3]! }), true);
    expect(store.getState().selection).toEqual(ids.slice(1, 4));
  });

  it('click in note input enters the note at the clicked pitch and position', () => {
    press('N', '5');
    const e4: Pitch = { step: 'E', alter: 0, octave: 4 };
    store.click(hit({ tick: 1920, pitch: e4 }));
    expect(notes()).toEqual(['r:half', 'E4:quarter', 'r:quarter']);
    expect(store.getState().cursor).toEqual({ measure: 0, tick: 2880 });
  });

  it('click applies the key signature and the armed accidental', () => {
    setup(createScore({ measures: 2, keyFifths: 1 }));
    press('N', '5');
    store.click(hit({ tick: 0, pitch: { step: 'F', alter: 0, octave: 5 } }));
    expect(notes()[0]).toBe('F#5:quarter');
    press('Minus');
    store.click(hit({ tick: 960, pitch: { step: 'B', alter: 0, octave: 4 } }));
    expect(notes()[1]).toBe('Bb4:quarter');
  });
});

describe('store transitions', () => {
  it('leaving note input selects the last entered note', () => {
    press('N', '5', 'C', 'D', 'N');
    expect(store.getState().mode).toBe('select');
    expect(store.getState().selection).toEqual([events()[1]!.id]);
  });

  it('entering note input starts at the selection', () => {
    press('N', '5', 'C', 'D', 'E', 'N', 'ArrowLeft', 'N');
    expect(store.getState().cursor).toEqual({ measure: 0, tick: 960 });
    press('G');
    expect(notes().slice(0, 3)).toEqual(['C5:quarter', 'G5:quarter', 'E5:quarter']);
  });

  it('calls onNoteEntered with the entered pitch', () => {
    const spy = vi.fn();
    store.onNoteEntered = spy;
    press('N', '5', 'C');
    expect(spy).toHaveBeenCalledWith({ step: 'C', alter: 0, octave: 5 });
  });

  it('a refused command leaves the score and the history untouched', () => {
    press('N', '5', 'Mod+3');
    const before = store.getState().score;
    // A half note cannot overwrite a triplet slot.
    press('6', 'C');
    expect(store.getState().score).toBe(before);
    expect(store.getState().announcement).toMatchObject({ notice: { key: 'notice.tuplet' } });
  });

  it('describes the entered note for the live region', () => {
    press('N', '5', 'C', 'D');
    const ann = store.getState().announcement;
    expect(ann && 'eventId' in ann).toBe(true);
    const id = (ann as { eventId: string }).eventId;
    expect(findEvent(store.getState().score, id)?.event).toMatchObject({ kind: 'note' });
  });
});

describe('piano keys (enterMidi)', () => {
  const pitches = (measure = 0) =>
    events(measure).flatMap((e) =>
      e.kind === 'note' ? [e.pitches.map((p) => p.step + p.octave)] : [],
    );

  it('enters a note at the current duration, Shift adds it to the chord', () => {
    press('N', '6');
    store.enterMidi(60);
    store.enterMidi(64, true);
    expect(pitches()).toEqual([['C4', 'E4']]);
    expect(store.getState().cursor.tick).toBe(1920);
  });

  it('calls the sound hook', () => {
    const heard = vi.fn();
    store.onNoteEntered = heard;
    press('N');
    store.enterMidi(62);
    expect(heard).toHaveBeenCalledWith({ step: 'D', alter: 0, octave: 4 });
  });

  it('in select mode moves the selected note, Shift adds to it', () => {
    press('N', '5');
    store.enterMidi(60);
    store.enterMidi(64);
    press('Escape');
    store.clickEvent(events()[0]!.id);
    store.enterMidi(67);
    expect(pitches()[0]).toEqual(['G4']);
    store.enterMidi(72, true);
    expect(pitches()[0]).toEqual(['G4', 'C5']);
    store.undo();
    expect(pitches()[0]).toEqual(['G4']);
  });

  it('refuses invalid MIDI numbers', () => {
    press('N');
    store.enterMidi(200);
    store.enterMidi(1.5);
    expect(pitches()).toEqual([]);
  });
});
