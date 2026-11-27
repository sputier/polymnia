import { describe, expect, it } from 'vitest';
import { buildScore } from '../score/fixtures/dsl';
import { validateScore } from '../score';
import { exportMusicXml, importMusicXml, parseMusicXml, scoreToMusicXml } from './index';
import { normalizeScore } from './testing';

/** 500 measures, 4 staves (piano grand staff, violin, cello), about 8000 events. */
function bigScore() {
  const staff = (clef: 'treble' | 'bass', notes: string) => ({
    clef,
    measures: Array.from({ length: 500 }, () => notes),
  });
  return buildScore({
    title: 'Perf',
    parts: [
      {
        name: 'Piano',
        instrument: 'piano',
        staves: [staff('treble', 'C5:q D5:q E5:q F5:q'), staff('bass', 'C3:h G2:h')],
      },
      {
        name: 'Violin',
        instrument: 'violin',
        staves: [staff('treble', 'G4:e A4:e B4:e C5:e D5:q E5:q')],
      },
      { name: 'Cello', instrument: 'cello', staves: [staff('bass', 'C3:q C3:q D3:h')] },
    ],
  });
}

function best(runs: number, fn: () => void): number {
  let min = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    min = Math.min(min, performance.now() - t);
  }
  return min;
}

describe('performance (500 measures, 4 staves, jsdom parser)', () => {
  const score = bigScore();
  const xml = scoreToMusicXml(score);
  const bytes = new TextEncoder().encode(xml);

  it('exports and imports in under 500 ms each', () => {
    const exportMs = best(3, () => scoreToMusicXml(score));
    const importMs = best(3, () => parseMusicXml(xml));
    const mxlMs = best(3, () => exportMusicXml(score, 'mxl'));
    const mxlBytes = exportMusicXml(score, 'mxl').bytes;
    const importMxlMs = best(3, () => importMusicXml(mxlBytes));
    console.log(
      [
        `MusicXML ${(bytes.length / 1e6).toFixed(2)} MB, MXL ${(mxlBytes.length / 1e3).toFixed(0)} KB`,
        `export .musicxml  ${exportMs.toFixed(1)} ms`,
        `export .mxl       ${mxlMs.toFixed(1)} ms`,
        `import .musicxml  ${importMs.toFixed(1)} ms`,
        `import .mxl       ${importMxlMs.toFixed(1)} ms`,
      ].join('\n'),
    );
    expect(exportMs).toBeLessThan(500);
    expect(importMs).toBeLessThan(500);
    expect(mxlMs).toBeLessThan(500);
    expect(importMxlMs).toBeLessThan(500);
  });

  it('round-trips the large score', () => {
    const { score: back } = importMusicXml(bytes);
    expect(validateScore(back)).toEqual([]);
    expect(normalizeScore(back)).toStrictEqual(normalizeScore(score));
  });
});
