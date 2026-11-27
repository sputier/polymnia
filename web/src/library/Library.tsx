import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { duplicateScore, renameScore, type ScoreListItem } from '../api/scores';
import { AccountMenu } from '../auth/AccountMenu';
import { useSession } from '../auth/session';
import { ApiError } from '../api/client';
import { Icon } from '../components/Icon';
import { Kbd } from '../components/Kbd';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import type { DialogKind } from '../editor/commands/CommandDialogs';
import { format, useI18n } from '../i18n/i18n';
import { navigate, scoreHref } from '../route/useRoute';
import type { Shortcut } from '../shortcuts/registry';
import { useShortcuts } from '../shortcuts/useShortcuts';
import { cancelDelete, scheduleDelete, UNDO_WINDOW_MS } from './deferredDelete';
import { NewScoreDialog } from './NewScoreDialog';
import { RenameDialog, ShareDialog } from './dialogs';
import { ScoreCard, type CardAction } from './ScoreCard';
import { describeFailure } from './text';
import { useLibrary } from './useLibrary';

const loadCommandDialogs = () => import('../editor/commands/CommandDialogs');
const CommandDialogs = lazy(loadCommandDialogs);

interface Toast {
  id: number;
  text: string;
  undo?: () => void;
}

type Modal =
  | { kind: 'new' }
  | { kind: 'rename'; score: ScoreListItem }
  | { kind: 'share'; score: ScoreListItem };

/** The signed-in home: the user's scores, search, creation and the per-score actions. */
export function Library() {
  const { t } = useI18n();
  const { expire } = useSession();
  const [search, setSearch] = useState('');
  const { state, loadMore, retry, putFirst, remove } = useLibrary(search);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<Modal | null>(null);
  const [palette, setPalette] = useState<DialogKind | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const toastId = useRef(0);

  const visible = useMemo(
    () => state.items.filter((i) => !hidden.has(i.id)),
    [state.items, hidden],
  );
  const total = Math.max(0, state.total - hidden.size);
  const countLabel = format(t(total === 1 ? 'library.countOne' : 'library.countMany'), {
    n: total,
  });

  const toast = useCallback((text: string, undo?: () => void) => {
    const id = ++toastId.current;
    setToasts((all) => [...all.slice(-2), { id, text, ...(undo ? { undo } : {}) }]);
    setTimeout(
      () => setToasts((all) => all.filter((x) => x.id !== id)),
      undo ? UNDO_WINDOW_MS : 5000,
    );
    return id;
  }, []);
  const dismiss = (id: number) => setToasts((all) => all.filter((x) => x.id !== id));

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) return expire();
      const { key, seconds } = describeFailure(error);
      toast(format(t(key), { n: seconds ?? 0 }));
    },
    [expire, t, toast],
  );

  // Idle-time fetch of the palette chunk, so Ctrl+K opens instantly.
  useEffect(() => {
    const load = () => void loadCommandDialogs();
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(load);
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(load, 200);
    return () => clearTimeout(id);
  }, []);

  // Scroll to the end of the list loads the next page.
  const sentinel = useRef<HTMLDivElement>(null);
  const hasMore = state.items.length < state.total;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, state.items.length]);

  const openNew = useCallback(() => setModal({ kind: 'new' }), []);

  const shortcutList: Shortcut[] = [
    {
      id: 'app.palette',
      keys: 'Mod+K',
      labelKey: 'shortcut.palette',
      group: 'help',
      palette: false,
      allowInInput: true,
      handler: () => setPalette('palette'),
    },
    {
      id: 'app.cheatSheet',
      keys: 'Question',
      labelKey: 'shortcut.cheatSheet',
      group: 'help',
      handler: () => setPalette('sheet'),
    },
    {
      id: 'library.new',
      keys: 'N',
      labelKey: 'shortcut.newScore',
      group: 'file',
      handler: openNew,
    },
    {
      id: 'library.search',
      keys: 'Slash',
      labelKey: 'shortcut.searchScores',
      group: 'navigation',
      handler: () => searchInput.current?.focus(),
    },
  ];
  useShortcuts(shortcutList);

  const act = (action: CardAction, score: ScoreListItem) => {
    if (action === 'rename') setModal({ kind: 'rename', score });
    else if (action === 'share') setModal({ kind: 'share', score });
    else if (action === 'duplicate') void duplicate(score);
    else deleteWithUndo(score);
  };

  const duplicate = async (score: ScoreListItem) => {
    try {
      const copy = await duplicateScore(score.id);
      putFirst({ ...copy, measureCount: score.measureCount, instruments: score.instruments });
      toast(format(t('library.duplicated'), { title: copy.title }));
    } catch (error) {
      fail(error);
    }
  };

  const rename = async (score: ScoreListItem, title: string) => {
    setModal(null);
    try {
      const saved = await renameScore(score.id, title, score.version);
      putFirst({
        ...score,
        title: saved.title,
        version: saved.version,
        updatedAt: saved.updatedAt,
      });
      toast(t('library.renamed'));
    } catch (error) {
      // 409: the score was saved from the editor meanwhile. The list is stale: read it again.
      if (error instanceof ApiError && error.status === 409) retry();
      fail(error);
    }
  };

  const deleteWithUndo = (score: ScoreListItem) => {
    // Focus moves to the next card (or the previous one) so the keyboard is not lost with the card.
    const index = visible.findIndex((i) => i.id === score.id);
    const next = visible[index + 1] ?? visible[index - 1];
    setActiveId(next?.id ?? null);
    setHidden((set) => new Set(set).add(score.id));
    requestAnimationFrame(() =>
      next
        ? list.current
            ?.querySelector<HTMLElement>(`[data-score-id="${next.id}"] .card-open`)
            ?.focus()
        : searchInput.current?.focus(),
    );
    const unhide = () =>
      setHidden((set) => {
        const copy = new Set(set);
        copy.delete(score.id);
        return copy;
      });
    const toastKey = toast(format(t('library.deleted'), { title: score.title }), () => {
      if (cancelDelete(score.id)) unhide();
    });
    scheduleDelete(score.id, (error) => {
      if (error) {
        unhide();
        fail(error);
      } else {
        remove(score.id);
        unhide();
      }
      dismiss(toastKey);
    });
  };

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('card-open')) return;
    const cards = [...event.currentTarget.querySelectorAll<HTMLElement>('.card-open')];
    const at = cards.indexOf(target);
    let next: HTMLElement | undefined;
    const rect = target.getBoundingClientRect();
    if (event.key === 'ArrowRight') next = cards[at + 1];
    else if (event.key === 'ArrowLeft') next = cards[at - 1];
    else if (event.key === 'Home') next = cards[0];
    else if (event.key === 'End') next = cards[cards.length - 1];
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const down = event.key === 'ArrowDown';
      const rows = cards
        .map((card) => ({ card, box: card.getBoundingClientRect() }))
        .filter(({ box }) => (down ? box.top > rect.top + 4 : box.top < rect.top - 4));
      if (rows.length > 0) {
        const rowTop = down
          ? Math.min(...rows.map((r) => r.box.top))
          : Math.max(...rows.map((r) => r.box.top));
        next = rows
          .filter((r) => Math.abs(r.box.top - rowTop) < 4)
          .sort(
            (a, b) => Math.abs(a.box.left - rect.left) - Math.abs(b.box.left - rect.left),
          )[0]?.card;
      }
    } else return;
    event.preventDefault();
    next?.focus();
  };

  const tabbableId = activeId && visible.some((i) => i.id === activeId) ? activeId : visible[0]?.id;

  return (
    <div className="lib">
      <header className="toolbar lib-top">
        <span className="brand">{t('app.name')}</span>
        <label className="lib-search">
          <Icon name="search" />
          <input
            ref={searchInput}
            type="search"
            value={search}
            aria-label={t('library.search')}
            placeholder={t('library.searchPlaceholder')}
            autoComplete="off"
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              if (search) setSearch('');
              else event.currentTarget.blur();
              event.stopPropagation();
            }}
          />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <div className="toolbar-actions">
          <button type="button" className="btn primary" onClick={openNew}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="lbl">{t('library.new')}</span> <Kbd keys="N" />
          </button>
          <button
            type="button"
            className="btn ghost icon"
            aria-label={t('cmd.openLabel')}
            aria-haspopup="dialog"
            onClick={() => setPalette('palette')}
          >
            <span aria-hidden="true">⌘</span>
          </button>
          <AccountMenu />
          <LanguageSwitch />
          <ThemeSwitch />
        </div>
      </header>

      <main className="lib-main">
        <div className="lib-head">
          <h1>{t('library.title')}</h1>
          {state.status === 'ready' && <span className="muted">{countLabel}</span>}
        </div>
        {/* Search results and deletions are announced once, politely. */}
        <p className="visually-hidden" role="status" aria-live="polite">
          {state.status === 'ready' ? countLabel : ''}
        </p>

        {state.status === 'loading' && <p className="muted">{t('library.loading')}</p>}
        {state.status === 'error' && (
          <div role="alert" className="lib-empty">
            <p>{t('library.loadError')}</p>
            <button type="button" className="btn" onClick={retry}>
              {t('auth.retry')}
            </button>
          </div>
        )}
        {state.status === 'ready' && visible.length === 0 && !hasMore && (
          <div className="lib-empty">
            {state.query ? (
              <p>{format(t('library.noMatch'), { q: state.query })}</p>
            ) : (
              <>
                <h2>{t('library.emptyTitle')}</h2>
                <p>{t('library.emptyText')}</p>
                <button type="button" className="btn primary" onClick={openNew}>
                  {t('library.new')}
                </button>
              </>
            )}
          </div>
        )}
        {visible.length > 0 && (
          <ul ref={list} className="grid" aria-label={t('library.list')} onKeyDown={onGridKeyDown}>
            {visible.map((score) => (
              <ScoreCard
                key={score.id}
                score={score}
                tabbable={score.id === tabbableId}
                onFocusCard={() => setActiveId(score.id)}
                onAction={act}
              />
            ))}
          </ul>
        )}
        {hasMore && state.status === 'ready' && (
          <div ref={sentinel} className="lib-more">
            <button type="button" className="btn" disabled={state.loadingMore} onClick={loadMore}>
              {t('library.loadMore')}
            </button>
          </div>
        )}
      </main>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div className="toast" key={item.id}>
            <span>{item.text}</span>
            {item.undo && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  item.undo?.();
                  dismiss(item.id);
                }}
              >
                {t('library.undo')}
              </button>
            )}
          </div>
        ))}
      </div>

      {modal?.kind === 'new' && (
        <NewScoreDialog
          onClose={() => setModal(null)}
          onCreated={(id) => {
            setModal(null);
            navigate(scoreHref(id));
          }}
        />
      )}
      {modal?.kind === 'rename' && (
        <RenameDialog
          title={modal.score.title}
          onClose={() => setModal(null)}
          onSubmit={(title) => void rename(modal.score, title)}
        />
      )}
      {modal?.kind === 'share' && (
        <ShareDialog title={modal.score.title} onClose={() => setModal(null)} />
      )}
      {palette && (
        <Suspense fallback={null}>
          <CommandDialogs dialog={palette} onClose={() => setPalette(null)} onOpen={setPalette} />
        </Suspense>
      )}
    </div>
  );
}
