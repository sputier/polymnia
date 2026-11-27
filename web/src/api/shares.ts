// Share link endpoints (docs/sharing.md). The owner's calls go through apiFetch (session + antiforgery); the public
// read is a plain request that carries nothing about the visitor.
import { apiFetch, apiJson, toApiError } from './client';

export interface ShareStatus {
  active: boolean;
  createdAt: string | null;
}

export interface ShareCreated {
  /** The raw token: only ever returned by the creation. */
  token: string;
  createdAt: string;
}

const base = (scoreId: string) => `/api/scores/${encodeURIComponent(scoreId)}/share`;

export function getShareStatus(scoreId: string, signal?: AbortSignal): Promise<ShareStatus> {
  return apiJson<ShareStatus>(base(scoreId), signal ? { signal } : {});
}

/** Creates the link, or replaces it (the previous one stops working at once). */
export function createShareLink(scoreId: string): Promise<ShareCreated> {
  return apiJson<ShareCreated>(base(scoreId), { method: 'POST' });
}

export async function revokeShareLink(scoreId: string): Promise<void> {
  const response = await apiFetch(base(scoreId), { method: 'DELETE' });
  if (!response.ok) throw await toApiError(response);
}

/**
 * The full link the owner copies. The token is in the URL fragment (`#/s/<token>`): a browser never sends the
 * fragment to a server, so the page load, the access logs and `Referer` never see it.
 */
export function shareUrl(token: string): string {
  return `${window.location.origin}/#/s/${encodeURIComponent(token)}`;
}

/** The score behind a share link, as JSON text. No cookie, no referrer, never cached. */
export async function loadSharedScore(token: string, signal?: AbortSignal): Promise<string> {
  // The token goes in a header, never in the URL: no access log, logging scope or Referer can then carry it.
  const response = await fetch('/api/shared', {
    headers: { 'X-Share-Token': token },
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await toApiError(response);
  return response.text();
}
