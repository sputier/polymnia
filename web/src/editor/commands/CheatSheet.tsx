import { Fragment, useId, useMemo } from 'react';
import { Icon } from '../../components/Icon';
import { Kbd } from '../../components/Kbd';
import { useI18n } from '../../i18n/i18n';
import { buildSheet, GROUP_LABEL } from '../../shortcuts/commands';
import { matches, type Shortcut } from '../../shortcuts/registry';
import { Dialog } from './Dialog';

interface CheatSheetProps {
  list: readonly Shortcut[];
  onClose: () => void;
  /** Ctrl/Cmd+K from the sheet goes straight to the palette. */
  onOpenPalette: () => void;
}

/** Keys of a row: `A` to `G` as a range, alternatives (`Del` / `⌫`) separated by a slash. */
function RowKeys({ keys }: { keys: string[] }) {
  const { t } = useI18n();
  if (keys.length > 3 && keys.every((k) => !k.includes('+'))) {
    return (
      <span className="sheet-keys">
        <Kbd keys={keys[0]!} />
        <span aria-hidden="true">–</span>
        <span className="visually-hidden"> {t('cheat.range')} </span>
        <Kbd keys={keys[keys.length - 1]!} />
      </span>
    );
  }
  return (
    <span className="sheet-keys">
      {keys.map((k, i) => (
        <Fragment key={k}>
          {i > 0 && <span aria-hidden="true">/</span>}
          <Kbd keys={k} />
        </Fragment>
      ))}
    </span>
  );
}

export function CheatSheet({ list, onClose, onOpenPalette }: CheatSheetProps) {
  const { t } = useI18n();
  const titleId = useId();
  const sections = useMemo(() => buildSheet(list), [list]);

  return (
    <Dialog
      className="sheet"
      labelledBy={titleId}
      onClose={onClose}
      onKey={(event) => {
        if (matches(event.nativeEvent, 'Mod+K')) {
          onOpenPalette();
          return true;
        }
        if (matches(event.nativeEvent, 'Question')) {
          onClose();
          return true;
        }
        return false;
      }}
    >
      <div className="sheet-head">
        <h2 id={titleId}>{t('cheat.title')}</h2>
        <button type="button" className="btn dlg-noprint" onClick={() => window.print()}>
          {t('cheat.print')}
        </button>
        <button
          type="button"
          className="btn ghost icon dlg-noprint"
          data-autofocus
          aria-label={t('cheat.close')}
          title={t('cheat.close')}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="sheet-body" tabIndex={0} role="region" aria-labelledby={titleId}>
        {sections.map((section) => (
          <section key={section.group} className="sheet-group">
            <h3>{t(GROUP_LABEL[section.group])}</h3>
            <ul>
              {section.rows.map((row) => (
                <li key={row.labelKey + row.keys.join()}>
                  <span>{t(row.labelKey)}</span>
                  <RowKeys keys={row.keys} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
