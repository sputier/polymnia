import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { preloadScript } from '../../vite-plugins/routePreload';
import { parseRoute } from './useRoute';

// The generated route-preload.js duplicates the route and language detection of the app (it runs before the
// bundle): these tests keep both in step.

const LS = String.fromCharCode(0x2028); // line separator
const MAP: Record<string, string[]> = {
  library: ['assets/L.js'],
  score: ['assets/S.js'],
  editor: ['assets/E.js'],
  shared: ['assets/V.js'],
  privacy: ['assets/P.js'],
  en: ['assets/en.js'],
  fr: ['assets/fr.js'],
};
const FOR_ROUTE: Record<string, string> = {
  library: 'assets/L.js',
  score: 'assets/S.js',
  editor: 'assets/E.js',
  shared: 'assets/V.js',
  privacy: 'assets/P.js',
};

function preloaded(hash: string, stored: string | null, languages: string[]): string[] {
  const hrefs: string[] = [];
  runInNewContext(preloadScript(MAP), {
    location: { hash },
    localStorage: { getItem: () => stored },
    navigator: { languages, language: languages[0] },
    document: {
      head: { appendChild: (link: { href: string }) => hrefs.push(link.href) },
      createElement: () => ({}),
    },
  });
  return hrefs;
}

describe('route-preload.js', () => {
  it.each([
    '',
    '#/',
    '#/scores/abc',
    '#/scores/abc/',
    '#/scores/a/b',
    '#/editor',
    '#/editor?fixture=chords',
    '#/s/AbC_-123',
    '#/s/bad token',
    '#/privacy',
    '#/privacy/',
    '#/unknown',
  ])('preloads the chunk the app will render for %s', (hash) => {
    const route = parseRoute(hash).name;
    const key = route === 'library' || route in FOR_ROUTE ? route : 'library';
    expect(preloaded(hash, 'en', ['en'])).toEqual([`/${FOR_ROUTE[key]}`, '/assets/en.js']);
  });

  it('preloads the catalog the app will use: stored choice, then browser languages, then English', () => {
    expect(preloaded('#/', 'fr', ['en'])).toContain('/assets/fr.js');
    expect(preloaded('#/', null, ['de-DE', 'fr-CA'])).toContain('/assets/fr.js');
    expect(preloaded('#/', '<script>', ['de'])).toContain('/assets/en.js');
    expect(preloaded('#/', null, ['de'])).toContain('/assets/en.js');
  });

  it('escapes characters that could end the script or the line, whatever the chunk names', () => {
    const script = preloadScript({ ...MAP, library: [`assets/</script>${LS}&x.js`] });
    expect(script).not.toContain('</script');
    expect(script).not.toContain(LS);
    const hrefs: string[] = [];
    runInNewContext(script, {
      location: { hash: '#/' },
      localStorage: { getItem: () => 'en' },
      navigator: { languages: ['en'], language: 'en' },
      document: {
        head: { appendChild: (link: { href: string }) => hrefs.push(link.href) },
        createElement: () => ({}),
      },
    });
    expect(hrefs[0]).toBe(`/assets/</script>${LS}&x.js`);
  });

  it('never throws when storage is blocked', () => {
    const hrefs: string[] = [];
    runInNewContext(preloadScript(MAP), {
      location: { hash: '#/' },
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
      },
      navigator: { languages: ['fr'], language: 'fr' },
      document: {
        head: { appendChild: (link: { href: string }) => hrefs.push(link.href) },
        createElement: () => ({}),
      },
    });
    expect(hrefs).toContain('/assets/fr.js');
  });
});
