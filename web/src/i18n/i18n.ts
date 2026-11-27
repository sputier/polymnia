import { useSyncExternalStore } from 'react';
import { en, type MessageKey, type Messages } from './en';
import { fr } from './fr';

// A tiny typed i18n layer: no runtime dependency, keys checked at compile time.
export const LANGUAGES = ['en', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'polymnia.lang';

const catalogs: Record<Language, Messages> = { en, fr };

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Stored choice first, then the browser's preferred languages, then English. */
export function detectLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage unavailable: fall through to browser detection.
  }
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const base = tag?.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

/** A message in a given language, whatever the UI language (the command search matches both). */
export function messageIn(language: Language, key: MessageKey): string {
  return catalogs[language][key];
}

let current: Language = detectLanguage();
const listeners = new Set<() => void>();

function syncDocument(): void {
  document.documentElement.lang = current;
}
syncDocument();

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  syncDocument();
  listeners.forEach((listener) => listener());
}

/** Test helper: re-runs detection (for example after changing navigator.languages). */
export function resetLanguage(): void {
  current = detectLanguage();
  syncDocument();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useI18n(): {
  language: Language;
  t: (key: MessageKey) => string;
  setLanguage: (language: Language) => void;
} {
  const language = useSyncExternalStore(subscribe, () => current);
  return { language, t: (key) => catalogs[language][key], setLanguage };
}
