/** Pure helpers of the instruments panel and the inspector (no React). */
import type { Language } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { normalize } from '../shortcuts/search';
import { INSTRUMENTS, getInstrument, type Alter, type InstrumentDef, type Pitch } from '../score';
import type { StepName } from '../score';

export type InstrumentFamily = 'keyboard' | 'voice' | 'woodwind' | 'strings' | 'fretted';

export const FAMILY_ORDER: readonly InstrumentFamily[] = [
  'fretted',
  'strings',
  'keyboard',
  'voice',
  'woodwind',
];

export const FAMILY_LABEL: Record<InstrumentFamily, MessageKey> = {
  keyboard: 'instruments.family.keyboard',
  voice: 'instruments.family.voice',
  woodwind: 'instruments.family.woodwind',
  strings: 'instruments.family.strings',
  fretted: 'instruments.family.fretted',
};

export function familyOf(inst: InstrumentDef): InstrumentFamily {
  if (inst.strings) return 'fretted';
  if (inst.staves === 2) return 'keyboard';
  if (inst.id === 'voice') return 'voice';
  if (['violin', 'cello', 'double-bass'].includes(inst.id)) return 'strings';
  return 'woodwind';
}

export function instrumentName(id: string, language: Language): string {
  return getInstrument(id)?.names[language] ?? id;
}

export interface InstrumentGroup {
  readonly family: InstrumentFamily;
  readonly instruments: readonly InstrumentDef[];
}

/** Catalog instruments grouped by family whose English or French name matches `query` (accents and case ignored). */
export function searchInstruments(query: string): InstrumentGroup[] {
  const words = normalize(query).split(' ').filter(Boolean);
  const matches = INSTRUMENTS.filter((inst) => {
    if (words.length === 0) return true;
    const text = `${normalize(inst.names.en)} ${normalize(inst.names.fr)} ${inst.id}`;
    return words.every((w) => text.includes(w));
  });
  return FAMILY_ORDER.map((family) => ({
    family,
    instruments: matches.filter((i) => familyOf(i) === family),
  })).filter((g) => g.instruments.length > 0);
}

const SHARP_FLAT: Record<string, Alter> = { '#': 1, '♯': 1, b: -1, '♭': -1 };

/** "F#3", "Bb2", "e4": a written note name, or undefined when it is not one. */
export function parsePitchName(text: string): Pitch | undefined {
  const m = /^\s*([A-Ga-g])([#♯b♭]{0,2})\s*(-?\d)\s*$/.exec(text);
  if (!m) return undefined;
  const marks = [...m[2]!];
  const alter = marks.reduce((n, c) => n + (SHARP_FLAT[c] ?? 0), 0);
  if (Math.abs(alter) > 2) return undefined;
  return { step: m[1]!.toUpperCase() as StepName, alter: alter as Alter, octave: Number(m[3]) };
}

export function pitchName(p: Pitch): string {
  const mark = p.alter === 0 ? '' : p.alter > 0 ? '♯'.repeat(p.alter) : '♭'.repeat(-p.alter);
  return `${p.step}${mark}${p.octave}`;
}

const MAJORS_EN = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const FLAT_MAJORS_EN = ['F', 'B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'C♭'];
const MAJORS_FR = ['Do', 'Sol', 'Ré', 'La', 'Mi', 'Si', 'Fa♯', 'Do♯'];
const FLAT_MAJORS_FR = ['Fa', 'Si♭', 'Mi♭', 'La♭', 'Ré♭', 'Sol♭', 'Do♭'];

/** Tonic of the major key with `fifths` sharps (negative: flats). */
export function keyTonic(fifths: number, language: Language): string {
  const index = Math.abs(fifths);
  if (fifths >= 0) return (language === 'fr' ? MAJORS_FR : MAJORS_EN)[index]!;
  return (language === 'fr' ? FLAT_MAJORS_FR : FLAT_MAJORS_EN)[index - 1]!;
}

/** "3 ♯" / "2 ♭" / "0". */
export function keyAccidentals(fifths: number): string {
  return fifths === 0 ? '0' : `${Math.abs(fifths)} ${fifths > 0 ? '♯' : '♭'}`;
}
