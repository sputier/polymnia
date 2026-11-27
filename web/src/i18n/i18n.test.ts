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
