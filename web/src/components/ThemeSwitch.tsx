import { useI18n } from '../i18n/i18n';
import { useTheme } from '../theme/theme';

export function ThemeSwitch() {
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const action = theme === 'dark' ? t('theme.toggleToLight') : t('theme.toggleToDark');
  const current = theme === 'dark' ? t('theme.dark') : t('theme.light');

  return (
    // The accessible name starts with the visible text (WCAG 2.5.3), then says what the button does.
    <button
      type="button"
      className="btn"
      onClick={toggleTheme}
      aria-label={`${current}: ${action}`}
      title={action}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
      <span>{current}</span>
    </button>
  );
}
