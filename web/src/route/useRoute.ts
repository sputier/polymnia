import { useMemo, useSyncExternalStore } from 'react';

/**
 * `library` is the signed-in home (`#/`), `score` opens a stored score (`#/scores/<id>`) and `editor` is the
 * scratch editor (`#/editor`, never saved: previews, fixtures and tests use it).
 */
export type Route =
  | { readonly name: 'library' }
  | { readonly name: 'editor' }
  | { readonly name: 'score'; readonly id: string }
  | { readonly name: 'shared'; readonly token: string }
  | { readonly name: 'privacy' }
  | { readonly name: 'contact' };

// Hash routing: three screens do not justify a router dependency.
function read(): string {
  return window.location.hash.split('?')[0] ?? '';
}

export function parseRoute(hash: string): Route {
  const path = hash.split('?')[0] ?? '';
  const score = /^#\/scores\/([^/]+)\/?$/.exec(path);
  if (score) {
    try {
      return { name: 'score', id: decodeURIComponent(score[1]!) };
    } catch {
      // A malformed escape ("#/scores/%") in a crafted link: the library, never an unhandled error that blanks the app.
      return { name: 'library' };
    }
  }
  // The public viewer of a share link (docs/sharing.md). The token is in the fragment, which a browser never sends:
  // it stays out of server logs and of Referer.
  const shared = /^#\/s\/([A-Za-z0-9_-]{1,128})\/?$/.exec(path);
  if (shared) return { name: 'shared', token: shared[1]! };
  if (path.startsWith('#/editor')) return { name: 'editor' };
  if (/^#\/privacy\/?$/.test(path)) return { name: 'privacy' };
  // The contact form (docs/contact.md): public. `?topic=report&page=<token>` prefills it, read by the page itself.
  if (/^#\/contact\/?$/.test(path)) return { name: 'contact' };
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

export const ROUTE_HREF = {
  home: '#/',
  editor: '#/editor',
  privacy: '#/privacy',
  contact: '#/contact',
} as const;

/** The contact form prefilled to report a shared page. The token is the shared page's own, shown to the sender. */
export const reportHref = (token: string): string =>
  `#/contact?topic=report&page=${encodeURIComponent(token)}`;

export const sharedHref = (token: string): string => `#/s/${encodeURIComponent(token)}`;

export const scoreHref = (id: string): string => `#/scores/${encodeURIComponent(id)}`;

export function navigate(href: string): void {
  window.location.hash = href.startsWith('#') ? href.slice(1) : href;
}
