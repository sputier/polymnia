import { useEffect, useRef } from 'react';
import { shortcuts, type Shortcut } from './registry';

/** Registers shortcuts for the lifetime of the component and listens on `document`. */
export function useShortcuts(list: Shortcut[]): void {
  // Handlers are read through a ref so callers can pass fresh closures every render.
  const ref = useRef(list);
  useEffect(() => {
    ref.current = list;
  });

  const signature = list.map((s) => `${s.id}:${s.keys}:${s.allowInInput ? 1 : 0}`).join('|');
  useEffect(() => {
    const unregister = ref.current.map((s) =>
      shortcuts.register({
        ...s,
        handler: (event) => ref.current.find((x) => x.id === s.id)?.handler(event),
      }),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      shortcuts.handle(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unregister.forEach((off) => off());
    };
  }, [signature]);
}
