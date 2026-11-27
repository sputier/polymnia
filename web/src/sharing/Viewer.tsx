import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSheetView } from '../components/useSheetView';
import { ViewToggle } from '../components/ViewToggle';
import { ChordSheet } from '../route/chunks';
import { ApiError } from '../api/client';
import { isNetworkError } from '../api/scores';
import { loadSharedScore } from '../api/shares';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { TransportBar } from '../editor/TransportBar';
import type { Engraver } from '../engraving/engraver';
import { ScoreView } from '../engraving/ScoreView';
import { useI18n } from '../i18n/i18n';
import { playback } from '../playback';
import { followPlayback } from '../playback/follow';
import { deserialize, type Score } from '../score';
import { useShortcuts } from '../shortcuts/useShortcuts';
import type { Shortcut } from '../shortcuts/registry';

type Loaded =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; reason: 'rate' | 'failed' | 'corrupt' }
  | { kind: 'ready'; score: Score };

/** Adds a `<meta>` to the head for as long as the viewer is shown. */
function useHeadMeta(name: string, content: string): void {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = name;
    meta.content = content;
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [name, content]);
}

const STATIC_SHORTCUTS: Shortcut[] = [
  {
    id: 'playback.playPause',
    keys: 'Space',
    labelKey: 'shortcut.playPause',
    group: 'playback',
    handler: (event) => {
      // A focused button or link takes Space itself (it activates on its own).
      const target = event?.target;
      if (
        target instanceof HTMLElement &&
        target.closest('button, a, summary, [role=button], input')
      )
        return false;
      playback.toggle();
    },
  },
  {
    id: 'playback.home',
    keys: 'Home',
    labelKey: 'shortcut.playHome',
    group: 'playback',
    handler: () => playback.home(),
  },
];

/**
 * The public, read-only page of a share link (`#/s/<token>`). It works signed out: no session request, no sign-in
 * screen, no editing interface. It shows the score and the playback bar, nothing else. The engraving and the audio
 * engine are lazy chunks, as in the editor.
 */
export function SharedViewer({ token }: { token: string }) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [engraver, setEngraver] = useState<Engraver | null>(null);
  const sheetView = useSheetView(engraver);

  // Never indexed, and no Referer from this page (the link is a credential).
  useHeadMeta('robots', 'noindex, nofollow');
  useHeadMeta('referrer', 'no-referrer');

  useEffect(() => {
    const controller = new AbortController();
    loadSharedScore(token, controller.signal).then(
      (text) => {
        if (controller.signal.aborted) return;
        try {
          setLoaded({ kind: 'ready', score: deserialize(text) });
        } catch {
          setLoaded({ kind: 'error', reason: 'corrupt' });
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) setLoaded({ kind: 'invalid' });
        else if (error instanceof ApiError && error.status === 429) {
          setLoaded({ kind: 'error', reason: 'rate' });
        } else if (error instanceof ApiError || isNetworkError(error)) {
          setLoaded({ kind: 'error', reason: 'failed' });
        } else setLoaded({ kind: 'error', reason: 'corrupt' });
      },
    );
    return () => controller.abort();
  }, [token, attempt]);

  const score = loaded.kind === 'ready' ? loaded.score : null;
  useEffect(() => {
    if (!score) return;
    playback.setScore(score);
    // Test hook, as in the editor (docs/playback.md).
    const w = window as unknown as { __polymnia?: Record<string, unknown> };
    w.__polymnia = { ...w.__polymnia, playback };
    return () => playback.stop();
  }, [score]);
  useEffect(() => (engraver ? followPlayback(playback, engraver) : undefined), [engraver]);

  // The audio engine is a lazy chunk: start fetching it at the first interaction (also what lets audio start).
  useEffect(() => {
    const warm = () => playback.warmUp();
    const opts = { once: true, capture: true } as const;
    document.addEventListener('pointerdown', warm, opts);
    document.addEventListener('keydown', warm, opts);
    return () => {
      document.removeEventListener('pointerdown', warm, opts);
      document.removeEventListener('keydown', warm, opts);
    };
  }, []);

  const title = score?.meta.title ?? '';
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${t('app.name')}`;
    return () => {
      document.title = previous;
    };
  }, [title, t]);

  useShortcuts(score ? STATIC_SHORTCUTS : []);
  const retry = useCallback(() => {
    setLoaded({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <a className="brand viewer-brand" href="/">
          {t('viewer.madeWith')}
        </a>
        <span className="viewer-badge">{t('viewer.readOnly')}</span>
        <span className="sp" />
        {score && <ViewToggle view={sheetView.view} onChange={sheetView.setView} />}
        <LanguageSwitch />
        <ThemeSwitch />
      </header>

      {loaded.kind === 'loading' && (
        <main className="route-message">
          <p role="status">{t('viewer.loading')}</p>
        </main>
      )}

      {loaded.kind === 'invalid' && (
        <main className="route-message">
          <div role="alert">
            <h1>{t('viewer.invalid')}</h1>
            <p className="muted">{t('viewer.invalidHint')}</p>
          </div>
        </main>
      )}

      {loaded.kind === 'error' && (
        <main className="route-message">
          <p role="alert">
            {t(
              loaded.reason === 'rate'
                ? 'viewer.rate'
                : loaded.reason === 'corrupt'
                  ? 'viewer.corrupt'
                  : 'viewer.failed',
            )}
          </p>
          {loaded.reason !== 'corrupt' && (
            <p>
              <button type="button" className="btn" onClick={retry}>
                {t('auth.retry')}
              </button>
            </p>
          )}
        </main>
      )}

      {score && (
        <main className="viewer-main">
          <TransportBar controller={playback} selection={[]} />
          <div className="score-area">
            <section className="paper" aria-label={t('paper.label')}>
              <h1 className="ptitle">{score.meta.title || t('editor.untitled')}</h1>
              {sheetView.view === 'sheet' ? (
                <Suspense
                  fallback={
                    <p className="muted" role="status">
                      {t('sheet.loading')}
                    </p>
                  }
                >
                  <ChordSheet
                    score={score}
                    onMeasure={sheetView.openMeasure}
                    partId={sheetView.sheetPart}
                    onPartChange={sheetView.setSheetPart}
                  />
                </Suspense>
              ) : (
                <ScoreView score={score} onEngraver={setEngraver} />
              )}
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
