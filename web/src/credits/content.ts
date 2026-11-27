import type { Language } from '../i18n/i18n';

// The credits of the sound samples (docs/playback.md, THIRD_PARTY_NOTICES.md). They live in this lazy chunk, not in the
// i18n catalogs: the dialog is rarely opened. Keep it in step with THIRD_PARTY_NOTICES.md (a test compares them).

export interface License {
  name: string;
  url: string;
}

export const CC0: License = {
  name: 'CC0 1.0',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
};
export const CC_BY_4: License = {
  name: 'CC BY 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/',
};

/** One sample set shipped with the application. Names of works and people are not translated. */
export interface SampleCredit {
  /** Folder name under `web/src/playback/samples/`. */
  id: string;
  /** Instrument label per language. */
  instrument: Record<Language, string>;
  /** Original recording. */
  work: string;
  /** Authors, as the source credits them. */
  author: string;
  license: License;
  source: string;
}

const FREEPATS = 'https://freepats.zenvoid.org/';
const VSCO = 'https://github.com/sgossner/VSCO-2-CE';
const VSCO_AUTHOR = 'Versilian Studios / Sam Gossner, Simon Dalzell (Ivy Audio)';

export const SAMPLE_CREDITS: readonly SampleCredit[] = [
  {
    id: 'voice',
    instrument: { en: 'Voice (choir "ah")', fr: 'Voix (chœur « ah »)' },
    work: 'epic-choir, alto and soprano "ah" sections, derived from VocalSet',
    author:
      'thepok (epic-choir), from VocalSet by Julia Wilkins, Prem Seetharaman, Alison Wahl and Bryan Pardo',
    license: CC_BY_4,
    source: 'https://github.com/thepok/epic-choir',
  },
  {
    id: 'guitar-steel',
    instrument: { en: 'Steel-string guitar', fr: 'Guitare folk (cordes acier)' },
    work: 'Meta Steel Guitar',
    author: 'Meta Creative Audio team',
    license: CC0,
    source: 'https://github.com/facebookincubator/Meta-open-sound',
  },
  {
    id: 'cello',
    instrument: { en: 'Cello', fr: 'Violoncelle' },
    work: 'Karoryfer x bigcat cello (sustained, mf)',
    author: 'Karoryfer Lecolds and bigcat instruments; cellist Kamila Borowiak',
    license: CC0,
    source: 'https://github.com/sfzinstruments/karoryfer-bigcat.cello',
  },
  {
    id: 'guitar-nylon',
    instrument: { en: 'Classical guitar', fr: 'Guitare classique' },
    work: 'Spanish classical guitar',
    author: 'Roberto, FreePats',
    license: CC0,
    source: `${FREEPATS}Guitar/acoustic-guitar.html`,
  },
  {
    id: 'ukulele',
    instrument: { en: 'Ukulele', fr: 'Ukulélé' },
    work: 'Ukulele (tenor, Flight Fireball)',
    author: 'Mateusz Dąbrowski, FreePats',
    license: CC0,
    source: `${FREEPATS}GuitarFamily/ukulele.html`,
  },
  {
    id: 'piano',
    instrument: { en: 'Piano (and unknown instruments)', fr: 'Piano (et instruments inconnus)' },
    work: 'Upright Piano KW (small)',
    author: 'Gonzalo and Roberto, FreePats',
    license: CC0,
    source: `${FREEPATS}Piano/acoustic-grand-piano.html`,
  },
  {
    id: 'clarinet',
    instrument: { en: 'Clarinet', fr: 'Clarinette' },
    work: 'Clarinet',
    author: 'Tyler Dence (recording), Kaili Dence (performer), Roberto (bank), FreePats',
    license: CC0,
    source: `${FREEPATS}Reed/clarinet.html`,
  },
  {
    id: 'violin',
    instrument: { en: 'Violin', fr: 'Violon' },
    work: 'VSCO 2 CE, Solo Violin',
    author: VSCO_AUTHOR,
    license: CC0,
    source: VSCO,
  },
  {
    id: 'double-bass',
    instrument: { en: 'Double bass', fr: 'Contrebasse' },
    work: 'VSCO 2 CE, Solo Contrabass',
    author: VSCO_AUTHOR,
    license: CC0,
    source: VSCO,
  },
  {
    id: 'flute',
    instrument: { en: 'Flute', fr: 'Flûte' },
    work: 'VSCO 2 CE, Flute',
    author: VSCO_AUTHOR,
    license: CC0,
    source: VSCO,
  },
];

export interface CreditsText {
  title: string;
  intro: string;
  /** Column headings. */
  columns: { instrument: string; recording: string; author: string; license: string };
  /** Required by CC BY 4.0 for the voice. */
  attributionTitle: string;
  attribution: string;
  changes: string;
  noEndorsement: string;
  license: string;
  licenseLink: string;
  close: string;
  source: string;
}

/** Credit line the epic-choir author asks for (CC BY 4.0). */
export const VOICE_ATTRIBUTION =
  'Choir samples derived from VocalSet (Wilkins, Seetharaman, Wahl, Pardo 2018), CC BY 4.0, https://doi.org/10.5281/zenodo.1442513 — epic-choir by thepok';

export const CREDITS_TEXT: Record<Language, CreditsText> = {
  en: {
    title: 'About and credits',
    intro:
      'Polymnia is free software under the MIT license. The sounds of playback are short excerpts of the recordings below, all freely licensed, re-encoded for the web (mono, trimmed, faded, loudness-matched).',
    columns: {
      instrument: 'Instrument',
      recording: 'Recording',
      author: 'Author',
      license: 'License',
    },
    attributionTitle: 'Attribution required by CC BY 4.0',
    attribution: VOICE_ATTRIBUTION,
    changes:
      'The recordings were modified: segments cut, pitch-shifted by at most two semitones and summed into section samples by epic-choir; then trimmed, faded, normalized and re-encoded by Polymnia.',
    noEndorsement: 'No endorsement by the VocalSet authors is implied.',
    license: 'Full license texts and sources:',
    licenseLink: 'THIRD_PARTY_NOTICES.md',
    close: 'Close',
    source: 'source',
  },
  fr: {
    title: 'À propos et crédits',
    intro:
      'Polymnia est un logiciel libre sous licence MIT. Les sons de la lecture sont de courts extraits des enregistrements ci-dessous, tous sous licence libre, réencodés pour le web (mono, coupés, fondus, niveau égalisé).',
    columns: {
      instrument: 'Instrument',
      recording: 'Enregistrement',
      author: 'Auteur',
      license: 'Licence',
    },
    attributionTitle: 'Attribution exigée par la licence CC BY 4.0',
    attribution: VOICE_ATTRIBUTION,
    changes:
      'Les enregistrements ont été modifiés : segments découpés, transposés de deux demi-tons au plus et additionnés en échantillons de pupitre par epic-choir ; puis coupés, fondus, normalisés et réencodés par Polymnia.',
    noEndorsement: 'Aucune approbation de la part des auteurs de VocalSet n’est suggérée.',
    license: 'Textes complets des licences et sources :',
    licenseLink: 'THIRD_PARTY_NOTICES.md',
    close: 'Fermer',
    source: 'source',
  },
};

/** Where the full notices live in the repository. */
export const NOTICES_URL = 'https://github.com/sputier/polymnia/blob/main/THIRD_PARTY_NOTICES.md';
