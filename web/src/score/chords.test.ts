import { describe, expect, it } from 'vitest';
import {
  chordTones,
  formatChord,
  normalizeQuality,
  notePc,
  parseChord,
  parseQuality,
  formatQuality,
  qualityRuns,
  shapeOf,
  transposeChord,
  type ChordData,
} from './chords';

const text = (s: string): string | null => {
  const c = parseChord(s);
  return c ? formatChord(c) : null;
};

describe('parseChord', () => {
  it.each([
    ['C', 'C'],
    ['c', 'C'],
    ['Am7', 'Am7'],
    ['am7', 'Am7'],
    ['G/B', 'G/B'],
    ['F#m7b5', 'F#m7b5'],
    ['Bbmaj7', 'Bbmaj7'],
    ['Dsus4', 'Dsus4'],
    ['Dsus', 'Dsus4'],
    ['E7#9', 'E7#9'],
    ['Cadd9', 'Cadd9'],
    ['C6/9', 'C6/9'],
    ['C69', 'C6/9'],
    ['CM7', 'Cmaj7'],
    ['CΔ7', 'Cmaj7'],
    ['C^7', 'Cmaj7'],
    ['Cma7', 'Cmaj7'],
    ['CMaj7', 'Cmaj7'],
    ['C-7', 'Cm7'],
    ['Cmin7', 'Cm7'],
    ['Cmi', 'Cm'],
    ['C-', 'Cm'],
    ['C+', 'Caug'],
    ['Caug', 'Caug'],
    ['C°', 'Cdim'],
    ['Co7', 'Cdim7'],
    ['Cdim7', 'Cdim7'],
    ['Cø', 'Cm7b5'],
    ['Cm7b5', 'Cm7b5'],
    ['Cm7(b5)', 'Cm7b5'],
    ['CmM7', 'Cm(maj7)'],
    ['Cm(maj7)', 'Cm(maj7)'],
    ['C5', 'C5'],
    ['C9', 'C9'],
    ['Cmaj9', 'Cmaj9'],
    ['Cm9', 'Cm9'],
    ['C11', 'C11'],
    ['C13', 'C13'],
    ['C7sus4', 'C7sus4'],
    ['C7b9', 'C7b9'],
    ['C7-5', 'C7b5'],
    ['C7#5', 'C7#5'],
    ['C7(#11)', 'C7#11'],
    ['Cmaj7#11', 'Cmaj7#11'],
    ['C7b9#9', 'C7b9#9'],
    ['C(add9)', 'Cadd9'],
    ['Cm6', 'Cm6'],
    ['C♯m', 'C#m'],
    ['B♭', 'Bb'],
    ['Ebmaj7/Bb', 'Ebmaj7/Bb'],
    ['C/C', 'C'],
    ['  Am  ', 'Am'],
    ['A/C#', 'A/C#'],
    ['Cmaj', 'C'],
    ['CM', 'C'],
    ['Ab', 'Ab'],
    ['Bb7', 'Bb7'],
    ['Cb', 'Cb'],
    ['Gx', 'G##'],
  ])('%s -> %s', (input, expected) => {
    expect(text(input)).toBe(expected);
  });

  it('accepts French note names', () => {
    expect(text('Do')).toBe('C');
    expect(text('Rém7')).toBe('Dm7');
    expect(text('Rem7')).toBe('Dm7');
    expect(text('Sol/Si')).toBe('G/B');
    expect(text('Sib')).toBe('Bb');
    expect(text('Fa#m7b5')).toBe('F#m7b5');
    expect(text('Mi7')).toBe('E7');
    expect(text('La')).toBe('A');
    expect(text('Lam')).toBe('Am');
    expect(text('Dosus4')).toBe('Csus4');
  });

  it('formats with solfège names', () => {
    const c = parseChord('F#m7/C#')!;
    expect(formatChord(c, 'solfege')).toBe('Fa#m7/Do#');
    expect(formatChord(parseChord('Bbmaj7')!, 'solfege')).toBe('Sibmaj7');
  });

  it.each([
    '',
    '   ',
    'H',
    'X7',
    'Cfoo',
    'C7/',
    'C/H',
    'Cm7/',
    'C2',
    'Csus5',
    'Cmm',
    '7',
    'C#bb#',
    'Cdim aug',
  ])('rejects %j', (input) => {
    expect(parseChord(input)).toBeNull();
  });

  it('rejects very long input', () => {
    expect(parseChord('C' + 'add9'.repeat(30))).toBeNull();
  });

  it('keeps the spelling of the root', () => {
    expect(parseChord('D#m')!.root).toEqual({ step: 'D', alter: 1 });
    expect(parseChord('Eb')!.root).toEqual({ step: 'E', alter: -1 });
  });

  it('has an idempotent normal form', () => {
    for (const s of [
      'CM7',
      'Co7',
      'Cm7(b5)',
      'C13',
      'C7b9#9',
      'Cmaj9',
      'C6/9',
      'Csus2',
      'C7sus4',
    ]) {
      const q = parseChord(s)!.quality;
      expect(normalizeQuality(q)).toBe(q);
    }
  });
});

describe('quality', () => {
  it('parses to a structure', () => {
    expect(parseQuality('m7b5')).toMatchObject({ minor: true, seventh: 7, alt: ['b5'] });
    expect(parseQuality('maj9')).toMatchObject({ seventh: 11, ext: 9 });
    expect(parseQuality('dim7')).toMatchObject({ dim: true, seventh: 7 });
    expect(parseQuality('6/9')).toMatchObject({ sixth: 69 });
    expect(parseQuality('add9add11')).toMatchObject({ add: [9, 11] });
    expect(parseQuality('zzz')).toBeNull();
  });

  it('round trips through the formatter', () => {
    for (const s of ['', 'm', 'dim', 'aug', '5', '7', 'm7', 'maj7', '9', '13', 'sus4', 'add9']) {
      expect(formatQuality(parseQuality(s)!)).toBe(s);
    }
  });

  it('splits quality runs for typography', () => {
    expect(qualityRuns('m7')).toEqual([
      { text: 'm', sup: false },
      { text: '7', sup: true },
    ]);
    expect(qualityRuns('maj7')).toEqual([
      { text: 'maj', sup: false },
      { text: '7', sup: true },
    ]);
    expect(qualityRuns('7#9')).toEqual([{ text: '7#9', sup: true }]);
    expect(qualityRuns('sus4')).toEqual([
      { text: 'sus', sup: false },
      { text: '4', sup: true },
    ]);
    expect(qualityRuns('m(maj7)')).toEqual([
      { text: 'm', sup: false },
      { text: '(maj7)', sup: true },
    ]);
    expect(qualityRuns('')).toEqual([]);
  });
});

describe('chordTones', () => {
  const pcs = (s: string) => {
    const t = chordTones(parseChord(s)!);
    return {
      req: [...t.required].sort((a, b) => a - b),
      opt: [...t.optional].sort((a, b) => a - b),
    };
  };
  it('lists the tones of common chords', () => {
    expect(pcs('C')).toEqual({ req: [0, 4], opt: [7] });
  });
  it('knows the tones of a minor seventh', () => {
    const t = chordTones(parseChord('Am7')!);
    expect(new Set(t.required)).toEqual(new Set([9, 0, 7]));
    expect(t.optional).toEqual([4]);
  });
  it('requires the altered fifth', () => {
    const t = chordTones(parseChord('Bm7b5')!);
    expect(new Set(t.required)).toEqual(new Set([11, 2, 5, 9]));
  });
  it('requires the bass', () => {
    const t = chordTones(parseChord('C/D')!);
    expect(t.required).toContain(2);
    expect(t.bass).toBe(2);
  });
  it('requires the top extension and 6/9', () => {
    expect(new Set(chordTones(parseChord('C9')!).required)).toEqual(new Set([0, 4, 10, 2]));
    expect(new Set(chordTones(parseChord('C6/9')!).required)).toEqual(new Set([0, 4, 9, 2]));
    expect(new Set(chordTones(parseChord('Csus2')!).required)).toEqual(new Set([0, 2]));
  });
});

describe('transposeChord', () => {
  const t = (s: string, n: number, fifths?: number) =>
    formatChord(transposeChord(parseChord(s)!, n, fifths === undefined ? {} : { fifths }));
  it('spells chord names the usual way', () => {
    expect(t('C', 3)).toBe('Eb');
    expect(t('C', 1)).toBe('Db');
    expect(t('C', 6)).toBe('F#');
    expect(t('C', 8)).toBe('Ab');
    expect(t('C', 10)).toBe('Bb');
    expect(t('Am', 1)).toBe('Bbm');
    expect(t('Am', 4)).toBe('C#m');
    expect(t('Am', 9)).toBe('F#m');
    expect(t('Am', 11)).toBe('G#m');
    expect(t('Am', 6)).toBe('Ebm');
  });
  it('goes down with flats where the direction decides', () => {
    expect(t('G', -1)).toBe('F#');
    expect(t('C', -6)).toBe('F#');
    expect(t('E', -1)).toBe('Eb');
  });
  it('follows the key signature', () => {
    expect(t('C', 1, 2)).toBe('C#');
    expect(t('D', 1, -3)).toBe('Eb');
    expect(t('E', 2, 6)).toBe('F#');
  });
  it('keeps the quality and moves the bass', () => {
    expect(t('Am7/G', 3)).toBe('Cm7/Bb');
    expect(t('C/E', 2)).toBe('D/F#');
    expect(t('F#m7b5', 1)).toBe('Gm7b5');
    expect(t('C7#9', 5)).toBe('F7#9');
  });
  it('keeps the spelling for whole octaves', () => {
    expect(t('D#m', 12)).toBe('D#m');
    expect(t('Gb', -24)).toBe('Gb');
  });
  it('round trips the pitch classes', () => {
    const c = parseChord('Ebmaj7/G')!;
    for (let n = -13; n <= 13; n++) {
      const back = transposeChord(transposeChord(c, n), -n);
      expect(notePc(back.root)).toBe(notePc(c.root));
      expect(notePc(back.bass!)).toBe(notePc(c.bass!));
    }
  });
});

describe('shapeOf', () => {
  it('is the chord lowered by the capo', () => {
    const d = parseChord('D')!;
    expect(formatChord(shapeOf(d, 2))).toBe('C');
    expect(formatChord(shapeOf(d, 0))).toBe('D');
    expect(formatChord(shapeOf(parseChord('Em')!, 2))).toBe('Dm');
    expect(formatChord(shapeOf(parseChord('A')!, 3))).toBe('F#');
  });
  it('is the same object without a capo', () => {
    const c: ChordData = parseChord('G')!;
    expect(shapeOf(c, 0)).toBe(c);
  });
});
