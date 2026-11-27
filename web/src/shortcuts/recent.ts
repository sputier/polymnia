/** Recently used palette commands, most recent first, kept in `localStorage` (failures ignored). */
export const RECENT_STORAGE_KEY = 'polymnia.recentCommands';
const MAX_RECENT = 8;

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

export function pushRecent(id: string): string[] {
  const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the list lasts until the page closes.
  }
  return next;
}
