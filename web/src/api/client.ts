// Small same-origin API client. The session lives in an HttpOnly cookie the page cannot read; the only
// secret JavaScript handles is the antiforgery request token, which the server hands out in a readable
// cookie and which is echoed in a header on every state-changing request.

export const XSRF_COOKIE = '__Host-XSRF-TOKEN';
export const XSRF_HEADER = 'X-XSRF-TOKEN';
const ANTIFORGERY_URL = '/api/auth/antiforgery';
const ANTIFORGERY_PROBLEM_CODE = 'antiforgery';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  readonly status: number;
  /** Seconds to wait before retrying, from the `Retry-After` header (429). */
  readonly retryAfter: number | undefined;
  /** The `type` of the problem document (RFC 9457), for example `urn:polymnia:problem:score-limit`. */
  readonly problemType: string | undefined;

  constructor(status: number, details: { retryAfter?: number; problemType?: string } = {}) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = details.retryAfter;
    this.problemType = details.problemType;
  }
}

/** An ApiError for a failed response, with the Retry-After delay and the problem type when present. */
export async function toApiError(response: Response): Promise<ApiError> {
  const header = Number(response.headers.get('Retry-After'));
  const retryAfter = Number.isFinite(header) && header > 0 ? header : undefined;
  let problemType: string | undefined;
  try {
    const problem: unknown = await response.clone().json();
    const type = (problem as { type?: unknown } | null)?.type;
    if (typeof type === 'string') problemType = type;
  } catch {
    // Not a problem document.
  }
  return new ApiError(response.status, {
    ...(retryAfter === undefined ? {} : { retryAfter }),
    ...(problemType === undefined ? {} : { problemType }),
  });
}

export function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

/** Asks the server for a token for the current identity (anonymous or signed in) and returns it. */
export async function refreshAntiforgeryToken(): Promise<string> {
  const response = await fetch(ANTIFORGERY_URL, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status);
  const token = readCookie(XSRF_COOKIE);
  if (!token) throw new Error('The server did not provide an antiforgery token.');
  return token;
}

function isUnsafe(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

async function isAntiforgeryRejection(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  try {
    const problem: unknown = await response.clone().json();
    return (
      typeof problem === 'object' &&
      problem !== null &&
      (problem as { code?: unknown }).code === ANTIFORGERY_PROBLEM_CODE
    );
  } catch {
    return false;
  }
}

function send(path: string, init: RequestInit, token: string | undefined): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set(XSRF_HEADER, token);
  return fetch(path, { ...init, headers, credentials: 'same-origin' });
}

/**
 * fetch() for the API: same-origin credentials, and the antiforgery header on POST, PUT, PATCH and DELETE.
 * A missing token is fetched first; a token the server rejects (for example one issued before sign-in)
 * is replaced and the request is sent once more, which is safe because the server refuses it before running it.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  if (!isUnsafe(method)) return send(path, init, undefined);

  const token = readCookie(XSRF_COOKIE) ?? (await refreshAntiforgeryToken());
  const response = await send(path, init, token);
  if (!(await isAntiforgeryRejection(response))) return response;

  return send(path, init, await refreshAntiforgeryToken());
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}
