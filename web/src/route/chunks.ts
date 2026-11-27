import { preloadable } from './preloadable';
import type { Route } from './useRoute';

/**
 * The lazy screens. The first load only holds React, the session check, the sign-in screen and the active
 * language: each screen below is downloaded when its route is first shown (docs/development.md, "Bundle").
 * The library never loads the editor and the editor never loads the library.
 */
export const Library = preloadable(
  () => import('../library/Library'),
  (m) => m.Library,
);
/** A stored score: the editor, its autosave and the persistence glue. */
export const ScoreEditorRoute = preloadable(
  () => import('../persistence/ScoreEditorRoute'),
  (m) => m.ScoreEditorRoute,
);
/** The scratch editor (`#/editor`). Shares the editor modules with the stored score. */
export const ScratchEditor = preloadable(
  () => import('../editor/EditorLayout'),
  (m) => m.EditorLayout,
);
export const SharedViewer = preloadable(
  () => import('../sharing/Viewer'),
  (m) => m.SharedViewer,
);

/** The command palette and the shortcut sheet (Ctrl+K), in the library and in the editor. */
export const CommandDialogs = preloadable(
  () => import('../editor/commands/CommandDialogs'),
  (m) => m.default,
);
/** Library dialogs that pull in the score model or import/export: fetched in idle time after the first paint. */
export const NewScoreDialog = preloadable(
  () => import('../library/NewScoreDialog'),
  (m) => m.NewScoreDialog,
);
export const LibraryShare = preloadable(
  () => import('../sharing/LibraryShare'),
  (m) => m.LibraryShare,
);

/** Starts downloading the chunk of a route, in parallel with whatever else the page is waiting for. */
export function preloadRoute(route: Route): void {
  const screen =
    route.name === 'library'
      ? Library
      : route.name === 'score'
        ? ScoreEditorRoute
        : route.name === 'editor'
          ? ScratchEditor
          : route.name === 'shared'
            ? SharedViewer
            : undefined;
  screen?.preload().catch(() => undefined); // the lazy boundary retries and reports it
}

let editorPrefetched = false;

/**
 * Prefetches what opening a score needs (the editor screen, then the engraver with VexFlow) once the browser is
 * idle, so that the next navigation is instant. Safe to call more than once.
 */
export function prefetchEditor(): void {
  if (editorPrefetched) return;
  editorPrefetched = true;
  const run = () => {
    void Promise.all([ScoreEditorRoute.preload(), ScratchEditor.preload()])
      .then(() => import('../engraving/engraver'))
      .catch(() => {
        editorPrefetched = false; // offline: try again at the next call
      });
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
