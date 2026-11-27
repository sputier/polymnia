import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../score/fixtures';
import { validateScore, type Score } from '../score';
import { exportMusicXml, importMusicXml, parseMusicXml, scoreToMusicXml } from './index';
import { normalizeScore } from './testing';

describe('round trip: model -> MusicXML -> model', () => {
  for (const [name, score] of Object.entries(FIXTURES)) {
    describe(name, () => {
      it('is identical through .musicxml', () => {
        const { score: back, report } = parseMusicXml(scoreToMusicXml(score));
        expect(validateScore(back)).toEqual([]);
        expect(normalizeScore(back)).toStrictEqual(normalizeScore(score));
        expect(report.dropped).toEqual({});
        expect(report.adjusted).toEqual({});
      });
      it('is identical through .mxl', () => {
        const file = exportMusicXml(score, 'mxl');
        expect(file.extension).toBe('mxl');
        const { score: back } = importMusicXml(file.bytes);
        expect(normalizeScore(back)).toStrictEqual(normalizeScore(score));
      });
    });
  }

  it('keeps a pickup length, tempo changes and time/key changes', () => {
    const base = FIXTURES.pickup as Score;
    const changed: Score = {
      ...base,
      meta: { ...base.meta, tempoBpm: 100 },
      measures: base.measures.map((m, i) =>
        i === 3 ? { ...m, tempoBpm: 132 } : i === 5 ? { ...m, keyFifths: 2 } : m,
      ),
    };
    const { score: back } = parseMusicXml(scoreToMusicXml(changed));
    expect(normalizeScore(back)).toStrictEqual(normalizeScore(changed));
    expect(back.measures[0]!.length).toBe(960);
    expect(back.measures[3]!.tempoBpm).toBe(132);
    expect(back.measures[5]!.keyFifths).toBe(2);
  });
});
