/**
 * MIDI, PDF and PNG export. This is the lazy entry point: the editor loads it with `import()` the
 * first time an export is chosen, so none of it is in the initial bundle.
 */
import { zipSync } from 'fflate';
import type { Score } from '../score';
import { encodeMidi } from './midi';
import { buildPage, planPages, printGeometry, type Page, type PagePlan, type Paper } from './pages';
import { buildPdf } from './pdf';
import { renderPng } from './png';

export type { Paper } from './pages';
export { PAPER_SIZES } from './pages';

export interface ExportFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
  readonly extension: string;
  /** What the format cannot hold, by name (feeds the export report). */
  readonly dropped: Readonly<Record<string, number>>;
  /** Pages written (PDF, PNG). */
  readonly pages?: number;
}

export interface Progress {
  readonly done: number;
  readonly total: number;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Records a User Timing measure (read by the browser performance test). */
async function timed<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    try {
      performance.measure(name, { start, end: performance.now() });
    } catch {
      // User Timing unavailable: nothing to record.
    }
  }
}

export function exportMidi(score: Score, title: string): Promise<ExportFile> {
  return timed('export:midi', () => {
    const { bytes, dropped } = encodeMidi(score, title);
    return { bytes, mime: 'audio/midi', extension: 'mid', dropped };
  });
}

interface Engraved {
  readonly plan: PagePlan;
  readonly svg: SVGSVGElement;
  readonly dispose: () => void;
}

/** Engraves the score at page width in an off-screen container. */
async function engrave(score: Score, paper: Paper, staffSpaceMm?: number): Promise<Engraved> {
  const { Engraver } = await import('../engraving/engraver');
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText =
    'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(container);
  const engraver = new Engraver(container);
  try {
    let geometry = printGeometry(paper, 0, staffSpaceMm);
    engraver.render(score, geometry.width);
    const tallest = Math.max(0, ...engraver.layout.systems.map((s) => s.height));
    const fitted = printGeometry(paper, tallest, staffSpaceMm);
    if (fitted.scale < geometry.scale) {
      // A system taller than a page (many parts): print smaller, which also widens the lines.
      geometry = fitted;
      engraver.render(score, geometry.width);
    }
    const plan: PagePlan = {
      paper,
      scale: geometry.scale,
      pages: planPages(engraver.layout, paper, geometry.scale),
      layout: engraver.layout,
    };
    return {
      plan,
      svg: engraver.svg,
      dispose: () => {
        engraver.destroy();
        container.remove();
      },
    };
  } catch (error) {
    engraver.destroy();
    container.remove();
    throw error;
  }
}

/** Builds every page in turn, yielding to the UI between pages. */
async function eachPage(
  score: Score,
  title: string,
  paper: Paper,
  onProgress: ((p: Progress) => void) | undefined,
  consume: (page: Page, index: number) => Promise<void> | void,
  staffSpaceMm?: number,
): Promise<{ pages: number; dropped: Record<string, number> }> {
  const engraved = await engrave(score, paper, staffSpaceMm);
  const dropped: Record<string, number> = {};
  const total = engraved.plan.pages.length;
  try {
    onProgress?.({ done: 0, total });
    for (let i = 0; i < total; i++) {
      await tick();
      const page = buildPage(engraved.plan, engraved.svg, i, score, title, dropped);
      await consume(page, i);
      onProgress?.({ done: i + 1, total });
    }
  } finally {
    engraved.dispose();
  }
  return { pages: total, dropped };
}

export function exportPdf(
  score: Score,
  title: string,
  paper: Paper,
  onProgress?: (p: Progress) => void,
  staffSpaceMm?: number,
): Promise<ExportFile> {
  return timed('export:pdf', async () => {
    const pages: Page[] = [];
    const { dropped } = await eachPage(
      score,
      title,
      paper,
      onProgress,
      (page) => {
        pages.push(page);
      },
      staffSpaceMm,
    );
    const bytes = buildPdf(pages, {
      title: title || score.meta.title,
      author: score.meta.composer,
      creator: 'Polymnia',
    });
    return { bytes, mime: 'application/pdf', extension: 'pdf', dropped, pages: pages.length };
  });
}

/** One PNG for a one-page score, otherwise a ZIP of `page-N.png` (one download, not several). */
export function exportPng(
  score: Score,
  title: string,
  paper: Paper,
  onProgress?: (p: Progress) => void,
  staffSpaceMm?: number,
): Promise<ExportFile> {
  return timed('export:png', async () => {
    const files: Uint8Array<ArrayBuffer>[] = [];
    const { pages, dropped } = await eachPage(
      score,
      title,
      paper,
      onProgress,
      async (page) => {
        files.push(await renderPng(page));
      },
      staffSpaceMm,
    );
    if (files.length === 1) {
      return { bytes: files[0]!, mime: 'image/png', extension: 'png', dropped, pages };
    }
    const width = String(files.length).length;
    const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
    files.forEach((f, i) => {
      entries[`page-${String(i + 1).padStart(width, '0')}.png`] = [f, { level: 0 }];
    });
    const zip = zipSync(entries) as Uint8Array<ArrayBuffer>;
    return { bytes: zip, mime: 'application/zip', extension: 'zip', dropped, pages };
  });
}
