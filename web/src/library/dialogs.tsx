import { useState, type FormEvent } from 'react';
import { Dialog } from '../editor/commands/Dialog';
import { useI18n } from '../i18n/i18n';

const MAX_TITLE = 200;

export function RenameDialog({
  title,
  onSubmit,
  onClose,
}: {
  title: string;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(title);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    if (next) onSubmit(next);
  };
  return (
    <Dialog className="dlg-form" labelledBy="rename-title" onClose={onClose}>
      <form className="dlg-body" onSubmit={submit}>
        <h2 id="rename-title">{t('rename.title')}</h2>
        <label className="field">
          <span>{t('rename.label')}</span>
          <input
            data-autofocus
            value={value}
            maxLength={MAX_TITLE}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            {t('rename.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Placeholder: sharing by link arrives with its own issue. */
export function ShareDialog({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog className="dlg-form" labelledBy="share-title" onClose={onClose}>
      <div className="dlg-body">
        <h2 id="share-title">{t('share.title')}</h2>
        <p>
          <strong>{title}</strong>
        </p>
        <p>{t('share.soon')}</p>
        <div className="dlg-actions">
          <button type="button" className="btn primary" data-autofocus onClick={onClose}>
            {t('dialog.close')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
