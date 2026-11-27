import { lazy, Suspense, type ReactNode } from 'react';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { useI18n } from '../i18n/i18n';
import { useRoute } from '../route/useRoute';
import { useSession } from './session';
import { SignIn } from './SignIn';
import './auth.css';

// The privacy policy is public and read by few people: its own chunk, not part of the first load.
const Privacy = lazy(() => import('../privacy/Privacy'));

/** Shows the app to a signed-in user; the sign-in screen, a loading state or an error otherwise. */
export function SessionGate({ children }: { children: ReactNode }) {
  const { state, retry } = useSession();
  const { t } = useI18n();
  const route = useRoute();

  // Reachable by anyone, signed in or not, and even while the session check is still running or failed.
  if (route.name === 'privacy') {
    return (
      <Suspense
        fallback={
          <p role="status" className="muted signin-main">
            {t('auth.loading')}
          </p>
        }
      >
        <Privacy />
      </Suspense>
    );
  }

  if (state.status === 'signedIn') return <>{children}</>;
  if (state.status === 'anonymous') return <SignIn />;

  return (
    <div className="signin">
      <header className="toolbar">
        <span className="brand">{t('app.name')}</span>
        <div className="toolbar-actions">
          <LanguageSwitch />
          <ThemeSwitch />
        </div>
      </header>
      <main className="signin-main">
        {state.status === 'loading' ? (
          <p role="status" className="muted">
            {t('auth.loading')}
          </p>
        ) : (
          <>
            <p role="alert">{t('auth.error')}</p>
            <div>
              <button type="button" className="btn" onClick={retry}>
                {t('auth.retry')}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
