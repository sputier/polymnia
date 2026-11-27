import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XSRF_COOKIE } from '../api/client';
import { resetLanguage } from '../i18n/i18n';
import { installCookieJar, removeCookieJar } from '../test-cookies';
import { AccountMenu } from './AccountMenu';
import { SessionProvider } from './session';
import { SessionGate } from './SessionGate';

const fetchMock = vi.fn<typeof fetch>();

const me = { id: 'u1', displayName: 'Ada Lovelace', avatarUrl: null, preferredLanguage: null };

const legal = {
  configured: true,
  operatorName: 'Example Operator',
  contact: 'privacy@polymnia.example',
  contactKind: 'email',
  address: null,
  hostingProvider: 'Example Hosting',
  hostingCountry: 'Exampleland',
  logRetentionDays: 14,
  sessionIdleDays: 7,
  sessionAbsoluteDays: 30,
};

function respond(handlers: Record<string, (init?: RequestInit) => Response>) {
  fetchMock.mockImplementation((input, init) => {
    const handler = handlers[`${init?.method ?? 'GET'} ${String(input)}`];
    return Promise.resolve(handler ? handler(init) : new Response(null, { status: 404 }));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  installCookieJar();
  document.cookie = `${XSRF_COOKIE}=tok; path=/`;
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
  resetLanguage();
  window.location.hash = '';
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  removeCookieJar();
  window.location.hash = '';
  sessionStorage.clear();
});

describe('privacy page', () => {
  it('is shown to an anonymous visitor with the operator details from the server', async () => {
    respond({
      'GET /api/me': () => new Response(null, { status: 401 }),
      'GET /api/legal': () => Response.json(legal),
    });
    window.location.hash = '#/privacy';

    render(
      <SessionProvider>
        <SessionGate>
          <p>app</p>
        </SessionGate>
      </SessionProvider>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
    expect(await screen.findByText('Example Operator')).toBeVisible();
    expect(screen.getByRole('link', { name: 'privacy@polymnia.example' })).toHaveAttribute(
      'href',
      'mailto:privacy@polymnia.example',
    );
    expect(
      screen.getByText(/after 7 days without use, and never lasts more than 30 days/),
    ).toBeVisible();
    expect(screen.getByText(/Security logs: 14 days\./)).toBeVisible();
    expect(screen.queryByText('app')).toBeNull();
  });

  it('is available in French', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr']);
    resetLanguage();
    respond({
      'GET /api/me': () => new Response(null, { status: 401 }),
      'GET /api/legal': () => Response.json(legal),
    });
    window.location.hash = '#/privacy';

    render(
      <SessionProvider>
        <SessionGate>
          <p>app</p>
        </SessionGate>
      </SessionProvider>,
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Politique de confidentialité' }),
    ).toBeVisible();
    expect(await screen.findByText(/Journaux de sécurité : 14 jours\./)).toBeVisible();
  });

  it('shows a clear placeholder when the operator is not configured, and never links an unsafe contact', async () => {
    respond({
      'GET /api/me': () => new Response(null, { status: 401 }),
      'GET /api/legal': () =>
        Response.json({
          ...legal,
          configured: false,
          operatorName: null,
          contact: 'javascript:alert(1)',
          contactKind: null,
        }),
    });
    window.location.hash = '#/privacy';

    render(
      <SessionProvider>
        <SessionGate>
          <p>app</p>
        </SessionGate>
      </SessionProvider>,
    );

    expect(await screen.findByText('Operator details not configured')).toBeVisible();
    expect(screen.queryByRole('link', { name: /javascript/ })).toBeNull();
  });

  it('offers a retry when the details cannot be loaded', async () => {
    let calls = 0;
    respond({
      'GET /api/me': () => new Response(null, { status: 401 }),
      'GET /api/legal': () =>
        ++calls === 1 ? new Response(null, { status: 500 }) : Response.json(legal),
    });
    window.location.hash = '#/privacy';

    render(
      <SessionProvider>
        <SessionGate>
          <p>app</p>
        </SessionGate>
      </SessionProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Example Operator')).toBeVisible();
  });

  it('is linked from the sign-in screen', async () => {
    respond({ 'GET /api/me': () => new Response(null, { status: 401 }) });

    render(
      <SessionProvider>
        <SessionGate>
          <p>app</p>
        </SessionGate>
      </SessionProvider>,
    );

    expect(await screen.findByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '#/privacy',
    );
  });
});

function mountMenu() {
  return render(
    <SessionProvider>
      <SessionGate>
        <AccountMenu />
      </SessionGate>
    </SessionProvider>,
  );
}

async function openDeleteDialog() {
  await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete my account' }));
  return screen.findByRole('dialog', { name: 'Delete your account' });
}

describe('account menu', () => {
  it('links the privacy policy, exports the data and asks for a typed confirmation before deleting', async () => {
    respond({
      'GET /api/me': () => Response.json(me),
      'GET /api/auth/antiforgery': () => new Response(null, { status: 204 }),
      'DELETE /api/me': (init) => {
        expect(new Headers(init?.headers).get('X-XSRF-TOKEN')).toBe('tok');
        return new Response(null, { status: 204 });
      },
    });
    mountMenu();

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
    expect(screen.getByRole('menuitem', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '#/privacy',
    );
    expect(screen.getByRole('menuitem', { name: 'Export my data' })).toBeVisible();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete my account' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete your account' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete my account' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'nope');
    expect(confirm).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText('Type DELETE to confirm'));
    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'delete');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    // The session is over: sign-in screen with a notice.
    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your account and all its data were deleted.',
    );
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });

  it('asks to sign in again when the server requires a recent sign-in, and keeps the account', async () => {
    respond({
      'GET /api/me': () => Response.json(me),
      'GET /api/auth/antiforgery': () => new Response(null, { status: 204 }),
      'DELETE /api/me': () =>
        Response.json({ status: 403, code: 'reauth-required' }, { status: 403 }),
    });
    mountMenu();

    const dialog = await openDeleteDialog();
    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }));

    const again = await screen.findByRole('dialog', { name: 'Sign in again to continue' });
    const link = within(again).getByRole('link', { name: 'Sign in again' });
    expect(link).toHaveAttribute('href', '/api/auth/login?reauth=true');
    expect(screen.queryByRole('link', { name: 'Sign in with Google' })).toBeNull();
  });

  it('reports a rate-limited deletion without closing the dialog', async () => {
    respond({
      'GET /api/me': () => Response.json(me),
      'GET /api/auth/antiforgery': () => new Response(null, { status: 204 }),
      'DELETE /api/me': () => new Response(null, { status: 429, headers: { 'Retry-After': '30' } }),
    });
    mountMenu();

    const dialog = await openDeleteDialog();
    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }));

    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Try again in 30 s.'),
    );
  });

  it('downloads the export through the API and reports a failure', async () => {
    const created: Blob[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return 'blob:test';
      },
      revokeObjectURL: () => {},
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let status = 200;
    respond({
      'GET /api/me': () => Response.json(me),
      'GET /api/me/export': () =>
        status === 200
          ? new Response(new Uint8Array([80, 75, 3, 4]), {
              headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="polymnia-export-20261127.zip"',
              },
            })
          : new Response(null, { status }),
    });
    mountMenu();

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Export my data' }));
    expect(await screen.findByText('Your data was downloaded.')).toBeVisible();
    expect(click).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);

    status = 500;
    await userEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Export my data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
