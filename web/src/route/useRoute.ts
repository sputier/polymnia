import { useMemo, useSyncExternalStore } from 'react';

/**
 * `library` is the signed-in home (`#/`), `score` opens a stored score (`#/scores/<id>`) and `editor` is the
 * scratch editor (`#/editor`, never saved: previews, fixtures and tests use it).
 */
export type Route =
  | { readonly name: 'library' }
  | { readonly name: 'editor' }
  | { readonly name: 'score'; readonly id: string };

// Hash routing: three screens do not justify a router dependency.
function read(): string {
  return window.location.hash.split('?')[0] ?? '';
}

export function parseRoute(hash: string): Route {
  const path = hash.split('?')[0] ?? '';
  const score = /^#\/scores\/([^/]+)\/?$/.exec(path);
  if (score) return { name: 'score', id: decodeURIComponent(score[1]!) };
  if (path.startsWith('#/editor')) return { name: 'editor' };
  return { name: 'library' };
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, read, () => '');
  return useMemo(() => parseRoute(hash), [hash]);
}

export const ROUTE_HREF = { home: '#/', editor: '#/editor' } as const;

export const scoreHref = (id: string): string => `#/scores/${encodeURIComponent(id)}`;

export function navigate(href: string): void {
  window.location.hash = href.startsWith('#') ? href.slice(1) : href;
}
