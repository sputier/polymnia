import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCookieJar, removeCookieJar } from '../test-cookies';
import { ApiError, XSRF_COOKIE } from './client';
import {
  deleteScore,
  duplicateScore,
  encodeScoreBody,
  isNetworkError,
  listScores,
  loadScore,
  parseETag,
  patchScore,
  renameScore,
  saveScore,
} from './scores';

const fetchMock = vi.fn<typeof fetch>();
const formats: string[] = [];

beforeEach(() => {
  fetchMock.mockReset();
  // jsdom has no CompressionStream: a stand-in that passes the bytes through and records the format.
  class FakeCompression extends TransformStream<Uint8Array, Uint8Array> {
    constructor(format: string) {
      super();
      formats.push(format);
    }
  }
  formats.length = 0;
  vi.stubGlobal('CompressionStream', FakeCompression);
  vi.stubGlobal('fetch', fetchMock);
  installCookieJar();
  document.cookie = `${XSRF_COOKIE}=tok; path=/`;
});

afterEach(() => {
  document.cookie = `${XSRF_COOKIE}=; path=/; max-age=0`;
  vi.unstubAllGlobals();
  removeCookieJar();
});

const init = (call = 0) => fetchMock.mock.calls[call]![1] as RequestInit;
const header = (name: string, call = 0) => new Headers(init(call).headers).get(name);

describe('parseETag', () => {
  it('reads a quoted version', () => {
    expect(parseETag('"3"')).toBe(3);
    expect(parseETag('W/"12"')).toBe(12);
  });
  it('refuses anything else', () => {
    expect(parseETag(null)).toBeUndefined();
    expect(parseETag('3')).toBeUndefined();
    expect(parseETag('"abc"')).toBeUndefined();
  });
});

describe('encodeScoreBody', () => {
  it('leaves a small body as plain JSON', async () => {
    const { body, headers } = await encodeScoreBody('{"a":1}');
    expect(body).toBe('{"a":1}');
    expect(headers['Content-Encoding']).toBeUndefined();
  });

  it('compresses a large body with gzip and says so', async () => {
    const text = JSON.stringify({ rests: 'r'.repeat(5000) });
    const { body, headers } = await encodeScoreBody(text);
    expect(formats).toEqual(['gzip']);
    expect(headers['Content-Encoding']).toBe('gzip');
    expect((body as Blob).size).toBe(text.length);
  });

  it('falls back to plain JSON without CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const text = 'x'.repeat(5000);
    const { body, headers } = await encodeScoreBody(text);
    expect(body).toBe(text);
    expect(headers['Content-Encoding']).toBeUndefined();
  });
});

describe('score requests', () => {
  it('lists with the search and paging in the query', async () => {
    fetchMock.mockResolvedValue(Response.json({ items: [], page: 2, pageSize: 50, total: 0 }));
    await listScores({ q: 'moon & sun', page: 2, pageSize: 50 });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/scores?page=2&pageSize=50&q=moon+%26+sun');
  });

  it('reads the version of a score from its ETag', async () => {
    fetchMock.mockResolvedValue(new Response('{"schemaVersion":1}', { headers: { ETag: '"7"' } }));
    expect(await loadScore('abc')).toEqual({ text: '{"schemaVersion":1}', version: 7 });
  });

  it('rejects a score without a version', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    await expect(loadScore('abc')).rejects.toThrow();
  });

  it('saves with If-Match, the token and a gzip body', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'abc', version: 4 }));
    await saveScore('abc', 'y'.repeat(4000), 3);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/scores/abc');
    expect(init().method).toBe('PUT');
    expect(header('If-Match')).toBe('"3"');
    expect(header('Content-Encoding')).toBe('gzip');
    expect(header('X-XSRF-TOKEN')).toBe('tok');
  });

  it('patches the content with If-Match, the token and the JSON text as is', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'abc', version: 4 }));
    const text = '{"ops":[{"op":"setSlurs","slurs":[]}]}';
    await patchScore('a b', text, 3);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/scores/a%20b/content');
    expect(init().method).toBe('PATCH');
    expect(header('If-Match')).toBe('"3"');
    expect(header('Content-Type')).toBe('application/json');
    expect(header('X-XSRF-TOKEN')).toBe('tok');
    expect(init().body).toBe(text);
  });

  it('rejects a patch the server refuses with the status of the answer', async () => {
    fetchMock.mockResolvedValue(Response.json({ title: 'Conflict' }, { status: 409 }));
    await expect(patchScore('abc', '{"ops":[]}', 3)).rejects.toMatchObject({ status: 409 });
  });

  it('renames with PATCH and If-Match', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'abc', version: 5 }));
    await renameScore('abc', 'New', 4);
    expect(init().method).toBe('PATCH');
    expect(header('If-Match')).toBe('"4"');
    expect(init().body).toBe('{"title":"New"}');
  });

  it('duplicates with POST', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'copy' }, { status: 201 }));
    await duplicateScore('abc');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/scores/abc/duplicate');
    expect(init().method).toBe('POST');
  });

  it('treats deleting a missing score as done', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(deleteScore('abc')).resolves.toBeUndefined();
  });
});

describe('errors', () => {
  it('carries the status, Retry-After and the problem type', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ type: 'urn:polymnia:problem:score-limit' }), {
        status: 409,
        headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '12' },
      }),
    );
    const error = await duplicateScore('abc').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).retryAfter).toBe(12);
    expect((error as ApiError).problemType).toBe('urn:polymnia:problem:score-limit');
  });

  it('tells a network failure from an HTTP one', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new ApiError(500))).toBe(false);
    expect(isNetworkError(new DOMException('x', 'AbortError'))).toBe(false);
  });
});
