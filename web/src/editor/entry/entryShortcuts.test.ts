import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { fr } from '../../i18n/fr';
import { alterInForce, nearestOctave, beatOf } from './pitchInput';
import { createScore, type Pitch, type StepName } from '../../score';
import { createShortcutRegistry, formatKeys, matches } from '../../shortcuts/registry';
import { EditorStore, newEditorScore } from './editorStore';
import { entryShortcuts, keysOf } from './entryShortcuts';
import { keyEvent } from './testKeys';

/** The shortcut table of issue #6 (MuseScore 4 defaults), one entry per row. */
const TABLE: Record<string, string> = {
  'entry.toggleInput': 'N',
  'entry.duration.3': '3',
  'entry.duration.4': '4',
  'entry.duration.5': '5',
  'entry.duration.6': '6',
  'entry.duration.7': '7',
  'entry.dot': 'Period',
  'entry.rest': '0',
  'entry.note.A': 'A',
  'entry.note.G': 'G',
  'entry.chord.A': 'Shift+A',
  'entry.chord.G': 'Shift+G',
  'entry.sharp': 'Plus',
  'entry.flat': 'Minus',
  'entry.natural': 'Equal',
  'entry.pitchUp': 'ArrowUp',
  'entry.pitchDown': 'ArrowDown',
  'entry.octaveUp': 'Mod+ArrowUp',
  'entry.octaveDown': 'Mod+ArrowDown',
  'entry.tie': 'T',
  'entry.slur': 'S',
  'entry.triplet': 'Mod+3',
  'entry.moveLeft': 'ArrowLeft',
  'entry.moveRight': 'ArrowRight',
  'entry.delete': 'Delete',
  'entry.undo': 'Mod+Z',
  'entry.redo': 'Mod+Y',
  'entry.redoShift': 'Mod+Shift+Z',
};

describe('entry key map', () => {
  it('matches the issue table', () => {
    for (const [id, keys] of Object.entries(TABLE)) expect(keysOf(id), id).toBe(keys);
  });

  it('has no two shortcuts on the same combo', () => {
    const list = entryShortcuts(new EditorStore(newEditorScore(1)));
    const seen = new Map<string, string>();
    for (const s of list) {
      expect(seen.get(s.keys), `${s.id} duplicates ${seen.get(s.keys)}`).toBeUndefined();
      seen.set(s.keys, s.id);
    }
  });

  it('every label exists in English and French', () => {
    for (const s of entryShortcuts(new EditorStore(newEditorScore(1)))) {
      expect(en[s.labelKey]).toBeTruthy();
      expect(fr[s.labelKey]).toBeTruthy();
    }
  });

  it('symbol keys match with or without Shift (AZERTY, QWERTY)', () => {
    const plus = (shift: boolean) =>
      new KeyboardEvent('keydown', { key: '+', code: 'Equal', shiftKey: shift });
    expect(matches(plus(true), 'Plus', false)).toBe(true);
    expect(matches(plus(false), 'Plus', false)).toBe(true);
    expect(matches(new KeyboardEvent('keydown', { key: '=', code: 'Equal' }), 'Equal', false)).toBe(
      true,
    );
    expect(
      matches(new KeyboardEvent('keydown', { key: '.', shiftKey: true }), 'Period', false),
    ).toBe(true);
    // Digits go by physical key: Shift+1 on AZERTY types "1" but is still Digit1.
    expect(matches(keyEvent('Mod+3'), 'Mod+3', false)).toBe(true);
    expect(matches(keyEvent('3'), 'Mod+3', false)).toBe(false);
  });

  it('formats the labels of the new keys', () => {
    expect(formatKeys('Mod+ArrowUp', false)).toEqual(['Ctrl', '↑']);
    expect(formatKeys('Mod+ArrowUp', true)).toEqual(['⌘', '↑']);
    expect(formatKeys('Plus', false)).toEqual(['+']);
    expect(formatKeys('Delete', false)).toEqual(['Del']);
  });

  it('does not fire while typing in a text field', () => {
    const store = new EditorStore(newEditorScore(1));
    const registry = createShortcutRegistry();
    entryShortcuts(store).forEach((s) => registry.register(s));
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = keyEvent('N');
    input.dispatchEvent(event);
    expect(registry.handle(event, false)).toBe(false);
    expect(store.getState().mode).toBe('select');
    input.remove();
  });
});

describe('nearestOctave', () => {
  const ref = (step: StepName, octave: number): Pitch => ({ step, alter: 0, octave });
  it.each([
    ['C', ref('C', 4), 4],
    ['D', ref('C', 4), 4],
    ['F', ref('C', 4), 4],
    ['G', ref('C', 4), 3], // a fifth up is farther than a fourth down
    ['B', ref('C', 4), 3],
    ['B', ref('F', 4), 4], // a tritone counts as up
    ['C', ref('B', 4), 5],
    ['A', ref('C', 5), 4],
    ['E', ref('A', 4), 4],
    ['E', ref('B', 4), 5],
  ] as [StepName, Pitch, number][])('%s near %o is in octave %i', (step, reference, octave) => {
    expect(nearestOctave(step, reference)).toBe(octave);
  });
});

describe('alterInForce', () => {
  it('uses the key signature, then accidentals written earlier in the measure', () => {
    const store = new EditorStore(createScore({ measures: 1, keyFifths: 2 }));
    const loc = { partIndex: 0, staffIndex: 0, measure: 0 };
    expect(alterInForce(store.getState().score, loc, 0, 'F', 5)).toBe(1);
    expect(alterInForce(store.getState().score, loc, 0, 'B', 4)).toBe(0);
    store.toggleInputMode();
    store.accidental(0);
    store.enterStep('F');
    expect(alterInForce(store.getState().score, loc, 960, 'F', 4)).toBe(0);
    // Another octave keeps the key signature.
    expect(alterInForce(store.getState().score, loc, 960, 'F', 5)).toBe(1);
  });
});

describe('beatOf', () => {
  it('counts beats of the time signature', () => {
    expect(beatOf(4, 0)).toBe(1);
    expect(beatOf(4, 960)).toBe(2);
    expect(beatOf(4, 1440)).toBe(2.5);
    expect(beatOf(8, 480)).toBe(2);
  });
});
