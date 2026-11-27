import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

// Must stay in sync with public/theme-init.js.
export const THEME_STORAGE_KEY = 'polymnia.theme';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function currentTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  if (applied === 'light' || applied === 'dark') return applied;
  return storedTheme() ?? systemTheme();
}

const listeners = new Set<() => void>();

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  listeners.forEach((listener) => listener());
}

/** Persists an explicit user choice and applies it immediately. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode, blocked): the choice lasts for this session only.
  }
  apply(theme);
}

/** Follows OS changes while the user has not made an explicit choice. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = () => {
    if (storedTheme() === null) apply(systemTheme());
  };
  media.addEventListener('change', onSystemChange);
  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', onSystemChange);
  };
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as Theme);
  return { theme, toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}
