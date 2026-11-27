// The server brings the browser back to a local path, but the part after `#` (which score was open) never
// reaches it. The hash is kept for the round trip and restored once the user is signed in again.
const KEY = 'polymnia.returnHash';

/** Remembers the current screen before leaving for the sign-in page. */
export function rememberReturn(): void {
  try {
    const hash = window.location.hash;
    if (hash && hash !== '#/') sessionStorage.setItem(KEY, hash);
  } catch {
    // Storage unavailable: the user lands on the library.
  }
}

/** The screen to go back to, once; only a local hash route is accepted. */
export function consumeReturn(): string | undefined {
  try {
    const hash = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return hash && /^#\/[\w\-./%?=&]*$/.test(hash) ? hash : undefined;
  } catch {
    return undefined;
  }
}
