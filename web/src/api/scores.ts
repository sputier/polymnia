// Score endpoints (docs/api.md). Versions travel as ETags ("3"); every write states the version it was
// based on (If-Match), so a concurrent change is a 409 and never a silent overwrite.
import { ApiError, apiFetch, apiJson, toApiError } from './client';

export interface ScoreListItem {
  id: string;
  title: string;
  schemaVersion: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Preview computed by the server from the content (the content itself is never listed). */
  measureCount: number;
  /** Catalog instrument id of each part. */
  instruments: string[];
}

export interface ScorePage {
  items: ScoreListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ScoreSummary {
  id: string;
  title: string;
  schemaVersion: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedScore {
  id: string;
  title: string;
  schemaVersion: number;
  version: number;
  updatedAt: string;
}

export interface LoadedScore {
  /** JSON text of the document. */
  text: string;
  version: number;
}

export const SCORE_LIMIT_PROBLEM = 'urn:polymnia:problem:score-limit';
/** The user's total storage is full (413): not the same as one score being too large. */
export const STORAGE_QUOTA_PROBLEM = 'urn:polymnia:problem:quota-exceeded';

/** Bodies smaller than this are not worth compressing. */
const GZIP_THRESHOLD = 1024;

/** `"3"` -> 3. */
export function parseETag(value: string | null): number | undefined {
  const match = /^(?:W\/)?"(\d+)"$/.exec(value?.trim() ?? '');
  return match ? Number(match[1]) : undefined;
}

const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** True for a failure that never reached the server (offline, DNS, connection reset), not an HTTP status. */
export function isNetworkError(error: unknown): boolean {
  return (
    !(error instanceof ApiError) && !(error instanceof DOMException && error.name === 'AbortError')
  );
}

/**
 * The request body for a score: gzip-compressed (`Content-Encoding: gzip`, accepted by the API) when the browser
 * has `CompressionStream` and the document is big enough to benefit, plain JSON otherwise.
 */
export async function encodeScoreBody(
  text: string,
): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  if (typeof CompressionStream === 'undefined' || text.length < GZIP_THRESHOLD) {
    return { body: text, headers: JSON_HEADERS };
  }
  try {
    const source = new Response(text).body;
    if (!source) return { body: text, headers: JSON_HEADERS };
    const stream = source.pipeThrough(new CompressionStream('gzip'));
    const body = await new Response(stream).blob();
    return { body, headers: { ...JSON_HEADERS, 'Content-Encoding': 'gzip' } };
  } catch {
    return { body: text, headers: JSON_HEADERS };
  }
}

export interface ListOptions {
  q?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

export function listScores({
  q,
  page = 1,
  pageSize = 50,
  signal,
}: ListOptions = {}): Promise<ScorePage> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) params.set('q', q);
  return apiJson<ScorePage>(`/api/scores?${params}`, signal ? { signal } : {});
}

export async function loadScore(id: string, signal?: AbortSignal): Promise<LoadedScore> {
  const response = await apiFetch(
    `/api/scores/${encodeURIComponent(id)}`,
    signal ? { signal } : {},
  );
  if (!response.ok) throw await toApiError(response);
  const version = parseETag(response.headers.get('ETag'));
  if (version === undefined) throw new Error('The server did not send the version of the score.');
  return { text: await response.text(), version };
}

/** Creates a score from its JSON document; the title is `meta.title`. */
export async function createScore(text: string): Promise<ScoreSummary> {
  return apiJson<ScoreSummary>('/api/scores', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: text,
  });
}

/** Replaces the document. Rejects with a 409 ApiError when `version` is not the current one. */
export async function saveScore(id: string, text: string, version: number): Promise<SavedScore> {
  const { body, headers } = await encodeScoreBody(text);
  return apiJson<SavedScore>(`/api/scores/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...headers, ...ifMatch(version) },
    body,
  });
}

/**
 * Applies an incremental save (the JSON text `{ "ops": [...] }`, see scoreOps.ts) to the document at `version`.
 * Rejects with a 409 ApiError when `version` is not the current one, and with a 400 or 413 when the server cannot
 * apply the operations to its document (the caller then saves the whole document).
 */
export function patchScore(id: string, text: string, version: number): Promise<SavedScore> {
  return apiJson<SavedScore>(`/api/scores/${encodeURIComponent(id)}/content`, {
    method: 'PATCH',
    headers: { ...JSON_HEADERS, ...ifMatch(version) },
    body: text,
  });
}

export function renameScore(id: string, title: string, version: number): Promise<SavedScore> {
  return apiJson<SavedScore>(`/api/scores/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...JSON_HEADERS, ...ifMatch(version) },
    body: JSON.stringify({ title }),
  });
}

export function duplicateScore(id: string): Promise<ScoreSummary> {
  return apiJson<ScoreSummary>(`/api/scores/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
  });
}

/** `keepalive` lets the request outlive the page (a deletion confirmed while the tab closes). */
export async function deleteScore(
  id: string,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  const response = await apiFetch(`/api/scores/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    ...(options.keepalive ? { keepalive: true } : {}),
  });
  if (!response.ok && response.status !== 404) throw await toApiError(response);
}
