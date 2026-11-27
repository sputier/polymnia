import { useState, type FormEvent } from 'react';
import { deleteAccount, rememberAccountDeleted, rememberReopenDelete } from '../api/account';
import { ApiError } from '../api/client';
import { Dialog } from '../editor/commands/Dialog';
import { format, useI18n } from '../i18n/i18n';
import { rememberReturn } from './returnTo';
import { useSession } from './session';

/** Where the sign-in page sends the person back, with a fresh Google sign-in (the server asks for it). */
const REAUTH_HREF = '/api/auth/login?reauth=true';

type Step =
  | { kind: 'confirm' }
  | { kind: 'working' }
  | { kind: 'reauth' }
  | { kind: 'error'; message: string };

/** Typed confirmation, then `DELETE /api/me`. An old sign-in is asked to sign in with Google again first. */
export default function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { expire } = useSession();
  const [typed, setTyped] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'confirm' });
  const word = t('account.deleteWord');
  const ready = typed.trim().toLocaleUpperCase() === word && step.kind !== 'working';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setStep({ kind: 'working' });
    try {
      const outcome = await deleteAccount();
      if (outcome === 'reauth-required') {
        setStep({ kind: 'reauth' });
        return;
      }
      rememberAccountDeleted();
      expire(); // The session is gone: the sign-in screen takes over.
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? format(t('account.errorRateLimited'), { n: error.retryAfter ?? 60 })
          : error instanceof TypeError
            ? t('account.errorOffline')
            : t('account.errorGeneric');
      setStep({ kind: 'error', message });
    }
  };

  if (step.kind === 'reauth') {
    return (
      <Dialog key="reauth" className="dlg-form" labelledBy="reauth-title" onClose={onClose}>
        <div className="dlg-body">
          <h2 id="reauth-title">{t('account.reauthTitle')}</h2>
          <p>{t('account.reauthBody')}</p>
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('dialog.cancel')}
            </button>
            {/* A link: signing in is a full-page navigation to the server. */}
            <a
              className="btn primary"
              data-autofocus
              href={REAUTH_HREF}
              onClick={() => {
                rememberReturn();
                rememberReopenDelete();
              }}
            >
              {t('account.reauthButton')}
            </a>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog className="dlg-form" labelledBy="delete-account-title" onClose={onClose}>
      <form className="dlg-body" onSubmit={(event) => void submit(event)}>
        <h2 id="delete-account-title">{t('account.deleteTitle')}</h2>
        <p>{t('account.deleteBody')}</p>
        <p className="muted">{t('account.deleteExportHint')}</p>
        <label className="field">
          <span>{format(t('account.deleteConfirmLabel'), { word })}</span>
          <input
            data-autofocus
            value={typed}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        {step.kind === 'error' && (
          <p role="alert" className="account-error">
            {step.message}
          </p>
        )}
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" className="btn danger" disabled={!ready}>
            {step.kind === 'working' ? t('account.deleting') : t('account.deleteConfirm')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
