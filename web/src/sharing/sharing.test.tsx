import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XSRF_COOKIE } from '../api/client';
import { resetLanguage } from '../i18n/i18n';
import { installCookieJar, removeCookieJar } from '../test-cookies';
import { parseRoute } from '../route/useRoute';
import { serialize } from '../score';
import { newEditorScore } from '../editor/entry/editorStore';
import { loadSharedScore, shareUrl } from '../api/shares';
import { ShareDialog } from './ShareDialog';
import { SharedViewer } from './Viewer';

// Engraving is its own test suite; here the viewer only has to hand it the score.
vi.mock('../engraving/ScoreView', () => ({
  ScoreView: ({ score }: { score?: { meta: { title: string } } }) => (
    <div data-testid="score-view">{score?.meta.title}</div>
  ),
}));

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

beforeEach(() => {
  resetLanguage();
  installCookieJar();
  document.cookie = `${XSRF_COOKIE}=t; path=/`;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeCookieJar();
});

describe('parseRoute', () => {
  it('recognizes the public viewer and nothing else as a token', () => {
    expect(parseRoute(`#/s/${TOKEN}`)).toEqual({ name: 'shared', token: TOKEN });
    expect(parseRoute(`#/s/${TOKEN}/`)).toEqual({ name: 'shared', token: TOKEN });
    // Not a token: falls back to the library, never reaches the API.
    expect(parseRoute('#/s/')).toEqual({ name: 'library' });
    expect(parseRoute('#/s/a b')).toEqual({ name: 'library' });
    expect(parseRoute('#/s/../scores/1')).toEqual({ name: 'library' });
  });
});

describe('api helpers', () => {
  it('puts the token in the fragment, never in the path or the query', () => {
    const url = new URL(shareUrl(TOKEN));
    expect(url.hash).toBe(`#/s/${TOKEN}`);
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
  });

  it('reads the shared score without cookies, cache or referrer', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchMock);
    await loadSharedScore(TOKEN);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/shared');
    expect(new Headers(init.headers).get('X-Share-Token')).toBe(TOKEN);
    expect(init).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });
});

function stubShareApi(initial: { active: boolean; createdAt: string | null }) {
  let status = initial;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (method === 'POST') {
        status = { active: true, createdAt: '2026-06-01T10:00:00Z' };
        return Promise.resolve(
          Response.json({ token: TOKEN, createdAt: status.createdAt }, { status: 201 }),
        );
      }
      if (method === 'DELETE') {
        status = { active: false, createdAt: null };
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(Response.json(status));
    }),
  );
  return calls;
}

describe('ShareDialog', () => {
  it('creates a link, shows it once, copies it, then revokes it', async () => {
    const calls = stubShareApi({ active: false, createdAt: null });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onExport = vi.fn();
    render(<ShareDialog scoreId="s1" title="My piece" onClose={() => {}} onExport={onExport} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create link' }));
    const input = await screen.findByLabelText('Share link');
    expect(input).toHaveValue(shareUrl(TOKEN));
    expect(input).toHaveAttribute('readonly');

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(shareUrl(TOKEN));
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(onExport).toHaveBeenCalledWith('pdf');

    await userEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(await screen.findByText('This score is not shared.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Share link')).not.toBeInTheDocument();
    expect(calls).toContain('DELETE /api/scores/s1/share');
  });

  it('never shows the token of an existing link: only that it is active', async () => {
    stubShareApi({ active: true, createdAt: '2026-06-01T10:00:00Z' });
    render(<ShareDialog scoreId="s1" title="My piece" onClose={() => {}} />);

    expect(await screen.findByText(/Sharing has been on since/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Share link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New link' })).toBeInTheDocument();
    // No export buttons without export actions.
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
  });

  it('falls back to the selection when the Clipboard API is missing or refuses', async () => {
    stubShareApi({ active: false, createdAt: null });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    document.execCommand = vi.fn(() => false);
    render(<ShareDialog scoreId="s1" title="My piece" onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create link' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy link' }));

    expect(await screen.findByText(/press Ctrl\+C/)).toBeInTheDocument();
  });

  it('is an accessible modal dialog and closes on Escape', async () => {
    stubShareApi({ active: false, createdAt: null });
    const onClose = vi.fn();
    render(<ShareDialog scoreId="s1" title="My piece" onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'Share' })).toHaveAttribute('aria-modal', 'true');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SharedViewer', () => {
  it('shows the score read-only, signed out, without asking for a session', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/shared'
          ? new Response(serialize(newEditorScore(2)))
          : new Response(null, { status: 401 }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<SharedViewer token={TOKEN} />);

    expect(await screen.findByTestId('score-view')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Playback controls' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Made with Polymnia' })).toHaveAttribute('href', '/');
    expect(screen.getByText('Read only')).toBeInTheDocument();
    // No editing interface, no sign-in gate, nothing but the one request.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in|export|share/i })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/shared']);
    // Not indexed, no referrer, for as long as the viewer is shown.
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      expect.stringContaining('noindex'),
    );
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    );
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('says the link is no longer valid on 404, with no detail about why', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ title: 'Not Found' }, { status: 404 }))),
    );
    render(<SharedViewer token={TOKEN} />);

    expect(
      await screen.findByRole('heading', { name: 'This link is no longer valid.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('no longer valid');
    expect(screen.queryByTestId('score-view')).not.toBeInTheDocument();
  });

  it('offers a retry when the network fails, and recovers', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(new Response(serialize(newEditorScore(1))));
    vi.stubGlobal('fetch', fetchMock);
    render(<SharedViewer token={TOKEN} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByTestId('score-view')).toBeInTheDocument());
  });
});
