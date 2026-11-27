import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SessionProvider } from './auth/session';
import { SessionGate } from './auth/SessionGate';
import { useRoute } from './route/useRoute';
import { SharedViewer } from './sharing/Viewer';
import './styles/tokens.css';
import './styles/app.css';
import './styles/editor.css';
import './styles/palette.css';
import './styles/parts.css';
import './styles/commands.css';
import './styles/file-io.css';
import './styles/library.css';
import './styles/share.css';

/**
 * A share link (`#/s/<token>`) is for people who may have no account: it is shown before, and without, the session
 * check and the sign-in screen. Everything else sits behind the session gate.
 */
function Root() {
  const route = useRoute();
  if (route.name === 'shared') return <SharedViewer key={route.token} token={route.token} />;
  return (
    <SessionProvider>
      <SessionGate>
        <App />
      </SessionGate>
    </SessionProvider>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
