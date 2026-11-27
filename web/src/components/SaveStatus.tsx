import { useI18n } from '../i18n/i18n';

export type SaveState = 'saved' | 'saving' | 'offline';

/** Dot and label. Wrap it in a `role="status"` region where announcements are wanted. */
export function SaveStatus({ state }: { state: SaveState }) {
  const { t } = useI18n();
  return (
    <span className="save" data-state={state}>
      <i className="dot" aria-hidden="true" />
      <span>{t(`save.${state}`)}</span>
    </span>
  );
}
