import { SaveStatus, type SaveState } from '../components/SaveStatus';
import { useI18n } from '../i18n/i18n';
import type { UiMode } from './uiMode';

export type InputMode = 'note' | 'select';
export type Duration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';

interface StatusBarProps {
  inputMode: InputMode;
  duration: Duration;
  measure: number;
  beat: number;
  saveState: SaveState;
  uiMode: UiMode;
}

export function StatusBar({
  inputMode,
  duration,
  measure,
  beat,
  saveState,
  uiMode,
}: StatusBarProps) {
  const { t } = useI18n();
  return (
    <footer className="status" aria-label={t('status.label')}>
      {/* Only the mode and the save state are announced: position changes on every note. */}
      <span className="cell mode" role="status" aria-live="polite" data-mode={inputMode}>
        {inputMode === 'note' ? t('status.input') : t('status.select')}
      </span>
      <span className="cell">
        <span className="visually-hidden">{t('status.duration')}: </span>
        {t(`duration.${duration}`)}
      </span>
      <span className="cell">
        <span className="visually-hidden">{t('status.position')}: </span>
        {t('status.measure')}
        {measure} · {t('status.beat')}
        {beat}
      </span>
      <span className="sp" />
      <span className="cell hide-sm">
        {uiMode === 'advanced' ? t('mode.advanced') : t('mode.simple')}
      </span>
      <span className="cell" role="status" aria-live="polite">
        <SaveStatus state={saveState} />
      </span>
    </footer>
  );
}
