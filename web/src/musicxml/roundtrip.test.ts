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

  it('never writes an octave outside 0 to 9: such pitches are left out and reported', () => {
    const base = FIXTURES.chords as Score;
    const low = { step: 'C', alter: 0, octave: -1 } as const;
    const voice = base.parts[0]!.staves[0]!.measures[0]!.voices[0]!;
    const [first, ...others] = voice.events;
    const events = [
      { kind: 'note' as const, id: 'low1', duration: first!.duration, pitches: [low] },
      ...others,
    ];
    const staff = base.parts[0]!.staves[0]!;
    const changed: Score = {
      ...base,
      parts: [
        {
          ...base.parts[0]!,
          staves: [
            {
              ...staff,
              measures: [
                { ...staff.measures[0]!, voices: [{ ...voice, events }] },
                ...staff.measures.slice(1),
              ],
            },
          ],
        },
      ],
    };
    const file = exportMusicXml(changed, 'musicxml');
    expect(file.dropped).toEqual({ 'pitch (below octave 0)': 1 });
    const { score: back } = parseMusicXml(new TextDecoder().decode(file.bytes));
    expect(back.parts[0]!.staves[0]!.measures[0]!.voices[0]!.events[0]!.kind).toBe('rest');
    expect(exportMusicXml(base, 'musicxml').dropped).toEqual({});
  });

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
