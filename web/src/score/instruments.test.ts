import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, shortPartName } from './instruments';

describe('short names', () => {
  it('every catalog instrument has a short name in both languages, shorter than the full one', () => {
    for (const inst of INSTRUMENTS) {
      for (const lang of ['en', 'fr'] as const) {
        expect(inst.short[lang].length, inst.id).toBeGreaterThan(0);
        expect(inst.short[lang].length, inst.id).toBeLessThanOrEqual(inst.names[lang].length);
      }
    }
  });

  it('uses the catalog short name while the part keeps its catalog name', () => {
    expect(shortPartName({ name: 'Piano', instrument: 'piano' })).toBe('Pno.');
    expect(shortPartName({ name: 'Violoncelle', instrument: 'cello' })).toBe('Vc.');
    expect(shortPartName({ name: 'Voix', instrument: 'voice' })).toBe('Voix');
  });

  it('keeps a custom name, shortened when long', () => {
    expect(shortPartName({ name: 'Lead', instrument: 'piano' })).toBe('Lead');
    expect(shortPartName({ name: 'Right hand melody', instrument: 'piano' })).toBe('Right h.');
  });
});
