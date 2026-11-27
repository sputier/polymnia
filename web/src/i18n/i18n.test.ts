import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { detectLanguage, LANGUAGE_STORAGE_KEY } from './i18n';

afterEach(() => vi.restoreAllMocks());

describe('catalogs', () => {
  it('French defines exactly the English keys, all non-empty', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const value of Object.values(fr)) expect(value.trim()).not.toBe('');
  });
});

describe('lazy catalogs', () => {
  it('downloads a catalog on first use only, and switches once it is there', async () => {
    vi.resetModules();
    localStorage.clear();
    const fresh = await import('./i18n');
    // Nothing is loaded up front: a message falls back to its key.
    expect(fresh.messageIn('fr', 'app.tagline')).toBe('app.tagline');

    await fresh.loadCatalog('en');
    expect(fresh.messageIn('en', 'app.tagline')).toBe(en['app.tagline']);
    expect(fresh.messageIn('fr', 'app.tagline')).toBe(en['app.tagline']); // English is the fallback

    await fresh.setLanguage('fr');
    expect(fresh.messageIn('fr', 'app.tagline')).toBe(fr['app.tagline']);
    expect(document.documentElement.lang).toBe('fr');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr');
  });
});

describe('detectLanguage', () => {
  it('uses the first supported browser language', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE', 'fr-CA', 'en']);
    expect(detectLanguage()).toBe('fr');
  });

  it('falls back to English when nothing is supported', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de', 'ja']);
    expect(detectLanguage()).toBe('en');
  });

  it('prefers a stored choice over the browser', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr');
    expect(detectLanguage()).toBe('fr');
  });

  it('ignores an invalid stored value and survives unavailable storage', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr']);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, '<script>');
    expect(detectLanguage()).toBe('fr');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(detectLanguage()).toBe('fr');
  });
});
