/**
 * Font files of the engraver. This module is tiny and has no VexFlow import: it ships in the
 * initial bundle so the editor route can start the download of the music font before the VexFlow
 * chunk has even arrived. The file is emitted by Vite into /assets with a content hash (immutable
 * cache) and served from our own origin, which the CSP (`font-src 'self'`) requires.
 */
import bravuraUrl from '@vexflow-fonts/bravura/bravura.woff2?url';

export const BRAVURA_URL: string = bravuraUrl;

/** Adds `<link rel="preload" as="font">` for the music font once (idempotent, no-op without a DOM). */
export function preloadEngravingFonts(): void {
  if (typeof document === 'undefined') return;
  if (document.head.querySelector('link[data-pm-font="bravura"]')) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'font';
  link.type = 'font/woff2';
  link.crossOrigin = 'anonymous'; // font preloads are always CORS requests
  link.href = BRAVURA_URL;
  link.dataset.pmFont = 'bravura';
  document.head.appendChild(link);
}
