import { useI18n } from '../i18n/i18n';

/** What the paper shows: the engraved score or the chord sheet (#60). */
export type View = 'score' | 'sheet';

/** Score or chord sheet: two toggle buttons, in the editor and in the shared viewer. */
export function ViewToggle({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const { t } = useI18n();
  return (
    <div className="seg" role="group" aria-label={t('sheet.view')}>
      <button type="button" aria-pressed={view === 'score'} onClick={() => onChange('score')}>
        {t('sheet.viewScore')}
      </button>
      <button type="button" aria-pressed={view === 'sheet'} onClick={() => onChange('sheet')}>
        {t('sheet.viewSheet')}
      </button>
    </div>
  );
}
