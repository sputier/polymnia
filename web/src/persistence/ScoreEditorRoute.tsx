import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../api/client';
import { isNetworkError, loadScore, renameScore, saveScore } from '../api/scores';
import { EditorLayout } from '../editor/EditorLayout';
import { EditorStore } from '../editor/entry/editorStore';
import { useI18n } from '../i18n/i18n';
import { deserialize, serialize, type Score } from '../score';
import { SaveNotices } from './SaveNotices';
import { SaveQueue, settleSaves, type SaveBackend } from './saveQueue';
import { ROUTE_HREF } from '../route/useRoute';

/** The title the server accepts: trimmed, no control characters, at most 200 characters, never empty. */
export function storedTitle(title: string, untitled: string): string {
  const clean = [...title]
    .filter((c) => {
      const code = c.codePointAt(0)!;
      return code > 0x1f && (code < 0x7f || code > 0x9f);
    })
    .join('')
    .trim()
    .slice(0, 200)
    .trim();
  return clean || untitled;
}

interface Session {
  store: EditorStore;
  queue: SaveQueue;
  /** Replaces the document with the server's (conflict: "load the server version"). */
  reload: () => Promise<void>;
  initialTitle: string;
  /** Tells the queue which title to save. */
  setTitle: (title: string) => void;
}

type Loaded =
  | { kind: 'loading' }
  | { kind: 'error'; reason: 'not-found' | 'corrupt' | 'failed' }
  | { kind: 'ready'; session: Session };

function backendFor(id: string): SaveBackend {
  return {
    saveContent: (text, version) => saveScore(id, text, version),
    rename: (title, version) => renameScore(id, title, version),
    currentVersion: async () => (await loadScore(id)).version,
  };
}

/** Fetch and deserialize the score, then wire the editor store to a save queue. */
function useScoreSession(
  id: string,
  untitledRef: { readonly current: string },
): { loaded: Loaded; retry: () => void } {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const titleRef = useRef('');

  useEffect(() => {
    const controller = new AbortController();
    let queue: SaveQueue | undefined;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        // The score may have been saved a moment ago from the editor we just left.
        await settleSaves();
        const started = performance.now();
        const { text, version } = await loadScore(id, controller.signal);
        const score = deserialize(text);
        performance.measure('score-open', { start: started });
        if (controller.signal.aborted) return;

        const store = new EditorStore(score);
        titleRef.current = score.meta.title;
        const content = (): string =>
          serialize(
            withTitle(store.getState().score, storedTitle(titleRef.current, untitledRef.current)),
          );
        queue = new SaveQueue({
          backend: backendFor(id),
          getContent: content,
          getTitle: () => storedTitle(titleRef.current, untitledRef.current),
          version,
        });
        let last = store.getState().score;
        let paused = false;
        unsubscribe = store.subscribe(() => {
          const now = store.getState().score;
          if (now === last) return;
          last = now;
          if (!paused) queue?.touch();
        });
        const q = queue;
        const reload = async () => {
          const fresh = await loadScore(id);
          const replaced = deserialize(fresh.text);
          paused = true;
          try {
            store.loadScore(replaced);
            last = store.getState().score;
          } finally {
            paused = false;
          }
          titleRef.current = replaced.meta.title;
          q.adopt(fresh.version);
        };
        setLoaded({
          kind: 'ready',
          session: {
            store,
            queue: q,
            reload,
            initialTitle: score.meta.title,
            setTitle: (value) => {
              titleRef.current = value;
            },
          },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setLoaded({ kind: 'error', reason: 'not-found' });
        } else if (error instanceof ApiError || isNetworkError(error)) {
          setLoaded({ kind: 'error', reason: 'failed' });
        } else {
          setLoaded({ kind: 'error', reason: 'corrupt' });
        }
      }
    })();

    return () => {
      controller.abort();
      unsubscribe?.();
      // Leaving the editor never loses a save: the queue finishes (and retries) on its own.
      queue?.release();
    };
  }, [id, untitledRef, attempt]);

  return {
    loaded,
    retry: () => {
      setLoaded({ kind: 'loading' });
      setAttempt((n) => n + 1);
    },
  };
}

function withTitle(score: Score, title: string): Score {
  return { ...score, meta: { ...score.meta, title } };
}

/** The editor for a stored score (`#/scores/<id>`): loads it, autosaves it, handles conflicts and sign-in. */
export function ScoreEditorRoute({ id }: { id: string }) {
  const { t } = useI18n();
  // Read when saving, so changing the language never reloads the score.
  const untitledRef = useRef(t('editor.untitled'));
  useEffect(() => {
    untitledRef.current = t('editor.untitled');
  });
  const { loaded, retry } = useScoreSession(id, untitledRef);

  if (loaded.kind === 'loading') {
    return (
      <main className="route-message">
        <p role="status">{t('editor.loading')}</p>
      </main>
    );
  }
  if (loaded.kind === 'error') {
    return (
      <main className="route-message">
        <p role="alert">
          {t(
            loaded.reason === 'not-found'
              ? 'editor.notFound'
              : loaded.reason === 'corrupt'
                ? 'editor.corrupt'
                : 'editor.loadError',
          )}
        </p>
        <p>
          {loaded.reason === 'failed' && (
            <button type="button" className="btn" onClick={retry}>
              {t('auth.retry')}
            </button>
          )}{' '}
          <a className="btn" href={ROUTE_HREF.home}>
            {t('editor.backToLibrary')}
          </a>
        </p>
      </main>
    );
  }
  return <OpenScore key={id} id={id} session={loaded.session} />;
}

function OpenScore({ id, session }: { id: string; session: Session }) {
  const { t } = useI18n();
  const { store, queue } = session;
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const [title, setTitle] = useState(session.initialTitle);

  const changeTitle = useCallback(
    (next: string) => {
      setTitle(next);
      session.setTitle(next);
      queue.touchTitle();
    },
    [queue, session],
  );

  // Online again, tab hidden, signed in from another tab: the queue acts at once.
  useEffect(() => {
    const online = () => queue.retryNow();
    const visibility = () => {
      if (document.visibilityState === 'hidden') void queue.flush();
      else queue.resumeAfterSignIn();
    };
    window.addEventListener('online', online);
    window.addEventListener('focus', visibility);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('focus', visibility);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [queue]);

  const beforeLeave = useCallback((): boolean => {
    const { status, problem } = queue.getSnapshot();
    const stuck =
      queue.hasUnsavedWork &&
      (status === 'conflict' ||
        status === 'unauthorized' ||
        (status === 'error' && problem !== 'server'));
    return !stuck || window.confirm(t('save.leaveConfirm'));
  }, [queue, t]);

  return (
    <>
      <EditorLayout
        store={store}
        saveState={snapshot.status}
        title={title}
        onTitleChange={changeTitle}
        onSaveNow={() => void queue.flush()}
        onBeforeLeave={beforeLeave}
        scoreId={id}
      />
      <SaveNotices
        status={snapshot.status}
        problem={snapshot.problem}
        onKeepMine={() => queue.overwrite()}
        onReload={() => session.reload()}
        onResume={() => queue.resumeAfterSignIn()}
      />
    </>
  );
}
