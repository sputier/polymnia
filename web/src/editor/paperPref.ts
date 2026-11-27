import { useSyncExternalStore } from 'react';

export type Paper = 'a4' | 'letter';

const KEY = 'polymnia.paper';
const LETTER_REGIONS = new Set([
  'US',
  'CA',
  'MX',
  'PH',
  'CL',
  'CO',
  'VE',
  'CR',
  'GT',
  'PA',
  'DO',
  'PR',
]);
const listeners = new Set<() => void>();
let current: Paper | undefined;

/** Letter in the countries that use it, A4 everywhere else (from the browser language). */
export function defaultPaper(
  language = typeof navigator === 'undefined' ? '' : navigator.language,
): Paper {
  const region = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(language)?.[1]?.toUpperCase();
  return region && LETTER_REGIONS.has(region) ? 'letter' : 'a4';
}

export function getPaper(): Paper {
  if (current) return current;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: fall back to the locale default.
  }
  current = stored === 'a4' || stored === 'letter' ? stored : defaultPaper();
  return current;
}

export function setPaper(paper: Paper): void {
  current = paper;
  try {
    localStorage.setItem(KEY, paper);
  } catch {
    // Not persisted: the choice still holds for this session.
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePaper(): Paper {
  return useSyncExternalStore(subscribe, getPaper, getPaper);
}
