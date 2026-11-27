import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import schema from '../../../schema/score.v1.schema.json';
import { FIXTURES } from './fixtures';
import {
  deserialize,
  LIMITS,
  migrate,
  ScoreFormatError,
  serialize,
  validateScore,
  type Score,
} from './index';

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateSchema = ajv.compile(schema);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test-only generic JSON mutation

const clone = (s: Score): Json => JSON.parse(serialize(s));
const staffOf = (j: Json, i = 0) => j.parts[0].staves[i];
const voiceOf = (j: Json, m = 0, v = 0, s = 0) => staffOf(j, s).measures[m].voices[v];

describe('fixtures', () => {
  for (const [name, score] of Object.entries(FIXTURES)) {
    describe(name, () => {
      it('is valid', () => {
        expect(validateScore(score)).toEqual([]);
      });
      it('round-trips through JSON', () => {
        expect(deserialize(serialize(score))).toStrictEqual(score);
      });
      it('matches the JSON Schema', () => {
        expect(validateSchema(JSON.parse(serialize(score)))).toBe(true);
      });
    });
  }
  it('cover the required cases', () => {
    expect(Object.keys(FIXTURES).length).toBeGreaterThanOrEqual(10);
    expect(FIXTURES.pickup!.measures[0]!.length).toBe(960);
    expect(FIXTURES.pianoGrandStaff!.parts[0]!.staves).toHaveLength(2);
    expect(FIXTURES.celloClefChanges!.parts[0]!.staves[0]!.measures[2]!.clef).toBe('tenor');
    expect(FIXTURES.guitarArpeggio!.parts[0]!.staves[1]!.type).toBe('tab');
  });
});

interface Sample {
  name: string;
  text?: string;
  mutate?: (j: Json) => void;
  /** The JSON Schema also rejects it (structural). Otherwise only deserialize can (semantic). */
  schemaRejects: boolean;
}

const bigId = 'x'.repeat(65);
const samples: Sample[] = [
  { name: 'unknown top-level property', mutate: (j) => (j.extra = 1), schemaRejects: true },
  { name: 'missing meta', mutate: (j) => delete j.meta, schemaRejects: true },
  { name: 'newer schemaVersion', mutate: (j) => (j.schemaVersion = 2), schemaRejects: true },
  { name: 'title too long', mutate: (j) => (j.meta.title = 'x'.repeat(201)), schemaRejects: true },
  { name: 'tempo 0', mutate: (j) => (j.meta.tempoBpm = 0), schemaRejects: true },
  { name: 'tempo as float', mutate: (j) => (j.meta.tempoBpm = 100.5), schemaRejects: true },
  {
    name: 'bad step',
    mutate: (j) => (voiceOf(j).events[0].pitches[0].step = 'H'),
    schemaRejects: true,
  },
  {
    name: 'alter 3',
    mutate: (j) => (voiceOf(j).events[0].pitches[0].alter = 3),
    schemaRejects: true,
  },
  {
    name: 'octave 10',
    mutate: (j) => (voiceOf(j).events[0].pitches[0].octave = 10),
    schemaRejects: true,
  },
  {
    name: 'three dots',
    mutate: (j) => (voiceOf(j).events[0].duration.dots = 3),
    schemaRejects: true,
  },
  {
    name: 'unknown base',
    mutate: (j) => (voiceOf(j).events[0].duration.base = '64th'),
    schemaRejects: true,
  },
  { name: 'unknown clef', mutate: (j) => (staffOf(j).clef = 'soprano'), schemaRejects: true },
  { name: 'unknown staff type', mutate: (j) => (staffOf(j).type = 'grid'), schemaRejects: true },
  { name: 'empty chord', mutate: (j) => (voiceOf(j).events[0].pitches = []), schemaRejects: true },
  {
    name: 'rest with pitches',
    mutate: (j) =>
      (voiceOf(j).events[0] = {
        kind: 'rest',
        id: 'r',
        duration: { base: 'quarter', dots: 0 },
        pitches: [],
      }),
    schemaRejects: true,
  },
  {
    name: 'unknown event kind',
    mutate: (j) => (voiceOf(j).events[0].kind = 'chord'),
    schemaRejects: true,
  },
  {
    name: 'id with a space',
    mutate: (j) => (voiceOf(j).events[0].id = 'a b'),
    schemaRejects: true,
  },
  { name: 'id too long', mutate: (j) => (voiceOf(j).events[0].id = bigId), schemaRejects: true },
  { name: 'id not a string', mutate: (j) => (voiceOf(j).events[0].id = 7), schemaRejects: true },
  {
    name: 'too many parts',
    mutate: (j) => {
      while (j.parts.length <= LIMITS.maxParts) j.parts.push(structuredClone(j.parts[0]));
    },
    schemaRejects: true,
  },
  {
    name: 'too many measures',
    mutate: (j) => {
      j.measures = Array.from({ length: LIMITS.maxMeasures + 1 }, (_, i) => ({ id: `m${i}` }));
    },
    schemaRejects: true,
  },
  {
    name: 'fretting string 0',
    mutate: (j) => (voiceOf(j, 0, 0, 0).events[0].pitches[0].fretting = { string: 0, fret: 0 }),
    schemaRejects: true,
  },
  {
    name: 'fret 37',
    mutate: (j) => (voiceOf(j, 0, 0, 0).events[0].pitches[0].fretting = { string: 1, fret: 37 }),
    schemaRejects: true,
  },
  {
    name: 'measure length not a multiple of 120',
    mutate: (j) => (j.measures[0].length = 100),
    schemaRejects: true,
  },
  { name: 'beatType 3', mutate: (j) => (j.measures[0].time.beatType = 3), schemaRejects: true },
  { name: 'transposition 37', mutate: (j) => (j.parts[0].transposition = 37), schemaRejects: true },
  { name: 'negative capo', mutate: (j) => (j.parts[0].capo = -1), schemaRejects: true },
  { name: 'no parts', mutate: (j) => (j.parts = []), schemaRejects: true },
  { name: 'slurs not an array', mutate: (j) => (j.slurs = {}), schemaRejects: true },
  {
    name: 'tieToNext as string',
    mutate: (j) => (voiceOf(j).events[0].pitches[0].tieToNext = 'yes'),
    schemaRejects: true,
  },
  {
    name: 'polluted prototype key',
    text: '{"schemaVersion":1,"__proto__":{"x":1}}',
    schemaRejects: true,
  },
  // Semantic problems: the schema cannot express them, deserialize must catch them.
  { name: 'measure too short', mutate: (j) => voiceOf(j).events.pop(), schemaRejects: false },
  {
    name: 'duplicate event id',
    mutate: (j) => (voiceOf(j).events[1].id = voiceOf(j).events[0].id),
    schemaRejects: false,
  },
  {
    name: 'slur to a missing event',
    mutate: (j) => (j.slurs[0].endEventId = 'ghost'),
    schemaRejects: false,
  },
  {
    name: 'tie without target',
    mutate: (j) => (voiceOf(j).events[3].pitches[0].tieToNext = true),
    schemaRejects: false,
  },
  {
    name: 'staff with fewer measures',
    mutate: (j) => staffOf(j).measures.pop(),
    schemaRejects: false,
  },
  {
    name: 'first measure without time',
    mutate: (j) => delete j.measures[0].time,
    schemaRejects: false,
  },
  {
    name: 'pickup longer than the measure',
    mutate: (j) => (j.measures[0].length = 7680),
    schemaRejects: false,
  },
  {
    name: 'measure without voice',
    mutate: (j) => (staffOf(j).measures[0].voices = []),
    schemaRejects: true,
  },
];

describe('invalid input: deserialize and the JSON Schema agree', () => {
  const base = FIXTURES.auClairDeLaLune!;
  for (const s of samples) {
    it(s.name, () => {
      let text: string;
      let json: unknown;
      if (s.text !== undefined) {
        text = s.text;
        json = JSON.parse(text);
      } else {
        const j = clone(base);
        s.mutate!(j);
        text = JSON.stringify(j);
        json = j;
      }
      expect(() => deserialize(text)).toThrow(ScoreFormatError);
      expect(validateSchema(json)).toBe(!s.schemaRejects);
    });
  }

  it('rejects semantic errors with the right codes', () => {
    const codes = (mutate: (j: Json) => void, from = base) => {
      const j = clone(from);
      mutate(j);
      try {
        deserialize(JSON.stringify(j));
      } catch (e) {
        return (e as ScoreFormatError).issues.map((i) => i.code);
      }
      return [];
    };
    expect(codes((j) => voiceOf(j).events.pop())).toContain('voice-length');
    expect(codes((j) => (voiceOf(j).events[1].id = voiceOf(j).events[0].id))).toContain(
      'duplicate-id',
    );
    expect(codes((j) => (j.slurs[0].endEventId = 'ghost'))).toContain('slur-ref');
    expect(codes((j) => (voiceOf(j).events[3].pitches[0].tieToNext = true))).toContain(
      'tie-target',
    );
  });

  it('rejects non-JSON, non-objects and oversized input', () => {
    for (const text of ['', 'not json', 'null', '[]', '1', '"x"']) {
      expect(() => deserialize(text)).toThrow(ScoreFormatError);
    }
    expect(() => deserialize('x'.repeat(LIMITS.maxJsonLength + 1))).toThrow(/too large/);
    try {
      deserialize('{');
    } catch (e) {
      expect((e as ScoreFormatError).issues[0]!.code).toBe('invalid-json');
    }
  });
});

describe('semantic validation', () => {
  const base = FIXTURES.guitarArpeggio!;
  const codes = (mutate: (j: Json) => void, from: Score = base) => {
    const j = clone(from);
    mutate(j);
    return validateScore(j as unknown as Score).map((i) => i.code);
  };

  it('accepts all fixtures', () => {
    for (const s of Object.values(FIXTURES)) expect(validateScore(s)).toEqual([]);
  });
  it('checks fretting against the tuning, fret count and sounding pitch', () => {
    expect(
      codes((j) => (voiceOf(j).events[0].pitches[0].fretting = { string: 5, fret: 1 })),
    ).toContain('fretting-mismatch');
    expect(
      codes((j) => (voiceOf(j).events[0].pitches[0].fretting = { string: 7, fret: 0 })),
    ).toContain('fretting-string');
    expect(
      codes((j) => (voiceOf(j).events[0].pitches[0].fretting = { string: 5, fret: 20 })),
    ).toContain('fretting-fret');
    expect(codes((j) => (j.parts[0].instrument = 'custom-lute'))).toContain('fretting-no-tuning');
  });
  it('takes the capo and the tuning override into account', () => {
    expect(validateScore(FIXTURES.guitarDropDCapo!)).toEqual([]);
    expect(codes((j) => (j.parts[0].capo = 3), FIXTURES.guitarDropDCapo!)).toContain(
      'fretting-mismatch',
    );
    expect(codes((j) => delete j.parts[0].tuning, FIXTURES.guitarDropDCapo!)).toContain(
      'fretting-mismatch',
    );
  });
  it('checks transposition against fretting', () => {
    expect(codes((j) => (j.parts[0].transposition = 0))).toContain('fretting-mismatch');
  });
  it('reports measure problems', () => {
    expect(codes((j) => delete j.measures[0].keyFifths)).toContain('first-measure-attributes');
    expect(codes((j) => (j.measures[0].length = 7680))).toContain('bad-measure-length');
    expect(codes((j) => (staffOf(j).measures[0].voices = []))).toContain('voice-missing');
    expect(codes((j) => staffOf(j).measures.pop())).toContain('measure-count');
  });
  it('reports chord problems', () => {
    const chord = FIXTURES.chords!;
    expect(codes((j) => (voiceOf(j).events[0].pitches = []), chord)).toContain('empty-chord');
    expect(
      codes(
        (j) => voiceOf(j).events[0].pitches.push({ ...voiceOf(j).events[0].pitches[0] }),
        chord,
      ),
    ).toContain('duplicate-pitch');
  });
  it('reports slur problems', () => {
    const s = FIXTURES.pianoGrandStaff!;
    const j0 = (j: Json) => j.slurs.push({ id: 'x1', startEventId: 'e1', endEventId: 'e14' });
    expect(codes(j0, s)).toContain('slur-staff');
    expect(
      codes((j) => j.slurs.push({ id: 'x1', startEventId: 'e2', endEventId: 'e1' }), s),
    ).toContain('slur-order');
    expect(
      codes((j) => j.slurs.push({ id: 'x1', startEventId: 'e1', endEventId: 'e1' }), s),
    ).toContain('slur-order');
  });
  it('reports tuplet problems', () => {
    const t = FIXTURES.triplets!;
    expect(codes((j) => (voiceOf(j).tuplets[0].eventIds[2] = 'ghost'), t)).toContain('tuplet-ref');
    expect(codes((j) => voiceOf(j).tuplets[0].eventIds.reverse(), t)).toContain(
      'tuplet-contiguous',
    );
    expect(codes((j) => (voiceOf(j).tuplets[0].eventIds = ['e1']), t)).toContain('tuplet-size');
    expect(codes((j) => (voiceOf(j).tuplets[0].normal = 3), t)).toContain('voice-length');
    expect(codes((j) => (voiceOf(j).tuplets[0].actual = 7), t)).toContain('non-integer-ticks');
    expect(codes((j) => (voiceOf(j).tuplets[0].actual = 2), t)).toContain('tuplet-ratio');
    expect(
      codes(
        (j) => voiceOf(j).tuplets.push({ id: 'tt', actual: 3, normal: 2, eventIds: ['e1', 'e2'] }),
        t,
      ),
    ).toContain('tuplet-overlap');
  });
  it('reports duplicate ids across different kinds of objects', () => {
    expect(codes((j) => (j.measures[0].id = j.parts[0].id))).toContain('duplicate-id');
  });
});

describe('versioning', () => {
  it('migrate is a no-op for version 1', () => {
    const j = clone(FIXTURES.auClairDeLaLune!);
    expect(migrate(j)).toBe(j);
  });
  it('rejects unknown versions with a typed error', () => {
    for (const v of [2, 0, -1, 1.5, '1', null]) {
      const j = clone(FIXTURES.auClairDeLaLune!);
      j.schemaVersion = v;
      try {
        migrate(j);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ScoreFormatError);
        expect((e as ScoreFormatError).issues[0]!.code).toBe('unsupported-version');
      }
    }
    expect(() => migrate(5)).toThrow(ScoreFormatError);
  });
  it('writes schemaVersion 1', () => {
    expect(JSON.parse(serialize(FIXTURES.auClairDeLaLune!)).schemaVersion).toBe(1);
  });
});

describe('JSON Schema and limits stay in sync', () => {
  const s = schema as Json;
  it('uses the same limits as the code', () => {
    expect(s.properties.parts.maxItems).toBe(LIMITS.maxParts);
    expect(s.properties.measures.maxItems).toBe(LIMITS.maxMeasures);
    expect(s.properties.slurs.maxItems).toBe(LIMITS.maxSlurs);
    expect(s.properties.meta.properties.title.maxLength).toBe(LIMITS.maxTitleLength);
    expect(s.$defs.part.properties.staves.maxItems).toBe(LIMITS.maxStavesPerPart);
    expect(s.$defs.part.properties.name.maxLength).toBe(LIMITS.maxNameLength);
    expect(s.$defs.part.properties.instrument.maxLength).toBe(LIMITS.maxInstrumentLength);
    expect(s.$defs.part.properties.tuning.maxItems).toBe(LIMITS.maxTuning);
    expect(s.$defs.staff.properties.measures.maxItems).toBe(LIMITS.maxMeasures);
    expect(s.$defs.staffMeasure.properties.voices.maxItems).toBe(LIMITS.maxVoicesPerMeasure);
    expect(s.$defs.voice.properties.events.maxItems).toBe(LIMITS.maxEventsPerVoice);
    expect(s.$defs.voice.properties.tuplets.maxItems).toBe(LIMITS.maxTupletsPerVoice);
    expect(s.$defs.tuplet.properties.eventIds.maxItems).toBe(LIMITS.maxTupletEvents);
    expect(s.$defs.event.oneOf[0].properties.pitches.maxItems).toBe(LIMITS.maxPitchesPerChord);
    expect(s.$defs.notePitch.properties.fretting.properties.fret.maximum).toBe(LIMITS.maxFret);
    expect(new RegExp(s.$defs.id.pattern).test('a'.repeat(LIMITS.maxIdLength))).toBe(true);
    expect(new RegExp(s.$defs.id.pattern).test('a'.repeat(LIMITS.maxIdLength + 1))).toBe(false);
  });
  it('declares draft 2020-12', () => {
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });
});
