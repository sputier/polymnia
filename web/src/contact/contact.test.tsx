import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguage } from '../i18n/i18n';
import { parseRoute, reportHref } from '../route/useRoute';
import { Contact, readPrefill } from './Contact';

const fetchMock = vi.fn<typeof fetch>();
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

interface Posted {
  topic: string;
  message: string;
  replyTo: string | null;
  website: string;
  token: string;
}

let posts: Posted[];
let tokens: number;

/** A server that hands out numbered tokens and answers the POST with `answer`. */
function server(answer: (body: Posted, attempt: number) => Response) {
  posts = [];
  tokens = 0;
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    if (url === '/api/contact/form-token') {
      tokens++;
      return Promise.resolve(Response.json({ token: `token-${tokens}`, minFillSeconds: 2 }));
    }
    if (url === '/api/contact' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Posted;
      posts.push(body);
      return Promise.resolve(answer(body, posts.length));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
  resetLanguage();
  window.location.hash = '#/contact';
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('route', () => {
  it('parses #/contact with or without a query, and nothing longer', () => {
    expect(parseRoute('#/contact')).toEqual({ name: 'contact' });
    expect(parseRoute('#/contact/')).toEqual({ name: 'contact' });
    expect(parseRoute('#/contact?topic=report&page=abc')).toEqual({ name: 'contact' });
    expect(parseRoute('#/contacts')).toEqual({ name: 'library' });
    expect(parseRoute('#/contact/x')).toEqual({ name: 'library' });
  });

  it('builds the "report this page" link from the token of the page', () => {
    expect(reportHref(TOKEN)).toBe(`#/contact?topic=report&page=${TOKEN}`);
    expect(parseRoute(reportHref(TOKEN))).toEqual({ name: 'contact' });
  });
});

describe('readPrefill', () => {
  it('reads a known topic and a well-formed token, and ignores anything else', () => {
    expect(readPrefill(reportHref(TOKEN), 'https://polymnia.example')).toEqual({
      topic: 'report',
      pageUrl: `https://polymnia.example/#/s/${TOKEN}`,
    });
    expect(readPrefill('#/contact?topic=hack&page=a%20b', 'https://x.example')).toEqual({
      topic: undefined,
      pageUrl: undefined,
    });
    expect(readPrefill('#/contact?page=%3Cscript%3E', 'https://x.example').pageUrl).toBeUndefined();
    expect(readPrefill('#/contact', 'https://x.example')).toEqual({
      topic: undefined,
      pageUrl: undefined,
    });
  });
});

describe('contact page', () => {
  it('shows no e-mail address and asks for a token as it opens', async () => {
    server(() => new Response(null, { status: 202 }));

    const { container } = render(<Contact />);

    expect(screen.getByRole('heading', { level: 1, name: 'Contact' })).toBeInTheDocument();
    await waitFor(() => expect(tokens).toBe(1));
    expect(container.textContent).not.toMatch(/\S+@\S+\.\S+/);
    // The token request carries no cookie.
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit' });
  });

  it('sends the message with the token, then shows the confirmation', async () => {
    server(() => new Response(null, { status: 202 }));
    const user = userEvent.setup();
    render(<Contact />);

    await user.selectOptions(screen.getByLabelText('Topic'), 'personal-data');
    await user.type(screen.getByLabelText('Message'), 'Please delete my data');
    await user.type(screen.getByLabelText(/Your e-mail address/), 'visitor@visitor.example');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Message sent')).toBeInTheDocument();
    expect(posts).toEqual([
      {
        topic: 'personal-data',
        message: 'Please delete my data',
        replyTo: 'visitor@visitor.example',
        website: '',
        token: 'token-1',
      },
    ]);
    // The send used no cookie and no antiforgery request.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/api/auth'))).toBe(true);
    // A fresh token is ready for the next message.
    await user.click(screen.getByRole('button', { name: 'Write another message' }));
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('sends no reply address when none is given', async () => {
    server(() => new Response(null, { status: 202 }));
    const user = userEvent.setup();
    render(<Contact />);

    await user.type(screen.getByLabelText('Message'), 'A question');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Message sent');
    expect(posts[0]?.replyTo).toBeNull();
    expect(posts[0]?.topic).toBe('question');
  });

  it('does not send an empty or too long message and counts the characters', async () => {
    server(() => new Response(null, { status: 202 }));
    const user = userEvent.setup();
    render(<Contact />);
    const send = screen.getByRole('button', { name: 'Send message' });

    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('Message'), '   ');
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('Message'), 'Hello');
    expect(send).toBeEnabled();
    expect(screen.getByText('8 / 2000')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Message'));
    // userEvent types one key at a time: paste a long text instead.
    await user.click(screen.getByLabelText('Message'));
    await user.paste('x'.repeat(2001));
    expect(send).toBeDisabled();
    expect(screen.getByText('2001 / 2000')).toBeInTheDocument();
  });

  it('keeps a honeypot out of sight and of the keyboard path, and sends it as it is', async () => {
    server(() => new Response(null, { status: 202 }));
    render(<Contact />);

    const trap = document.querySelector<HTMLInputElement>('input[name="website"]');

    expect(trap).not.toBeNull();
    expect(trap?.tabIndex).toBe(-1);
    expect(trap?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap?.value).toBe('');
  });

  it('explains a refused reply address and keeps the text', async () => {
    server(() =>
      Response.json(
        { errors: { replyTo: ['invalid'] } },
        { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    );
    const user = userEvent.setup();
    render(<Contact />);

    await user.type(screen.getByLabelText('Message'), 'Keep me');
    await user.type(screen.getByLabelText(/Your e-mail address/), 'not valid');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not a valid e-mail address');
    expect(screen.getByLabelText('Message')).toHaveValue('Keep me');
  });

  it('tells how long to wait when a rate limit answers 429', async () => {
    server(
      () =>
        new Response(null, {
          status: 429,
          headers: { 'Retry-After': '120', 'Content-Type': 'application/problem+json' },
        }),
    );
    const user = userEvent.setup();
    render(<Contact />);

    await user.type(screen.getByLabelText('Message'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 120 seconds');
  });

  it('fetches a new token and sends once more when the first one is refused as expired', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      server((_, attempt) =>
        attempt === 1
          ? Response.json(
              { code: 'contact-token' },
              { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
            )
          : new Response(null, { status: 202 }),
      );
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
      render(<Contact />);

      await user.type(screen.getByLabelText('Message'), 'Hello');
      await user.click(screen.getByRole('button', { name: 'Send message' }));
      await vi.advanceTimersByTimeAsync(2500);

      expect(await screen.findByText('Message sent')).toBeInTheDocument();
      expect(posts.map((p) => p.token)).toEqual(['token-1', 'token-2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows an offline message when the network fails', async () => {
    fetchMock.mockImplementation((input) =>
      String(input) === '/api/contact/form-token'
        ? Promise.resolve(Response.json({ token: 't', minFillSeconds: 2 }))
        : Promise.reject(new TypeError('Failed to fetch')),
    );
    const user = userEvent.setup();
    render(<Contact />);

    await user.type(screen.getByLabelText('Message'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No connection');
  });

  it('prefills a report with the link of the page, which the sender can edit', async () => {
    server(() => new Response(null, { status: 202 }));
    window.location.hash = reportHref(TOKEN);

    render(<Contact />);

    expect(screen.getByLabelText('Topic')).toHaveValue('report');
    expect(screen.getByLabelText('Message')).toHaveValue(
      `Reported page: ${window.location.origin}/#/s/${TOKEN}\n\n`,
    );
    expect(screen.getByText(/You can edit or remove it/)).toBeInTheDocument();
  });

  it('is available in French', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr']);
    resetLanguage();
    server(() => new Response(null, { status: 202 }));

    render(<Contact />);

    expect(screen.getByRole('button', { name: 'Envoyer le message' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sujet')).toBeInTheDocument();
  });
});
