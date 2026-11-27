import { useSyncExternalStore } from 'react';
import type { NoteNaming } from '../score/chords';

/**
 * How chord symbols are displayed: English letters (`C D E`, the default) or French solfège names
 * (`Do Ré Mi`). A display preference only: input accepts both and MusicXML always writes English
 * roots. Kept in localStorage like the other UI preferences (paper, Simple/Advanced); the engraver
 * reads it through `getChordNaming()`, so the editor, the shared viewer and the exports agree.
 */
export const CHORD_NAMING_STORAGE_KEY = 'polymnia.chordNaming';

function read(): NoteNaming {
  try {
    return localStorage.getItem(CHORD_NAMING_STORAGE_KEY) === 'solfege' ? 'solfege' : 'letters';
  } catch {
    return 'letters';
  }
}

let current: NoteNaming = read();
const listeners = new Set<() => void>();

export function getChordNaming(): NoteNaming {
  return current;
}

export function setChordNaming(naming: NoteNaming): void {
  if (naming === current) return;
  current = naming;
  try {
    localStorage.setItem(CHORD_NAMING_STORAGE_KEY, naming);
  } catch {
    // Not persisted: the choice still holds for this session.
  }
  listeners.forEach((l) => l());
}

/** Test helper: re-reads the stored value. */
export function resetChordNaming(): void {
  current = read();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useChordNaming(): NoteNaming {
  return useSyncExternalStore(subscribe, getChordNaming, () => 'letters' as NoteNaming);
}
