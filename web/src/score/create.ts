import { idGen, newId } from './ids';
import { getInstrument } from './instruments';
import { restsFor } from './commands/core';
import { timeSignatureTicks } from './ticks';
import type { Clef, MeasureInfo, Part, Score, TimeSignature } from './types';

export interface CreateScoreOptions {
  title?: string;
  composer?: string;
  tempoBpm?: number;
  time?: TimeSignature;
  keyFifths?: number;
  measures?: number;
  /** Catalog instrument ids, one part each. Defaults to a piano. */
  instruments?: readonly string[];
}

/** A new empty score (all rests) with fresh random ids. */
export function createScore(opts: CreateScoreOptions = {}): Score {
  const time = opts.time ?? { beats: 4, beatType: 4 };
  const count = opts.measures ?? 4;
  const length = timeSignatureTicks(time);
  const gen = idGen(newId('c'));
  const measures: MeasureInfo[] = Array.from({ length: count }, (_, i) =>
    i === 0 ? { id: gen(), time, keyFifths: opts.keyFifths ?? 0 } : { id: gen() },
  );
  const parts: Part[] = (opts.instruments ?? ['piano']).map((instId) => {
    const inst = getInstrument(instId);
    const clefs: readonly Clef[] =
      inst?.staves === 2 ? ['treble', 'bass'] : [inst?.clefs[0] ?? 'treble'];
    return {
      id: gen(),
      name: inst?.names.en ?? instId,
      instrument: instId,
      transposition: inst?.transposition ?? 0,
      staves: clefs.map((clef) => ({
        id: gen(),
        clef,
        type: 'standard' as const,
        measures: measures.map(() => ({
          voices: [{ id: gen(), events: restsFor(0, length, gen), tuplets: [] }],
        })),
      })),
    };
  });
  return {
    schemaVersion: 1,
    meta: {
      title: opts.title ?? '',
      composer: opts.composer ?? '',
      tempoBpm: opts.tempoBpm ?? 100,
    },
    measures,
    parts,
    slurs: [],
  };
}
