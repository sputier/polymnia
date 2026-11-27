import { useSyncExternalStore } from 'react';

export type Route = 'home' | 'editor';

// Hash routing: two screens do not justify a router dependency.
function read(): Route {
  return window.location.hash.startsWith('#/editor') ? 'editor' : 'home';
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, read, () => 'home' as Route);
}

export const ROUTE_HREF: Record<Route, string> = { home: '#/', editor: '#/editor' };
