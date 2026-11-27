import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  className: string;
  /** Id of the element that names the dialog. */
  labelledBy: string;
  onClose: () => void;
  /** Extra keys (checked before the built-in ones); return true when handled. */
  onKey?: (event: KeyboardEvent<HTMLDivElement>) => boolean;
  children: ReactNode;
}

/**
 * Modal dialog: `role="dialog"` with `aria-modal`, focus moves in, Tab stays inside, Esc and a
 * click on the backdrop close it, focus goes back to where it was. Rendered in a portal so the
 * print stylesheet can show it alone. While it is open the shortcut registry ignores the keyboard
 * (it looks for `aria-modal`).
 */
export function Dialog({ className, labelledBy, onClose, onKey, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    (
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      root?.querySelector<HTMLElement>(FOCUSABLE)
    )?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (onKey?.(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return event.preventDefault();
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !ref.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !ref.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return createPortal(
    <div
      className="dlg-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dlg ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
