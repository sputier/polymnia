import { useState } from 'react';
import { Dialog } from '../editor/commands/Dialog';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { SaveProblem, SaveStatus } from './saveQueue';

interface SaveNoticesProps {
  status: SaveStatus;
  problem: SaveProblem | null;
  onKeepMine: () => Promise<void>;
  onReload: () => Promise<void>;
  onResume: () => void;
}

const NOTICE: Record<string, MessageKey> = {
  'too-large': 'save.noticeTooLarge',
  'storage-full': 'save.noticeStorageFull',
  rejected: 'save.noticeRejected',
  gone: 'save.noticeGone',
  'rate-limited': 'save.noticeRateLimited',
  server: 'save.noticeServer',
};

/** Everything the user must know or decide about saving: the conflict dialog, the sign-in dialog and the notices. */
export function SaveNotices({ status, problem, onKeepMine, onReload, onResume }: SaveNoticesProps) {
  const { t } = useI18n();

  const notice =
    status === 'offline' ? 'save.noticeOffline' : problem ? NOTICE[problem] : undefined;

  return (
    <>
      {notice && (
        <p
          className="save-notice"
          role={status === 'error' && problem !== 'server' ? 'alert' : 'status'}
        >
          {t(notice)}
        </p>
      )}
      {status === 'conflict' && <ConflictDialog onKeepMine={onKeepMine} onReload={onReload} />}
      {status === 'unauthorized' && (
        <Dialog className="dlg-form" labelledBy="session-title" onClose={() => {}}>
          <div className="dlg-body">
            <h2 id="session-title">{t('session.title')}</h2>
            <p>{t('session.text')}</p>
            <div className="dlg-actions">
              {/* A new tab: this one keeps the unsaved edits in memory. */}
              <a
                className="btn"
                href="/api/auth/login?returnUrl=%2F"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('session.signIn')}
              </a>
              <button type="button" className="btn primary" data-autofocus onClick={onResume}>
                {t('session.retry')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

function ConflictDialog({
  onKeepMine,
  onReload,
}: Pick<SaveNoticesProps, 'onKeepMine' | 'onReload'>) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog className="dlg-form" labelledBy="conflict-title" onClose={() => {}}>
      <div className="dlg-body" role="alertdialog" aria-describedby="conflict-text">
        <h2 id="conflict-title">{t('conflict.title')}</h2>
        <p id="conflict-text">{t('conflict.text')}</p>
        <div className="dlg-choices">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-autofocus
            onClick={() => void run(onReload)}
          >
            {t('conflict.reload')}
          </button>
          <span className="muted">{t('conflict.reloadHint')}</span>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void run(onKeepMine)}
          >
            {t('conflict.keep')}
          </button>
          <span className="muted">{t('conflict.keepHint')}</span>
        </div>
        {failed && <p role="alert">{t('conflict.failed')}</p>}
      </div>
    </Dialog>
  );
}
