/**
 * Fixture scores. Melodies are traditional / public domain; the rest are short original exercises.
 * Used by the tests (round trip, schema, validation) and by later features as sample documents.
 */
import type { Score } from '../types';
import { buildScore } from './dsl';

/** "Au clair de la lune" (traditional), first phrase, voice. */
export const auClairDeLaLune: Score = buildScore({
  title: 'Au clair de la lune',
  composer: 'Traditional',
  tempoBpm: 96,
  parts: [
    {
      name: 'Voice',
      instrument: 'voice',
      staves: [
        {
          measures: ['C4:q< C4:q C4:q D4:q>', 'E4:h D4:h', 'C4:q E4:q D4:q D4:q', 'C4:w'],
        },
      ],
    },
  ],
});

/** Piano grand staff: melody over bass notes, a chord and a second voice. */
export const pianoGrandStaff: Score = buildScore({
  title: 'Au clair de la lune (piano)',
  composer: 'Traditional',
  parts: [
    {
      name: 'Piano',
      instrument: 'piano',
      staves: [
        {
          clef: 'treble',
          measures: [
            'C4:q C4:q C4:q D4:q',
            'E4+G4:h D4+F4:h',
            'C4:q E4:q D4:q D4:q',
            ['C5:w', 'E4:h G4:h'],
          ],
        },
        {
          clef: 'bass',
          measures: ['C3:h G2:h', 'C3:w', 'C3:h G2:h', 'C2+C3:w'],
        },
      ],
    },
  ],
});

export const chords: Score = buildScore({
  title: 'Chords',
  keyFifths: 0,
  parts: [
    {
      name: 'Piano',
      instrument: 'piano',
      staves: [
        {
          measures: [
            'C4+E4+G4:w',
            'F4+A4+C5:h C4+F4+A4:h',
            'G4+B4+D5:q G4+B4+D5:q G4+B4+D5:h',
            'C4+E4+G4+C5:w',
          ],
        },
      ],
    },
  ],
});

export const triplets: Score = buildScore({
  title: 'Triplets',
  parts: [
    {
      name: 'Flute',
      instrument: 'flute',
      staves: [
        {
          measures: [
            '(3 C5:e D5:e E5:e) F5:q G5:h',
            '(3 C6:q B5:q A5:q) G5:h',
            '(3 C5:s D5:s E5:s) r:e F5:q G5:h',
          ],
        },
      ],
    },
  ],
});

export const ties: Score = buildScore({
  title: 'Ties',
  time: { beats: 4, beatType: 4 },
  parts: [
    {
      name: 'Violin',
      instrument: 'violin',
      staves: [
        {
          measures: ['E4:q F4:q G4:h~', 'G4:w', 'C4+E4:h~ C4+E4:q D4:q', 'C4:q~ C4:q~ C4:h'],
        },
      ],
    },
  ],
});

/** Pickup measure (one quarter) in 2/4, "Oh! Susanna" (Foster, public domain). */
export const pickup: Score = buildScore({
  title: 'Oh! Susanna',
  composer: 'Stephen Foster',
  time: { beats: 2, beatType: 4 },
  keyFifths: 0,
  measureInfo: { 0: { length: 960 } },
  parts: [
    {
      name: 'Voice',
      instrument: 'voice',
      staves: [
        {
          measures: [
            'C4:e D4:e',
            'E4:q. G4:e',
            'G4:q. A4:e',
            'G4:q E4:q',
            'C4:q. D4:e',
            'E4:q E4:q',
            'D4:h',
          ],
        },
      ],
    },
  ],
});

/** Classical guitar: written an octave above the sound, with fretting. */
export const guitarArpeggio: Score = buildScore({
  title: 'Arpeggio study in A minor',
  composer: 'Polymnia examples',
  tempoBpm: 80,
  parts: [
    {
      name: 'Guitar',
      instrument: 'guitar-classical',
      staves: [
        {
          measures: [
            'A3@5.0:e E4@4.2:e A4@3.2:e C5@2.1:e E5@1.0:e C5@2.1:e A4@3.2:e E4@4.2:e',
            'A3@5.0+E4@4.2+A4@3.2+C5@2.1+E5@1.0:w',
          ],
        },
        {
          type: 'tab',
          clef: 'treble-8vb',
          measures: [
            'A3@5.0:e E4@4.2:e A4@3.2:e C5@2.1:e E5@1.0:e C5@2.1:e A4@3.2:e E4@4.2:e',
            'A3@5.0+E4@4.2+A4@3.2+C5@2.1+E5@1.0:w',
          ],
        },
      ],
    },
  ],
});

/** Guitar in drop D with a capo on fret 2: the sounding pitch includes the capo. */
export const guitarDropDCapo: Score = buildScore({
  title: 'Drop D, capo 2',
  parts: [
    {
      name: 'Guitar',
      instrument: 'guitar-steel',
      capo: 2,
      tuning: [
        { step: 'E', alter: 0, octave: 4 },
        { step: 'B', alter: 0, octave: 3 },
        { step: 'G', alter: 0, octave: 3 },
        { step: 'D', alter: 0, octave: 3 },
        { step: 'A', alter: 0, octave: 2 },
        { step: 'D', alter: 0, octave: 2 },
      ],
      staves: [{ measures: ['E3@6.0:q B3@5.0:q E4@4.0:q G#4@4.4:q'] }],
    },
  ],
});

/**
 * Tablature features on a classical guitar (standard + TAB): a slur (drawn as an arc on both
 * staves), a tie, a chord stacked on three strings and a rest (hidden on the TAB, as by default).
 */
export const guitarTabFeatures: Score = buildScore({
  title: 'Tablature features',
  parts: [
    {
      name: 'Guitar',
      instrument: 'guitar-classical',
      staves: [
        {
          measures: [
            'E3@6.0:q G3@6.3:q< A3@5.0:q> r:q',
            'B3@5.2:q~ B3@5.2:q E3@6.0+B3@5.2+E4@4.2:h',
          ],
        },
        {
          type: 'tab',
          clef: 'treble-8vb',
          measures: ['E3@6.0:q G3@6.3:q A3@5.0:q r:q', 'B3@5.2:q~ B3@5.2:q E3@6.0+B3@5.2+E4@4.2:h'],
        },
      ],
    },
  ],
});

/** Soprano ukulele (re-entrant tuning), "Twinkle, Twinkle, Little Star". */
export const ukuleleMelody: Score = buildScore({
  title: 'Twinkle, Twinkle, Little Star',
  composer: 'Traditional',
  parts: [
    {
      name: 'Ukulele',
      instrument: 'ukulele-soprano',
      staves: [
        {
          measures: [
            'C4@3.0:q C4@3.0:q G4@4.0:q G4@4.0:q',
            'A4@1.0:q A4@1.0:q G4@4.0:h',
            'F4@2.1:q F4@2.1:q E4@2.0:q E4@2.0:q',
            'D4@3.2:q D4@3.2:q C4@3.0:h',
          ],
        },
      ],
    },
  ],
});

/** Cello line: bass clef, then tenor clef, then treble clef. */
export const celloClefChanges: Score = buildScore({
  title: 'Cello line',
  parts: [
    {
      name: 'Cello',
      instrument: 'cello',
      staves: [
        {
          measures: [
            'C2:q D2:q E2:q F2:q',
            'G2:q A2:q B2:q C3:q',
            { clef: 'tenor', voices: 'G3:q A3:q B3:q C4:q' },
            'D4:h C4:h',
            { clef: 'treble', voices: 'E4:q F4:q G4:h' },
          ],
        },
      ],
    },
  ],
});

export const FIXTURES: Readonly<Record<string, Score>> = {
  auClairDeLaLune,
  pianoGrandStaff,
  chords,
  triplets,
  ties,
  pickup,
  guitarArpeggio,
  guitarDropDCapo,
  guitarTabFeatures,
  ukuleleMelody,
  celloClefChanges,
};
