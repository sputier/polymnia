import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { refreshAntiforgeryToken } from '../api/client';
import { fetchCurrentUser, signOut as apiSignOut } from '../api/me';
import type { CurrentUser } from '../api/me';

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'signedIn'; user: CurrentUser }
  | { status: 'error' };

interface SessionContextValue {
  state: SessionState;
  retry: () => void;
  signOut: () => Promise<void>;
  /** The server answered 401: the session ended. Shows the sign-in screen. */
  expire: () => void;
}

// Without a provider (isolated component tests) the visitor is simply anonymous.
const SessionContext = createContext<SessionContextValue>({
  state: { status: 'anonymous' },
  retry: () => {},
  signOut: () => Promise.resolve(),
  expire: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const user = await fetchCurrentUser();
        // Best effort: apiFetch fetches a token itself when an unsafe request finds none.
        if (user) await refreshAntiforgeryToken().catch(() => undefined);
        if (!cancelled) setState(user ? { status: 'signedIn', user } : { status: 'anonymous' });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    setState({ status: 'anonymous' });
  }, []);

  const expire = useCallback(() => setState({ status: 'anonymous' }), []);

  const value = useMemo(() => ({ state, retry, signOut, expire }), [state, retry, signOut, expire]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
