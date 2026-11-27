import { useEffect } from 'react';
import { consumeReturn } from './auth/returnTo';
import { EditorLayout } from './editor/EditorLayout';
import { flushDeletes, hasPendingDeletes } from './library/deferredDelete';
import { Library } from './library/Library';
import { ScoreEditorRoute } from './persistence/ScoreEditorRoute';
import { hasPendingSaves } from './persistence/saveQueue';
import { useRoute } from './route/useRoute';

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

  if (route.name === 'score') return <ScoreEditorRoute key={route.id} id={route.id} />;
  if (route.name === 'editor') return <EditorLayout />;
  return <Library />;
}
