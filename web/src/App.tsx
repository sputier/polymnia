import { LanguageSwitch } from './components/LanguageSwitch';
import { ThemeSwitch } from './components/ThemeSwitch';
import { EditorLayout } from './editor/EditorLayout';
import { useI18n } from './i18n/i18n';
import { ROUTE_HREF, useRoute } from './route/useRoute';

export function App() {
  const route = useRoute();
  return route === 'editor' ? <EditorLayout /> : <Home />;
}

function Home() {
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
        <p>
          <a className="btn primary" href={ROUTE_HREF.editor}>
            {t('home.openEditor')}
          </a>
        </p>
      </main>
      <footer className="statusbar" aria-hidden="true">
        <kbd>Polymnia</kbd>
      </footer>
    </div>
  );
}
