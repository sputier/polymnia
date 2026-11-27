// Sample sets: which original recording becomes which pitch. Paths are relative to SAMPLES_SRC.
// `seconds` caps the length of a sample (sustained instruments are cut and faded out), `octaveShift`
// corrects a source that labels its octaves differently. See docs/playback.md.
const map = (dir, notes, name) => Object.fromEntries(notes.map((n) => [n, `${dir}/${name(n)}`]));

export const SETS = [
  {
    id: 'guitar-nylon',
    seconds: 5,
    fadeOut: 0.8,
    files: map(
      'nylon/SpanishClassicalGuitar-SFZ+FLAC-20190618/samples',
      ['E2', 'A2', 'D3', 'G3', 'B3', 'E4', 'A4', 'D5', 'G5', 'C6'],
      (n) => `${n}.flac`,
    ),
  },
  {
    id: 'ukulele',
    seconds: 4,
    fadeOut: 0.7,
    files: map(
      'uke/Ukulele SFZ+FLAC-20260811/samples',
      ['C4', 'E4', 'G4', 'B4', 'C#5', 'F5', 'A5', 'C6'],
      (n) => `${n}.flac`,
    ),
  },
  {
    id: 'piano',
    seconds: 4,
    fadeOut: 0.8,
    files: map(
      'piano/UprightPianoKW-small-SFZ+FLAC-20190703/samples',
      ['B1', 'B2', 'D#3', 'A3', 'C4', 'F#4', 'C5', 'F#5', 'C6', 'F#6', 'C7'],
      (n) => `${n}vH.flac`,
    ),
  },
  {
    id: 'clarinet',
    seconds: 3.5,
    fadeOut: 0.5,
    files: map(
      'clar/Clarinet-SFZ-20190818/samples',
      ['D3', 'F3', 'Bb3', 'D4', 'F4', 'Bb4', 'D5', 'F5', 'Bb5'],
      (n) => `${n}.wav`,
    ),
  },
  {
    id: 'cello',
    octaveShift: 1,
    seconds: 4,
    fadeOut: 0.6,
    files: map(
      'cello',
      ['B1', 'E1', 'A2', 'D2', 'G3', 'C3', 'F4', 'B3', 'E3', 'D4'],
      (n) => `susvib_${n}_v1_1.wav`,
    ),
  },
  {
    id: 'violin',
    seconds: 4,
    fadeOut: 0.6,
    files: map(
      'violin',
      ['G3', 'C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6', 'E6', 'A6'],
      (n) => `LLVln_ArcoVib_${n}_p.wav`,
    ),
  },
  {
    id: 'double-bass',
    octaveShift: 1,
    seconds: 4,
    fadeOut: 0.6,
    files: map(
      'bass',
      ['F#0', 'A#0', 'C1', 'E1', 'A1', 'C#2', 'E2'],
      (n) => `BKCtbss_SusVib_${n}_v1_rr1.wav`,
    ),
  },
  {
    id: 'flute',
    octaveShift: 1,
    seconds: 3.5,
    fadeOut: 0.5,
    files: map(
      'flute',
      ['C3', 'E3', 'A3', 'C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6'],
      (n) => `LDFlute_susvib_${n}_v1_1.wav`,
    ),
  },
];
