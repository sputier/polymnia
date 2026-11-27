import { LanguageSwitch } from './components/LanguageSwitch';
import { ThemeSwitch } from './components/ThemeSwitch';
import { useI18n } from './i18n/i18n';

export function App() {
  const { t } = useI18n();

  return (
    <div className="shell">
      <header className="toolbar">
        <span className="brand">{t('app.name')}</span>
        <div className="toolbar-actions">
          <LanguageSwitch />
          <ThemeSwitch />
        </div>
      </header>
      <main className="home">
        <h1>{t('app.name')}</h1>
        <p>{t('app.tagline')}</p>
        <p className="muted">{t('home.status')}</p>
      </main>
      <footer className="statusbar" aria-hidden="true">
        <kbd>Polymnia</kbd>
      </footer>
    </div>
  );
}
