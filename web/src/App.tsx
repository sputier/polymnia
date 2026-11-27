import { Suspense, useEffect } from 'react';
import { consumeReturn } from './auth/returnTo';
import { useI18n } from './i18n/i18n';
import { flushDeletes, hasPendingDeletes } from './library/deferredDelete';
import { hasPendingSaves } from './persistence/saveQueue';
import { Library, ScoreEditorRoute, ScratchEditor } from './route/chunks';
import { useRoute } from './route/useRoute';

function Loading() {
  const { t } = useI18n();
  return (
    <p role="status" className="muted signin-main">
      {t('auth.loading')}
    </p>
  );
}

export function App() {
  const route = useRoute();

  // Back from the sign-in page: the screen that was open (the hash never reaches the server).
  useEffect(() => {
    const back = consumeReturn();
    if (back && (window.location.hash === '' || window.location.hash === '#/')) {
      window.location.hash = back;
    }
  }, []);

  // Never lose work: the browser asks before closing a tab that holds unsaved edits, and deletions the user
  // did not undo are sent while the page is still there.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasPendingSaves()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const pageHide = () => {
      if (hasPendingDeletes()) flushDeletes();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
    };
  }, []);

  return (
    <Suspense fallback={<Loading />}>
      {route.name === 'score' ? (
        <ScoreEditorRoute key={route.id} id={route.id} />
      ) : route.name === 'editor' ? (
        <ScratchEditor />
      ) : (
        <Library />
      )}
    </Suspense>
  );
}
