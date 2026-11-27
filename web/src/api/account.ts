import { apiFetch, toApiError } from './client';

/** What `GET /api/legal` returns: who runs this instance (docs/privacy.md). */
export interface LegalInfo {
  configured: boolean;
  operatorName: string | null;
  contact: string | null;
  contactKind: 'email' | 'url' | null;
  address: string | null;
  hostingProvider: string | null;
  hostingCountry: string | null;
  logRetentionDays: number;
  sessionIdleDays: number;
  sessionAbsoluteDays: number;
}

export async function fetchLegal(): Promise<LegalInfo> {
  const response = await apiFetch('/api/legal');
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as LegalInfo;
}

export type DeleteOutcome = 'deleted' | 'reauth-required';

/** `DELETE /api/me`. A 403 with `code: "reauth-required"` means the person must sign in again first. */
export async function deleteAccount(): Promise<DeleteOutcome> {
  const response = await apiFetch('/api/me', { method: 'DELETE' });
  if (response.ok) return 'deleted';
  if (response.status === 403) {
    try {
      const problem: unknown = await response.clone().json();
      if ((problem as { code?: unknown } | null)?.code === 'reauth-required') {
        return 'reauth-required';
      }
    } catch {
      // Not a problem document: a plain failure.
    }
  }
  throw await toApiError(response);
}

const DELETED_FLAG = 'polymnia.accountDeleted';
const REOPEN_FLAG = 'polymnia.reopenDelete';

/** Remembered across the redirect to Google so the deletion dialog opens again after the new sign-in. */
export function rememberReopenDelete(): void {
  try {
    sessionStorage.setItem(REOPEN_FLAG, '1');
  } catch {
    // Storage unavailable: the person opens the dialog again.
  }
}

export function peekReopenDelete(): boolean {
  try {
    return sessionStorage.getItem(REOPEN_FLAG) === '1';
  } catch {
    return false;
  }
}

export function clearReopenDelete(): void {
  try {
    sessionStorage.removeItem(REOPEN_FLAG);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

export function rememberAccountDeleted(): void {
  try {
    sessionStorage.setItem(DELETED_FLAG, '1');
  } catch {
    // Storage unavailable: the sign-in screen simply does not mention it.
  }
}

export function peekAccountDeleted(): boolean {
  try {
    return sessionStorage.getItem(DELETED_FLAG) === '1';
  } catch {
    return false;
  }
}

export function clearAccountDeleted(): void {
  try {
    sessionStorage.removeItem(DELETED_FLAG);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

/**
 * `GET /api/me/export`: the ZIP (profile.json and one JSON file per score), saved through a temporary link. A
 * library is at most a few tens of MB once zipped (200 scores of 1 MB measure 11 MB), so it is read as a blob.
 */
export async function downloadExport(): Promise<void> {
  const response = await apiFetch('/api/me/export');
  if (!response.ok) throw await toApiError(response);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error('Empty export');

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download =
      filenameOf(response.headers.get('Content-Disposition')) ?? 'polymnia-export.zip';
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // The browser has started the download by the time the task queue runs again.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function filenameOf(disposition: string | null): string | undefined {
  const name = /filename="?([\w.-]+)"?/.exec(disposition ?? '')?.[1];
  return name?.endsWith('.zip') ? name : undefined;
}
