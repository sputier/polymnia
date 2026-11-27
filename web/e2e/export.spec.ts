import { readFile } from 'node:fs/promises';
import { unzlibSync, unzipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedIn } from './engraving-helpers';

test.use({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1280, height: 900 } });

const ATTRIBUTES =
  '<attributes><divisions>1</divisions><key><fifths>0</fifths></key>' +
  '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>' +
  '<clef number="1"><sign>G</sign><line>2</line></clef>' +
  '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>';

const note = (step: string, duration: number, type: string, staff: number, octave: number) =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>` +
  `<voice>${staff}</voice><type>${type}</type><staff>${staff}</staff></note>`;

function measure(n: number): string {
  const treble = ['C', 'D', 'E', 'F'].map((s) => note(s, 1, 'quarter', 1, 5)).join('');
  const bass = ['C', 'G'].map((s) => note(s, 2, 'half', 2, 3)).join('');
  return `<measure number="${n}">${n === 1 ? ATTRIBUTES : ''}${treble}<backup><duration>4</duration></backup>${bass}</measure>`;
}

const scoreXml = (measures: number) =>
  '<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Long piece</work-title></work>' +
  '<identification><creator type="composer">A. Composer</creator></identification>' +
  '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
  `<part id="P1">${Array.from({ length: measures }, (_, i) => measure(i + 1)).join('')}</part></score-partwise>`;

async function importLong(page: Page, measures: number): Promise<void> {
  await page.setInputFiles('input[type="file"]', {
    name: 'long.musicxml',
    mimeType: 'application/xml',
    buffer: Buffer.from(scoreXml(measures)),
  });
  const confirm = page.getByRole('alertdialog', { name: 'Replace the current score?' });
  await confirm.getByRole('button', { name: 'Replace the score' }).click();
  await expect(confirm).toHaveCount(0);
}

async function exportAs(page: Page, item: string): Promise<{ name: string; bytes: Buffer }> {
  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: item }).click();
  const file = await download;
  return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) };
}

const measureMs = (page: Page, name: string) =>
  page.evaluate((n) => performance.getEntriesByName(n).at(-1)?.duration ?? -1, name);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.describe('export', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedIn(page);
    await page.goto('/#/editor');
  });

  test('MIDI: a Standard MIDI File', async ({ page }) => {
    const { name, bytes } = await exportAs(page, 'MIDI (.mid)');
    expect(name).toBe('score.mid');
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('MThd');
    expect(bytes.readUInt16BE(8)).toBe(1); // format 1
    expect(bytes.readUInt16BE(12)).toBe(960);
    expect(bytes.length).toBeGreaterThan(40);
  });

  test('PDF: a page per ~5 systems of a 100-measure score, black on white', async ({ page }) => {
    test.setTimeout(60_000);
    await importLong(page, 100);
    const { name, bytes } = await exportAs(page, 'PDF');
    expect(name).toBe('Long-piece.pdf');
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    const pages = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThan(3);
    expect(text.match(/\/Type \/Page /g)).toHaveLength(pages);
    expect(text).toContain('/MediaBox [0 0 612 792]'); // en-US: Letter
    // First content stream: white paper, then black ink only, with the title block.
    const stream = /\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/.exec(text)!;
    const start = stream.index + stream[0].length;
    const content = Buffer.from(
      unzlibSync(new Uint8Array(bytes.subarray(start, start + Number(stream[1])))),
    ).toString('latin1');
    expect(content.startsWith('1 g 0 0 612 792 re f')).toBe(true);
    expect(content).not.toMatch(/\b(rg|RG|k|K)\b/);
    expect(content).toContain('Tj'); // title, composer, page number
    expect(await measureMs(page, 'export:pdf')).toBeLessThan(3000);
  });

  test('PDF: A4 when chosen in the menu', async ({ page }) => {
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitemradio', { name: 'Paper: A4' }).click();
    const { bytes } = await exportAs(page, 'PDF');
    expect(bytes.toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]');
  });

  test('PNG: one image for a short score, a zip of images for a long one', async ({ page }) => {
    test.setTimeout(60_000);
    const one = await exportAs(page, 'PNG images');
    expect(one.name).toBe('score.png');
    expect(one.bytes.subarray(0, 8).equals(PNG)).toBe(true);
    // 2x of a 96 dpi Letter page.
    expect(one.bytes.readUInt32BE(16)).toBe(1632);
    expect(one.bytes.readUInt32BE(20)).toBe(2112);

    await importLong(page, 100);
    const many = await exportAs(page, 'PNG images');
    expect(many.name).toBe('Long-piece.zip');
    const files = unzipSync(new Uint8Array(many.bytes));
    const names = Object.keys(files);
    expect(names.length).toBeGreaterThan(3);
    expect(names[0]).toMatch(/^page-0*1\.png$/);
    for (const f of Object.values(files)) {
      expect(Buffer.from(f.subarray(0, 8)).equals(PNG)).toBe(true);
    }
    expect(await measureMs(page, 'export:png')).toBeLessThan(2000);
  });

  test('MIDI of a 100-measure score takes well under 50 ms', async ({ page }) => {
    await importLong(page, 100);
    await exportAs(page, 'MIDI (.mid)'); // loads the lazy chunk
    await exportAs(page, 'MIDI (.mid)');
    expect(await measureMs(page, 'export:midi')).toBeLessThan(50);
  });

  test('keyboard shortcuts export without the menu', async ({ page }) => {
    await page.waitForSelector('svg.pm-score .vf-pm-system', { state: 'attached' });
    for (const [keys, file] of [
      ['Control+Shift+U', 'score.mid'],
      ['Control+Shift+F', 'score.pdf'],
      ['Control+Shift+G', 'score.png'],
    ] as const) {
      const download = page.waitForEvent('download');
      await page.keyboard.press(keys);
      expect((await download).suggestedFilename()).toBe(file);
    }
  });

  test('the palette offers the three exports', async ({ page }) => {
    await page.getByRole('button', { name: 'Open the command palette' }).click();
    const search = page.getByRole('combobox', { name: 'Search commands' });
    await search.fill('export');
    for (const label of [/Export as MIDI/, /Export as PDF/, /Export as PNG/]) {
      await expect(page.getByRole('option', { name: label })).toBeVisible();
    }
    const download = page.waitForEvent('download');
    await page.getByRole('option', { name: /Export as PDF/ }).click();
    expect((await download).suggestedFilename()).toBe('score.pdf');
  });
});

test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });

  test('the PNG is black ink on a white page, not the dark UI colors', async ({ page }) => {
    await mockSignedIn(page);
    await page.goto('/#/editor');
    const { bytes } = await exportAs(page, 'PNG images');
    const stats = await page.evaluate(async (b64) => {
      const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], {
        type: 'image/png',
      });
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let white = 0;
      let dark = 0;
      let colored = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (r > 250 && g > 250 && b > 250) white++;
        if (r < 60 && g < 60 && b < 60) dark++;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 8) colored++;
      }
      return {
        pixels: data.length / 4,
        white,
        dark,
        colored,
        corner: Array.from(data.slice(0, 4)),
      };
    }, bytes.toString('base64'));
    expect(stats.corner).toEqual([255, 255, 255, 255]);
    expect(stats.white / stats.pixels).toBeGreaterThan(0.8);
    expect(stats.dark).toBeGreaterThan(500); // staff lines and noteheads
    expect(stats.colored).toBe(0);
  });

  test('the PDF is the same black on white', async ({ page }) => {
    await mockSignedIn(page);
    await page.goto('/#/editor');
    const { bytes } = await exportAs(page, 'PDF');
    const text = bytes.toString('latin1');
    const stream = /\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/.exec(text)!;
    const start = stream.index + stream[0].length;
    const content = Buffer.from(
      unzlibSync(new Uint8Array(bytes.subarray(start, start + Number(stream[1])))),
    ).toString('latin1');
    expect(content.startsWith('1 g 0 0 ')).toBe(true);
    expect(content).toContain('0 g 0 G');
    expect(content).not.toMatch(/\b(rg|RG|k|K)\b/);
  });
});
