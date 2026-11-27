// The public contact form (docs/contact.md). Not apiFetch: a signed-out visitor has no antiforgery cookie, so the
// signed form token from GET /api/contact/form-token plays that role, and no /api/auth call is needed.

export const CONTACT_TOPICS = ['personal-data', 'question', 'report', 'other'] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/** Same limit as the server (ContactLimits.MaxMessageLength). */
export const CONTACT_MAX_LENGTH = 2000;

export interface ContactFields {
  topic: ContactTopic;
  message: string;
  /** Empty when the visitor gave none. */
  replyTo: string;
  /** The honeypot: a field people never see. */
  website: string;
}

/** A refused request. `code` is the server's machine-readable problem code; `fields` the invalid fields. */
export class ContactError extends Error {
  readonly status: number;
  readonly retryAfter: number | undefined;
  readonly code: string | undefined;
  readonly fields: readonly string[];

  constructor(status: number, details: { retryAfter?: number; code?: string; fields?: string[] }) {
    super(`Contact request failed with status ${status}`);
    this.name = 'ContactError';
    this.status = status;
    this.retryAfter = details.retryAfter;
    this.code = details.code;
    this.fields = details.fields ?? [];
  }
}

async function failure(response: Response): Promise<ContactError> {
  const header = Number(response.headers.get('Retry-After'));
  let code: string | undefined;
  let fields: string[] = [];
  try {
    const problem: unknown = await response.json();
    const p = problem as { code?: unknown; errors?: unknown } | null;
    if (typeof p?.code === 'string') code = p.code;
    if (p?.errors && typeof p.errors === 'object') fields = Object.keys(p.errors);
  } catch {
    // Not a problem document.
  }
  return new ContactError(response.status, {
    ...(Number.isFinite(header) && header > 0 ? { retryAfter: header } : {}),
    ...(code === undefined ? {} : { code }),
    fields,
  });
}

/** A new form token. The server refuses a token used less than `minFillSeconds` after it was issued. */
export async function fetchFormToken(): Promise<{ token: string; minFillSeconds: number }> {
  const response = await fetch('/api/contact/form-token', {
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { token?: unknown; minFillSeconds?: unknown };
  if (typeof body.token !== 'string' || body.token === '') throw new Error('No form token.');
  return {
    token: body.token,
    minFillSeconds: typeof body.minFillSeconds === 'number' ? body.minFillSeconds : 2,
  };
}

/** `POST /api/contact`: resolves on `202`. */
export async function sendContact(token: string, fields: ContactFields): Promise<void> {
  const response = await fetch('/api/contact', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: fields.topic,
      message: fields.message,
      replyTo: fields.replyTo.trim() === '' ? null : fields.replyTo.trim(),
      website: fields.website,
      token,
    }),
  });
  if (!response.ok) throw await failure(response);
}
