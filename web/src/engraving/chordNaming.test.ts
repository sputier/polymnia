import { afterEach, describe, expect, it } from 'vitest';
import { createScore, parseChord } from '../score';
import { formatChord } from '../score/chords';
import { chordLabel, chordText, chordWidth } from './chords';
import {
  CHORD_NAMING_STORAGE_KEY,
  getChordNaming,
  resetChordNaming,
  setChordNaming,
} from './chordNaming';

const fr = (text: string) => chordLabel(parseChord(text)!, undefined, 'solfege');
const frTexts = (text: string) => fr(text).runs.map((r) => r.text);

afterEach(() => {
  localStorage.clear();
  resetChordNaming();
});

describe('chord names in French', () => {
  it.each([
    ['C', 'Do'],
    ['D', 'Ré'],
    ['E', 'Mi'],
    ['F', 'Fa'],
    ['G', 'Sol'],
    ['A', 'La'],
    ['B', 'Si'],
  ])('names the root %s as %s, bass included', (letter, name) => {
    expect(frTexts(letter)).toEqual([name]);
    expect(chordText(parseChord(`${letter}m7`)!, 'solfege')).toBe(`${name}m7`);
    const bass = letter === 'C' ? 'E' : 'C';
    expect(frTexts(`${letter}/${bass}`).at(-1)).toBe(letter === 'C' ? 'Mi' : 'Do');
    expect(chordText(parseChord(`C/${letter}`)!, 'solfege')).toBe(
      letter === 'C' ? 'Do' : `Do/${name}`,
    );
  });

  it('keeps the qualities and sets sharps and flats as Bravura glyphs', () => {
    expect(frTexts('Dm7')).toEqual(['Ré', 'm', '7']);
    expect(frTexts('G/B')).toEqual(['Sol', '/', 'Si']);
    expect(frTexts('F#m')).toEqual(['Fa', '', 'm']);
    expect(frTexts('Bbmaj7')).toEqual(['Si', '', 'maj', '7']);
    expect(frTexts('E7b9/G#')).toEqual(['Mi', '7', '', '9', '/', 'Sol', '']);
    expect(fr('F#m').runs.some((r) => r.text.includes('#'))).toBe(false);
  });

  it('reads back what it writes: input accepts both namings', () => {
    for (const text of ['Rém7', 'Sol/Si', 'Fa#m', 'Dm7', 'G/B', 'F#m']) {
      const c = parseChord(text)!;
      expect(parseChord(formatChord(c, 'solfege'))).toEqual(c);
      expect(parseChord(formatChord(c, 'letters'))).toEqual(c);
    }
    expect(chordText(parseChord('Rém7')!, 'letters')).toBe('Dm7');
  });

  it('is wider than the English name, so the layout makes room', () => {
    const chord = parseChord('Sol')!;
    expect(fr('Sol').width).toBeGreaterThan(chordLabel(chord, undefined, 'letters').width);
  });
});

describe('chord naming preference', () => {
  it('defaults to English letters and remembers the choice', () => {
    expect(getChordNaming()).toBe('letters');
    setChordNaming('solfege');
    expect(getChordNaming()).toBe('solfege');
    expect(localStorage.getItem(CHORD_NAMING_STORAGE_KEY)).toBe('solfege');
    resetChordNaming();
    expect(getChordNaming()).toBe('solfege');
  });

  it('drives the default label, text and width', () => {
    const chord = parseChord('Dm7')!;
    expect(chordLabel(chord).runs[0]!.text).toBe('D');
    const part = createScore().parts[0]!;
    const sym = { ...chord, id: 'c', tick: 0 };
    const english = chordWidth(sym, { part, diagram: false });
    setChordNaming('solfege');
    expect(chordLabel(chord).runs[0]!.text).toBe('Ré');
    expect(chordText(chord)).toBe('Rém7');
    expect(chordWidth(sym, { part, diagram: false })).toBeGreaterThan(english);
  });
});
