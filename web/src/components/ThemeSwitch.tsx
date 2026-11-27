import { useI18n } from '../i18n/i18n';
import { useTheme } from '../theme/theme';

export function ThemeSwitch() {
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? t('theme.toggleToLight') : t('theme.toggleToDark');

  return (
    <button type="button" className="btn" onClick={toggleTheme} aria-label={label} title={label}>
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
      <span>{theme === 'dark' ? t('theme.dark') : t('theme.light')}</span>
    </button>
  );
}
