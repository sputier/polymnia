import { useSyncExternalStore } from 'react';
import type { MessageKey, Messages } from './en';

// A tiny typed i18n layer: no runtime dependency, keys checked at compile time.
export const LANGUAGES = ['en', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'polymnia.lang';

// One lazy chunk per language: only the active catalog is downloaded, the other one when the user switches
// (or when the command search needs both, see loadAllCatalogs).
const loaders: Record<Language, () => Promise<Messages>> = {
  en: () => import('./en').then((m) => m.en),
  fr: () => import('./fr').then((m) => m.fr),
};
const catalogs: Partial<Record<Language, Messages>> = {};
const loading = new Map<Language, Promise<Messages>>();

/** Downloads the catalog of a language (once). main.tsx waits for the active one before the first render. */
export function loadCatalog(language: Language): Promise<Messages> {
  const loaded = catalogs[language];
  if (loaded) return Promise.resolve(loaded);
  let pending = loading.get(language);
  if (!pending) {
    pending = loaders[language]().then((messages) => {
      catalogs[language] = messages;
      return messages;
    });
    // A failed download (network) can be retried by the next call.
    pending.catch(() => loading.delete(language));
    loading.set(language, pending);
  }
  return pending;
}

/** Every catalog: the command palette searches labels in all languages. */
export async function loadAllCatalogs(): Promise<void> {
  await Promise.all(LANGUAGES.map(loadCatalog));
}

/** True once every language is there (the command search matches labels in all of them). */
export const allCatalogsLoaded = (): boolean => LANGUAGES.every((l) => catalogs[l]);

const lookup = (language: Language, key: MessageKey): string =>
  catalogs[language]?.[key] ?? catalogs.en?.[key] ?? key;

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
  return lookup(language, key);
}

let current: Language = detectLanguage();
const listeners = new Set<() => void>();

function syncDocument(): void {
  document.documentElement.lang = current;
}
syncDocument();

/**
 * Switches the UI language. The catalog is downloaded first when needed (the screen keeps the previous language
 * until it is there); the returned promise settles once the switch is done.
 */
export function setLanguage(language: Language): Promise<void> {
  if (catalogs[language]) {
    apply(language);
    return Promise.resolve();
  }
  return loadCatalog(language).then(() => apply(language));
}

function apply(language: Language): void {
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
  setLanguage: (language: Language) => Promise<void>;
} {
  const language = useSyncExternalStore(subscribe, () => current);
  return { language, t: (key) => lookup(language, key), setLanguage };
}

/** Fills `{name}` placeholders of a message. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
