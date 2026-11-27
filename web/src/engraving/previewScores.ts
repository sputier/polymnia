/** Large score used by the engraving performance tests (not shipped in the first screen). */
import { buildScore } from '../score/fixtures/dsl';
import type { Score } from '../score/types';

/** Piano grand staff, `measures` measures: eighths with accidentals and ties over a bass line. */
export function benchmarkScore(measures = 100): Score {
  const treble = [
    'C5:e D5:e E5:e F#5:e G5:e A5:e B5:e C6:e',
    'G4:q A4:q B4:q C5:q~',
    'C5:h E5+G5:h',
  ];
  const bass = ['C3:h G2:h', 'F2:q F3:q E2:h', 'C3+G3:w'];
  const staff = (clef: 'treble' | 'bass', cells: string[]) => ({
    clef,
    measures: Array.from({ length: measures }, (_, i) => cells[i % cells.length]!),
  });
  return buildScore({
    title: 'Benchmark',
    parts: [
      {
        name: 'Piano',
        instrument: 'piano',
        staves: [staff('treble', treble), staff('bass', bass)],
      },
    ],
  });
}

/** Key signature, measure-local accidentals, a key change and a time change (visual tests). */
export function accidentalsScore(): Score {
  return buildScore({
    title: 'Accidentals',
    keyFifths: 1,
    measureInfo: { 2: { keyFifths: -2 }, 3: { time: { beats: 3, beatType: 4 } } },
    parts: [
      {
        name: 'Flute',
        instrument: 'flute',
        staves: [
          {
            measures: [
              'G4:q F#4:q F4:q F4:q',
              'C#5:q C#5:q C5:q C##5:q',
              'Bb4:q B4:q Eb5:q Db5+F5:q',
              'A4:q Ab4:q G4:q',
            ],
          },
        ],
      },
    ],
  });
}
