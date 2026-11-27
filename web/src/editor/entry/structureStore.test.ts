import { describe, expect, it } from 'vitest';
import {
  clefAt,
  createScore,
  keyFifthsAt,
  measureLength,
  putEvent,
  tempoAt,
  timeSignatureAt,
  type Pitch,
} from '../../score';
import { buildCommands } from '../../shortcuts/commands';
import { createShortcutRegistry } from '../../shortcuts/registry';
import { EditorStore } from './editorStore';
import { entryShortcuts } from './entryShortcuts';
import { structureShortcuts } from './structureShortcuts';
import { keyEvent } from './testKeys';

const P = (step: Pitch['step'], octave: number, alter: Pitch['alter'] = 0): Pitch => ({
  step,
  alter,
  octave,
});

function make(instruments = ['guitar-steel', 'cello'], measures = 4) {
  const store = new EditorStore(createScore({ measures, instruments }));
  const registry = createShortcutRegistry();
  let added = 0;
  [...entryShortcuts(store), ...structureShortcuts(store, () => added++)].forEach((s) =>
    registry.register(s),
  );
  return { store, registry, added: () => added };
}

const state = (s: EditorStore) => s.getState();

describe('parts through the store', () => {
  it('adds a part, edits it, and undo restores both the score and the staff being edited', () => {
    const { store } = make(['guitar-steel']);
    const before = state(store).staffId;
    expect(store.addPart('cello', { name: 'Violoncelle' })).toBe(true);
    expect(state(store).score.parts.map((p) => p.name)).toEqual([
      'Steel-string guitar',
      'Violoncelle',
    ]);
    expect(state(store).staffId).toBe(state(store).score.parts[1]!.staves[0]!.id);
    store.undo();
    expect(state(store).score.parts).toHaveLength(1);
    expect(state(store).staffId).toBe(before);
    store.redo();
    expect(state(store).score.parts).toHaveLength(2);
  });

  it('removing the part being edited moves the staff to a surviving part; the last part is protected', () => {
    const { store } = make(['guitar-steel', 'cello']);
    store.focusPart(1);
    const cello = state(store).score.parts[1]!;
    expect(store.removePart(cello.id)).toBe(true);
    expect(state(store).score.parts).toHaveLength(1);
    expect(state(store).staffId).toBe(state(store).score.parts[0]!.staves[0]!.id);
    expect(store.removePart(state(store).score.parts[0]!.id)).toBe(false);
    expect(state(store).announcement).toMatchObject({ notice: { key: 'notice.lastPart' } });
  });

  it('reorders, renames and changes instrument', () => {
    const { store } = make(['guitar-steel', 'cello']);
    const [guitar, cello] = state(store).score.parts;
    store.movePart(cello!.id, 0);
    expect(state(store).score.parts.map((p) => p.instrument)).toEqual(['cello', 'guitar-steel']);
    store.renamePart(guitar!.id, 'Lead');
    expect(state(store).score.parts[1]!.name).toBe('Lead');
    store.changeInstrument(guitar!.id, 'ukulele-tenor', 'Uke');
    expect(state(store).score.parts[1]).toMatchObject({ instrument: 'ukulele-tenor', name: 'Uke' });
    store.undo();
    expect(state(store).score.parts[1]!.instrument).toBe('guitar-steel');
  });

  it('refuses to drop a staff holding notes and says why', () => {
    const piano = createScore({ measures: 1, instruments: ['piano'] });
    const left = piano.parts[0]!.staves[1]!.id;
    const store = new EditorStore(
      putEvent({
        staffId: left,
        measure: 0,
        tick: 0,
        event: { kind: 'note', duration: { base: 'quarter', dots: 0 }, pitches: [P('C', 3)] },
      }).apply(piano),
    );
    expect(store.changeInstrument(piano.parts[0]!.id, 'flute')).toBe(false);
    expect(state(store).announcement).toMatchObject({ notice: { key: 'notice.notEmpty' } });
    expect(state(store).score.parts[0]!.instrument).toBe('piano');
  });

  it('tuning, capo and layout are undoable score edits', () => {
    const { store } = make(['guitar-steel']);
    const id = state(store).score.parts[0]!.id;
    const drop: Pitch[] = [P('E', 4), P('B', 3), P('G', 3), P('D', 3), P('A', 2), P('D', 2)];
    expect(store.setTuning(id, drop)).toBe(true);
    expect(store.setCapo(id, 2)).toBe(true);
    expect(store.setStaffLayout(id, 'standard+tab')).toBe(true);
    expect(state(store).score.parts[0]!.staves).toHaveLength(2);
    store.undo();
    store.undo();
    store.undo();
    expect(state(store).score.parts[0]!.tuning).toBeUndefined();
    expect(state(store).score.parts[0]!.capo).toBeUndefined();
  });
});

describe('standard + TAB parts through the store', () => {
  it('the TAB staff follows every edit in the same undo step', () => {
    const { store, registry } = make(['guitar-steel']);
    store.setStaffLayout(state(store).score.parts[0]!.id, 'standard+tab');
    registry.handle(keyEvent('N'), false);
    registry.handle(keyEvent('5'), false);
    registry.handle(keyEvent('E'), false);
    const [std, tab] = state(store).score.parts[0]!.staves;
    const first = (staff: typeof std) => staff!.measures[0]!.voices[0]!.events[0]!;
    const note = first(tab);
    expect(note.kind === 'note' && note.pitches[0]!.fretting).toBeTruthy();
    expect(first(std).kind).toBe('note');
    store.undo();
    expect(first(state(store).score.parts[0]!.staves[1]).kind).toBe('rest');
    store.redo();
    expect(first(state(store).score.parts[0]!.staves[1]).kind).toBe('note');
  });
});

describe('measures and attributes through the store', () => {
  it('inserts, appends and deletes measures around the cursor', () => {
    const { store } = make();
    store.insertMeasure('after');
    expect(state(store).score.measures).toHaveLength(5);
    expect(state(store).cursor.measure).toBe(1);
    store.insertMeasure('end');
    expect(state(store).score.measures).toHaveLength(6);
    store.deleteMeasure();
    expect(state(store).score.measures).toHaveLength(5);
    store.undo();
    expect(state(store).score.measures).toHaveLength(6);
  });

  it('the cursor stays valid when the last measure is deleted', () => {
    const { store } = make(['guitar-steel'], 2);
    store.insertMeasure('end');
    expect(state(store).cursor.measure).toBe(2);
    store.deleteMeasure();
    expect(state(store).cursor.measure).toBe(1);
  });

  it('key, time and tempo apply from the cursor measure', () => {
    const { store } = make();
    store.insertMeasure('after'); // cursor on measure 1
    expect(store.setKeySignature(2)).toBe(true);
    expect(keyFifthsAt(state(store).score, 0)).toBe(0);
    expect(keyFifthsAt(state(store).score, 1)).toBe(2);
    expect(store.setTimeSignature({ beats: 3, beatType: 4 })).toBe(true);
    expect(timeSignatureAt(state(store).score, 2)).toEqual({ beats: 3, beatType: 4 });
    expect(measureLength(state(store).score, 2)).toBe(2880);
    expect(store.setTempo(70)).toBe(true);
    expect(tempoAt(state(store).score, 1)).toBe(70);
    expect(store.setTempo(null)).toBe(true);
    expect(tempoAt(state(store).score, 1)).toBe(100);
    expect(store.setMeasureLength(960)).toBe(true);
    expect(measureLength(state(store).score, 1)).toBe(960);
  });

  it('clef changes target the staff being edited at the cursor measure', () => {
    const { store } = make(['cello']);
    store.insertMeasure('after');
    expect(store.setClef('tenor')).toBe(true);
    const staff = state(store).score.parts[0]!.staves[0]!;
    expect(clefAt(staff, 0)).toBe('bass');
    expect(clefAt(staff, 1)).toBe('tenor');
    store.undo();
    expect(clefAt(state(store).score.parts[0]!.staves[0]!, 1)).toBe('bass');
  });
});

describe('structure shortcuts', () => {
  it('Insert, Ctrl+Insert and Ctrl+Delete work on measures', () => {
    const { store, registry } = make();
    registry.handle(keyEvent('Insert'), false);
    expect(state(store).score.measures).toHaveLength(5);
    registry.handle(keyEvent('Mod+Insert'), false);
    expect(state(store).score.measures).toHaveLength(6);
    registry.handle(keyEvent('Mod+Delete'), false);
    expect(state(store).score.measures).toHaveLength(5);
  });

  it('palette-only commands exist with no key and are enabled only where they do something', () => {
    const { store, registry } = make(['cello']);
    const commands = buildCommands(registry.list());
    const byId = (id: string) => commands.find((c) => c.id === id)!;
    expect(byId('structure.clef.tenor').keys).toEqual([]);
    expect(byId('structure.clef.bass').enabled()).toBe(false); // already bass
    expect(byId('structure.clef.tenor').enabled()).toBe(true);
    byId('structure.clef.tenor').run();
    expect(clefAt(state(store).score.parts[0]!.staves[0]!, 0)).toBe('tenor');
    expect(byId('structure.key.none').enabled()).toBe(false);
    byId('structure.key.flat').run();
    expect(keyFifthsAt(state(store).score, 0)).toBe(-1);
    byId('structure.time.6-8').run();
    expect(timeSignatureAt(state(store).score, 0)).toEqual({ beats: 6, beatType: 8 });
    expect(byId('structure.tempo.clear').enabled()).toBe(false);
    byId('structure.tempo.faster').run();
    expect(tempoAt(state(store).score, 0)).toBe(110);
  });

  it('"Add an instrument" calls the panel opener', () => {
    const { registry, added } = make();
    registry.run('structure.addInstrument');
    expect(added()).toBe(1);
  });

  it('chords and triplets entered next to a key change undo cleanly', () => {
    const { store, registry } = make(['guitar-steel']);
    registry.handle(keyEvent('N'), false);
    registry.handle(keyEvent('5'), false);
    registry.handle(keyEvent('E'), false);
    registry.handle(keyEvent('Shift+G'), false);
    const events = () => state(store).score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events;
    const first = events()[0]!;
    expect(first.kind === 'note' && first.pitches).toHaveLength(2);
    store.setKeySignature(1);
    store.undo();
    expect(keyFifthsAt(state(store).score, 0)).toBe(0);
    store.undo();
    const undone = events()[0]!;
    expect(undone.kind === 'note' && undone.pitches).toHaveLength(1);
  });
});
