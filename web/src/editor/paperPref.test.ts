import { describe, expect, it } from 'vitest';
import { defaultPaper, getPaper, setPaper } from './paperPref';

describe('paper preference', () => {
  it('uses Letter where Letter is the norm and A4 elsewhere', () => {
    expect(defaultPaper('en-US')).toBe('letter');
    expect(defaultPaper('en-CA')).toBe('letter');
    expect(defaultPaper('es-MX')).toBe('letter');
    expect(defaultPaper('fr-FR')).toBe('a4');
    expect(defaultPaper('en-GB')).toBe('a4');
    expect(defaultPaper('fr')).toBe('a4');
    expect(defaultPaper('')).toBe('a4');
  });

  it('remembers the choice', () => {
    setPaper('letter');
    expect(getPaper()).toBe('letter');
    expect(localStorage.getItem('polymnia.paper')).toBe('letter');
    setPaper('a4');
    expect(getPaper()).toBe('a4');
  });
});
