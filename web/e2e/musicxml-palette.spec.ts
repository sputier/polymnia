import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

test('import and export are reachable from the command palette', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/#/editor');
  await page.getByRole('button', { name: 'Open the command palette' }).click();
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await search.fill('musicxml');
  await expect(page.getByRole('option', { name: /Import MusicXML/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Export as MusicXML/ })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('option', { name: /Export as MusicXML \(\.musicxml\)/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('score.musicxml');
  expect((await readFile((await file.path())!, 'utf8')).length).toBeGreaterThan(200);
});
