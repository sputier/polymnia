import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

const FIXTURE = 'src/musicxml/fixtures/ode-to-joy-style.musicxml';

test.beforeEach(async ({ page }) => {
  await mockSignedIn(page);
});

test('export downloads a non-empty .musicxml and .mxl', async ({ page }) => {
  await page.goto('/#/editor');
  await page.getByLabel('Score title').fill('My étude');

  const xmlDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'MusicXML (.musicxml)' }).click();
  const xml = await xmlDownload;
  expect(xml.suggestedFilename()).toBe('My-etude.musicxml');
  const text = await readFile((await xml.path())!, 'utf8');
  expect(text.length).toBeGreaterThan(200);
  expect(text).toContain('<score-partwise version="4.0">');
  expect(text).toContain('<work-title>My étude</work-title>');

  const mxlDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Compressed MusicXML (.mxl)' }).click();
  const mxl = await mxlDownload;
  expect(mxl.suggestedFilename()).toBe('My-etude.mxl');
  const bytes = await readFile((await mxl.path())!);
  expect(bytes.length).toBeGreaterThan(100);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
});

test('the export menu is keyboard accessible', async ({ page }) => {
  await page.goto('/#/editor');
  const button = page.getByRole('button', { name: 'Export', exact: true });
  await button.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'MusicXML (.musicxml)' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Compressed MusicXML (.mxl)' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('import replaces the score after confirmation and shows the report', async ({ page }) => {
  await page.goto('/#/editor');
  await page.setInputFiles('input[type="file"]', FIXTURE);

  const confirm = page.getByRole('alertdialog', { name: 'Replace the current score?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('1 part(s) and 4 measure(s)');
  await confirm.getByRole('button', { name: 'Replace the score' }).click();

  const report = page.getByRole('dialog', { name: 'Import report' });
  await expect(report).toBeVisible();
  await expect(report).toContainText('staccato');
  await report.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByLabel('Score title')).toHaveValue('Ode to Joy');
  await page.waitForSelector('svg.pm-score .vf-pm-system', { state: 'attached' });
  const measures = await page.evaluate(
    () =>
      (
        window as unknown as {
          __polymnia: { store: { getState(): { score: { measures: unknown[] } } } };
        }
      ).__polymnia.store.getState().score.measures.length,
  );
  expect(measures).toBe(4);
});

test('import cancelled keeps the score; an unsafe file is refused', async ({ page }) => {
  await page.goto('/#/editor');
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Score title')).toHaveValue('');

  await page.setInputFiles('input[type="file"]', {
    name: 'evil.musicxml',
    mimeType: 'application/xml',
    buffer: Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE score-partwise [<!ENTITY a "b">]><score-partwise/>',
    ),
  });
  const error = page.getByRole('alertdialog', { name: 'Import failed' });
  await expect(error).toContainText('XML entities');
});
