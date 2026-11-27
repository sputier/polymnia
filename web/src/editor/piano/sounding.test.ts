import { describe, expect, it } from 'vitest';
import type { Score } from '../../score';
import { EditorStore, newEditorScore } from '../entry/editorStore';
import { midisOf } from './Piano';

function noteIds(score: Score): string[] {
  return score.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events.filter(
    (e) => e.kind === 'note',
  ).map((e) => e.id);
}

describe('piano highlights show the sounding pitch', () => {
  it.each([
    ['piano', 72],
    ['guitar-classical', 60],
    ['clarinet', 70],
  ])('%s: a written C5 lights key %i', (instrument, key) => {
    const store = new EditorStore(newEditorScore(2));
    if (instrument !== 'piano') {
      store.changeInstrument(store.getState().score.parts[0]!.id, instrument);
    }
    const transposition = store.getState().score.parts[0]!.transposition;
    store.toggleInputMode();
    store.enterMidi(72 + transposition);
    const after = store.getState().score;
    expect([...midisOf(after, noteIds(after))]).toEqual([key]);
  });
});
