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

/** Opens the editor on a fixture (see "preview hook" in docs/engraving.md) and waits for the engraving. */
export async function openFixture(page: Page, fixture: string, width?: number): Promise<void> {
  const query = `fixture=${fixture}${width ? `&width=${width}` : ''}`;
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
  'ukuleleMelody',
  'celloClefChanges',
  'accidentals',
] as const;
