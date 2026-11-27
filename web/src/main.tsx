import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SessionProvider } from './auth/session';
import { SessionGate } from './auth/SessionGate';
import './styles/tokens.css';
import './styles/app.css';
import './styles/editor.css';
import './styles/palette.css';
import './styles/parts.css';
import './styles/commands.css';
import './styles/file-io.css';
import './styles/library.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <StrictMode>
    <SessionProvider>
      <SessionGate>
        <App />
      </SessionGate>
    </SessionProvider>
  </StrictMode>,
);
