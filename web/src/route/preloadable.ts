import { createElement, lazy, useState, type ComponentType, type FunctionComponent } from 'react';

/** A lazy component that can be downloaded ahead of time and then renders without suspending. */
export type Preloadable<P> = FunctionComponent<P> & {
  /** Starts the download (once). Resolves when the component is ready. */
  preload: () => Promise<void>;
};

/**
 * `React.lazy` with a way out of the Suspense fallback. React keeps a fallback on screen for at least 300 ms before
 * it reveals the content, even when the chunk arrived a millisecond later: a screen that was preloaded (route chunk
 * requested at start-up, dialogs fetched in idle time) must therefore render directly once `preload()` resolved.
 * Until then it behaves exactly like `lazy`, so a surrounding `<Suspense>` is still required.
 */
export function preloadable<M, P extends object>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<P>,
): Preloadable<P> {
  let ready: ComponentType<P> | undefined;
  let pending: Promise<void> | undefined;
  const preload = (): Promise<void> => {
    pending ??= load().then(
      (module) => {
        ready = pick(module);
      },
      (error: unknown) => {
        pending = undefined; // a failed download can be retried
        throw error;
      },
    );
    return pending;
  };
  const Lazy = lazy(() => preload().then(() => ({ default: ready! })));
  const Component = (props: P) => {
    // Decided once per mount: swapping the element type later would remount the screen and lose its state.
    const [type] = useState(() => ready ?? Lazy);
    return createElement(type, props);
  };
  Component.preload = preload;
  return Component as Preloadable<P>;
}
