import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { listScores, type ScoreListItem } from '../api/scores';
import { useSession } from '../auth/session';
import { settleSaves } from '../persistence/saveQueue';

export const PAGE_SIZE = 50;
export const SEARCH_DEBOUNCE_MS = 250;

export interface LibraryState {
  items: ScoreListItem[];
  total: number;
  status: 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  /** The search text the items answer. */
  query: string;
}

/**
 * The list of scores: server-side title search (debounced, stale answers dropped), paging by "load more" or by
 * scrolling, and local edits (rename, duplicate, delete) that spare a round trip to the list.
 */
export function useLibrary(search: string) {
  const { expire } = useSession();
  const [state, setState] = useState<LibraryState>({
    items: [],
    total: 0,
    status: 'loading',
    loadingMore: false,
    query: '',
  });
  const [attempt, setAttempt] = useState(0);
  const page = useRef(1);
  const controller = useRef<AbortController | null>(null);
  const query = useRef('');
  const lastSearch = useRef(search);
  const busy = useRef(false);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) expire();
    },
    [expire],
  );

  // New search text (debounced): first page again.
  useEffect(() => {
    const immediate = search === lastSearch.current;
    const timer = setTimeout(
      () => {
        lastSearch.current = search;
        busy.current = false;
        controller.current?.abort();
        const abort = new AbortController();
        controller.current = abort;
        query.current = search.trim();
        page.current = 1;
        setState((s) => ({ ...s, status: s.items.length === 0 ? 'loading' : s.status }));
        void (async () => {
          try {
            // Coming back from the editor: let its last save land before reading the list.
            await settleSaves();
            const result = await listScores({
              q: query.current,
              pageSize: PAGE_SIZE,
              signal: abort.signal,
            });
            if (abort.signal.aborted) return;
            setState({
              items: result.items,
              total: result.total,
              status: 'ready',
              loadingMore: false,
              query: query.current,
            });
          } catch (error) {
            if (abort.signal.aborted) return;
            handleError(error);
            setState((s) => ({ ...s, status: 'error', loadingMore: false }));
          }
        })();
      },
      immediate ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [search, attempt, handleError]);

  useEffect(() => () => controller.current?.abort(), []);

  const loadMore = useCallback(() => {
    const abort = controller.current;
    const s = latest.current;
    if (!abort || abort.signal.aborted || busy.current) return;
    if (s.status !== 'ready' || s.items.length >= s.total) return;
    busy.current = true;
    page.current += 1;
    setState((current) => ({ ...current, loadingMore: true }));
    listScores({ q: query.current, page: page.current, pageSize: PAGE_SIZE, signal: abort.signal })
      .then((result) => {
        if (abort.signal.aborted) return;
        setState((current) => {
          const known = new Set(current.items.map((i) => i.id));
          return {
            ...current,
            items: [...current.items, ...result.items.filter((i) => !known.has(i.id))],
            total: result.total,
            loadingMore: false,
          };
        });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        handleError(error);
        page.current -= 1;
        setState((current) => ({ ...current, loadingMore: false }));
      })
      .finally(() => {
        busy.current = false;
      });
  }, [handleError]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const update = useCallback((id: string, patch: Partial<ScoreListItem>) => {
    setState((s) => ({
      ...s,
      items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  }, []);

  /** Puts a score first (a copy, or a renamed one: last modified is now). */
  const putFirst = useCallback((item: ScoreListItem) => {
    setState((s) => {
      const exists = s.items.some((i) => i.id === item.id);
      return {
        ...s,
        items: [item, ...s.items.filter((i) => i.id !== item.id)],
        total: exists ? s.total : s.total + 1,
      };
    });
  }, []);

  const remove = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      items: s.items.filter((i) => i.id !== id),
      total: Math.max(0, s.total - 1),
    }));
  }, []);

  return { state, loadMore, retry, update, putFirst, remove, handleError };
}
