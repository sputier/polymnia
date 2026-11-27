import { useSyncExternalStore } from 'react';

export type UiMode = 'simple' | 'advanced';

// Stored in localStorage for now; it will move to the user profile with accounts.
export const UI_MODE_STORAGE_KEY = 'polymnia.uiMode';

function read(): UiMode {
  try {
    return localStorage.getItem(UI_MODE_STORAGE_KEY) === 'advanced' ? 'advanced' : 'simple';
  } catch {
    return 'simple';
  }
}

let current: UiMode = read();
const listeners = new Set<() => void>();

export function setUiMode(mode: UiMode): void {
  if (mode === current) return;
  current = mode;
  try {
    localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  listeners.forEach((listener) => listener());
}

/** Test helper: re-reads the stored value. */
export function resetUiMode(): void {
  current = read();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiMode(): { mode: UiMode; setMode: (mode: UiMode) => void; toggle: () => void } {
  const mode = useSyncExternalStore(
    subscribe,
    () => current,
    () => 'simple' as UiMode,
  );
  return {
    mode,
    setMode: setUiMode,
    toggle: () => setUiMode(current === 'advanced' ? 'simple' : 'advanced'),
  };
}
