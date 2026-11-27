import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  /** Called on Escape and by the dialog's own close actions. */
  onClose: () => void;
  children: ReactNode;
  /** Buttons, right aligned. The element with `data-autofocus` gets the initial focus. */
  actions: ReactNode;
  role?: 'dialog' | 'alertdialog';
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Modal dialog: labelled, focus moves in and is trapped, Escape closes, focus returns on close. */
export function Modal({ title, onClose, children, actions, role = 'dialog' }: ModalProps) {
  const titleId = useId();
  const bodyId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const first =
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        <div id={bodyId} className="modal-body">
          {children}
        </div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}
