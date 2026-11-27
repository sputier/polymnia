import { apiFetch } from './client';

export interface CurrentUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  preferredLanguage: string | null;
}

/** The signed-in user, or `null` when anonymous (401). Any other failure throws. */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await apiFetch('/api/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
  return (await response.json()) as CurrentUser;
}

export async function signOut(): Promise<void> {
  const response = await apiFetch('/api/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
}
