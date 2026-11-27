import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { loadAllCatalogs } from './i18n/i18n';

// The catalogs are lazy chunks in the app; tests render synchronously, so they are loaded up front.
await loadAllCatalogs();

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList;
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
