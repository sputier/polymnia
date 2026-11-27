import { useI18n } from '../i18n/i18n';
import type { UiMode } from '../editor/uiMode';

export function ModeToggle({ mode, onChange }: { mode: UiMode; onChange: (mode: UiMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="seg" role="group" aria-label={t('mode.label')}>
      <button type="button" aria-pressed={mode === 'simple'} onClick={() => onChange('simple')}>
        {t('mode.simple')}
      </button>
      <button type="button" aria-pressed={mode === 'advanced'} onClick={() => onChange('advanced')}>
        {t('mode.advanced')}
      </button>
    </div>
  );
}
