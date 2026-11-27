import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCookieJar, removeCookieJar } from '../test-cookies';
import { XSRF_COOKIE, XSRF_HEADER, apiFetch, readCookie } from './client';

function setTokenCookie(value: string | null): void {
  document.cookie = `${XSRF_COOKIE}=${value ?? ''}; path=/${value === null ? '; max-age=0' : ''}`;
}

function headerOf(call: unknown[], name: string): string | null {
  const init = call[1] as RequestInit;
  return new Headers(init.headers).get(name);
}

describe('apiFetch', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    installCookieJar();
    setTokenCookie(null);
  });

  afterEach(() => {
    setTokenCookie(null);
    vi.unstubAllGlobals();
    removeCookieJar();
  });

  it('sends same-origin credentials and no token on a GET', async () => {
    setTokenCookie('abc');
    fetchMock.mockResolvedValue(new Response('{}'));

    await apiFetch('/api/me');

    const call = fetchMock.mock.calls[0]!;
    expect((call[1] as RequestInit).credentials).toBe('same-origin');
    expect(headerOf(call, XSRF_HEADER)).toBeNull();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])(
    'adds the token from the cookie on %s',
    async (method) => {
      setTokenCookie('token-123');
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

      await apiFetch('/api/scores', { method });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0]!;
      expect(headerOf(call, XSRF_HEADER)).toBe('token-123');
      expect((call[1] as RequestInit).credentials).toBe('same-origin');
    },
  );

  it('keeps the caller headers and does not let them replace the token', async () => {
    setTokenCookie('real');
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await apiFetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [XSRF_HEADER]: 'forged' },
      body: '{}',
    });

    const call = fetchMock.mock.calls[0]!;
    expect(headerOf(call, 'Content-Type')).toBe('application/json');
    expect(headerOf(call, XSRF_HEADER)).toBe('real');
  });

  it('fetches a token first when the cookie is missing', async () => {
    fetchMock.mockImplementation((input) => {
      if (input === '/api/auth/antiforgery') {
        setTokenCookie('fresh');
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await apiFetch('/api/auth/logout', { method: 'POST' });

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/auth/antiforgery',
      '/api/auth/logout',
    ]);
    expect(headerOf(fetchMock.mock.calls[1]!, XSRF_HEADER)).toBe('fresh');
  });

  it('replaces a rejected token once and retries', async () => {
    setTokenCookie('stale');
    fetchMock.mockImplementation((input, init) => {
      if (input === '/api/auth/antiforgery') {
        setTokenCookie('renewed');
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const token = new Headers((init as RequestInit).headers).get(XSRF_HEADER);
      return Promise.resolve(
        token === 'renewed'
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({ code: 'antiforgery' }), {
              status: 400,
              headers: { 'Content-Type': 'application/problem+json' },
            }),
      );
    });

    const response = await apiFetch('/api/scores', { method: 'POST' });

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry an unrelated 400', async () => {
    setTokenCookie('ok');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'other' }), { status: 400 }));

    const response = await apiFetch('/api/scores', { method: 'POST' });

    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('readCookie', () => {
  it('returns undefined for an absent cookie and does not match a name suffix', () => {
    document.cookie = 'other=1; path=/';
    document.cookie = 'x-a=2; path=/';
    expect(readCookie('a')).toBeUndefined();
    expect(readCookie('other')).toBe('1');
    document.cookie = 'other=; path=/; max-age=0';
    document.cookie = 'x-a=; path=/; max-age=0';
  });
});
