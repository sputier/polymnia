import { describe, expect, it } from 'vitest';
import { BRAVURA_URL, preloadEngravingFonts } from './fonts';

describe('engraving fonts', () => {
  it('points at a same-origin woff2 file, not a data URL', () => {
    expect(BRAVURA_URL).toMatch(/bravura.*\.woff2$/);
    expect(BRAVURA_URL.startsWith('data:')).toBe(false);
  });

  it('adds a single CORS font preload, however many times it is called', () => {
    document.head.querySelectorAll('link[data-pm-font]').forEach((l) => l.remove());
    preloadEngravingFonts();
    preloadEngravingFonts();
    const links = document.head.querySelectorAll<HTMLLinkElement>('link[data-pm-font="bravura"]');
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.rel).toBe('preload');
    expect(link.as).toBe('font');
    expect(link.type).toBe('font/woff2');
    expect(link.crossOrigin).toBe('anonymous');
    expect(link.getAttribute('href')).toBe(BRAVURA_URL);
  });
});
