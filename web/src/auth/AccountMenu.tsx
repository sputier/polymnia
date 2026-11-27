import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { clearReopenDelete, downloadExport, peekReopenDelete } from '../api/account';
import { ApiError } from '../api/client';
import { format, useI18n } from '../i18n/i18n';
import { useSession } from './session';

// The deletion dialog is rarely opened: it is its own chunk.
const DeleteAccountDialog = lazy(() => import('./DeleteAccountDialog'));

type Status = { kind: 'idle' } | { kind: 'working' | 'done' } | { kind: 'error'; message: string };

/**
 * Display name with a menu (privacy policy, data export, account deletion) and sign-out, in the toolbar.
 * Renders nothing for an anonymous visitor.
 */
export function AccountMenu() {
  const { state, signOut } = useSession();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Back from "sign in again": the deletion dialog was open before the redirect.
  const [deleting, setDeleting] = useState(peekReopenDelete);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  // The flag is read at mount and cleared once the dialog is up (a strict-mode double render must not lose it).
  useEffect(() => {
    clearReopenDelete();
  }, []);

  // Focus the first item on open; close on a click elsewhere.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && event.target !== button.current) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // A message that is not an error disappears by itself.
  useEffect(() => {
    if (status.kind !== 'done') return;
    const timer = setTimeout(() => setStatus({ kind: 'idle' }), 6000);
    return () => clearTimeout(timer);
  }, [status]);

  if (state.status !== 'signedIn') return null;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
    else if (event.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus();
    else if (event.key === 'Home') items[0]?.focus();
    else if (event.key === 'End') items[items.length - 1]?.focus();
    else if (event.key === 'Escape') close(true);
    else if (event.key === 'Tab') close(false);
    else return;
    if (event.key !== 'Tab') {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const exportData = async () => {
    close(true);
    setStatus({ kind: 'working' });
    try {
      await downloadExport();
      setStatus({ kind: 'done' });
    } catch (error) {
      setStatus({ kind: 'error', message: exportMessage(error) });
    }
  };

  const exportMessage = (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.status === 429) {
        return format(t('account.errorRateLimited'), { n: error.retryAfter ?? 60 });
      }
      return t('account.errorGeneric');
    }
    return error instanceof TypeError ? t('account.errorOffline') : t('account.exportEmpty');
  };

  return (
    <div role="group" aria-label={t('auth.account')} className="account">
      <div className="account-menu-wrap">
        <button
          ref={button}
          type="button"
          className="btn ghost account-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen(!open)}
        >
          {state.user.avatarUrl && (
            <img
              className="avatar"
              src={state.user.avatarUrl}
              alt=""
              width="24"
              height="24"
              referrerPolicy="no-referrer"
            />
          )}
          <span className="account-name">{state.user.displayName}</span>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {open && (
          <div
            ref={menu}
            id={id}
            className="menu"
            role="menu"
            aria-label={t('account.menuLabel')}
            onKeyDown={onKeyDown}
          >
            <a
              role="menuitem"
              href="#/privacy"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
            >
              {t('account.privacy')}
            </a>
            <button type="button" role="menuitem" onClick={() => void exportData()}>
              {t('account.export')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                close(false);
                setDeleting(true);
              }}
            >
              {t('account.delete')}
            </button>
          </div>
        )}
      </div>
      <button type="button" className="btn" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </button>
      {status.kind === 'working' && (
        <span role="status" className="account-status muted">
          {t('account.exporting')}
        </span>
      )}
      {status.kind === 'done' && (
        <span role="status" className="account-status muted">
          {t('account.exported')}
        </span>
      )}
      {status.kind === 'error' && (
        <span role="alert" className="account-status account-error">
          {status.message}
        </span>
      )}
      {deleting && (
        <Suspense fallback={null}>
          <DeleteAccountDialog
            onClose={() => {
              setDeleting(false);
              // The menu item that opened it is gone: the focus goes back to the menu button.
              button.current?.focus();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
