import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { benchmarkScore } from '../engraving/previewScores';
import { exportPdf } from './index';
import { measurer, blocksFor, loadTextFont, needsUnicode } from './textFont';
import { buildPdf } from './pdf';
import { textWidth, type Page } from './pages';
import type { TextItem } from './svgItems';

/** Extracts the text of every page with pdf.js, the reference reader. */
async function extract(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await task.destroy();
  return pages;
}

const text = (s: string, x = 100, y = 100, align: TextItem['align'] = 'start'): TextItem => ({
  kind: 'text',
  x,
  y,
  size: 20,
  text: s,
  align,
});

const page = (...items: TextItem[]): Page => ({ width: 595.28, height: 841.89, items });

const INFO = { title: 'T', author: 'A', creator: 'Polymnia' };

describe('needsUnicode', () => {
  it('is false for Latin-1 and the Windows-1252 extras, true beyond', () => {
    expect(needsUnicode('Étude n°2 « ça » — fin…')).toBe(false);
    expect(needsUnicode('ł')).toBe(true);
    expect(needsUnicode('Ω')).toBe(true);
    expect(needsUnicode('Ж')).toBe(true);
    expect(needsUnicode('日本')).toBe(true);
  });

  it('asks for the latin block plus the scripts used, nothing for WinAnsi', () => {
    expect(blocksFor(['Étude']).size).toBe(0);
    expect([...blocksFor(['Ωδή'])].sort()).toEqual(['greek', 'latin']);
    expect([...blocksFor(['Этюд ł'])].sort()).toEqual(['cyrillic', 'latin', 'latin-ext']);
  });
});

describe('Unicode text in the PDF', () => {
  it('extracts é ł ß Ω Ж and mixed scripts exactly as written (pdf.js)', async () => {
    const samples = ['é ł ß Ω Ж', 'Этюд — Ωδή — Étude', 'Łódź Žižek Ünïcödé', 'Ὀδυσσεύς Ґанок'];
    const font = await loadTextFont(samples);
    const bytes = buildPdf([page(...samples.map((s, i) => text(s, 50, 100 + i * 40)))], INFO, font);
    const [extracted] = await extract(bytes);
    for (const s of samples) expect(extracted).toContain(s);
  });

  it('keeps the common case on Helvetica: no Unicode font, no table loaded', async () => {
    expect(await loadTextFont(['Étude pour piano', 'J. S. Bach'])).toBeUndefined();
    const bytes = buildPdf([page(text('Étude pour piano'))], INFO);
    const raw = Buffer.from(bytes).toString('latin1');
    expect(raw).not.toContain('/Type0');
    const [extracted] = await extract(bytes);
    expect(extracted).toContain('Étude pour piano');
  });

  it('draws outlines (filled paths) and an invisible text layer in render mode 3', async () => {
    const font = (await loadTextFont(['Ω']))!;
    const bytes = buildPdf([page(text('Ω'))], INFO, font);
    const raw = Buffer.from(bytes).toString('latin1');
    expect(raw).toContain('/Subtype /Type0');
    expect(raw).toContain('/ToUnicode');
    expect(raw).not.toContain('/FontFile');
  });

  it('CJK: extractable, drawn as ? and reported as missing', async () => {
    const font = (await loadTextFont(['日本 Ж']))!;
    const bytes = buildPdf([page(text('日本 Ж'))], INFO, font);
    const [extracted] = await extract(bytes);
    expect(extracted).toContain('日本 Ж');
    expect([...font.missing].sort()).toEqual([0x65e5, 0x672c]);
  });

  it('exportPdf: a Cyrillic and Greek title is extractable and reports what it cannot draw', async () => {
    const title = 'Этюд — Ωδή — Étude 日本';
    const file = await exportPdf(benchmarkScore(8), title, 'a4');
    const [first] = await extract(file.bytes);
    expect(first).toContain('Этюд — Ωδή — Étude');
    expect(first).toContain('日本');
    expect(Object.keys(file.dropped).sort()).toEqual(['pdf-text-U+65E5', 'pdf-text-U+672C']);
  }, 20_000);

  it('exportPdf: a Latin-1 title reports nothing and loads nothing', async () => {
    const file = await exportPdf(benchmarkScore(8), 'Étude n°2', 'a4');
    expect(file.dropped).toEqual({});
    expect(Buffer.from(file.bytes).toString('latin1')).not.toContain('/Type0');
  }, 20_000);

  it('truncates a long Cyrillic title with Inter widths so it fits the page', async () => {
    const title = 'Ж'.repeat(200);
    const font = (await loadTextFont([title]))!;
    const measure = measurer(font, textWidth);
    expect(measure('Ж', 20)).toBeGreaterThan(textWidth('Ж', 20) * 0.9);
    const file = await exportPdf(benchmarkScore(4), title, 'a4');
    const [first] = await extract(file.bytes);
    expect(first).toContain('...');
  }, 20_000);
});

describe('Inter outline tables', () => {
  const dir = resolve('src/export/inter');
  const read = (name: string) => readFileSync(join(dir, `${name}.json`));

  it('cover Latin Extended-A, Greek, Cyrillic and the WinAnsi punctuation', async () => {
    const letters = [
      'ĀāĂăĄąĆćČčĎďĐđĒēĘęĚěĞğĪīİıŁłŃńŇňŌōŐőŒœŘřŚśŞşŠšŢţŤťŪūŮůŰűŸŹźŻżŽž',
      'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψωάέήίόύώΪΫϊϋ',
      'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяЁёЄєІіЇїҐґ',
      '—–‘’“”…€•ŒœŠšŽžŸƒˆ˜ıABCXYZabcxyz0123456789',
    ].join('');
    const font = (await loadTextFont([letters]))!;
    const missing = [...letters].filter((c) => !font.glyph(c.codePointAt(0)!));
    expect(missing).toEqual([]);
  });

  it('every block stays within its size budget (the files are fetched on demand)', () => {
    const budgets: Record<string, number> = {
      latin: 20_000,
      'latin-ext': 42_000,
      greek: 20_000,
      cyrillic: 22_000,
    };
    for (const [name, max] of Object.entries(budgets)) {
      const gz = gzipSync(read(name), { level: 9 }).length;
      expect(gz, `${name} is ${gz} bytes gzip`).toBeLessThanOrEqual(max);
    }
    // A Cyrillic title loads latin + cyrillic only: well under the 70 KB export budget.
    const need = gzipSync(read('latin')).length + gzipSync(read('cyrillic')).length;
    expect(need).toBeLessThan(45_000);
    expect(statSync(join(dir, 'latin.json')).size).toBeGreaterThan(0);
  });
});
