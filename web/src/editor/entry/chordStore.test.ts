import { beforeEach, describe, expect, it } from 'vitest';
import type { HitResult } from '../../engraving/hitTest';
import { createScore, formatChord, staffChords, type Score } from '../../score';
import { createShortcutRegistry, type ShortcutRegistry } from '../../shortcuts/registry';
import { EditorStore } from './editorStore';
import { entryShortcuts } from './entryShortcuts';
import { keyEvent } from './testKeys';

let store: EditorStore;
let registry: ShortcutRegistry;

function setup(score: Score = createScore({ measures: 4, instruments: ['guitar-steel'] })) {
  store = new EditorStore(score);
  registry = createShortcutRegistry();
  entryShortcuts(store).forEach((s) => registry.register(s));
}

const press = (...combos: string[]) => combos.forEach((c) => registry.handle(keyEvent(c), false));

const staffId = () => store.getState().score.parts[0]!.staves[0]!.id;
const chords = (score = store.getState().score) =>
  staffChords(score, score.parts[0]!.staves[0]!.id).map(
    ({ measure, chord }) => `${measure}:${chord.tick}:${formatChord(chord)}`,
  );
const entry = () => store.getState().chordEntry;

beforeEach(() => setup());

describe('opening the chord field', () => {
  it('opens at the cursor with Alt+K', () => {
    expect(entry()).toBeNull();
    press('Alt+K');
    expect(entry()).toEqual({ staffId: staffId(), measure: 0, tick: 0 });
  });

  it('opens where the selected note is', () => {
    store.click({
      systemIndex: 0,
      partId: 'p',
      staffId: staffId(),
      measureIndex: 2,
      tick: 1920,
    });
    store.openChordEntry();
    expect(entry()).toEqual({ staffId: staffId(), measure: 2, tick: 1920 });
  });

  it('always uses the first staff of the part, and clamps to the measure', () => {
    setup(createScore({ measures: 2, instruments: ['piano'] }));
    const bass = store.getState().score.parts[0]!.staves[1]!.id;
    store.openChordEntry({ staffId: bass, measure: 1, tick: 99999 });
    expect(entry()).toEqual({
      staffId: store.getState().score.parts[0]!.staves[0]!.id,
      measure: 1,
      tick: 3839,
    });
  });

  it('has a palette command and a cheat sheet row', () => {
    const shortcut = registry.list().find((s) => s.id === 'entry.chordSymbol')!;
    expect(shortcut.keys).toBe('Alt+K');
    expect(shortcut.group).toBe('input');
    expect(registry.list().find((s) => s.id === 'chord.transposeUp')!.keys).toBe('');
  });

  it('closes on any other click, and on undo', () => {
    press('Alt+K');
    store.click({ systemIndex: 0, partId: 'p', staffId: staffId(), measureIndex: 1, tick: 0 });
    expect(entry()).toBeNull();
    press('Alt+K');
    store.commitChord('C');
    press('Mod+Z');
    expect(entry()).toBeNull();
  });

  it('opens when a chord symbol is clicked', () => {
    const hit: HitResult = {
      systemIndex: 0,
      partId: 'p',
      staffId: staffId(),
      measureIndex: 3,
      tick: 960,
      chord: { id: 'x', tick: 960 },
    };
    store.click(hit);
    expect(entry()).toEqual({ staffId: staffId(), measure: 3, tick: 960 });
  });
});

describe('writing chords', () => {
  it('writes a chord, normalized, and keeps the field open for the next', () => {
    press('Alt+K');
    expect(store.commitChord('rém7')).toBe(true);
    expect(chords()).toEqual(['0:0:Dm7']);
    expect(entry()).not.toBeNull();
    expect(store.getState().cursor).toEqual({ measure: 0, tick: 0 });
  });

  it('refuses text that is not a chord, with a notice, and writes nothing', () => {
    press('Alt+K');
    expect(store.commitChord('hello')).toBe(false);
    expect(chords()).toEqual([]);
    expect(store.getState().announcement).toMatchObject({
      notice: { key: 'notice.chordInvalid', params: { text: 'hello' } },
    });
    expect(entry()).not.toBeNull();
  });

  it('edits an existing chord: the field shows it, an empty field removes it', () => {
    press('Alt+K');
    store.commitChord('G7');
    expect(store.chordTextAt(entry()!)).toBe('G7');
    store.commitChord('Gmaj7');
    expect(chords()).toEqual(['0:0:Gmaj7']);
    store.commitChord('   ');
    expect(chords()).toEqual([]);
    // Removing nothing is not an error.
    expect(store.commitChord('')).toBe(true);
  });

  it('makes one undo step per chord', () => {
    press('Alt+K');
    store.commitChord('C');
    store.moveChordEntry('beat', 1);
    store.commitChord('G');
    expect(chords()).toEqual(['0:0:C', '0:960:G']);
    store.undo();
    expect(chords()).toEqual(['0:0:C']);
    store.redo();
    expect(chords()).toEqual(['0:0:C', '0:960:G']);
  });

  it('does nothing without an open field', () => {
    expect(store.commitChord('C')).toBe(false);
    expect(store.moveChordEntry('beat', 1)).toBe(false);
  });
});

describe('moving the field', () => {
  const at = () => `${entry()!.measure}:${entry()!.tick}`;

  it('Space goes beat by beat and into the next measure', () => {
    press('Alt+K');
    const seen = [at()];
    for (let i = 0; i < 5; i++) {
      store.moveChordEntry('beat', 1);
      seen.push(at());
    }
    expect(seen).toEqual(['0:0', '0:960', '0:1920', '0:2880', '1:0', '1:960']);
  });

  it('Shift+Space goes back, to the last beat of the previous measure', () => {
    store.openChordEntry({ staffId: staffId(), measure: 1, tick: 960 });
    store.moveChordEntry('beat', -1);
    expect(at()).toBe('1:0');
    store.moveChordEntry('beat', -1);
    expect(at()).toBe('0:2880');
    store.moveChordEntry('beat', -1);
    expect(at()).toBe('0:1920');
  });

  it('snaps an off-beat position to the beat grid', () => {
    store.openChordEntry({ staffId: staffId(), measure: 0, tick: 1200 });
    store.moveChordEntry('beat', 1);
    expect(at()).toBe('0:1920');
    store.openChordEntry({ staffId: staffId(), measure: 0, tick: 1200 });
    store.moveChordEntry('beat', -1);
    expect(at()).toBe('0:960');
  });

  it('Tab goes to the next measure, Shift+Tab to the previous', () => {
    store.openChordEntry({ staffId: staffId(), measure: 0, tick: 1920 });
    store.moveChordEntry('measure', 1);
    expect(at()).toBe('1:0');
    store.moveChordEntry('measure', -1);
    expect(at()).toBe('0:0');
  });

  it('stays at the start and at the end of the score', () => {
    press('Alt+K');
    expect(store.moveChordEntry('beat', -1)).toBe(false);
    expect(store.moveChordEntry('measure', -1)).toBe(false);
    expect(at()).toBe('0:0');
    store.openChordEntry({ staffId: staffId(), measure: 3, tick: 2880 });
    expect(store.moveChordEntry('beat', 1)).toBe(false);
    expect(store.moveChordEntry('measure', 1)).toBe(false);
    expect(at()).toBe('3:2880');
  });

  it('moves the cursor with it', () => {
    press('Alt+K');
    store.moveChordEntry('beat', 1);
    expect(store.getState().cursor).toEqual({ measure: 0, tick: 960 });
  });

  it('uses the beat of the time signature: a dotted quarter in 6/8, a half in 2/2', () => {
    setup(
      createScore({ measures: 2, instruments: ['guitar-steel'], time: { beats: 6, beatType: 8 } }),
    );
    press('Alt+K');
    const seen = [at()];
    for (let i = 0; i < 3; i++) {
      store.moveChordEntry('beat', 1);
      seen.push(at());
    }
    expect(seen).toEqual(['0:0', '0:1440', '1:0', '1:1440']);
    setup(
      createScore({ measures: 2, instruments: ['guitar-steel'], time: { beats: 2, beatType: 2 } }),
    );
    press('Alt+K');
    store.moveChordEntry('beat', 1);
    expect(at()).toBe('0:1920');
  });
});

describe('chord commands', () => {
  it('transposes the symbols of the part, spelled for the key', () => {
    setup(createScore({ measures: 2, instruments: ['guitar-steel', 'piano'] }));
    store.openChordEntry({ staffId: staffId(), measure: 0, tick: 0 });
    store.commitChord('C');
    store.moveChordEntry('beat', 1);
    store.moveChordEntry('beat', 1);
    store.commitChord('Am7/G');
    store.closeChordEntry();
    expect(store.transposeChords(3)).toBe(true);
    expect(chords()).toEqual(['0:0:Eb', '0:1920:Cm7/Bb']);
    expect(store.transposeChords(-3)).toBe(true);
    expect(chords()).toEqual(['0:0:C', '0:1920:Am7/G']);
  });

  it('says so when there is nothing to transpose', () => {
    expect(store.transposeChords(2)).toBe(false);
    expect(store.getState().announcement).toMatchObject({ notice: { key: 'notice.chordNone' } });
  });

  it('transposes through the palette commands', () => {
    press('Alt+K');
    store.commitChord('E');
    store.closeChordEntry();
    registry.run('chord.transposeUp');
    expect(chords()).toEqual(['0:0:F']);
    registry.run('chord.transposeDown');
    registry.run('chord.transposeDown');
    expect(chords()).toEqual(['0:0:Eb']);
  });

  it('follows the key signature of the measure', () => {
    store.setKeySignature(2);
    press('Alt+K');
    store.commitChord('C');
    store.closeChordEntry();
    store.transposeChords(1);
    expect(chords()).toEqual(['0:0:C#']);
    store.setKeySignature(-3);
    store.transposeChords(2);
    expect(chords()).toEqual(['0:0:Eb']);
  });

  it('removes the chord at the cursor', () => {
    press('Alt+K');
    store.commitChord('C');
    store.closeChordEntry();
    expect(store.deleteChordAtCursor()).toBe(true);
    expect(chords()).toEqual([]);
    expect(store.deleteChordAtCursor()).toBe(false);
    registry.run('chord.delete');
  });

  it('shows and hides the diagram of one chord', () => {
    press('Alt+K');
    store.commitChord('C');
    store.closeChordEntry();
    expect(store.toggleChordDiagram()).toBe(true);
    const chord = staffChords(store.getState().score, staffId())[0]!.chord;
    expect(chord.diagram).toBe(true);
    store.toggleChordDiagram();
    expect(staffChords(store.getState().score, staffId())[0]!.chord.diagram).toBe(false);
    store.undo();
    store.undo();
    expect(staffChords(store.getState().score, staffId())[0]!.chord.diagram).toBeUndefined();
  });

  it('sets the diagram mode and the capo shapes of a part', () => {
    const partId = store.getState().score.parts[0]!.id;
    expect(store.setChordDiagramMode(partId, 'first')).toBe(true);
    expect(store.getState().score.parts[0]!.chordDiagrams).toBe('first');
    expect(store.setChordDiagramMode(partId, null)).toBe(true);
    expect(store.getState().score.parts[0]!.chordDiagrams).toBeUndefined();
    expect(store.setChordCapoShapes(partId, true)).toBe(true);
    expect(store.getState().score.parts[0]!.chordCapoShapes).toBe(true);
    store.undo();
    expect(store.getState().score.parts[0]!.chordCapoShapes).toBeUndefined();
  });

  it('keeps chords valid when the time signature changes under them', () => {
    press('Alt+K');
    for (let i = 0; i < 3; i++) store.moveChordEntry('beat', 1);
    store.commitChord('G');
    store.closeChordEntry();
    store.setTimeSignature({ beats: 2, beatType: 4 });
    expect(chords()).toEqual([]);
  });
});
