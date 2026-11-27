import type { Page } from '@playwright/test';

export interface EngravingStats {
  ms: number;
  systems: number;
  drawn: number;
  reused: number;
  overflow: number;
  firstSystemMs: number;
  complete: boolean;
}

/** The app is behind the sign-in screen: mocks the API as signed in. Call it before `page.goto`. */
export async function mockSignedIn(page: Page): Promise<void> {
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: { id: 'u1', displayName: 'Ada Lovelace', avatarUrl: null, preferredLanguage: null },
    }),
  );
  await page.route('**/api/auth/antiforgery', (route) => route.fulfill({ status: 204 }));
}

/** Opens the editor on a fixture (see "preview hook" in docs/engraving.md) and waits for the engraving. */
export async function openFixture(page: Page, fixture: string, width?: number): Promise<void> {
  const query = `fixture=${fixture}${width ? `&width=${width}` : ''}`;
  await mockSignedIn(page);
  await page.goto(`/#/editor?${query}`);
  await page.waitForSelector('svg.pm-score .vf-pm-system', { state: 'attached' });
  await page.waitForFunction(() => (window as unknown as { __polymnia?: unknown }).__polymnia);
  await page.evaluate(() => document.fonts.ready);
}

export const FIXTURE_NAMES = [
  'auClairDeLaLune',
  'pianoGrandStaff',
  'chords',
  'triplets',
  'ties',
  'pickup',
  'guitarArpeggio',
  'guitarDropDCapo',
  'guitarTabFeatures',
  'ukuleleMelody',
  'celloClefChanges',
  'guitarChords',
  'ukuleleChords',
  'pianoChords',
  'accidentals',
] as const;
