// jsdom refuses "__Host-" cookies on an http origin (they require Secure), so tests use a plain in-memory
// jar behind document.cookie. Install it in beforeEach, remove it in afterEach.
const jar = new Map<string, string>();

export function installCookieJar(): void {
  jar.clear();
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
    set: (raw: string) => {
      const [pair = '', ...attributes] = raw.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((a) => a.trim().toLowerCase() === 'max-age=0');
      if (expired || value === '') jar.delete(name);
      else jar.set(name, value);
    },
  });
}

export function removeCookieJar(): void {
  jar.clear();
  delete (document as { cookie?: string }).cookie;
}
