import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { XSRF_COOKIE } from '../api/client';
import { resetLanguage } from '../i18n/i18n';
import { installCookieJar, removeCookieJar } from '../test-cookies';
import { SessionProvider } from './session';
import { SessionGate } from './SessionGate';

const fetchMock = vi.fn<typeof fetch>();

function mount() {
  return render(
    <SessionProvider>
      <SessionGate>
        <App />
      </SessionGate>
    </SessionProvider>,
  );
}

function route(handlers: Record<string, () => Response>) {
  fetchMock.mockImplementation((input) => {
    const handler = handlers[String(input)];
    return Promise.resolve(handler ? handler() : new Response(null, { status: 404 }));
  });
}

const me = {
  id: '0190c0de-0000-7000-8000-000000000001',
  displayName: 'Ada Lovelace',
  avatarUrl: null,
  preferredLanguage: null,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  installCookieJar();
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
  resetLanguage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  removeCookieJar();
  document.cookie = `${XSRF_COOKIE}=; path=/; max-age=0`;
});

describe('session gate', () => {
  it('shows a loading state, then the sign-in screen for an anonymous visitor', async () => {
    route({ '/api/me': () => new Response(null, { status: 401 }) });

    mount();

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    const signIn = await screen.findByRole('link', { name: 'Sign in with Google' });
    expect(signIn).toHaveAttribute('href', '/api/auth/login');
    expect(screen.getByRole('heading', { level: 1, name: 'Write. Hear. Share.' })).toBeVisible();
    expect(signIn).toHaveFocus();
  });

  it('shows the app and the user name once signed in, then signs out', async () => {
    route({
      '/api/me': () => Response.json(me),
      '/api/auth/antiforgery': () => {
        document.cookie = `${XSRF_COOKIE}=tok; path=/`;
        return new Response(null, { status: 204 });
      },
      '/api/auth/logout': () => new Response(null, { status: 204 }),
    });

    mount();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument();
    const logoutCall = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/logout')!;
    expect(new Headers((logoutCall[1] as RequestInit).headers).get('X-XSRF-TOKEN')).toBe('tok');
  });

  it('offers a retry when the server cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    route({ '/api/me': () => new Response(null, { status: 401 }) });

    mount();

    expect(await screen.findByRole('alert')).toHaveTextContent('not reachable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument(),
    );
  });

  it('says so when the sign-in did not complete', async () => {
    window.history.replaceState(null, '', '/?signin=failed');
    route({ '/api/me': () => new Response(null, { status: 401 }) });

    mount();

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in did not complete');
    window.history.replaceState(null, '', '/');
  });

  it('keeps the page the visitor asked for as a local return URL', async () => {
    window.history.replaceState(null, '', '/scores?id=1');
    route({ '/api/me': () => new Response(null, { status: 401 }) });

    mount();

    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnUrl=%2Fscores%3Fid%3D1',
    );
    window.history.replaceState(null, '', '/');
  });

  it('is translated', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr']);
    resetLanguage();
    route({ '/api/me': () => new Response(null, { status: 401 }) });

    mount();

    expect(
      await screen.findByRole('link', { name: 'Se connecter avec Google' }),
    ).toBeInTheDocument();
  });
});
