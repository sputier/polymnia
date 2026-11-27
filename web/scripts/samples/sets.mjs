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
    octaveShift: 1, // the source labels C2 as C1
    seconds: 4,
    fadeOut: 0.6,
    files: map(
      'cello',
      ['C1', 'Eb1', 'A1', 'Eb2', 'A2', 'Eb3', 'A3', 'Eb4', 'A4', 'C5'],
      (n) => `${n}_mf_d.wav`,
    ),
  },
  {
    id: 'guitar-steel',
    seconds: 5,
    fadeOut: 0.8,
    files: {
      E2: 'steel/s/INSGuitarSteel_StringLowE_Vel02_E2_01.wav',
      A2: 'steel/s/INSGuitarSteel_StringA_Vel02_A2_01.wav',
      D3: 'steel/s/INSGuitarSteel_StringD_Vel02_D3_01.wav',
      G3: 'steel/s/INSGuitarSteel_StringG_Vel02_G3_01.wav',
      B3: 'steel/s/INSGuitarSteel_StringB_Vel02_B3_01.wav',
      E4: 'steel/s/INSGuitarSteel_StringHighE_Vel02_E4_01.wav',
      A4: 'steel/s/INSGuitarSteel_StringHighE_Vel02_A4_01.wav',
      D5: 'steel/s/INSGuitarSteel_StringHighE_Vel02_D5_01.wav',
      G5: 'steel/s/INSGuitarSteel_StringHighE_Vel02_G5_01.wav',
      C6: 'steel/s/INSGuitarSteel_StringHighE_Vel02_C6_01.wav',
    },
  },
  {
    id: 'voice',
    seconds: 3.5,
    fadeOut: 0.5,
    // epic-choir (CC BY 4.0): alto section "ah" at mf, soprano section for the top note.
    files: {
      'A#3': 'choir/x/samples/A/A_ah_mf_As3.wav',
      E4: 'choir/x/samples/A/A_ah_mf_E4.wav',
      'F#4': 'choir/x/samples/A/A_ah_mf_Fs4.wav',
      'A#4': 'choir/x/samples/A/A_ah_mf_As4.wav',
      C5: 'choir/x/samples/A/A_ah_mf_C5.wav',
      E5: 'choir/x/samples/A/A_ah_mf_E5.wav',
      'F#5': 'choir/x/samples/S/S_ah_mf_Fs5.wav',
    },
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
