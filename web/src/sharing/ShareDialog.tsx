import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { isNetworkError } from '../api/scores';
import {
  createShareLink,
  getShareStatus,
  revokeShareLink,
  shareUrl,
  type ShareStatus,
} from '../api/shares';
import { Icon } from '../components/Icon';
import { Dialog } from '../editor/commands/Dialog';
import type { ExportFormat } from '../editor/FileMenu';
import type { MessageKey } from '../i18n/en';
import { format, useI18n } from '../i18n/i18n';
import { fullDate } from '../library/text';

interface ShareDialogProps {
  scoreId: string;
  title: string;
  onClose: () => void;
  /** The export actions of the editor (the Export menu): shown as buttons when given. */
  onExport?: (format: ExportFormat) => void;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; key: MessageKey; seconds?: number }
  | { kind: 'ready'; status: ShareStatus };

const EXPORTS: readonly { format: ExportFormat; label: MessageKey }[] = [
  { format: 'musicxml', label: 'io.exportMusicXml' },
  { format: 'mxl', label: 'io.exportMxl' },
  { format: 'midi', label: 'io.exportMidi' },
  { format: 'pdf', label: 'io.exportPdf' },
  { format: 'png', label: 'io.exportPng' },
];

function describe(error: unknown): { key: MessageKey; seconds?: number } {
  if (isNetworkError(error)) return { key: 'share.errorOffline' };
  if (error instanceof ApiError && error.status === 429) {
    return { key: 'share.errorRate', seconds: Math.ceil(error.retryAfter ?? 5) };
  }
  return { key: 'share.error' };
}

/** Copies with the Clipboard API, then with the selection fallback (older browsers, insecure contexts). */
async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused or not focused: try the fallback.
  }
  if (!input) return false;
  input.focus();
  input.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

/**
 * The share dialog of a stored score: create, copy, regenerate and revoke the read-only link, and download a copy.
 * The raw token exists only in this component's state, from the creation until the dialog closes: the server keeps a
 * hash and never returns the token again (docs/sharing.md).
 */
export function ShareDialog({ scoreId, title, onClose, onExport }: ShareDialogProps) {
  const { t, language } = useI18n();
  const titleId = useId();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState<{ key: MessageKey; seconds?: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    getShareStatus(scoreId, controller.signal).then(
      (status) => setLoad({ kind: 'ready', status }),
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', ...describe(error) });
      },
    );
    return () => controller.abort();
  }, [scoreId]);

  // After a creation the link is selected, ready to copy.
  useEffect(() => {
    if (url) {
      input.current?.focus();
      input.current?.select();
    }
  }, [url]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const created = await createShareLink(scoreId);
      setUrl(shareUrl(created.token));
      setLoad({ kind: 'ready', status: { active: true, createdAt: created.createdAt } });
      setMessage(t('share.created'));
    });

  const revoke = () =>
    run(async () => {
      await revokeShareLink(scoreId);
      setUrl(null);
      setLoad({ kind: 'ready', status: { active: false, createdAt: null } });
      setMessage(t('share.revoked'));
    });

  const copy = async () => {
    if (!url) return;
    const ok = await copyText(url, input.current);
    setMessage(t(ok ? 'share.copied' : 'share.copyFailed'));
    if (!ok) input.current?.select();
  };

  const status = load.kind === 'ready' ? load.status : null;
  const exportSection = onExport && (
    <section className="share-export" aria-label={t('share.exportTitle')}>
      <h3>{t('share.exportTitle')}</h3>
      <div className="share-export-list">
        {EXPORTS.map((entry) => (
          <button
            key={entry.format}
            type="button"
            className="btn"
            onClick={() => onExport(entry.format)}
          >
            {t(entry.label)}
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <Dialog className="dlg-form dlg-share" labelledBy={titleId} onClose={onClose}>
      <div className="dlg-body">
        <h2 id={titleId}>{t('share.title')}</h2>
        <p>
          <strong>{title}</strong>
        </p>
        <p className="muted">{t('share.intro')}</p>

        {load.kind === 'loading' && <p role="status">{t('share.loading')}</p>}
        {load.kind === 'error' && (
          <p role="alert" className="share-problem">
            {format(t(load.key), { n: load.seconds ?? 0 })}
          </p>
        )}

        {status && !status.active && <p>{t('share.off')}</p>}
        {status?.active && (
          <>
            {url ? (
              <div className="field">
                <label htmlFor="share-url">{t('share.linkLabel')}</label>
                <div className="share-row">
                  <input
                    id="share-url"
                    ref={input}
                    readOnly
                    value={url}
                    spellCheck={false}
                    autoComplete="off"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button type="button" className="btn primary" onClick={() => void copy()}>
                    <Icon name="copy" />
                    <span className="lbl">{t('share.copy')}</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {status.createdAt && (
                  <p>{format(t('share.on'), { when: fullDate(status.createdAt, language) })}</p>
                )}
                <p className="muted hint">{t('share.hidden')}</p>
              </>
            )}
            <p className="muted hint">{t('share.regenerateHint')}</p>
          </>
        )}

        <div role="status" aria-live="polite" className="share-message">
          {message}
        </div>
        {problem && (
          <p role="alert" className="share-problem">
            {format(t(problem.key), { n: problem.seconds ?? 0 })}
          </p>
        )}

        <div className="dlg-actions">
          {status && !status.active && (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void create()}
            >
              {t('share.create')}
            </button>
          )}
          {status?.active && (
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
                {t('share.regenerate')}
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => void revoke()}
              >
                {t('share.revoke')}
              </button>
            </>
          )}
        </div>

        {exportSection}

        <div className="dlg-actions">
          <button type="button" className="btn" data-autofocus onClick={onClose}>
            {t('dialog.close')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
