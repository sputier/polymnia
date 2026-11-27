import { ID_PATTERN, LIMITS } from './limits';
import { MIN_TICKS } from './ticks';
import { validateScore } from './validate';
import { SCHEMA_VERSION } from './types';
import type {
  Clef,
  Duration,
  Issue,
  MeasureInfo,
  NoteBase,
  NotePitch,
  Part,
  Pitch,
  Score,
  ScoreEvent,
  Slur,
  Fretting,
  Staff,
  StaffMeasure,
  StaffType,
  TimeSignature,
  Tuplet,
  Voice,
} from './types';

/** Thrown by `deserialize` for malformed JSON, unsupported versions, structural or semantic errors. */
export class ScoreFormatError extends Error {
  readonly issues: readonly Issue[];
  constructor(issues: readonly Issue[]) {
    const first = issues[0];
    super(first ? `${first.path || '/'}: ${first.message}` : 'Invalid score');
    this.name = 'ScoreFormatError';
    this.issues = issues;
  }
}

function fail(path: string, message: string, code = 'invalid-structure'): never {
  throw new ScoreFormatError([{ code, path, message }]);
}

// ---------------------------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------------------------

/** Migrations from version N to N+1, keyed by N. Empty while version 1 is the only version. */
const MIGRATIONS: Record<number, (json: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * Upgrades parsed JSON of any known older version to the current one. Version 1 is a no-op.
 * Throws ScoreFormatError for a missing, invalid or future version.
 */
export function migrate(json: unknown): unknown {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    fail('', 'Expected an object');
  }
  let doc = json as Record<string, unknown>;
  let version = doc.schemaVersion;
  if (!Number.isInteger(version) || (version as number) < 1) {
    fail('/schemaVersion', 'schemaVersion must be a positive integer', 'unsupported-version');
  }
  if ((version as number) > SCHEMA_VERSION) {
    fail(
      '/schemaVersion',
      `Version ${String(version)} is newer than supported (${SCHEMA_VERSION})`,
      'unsupported-version',
    );
  }
  while ((version as number) < SCHEMA_VERSION) {
    const step = MIGRATIONS[version as number];
    if (!step)
      fail('/schemaVersion', `No migration from version ${String(version)}`, 'unsupported-version');
    doc = step(doc);
    version = doc.schemaVersion;
  }
  return doc;
}

// ---------------------------------------------------------------------------------------------
// Structural decoding (mirrors schema/score.v1.schema.json; never trusts the input)
// ---------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function obj(
  v: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'Expected an object');
  const o = v as Obj;
  for (const k of Object.keys(o)) {
    if (!required.includes(k) && !optional.includes(k)) fail(`${path}/${k}`, 'Unknown property');
  }
  for (const k of required) if (!Object.hasOwn(o, k)) fail(`${path}/${k}`, 'Missing property');
  return o;
}

function arr(v: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(v)) fail(path, 'Expected an array');
  if (v.length < min || v.length > max)
    fail(path, `Expected between ${min} and ${max} items, got ${v.length}`);
  return v;
}

function str(v: unknown, path: string, max: number, min = 0): string {
  if (typeof v !== 'string') fail(path, 'Expected a string');
  if (v.length < min || v.length > max) fail(path, `Expected ${min} to ${max} characters`);
  return v;
}

function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(path, 'Expected an integer');
  if (v < min || v > max) fail(path, `Expected a value between ${min} and ${max}`);
  return v;
}

function oneOf<T extends string | number>(v: unknown, path: string, allowed: readonly T[]): T {
  if (!allowed.includes(v as T)) fail(path, `Expected one of ${allowed.join(', ')}`);
  return v as T;
}

function idOf(v: unknown, path: string): string {
  const s = str(v, path, LIMITS.maxIdLength, 1);
  if (!ID_PATTERN.test(s)) fail(path, 'Invalid id (letters, digits, _ . - only)');
  return s;
}

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const ALTERS = [-2, -1, 0, 1, 2] as const;
const BASES: readonly NoteBase[] = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'];
const CLEFS: readonly Clef[] = ['treble', 'bass', 'alto', 'tenor', 'treble-8vb', 'percussion'];
const STAFF_TYPES: readonly StaffType[] = ['standard', 'tab'];
const BEAT_TYPES = [1, 2, 4, 8, 16, 32] as const;
const MAX_MEASURE_TICKS = 32 * 3840;

function pitch(v: unknown, path: string): Pitch {
  const o = obj(v, path, ['step', 'alter', 'octave']);
  return {
    step: oneOf(o.step, `${path}/step`, STEPS),
    alter: oneOf(o.alter, `${path}/alter`, ALTERS),
    octave: int(o.octave, `${path}/octave`, -1, 9),
  };
}

function notePitch(v: unknown, path: string): NotePitch {
  const o = obj(v, path, ['step', 'alter', 'octave'], ['tieToNext', 'fretting']);
  const out: { -readonly [K in keyof NotePitch]: NotePitch[K] } = {
    step: oneOf(o.step, `${path}/step`, STEPS),
    alter: oneOf(o.alter, `${path}/alter`, ALTERS),
    octave: int(o.octave, `${path}/octave`, -1, 9),
  };
  if (o.tieToNext !== undefined) {
    if (typeof o.tieToNext !== 'boolean') fail(`${path}/tieToNext`, 'Expected a boolean');
    out.tieToNext = o.tieToNext;
  }
  if (o.fretting !== undefined) {
    const f = obj(o.fretting, `${path}/fretting`, ['string', 'fret'], ['manual']);
    const fretting: { -readonly [K in keyof Fretting]: Fretting[K] } = {
      string: int(f.string, `${path}/fretting/string`, 1, LIMITS.maxTuning),
      fret: int(f.fret, `${path}/fretting/fret`, 0, LIMITS.maxFret),
    };
    if (f.manual !== undefined) {
      if (typeof f.manual !== 'boolean') fail(`${path}/fretting/manual`, 'Expected a boolean');
      if (f.manual) fretting.manual = true;
    }
    out.fretting = fretting;
  }
  return out;
}

function duration(v: unknown, path: string): Duration {
  const o = obj(v, path, ['base', 'dots']);
  return {
    base: oneOf(o.base, `${path}/base`, BASES),
    dots: oneOf(o.dots, `${path}/dots`, [0, 1, 2] as const),
  };
}

function event(v: unknown, path: string): ScoreEvent {
  if (typeof v === 'object' && v !== null && (v as Obj).kind === 'rest') {
    const o = obj(v, path, ['kind', 'id', 'duration']);
    return {
      kind: 'rest',
      id: idOf(o.id, `${path}/id`),
      duration: duration(o.duration, `${path}/duration`),
    };
  }
  const o = obj(v, path, ['kind', 'id', 'duration', 'pitches']);
  oneOf(o.kind, `${path}/kind`, ['note'] as const);
  return {
    kind: 'note',
    id: idOf(o.id, `${path}/id`),
    duration: duration(o.duration, `${path}/duration`),
    pitches: arr(o.pitches, `${path}/pitches`, 1, LIMITS.maxPitchesPerChord).map((p, i) =>
      notePitch(p, `${path}/pitches/${i}`),
    ),
  };
}

function tuplet(v: unknown, path: string): Tuplet {
  const o = obj(v, path, ['id', 'actual', 'normal', 'eventIds']);
  return {
    id: idOf(o.id, `${path}/id`),
    actual: int(o.actual, `${path}/actual`, 2, 9),
    normal: int(o.normal, `${path}/normal`, 2, 9),
    eventIds: arr(o.eventIds, `${path}/eventIds`, 2, LIMITS.maxTupletEvents).map((x, i) =>
      idOf(x, `${path}/eventIds/${i}`),
    ),
  };
}

function voice(v: unknown, path: string): Voice {
  const o = obj(v, path, ['id', 'events', 'tuplets']);
  return {
    id: idOf(o.id, `${path}/id`),
    events: arr(o.events, `${path}/events`, 1, LIMITS.maxEventsPerVoice).map((e, i) =>
      event(e, `${path}/events/${i}`),
    ),
    tuplets: arr(o.tuplets, `${path}/tuplets`, 0, LIMITS.maxTupletsPerVoice).map((t, i) =>
      tuplet(t, `${path}/tuplets/${i}`),
    ),
  };
}

function staffMeasure(v: unknown, path: string): StaffMeasure {
  const o = obj(v, path, ['voices'], ['clef']);
  const voices = arr(o.voices, `${path}/voices`, 1, LIMITS.maxVoicesPerMeasure).map((x, i) =>
    voice(x, `${path}/voices/${i}`),
  );
  return o.clef === undefined ? { voices } : { clef: oneOf(o.clef, `${path}/clef`, CLEFS), voices };
}

function staff(v: unknown, path: string): Staff {
  const o = obj(v, path, ['id', 'clef', 'type', 'measures'], ['showRests']);
  const out: { -readonly [K in keyof Staff]: Staff[K] } = {
    id: idOf(o.id, `${path}/id`),
    clef: oneOf(o.clef, `${path}/clef`, CLEFS),
    type: oneOf(o.type, `${path}/type`, STAFF_TYPES),
    measures: arr(o.measures, `${path}/measures`, 1, LIMITS.maxMeasures).map((m, i) =>
      staffMeasure(m, `${path}/measures/${i}`),
    ),
  };
  if (o.showRests !== undefined) {
    if (typeof o.showRests !== 'boolean') fail(`${path}/showRests`, 'Expected a boolean');
    if (o.showRests) out.showRests = true;
  }
  return out;
}

function part(v: unknown, path: string): Part {
  const o = obj(
    v,
    path,
    ['id', 'name', 'instrument', 'transposition', 'staves'],
    ['tuning', 'capo'],
  );
  const out: { -readonly [K in keyof Part]: Part[K] } = {
    id: idOf(o.id, `${path}/id`),
    name: str(o.name, `${path}/name`, LIMITS.maxNameLength),
    instrument: str(o.instrument, `${path}/instrument`, LIMITS.maxInstrumentLength, 1),
    transposition: int(o.transposition, `${path}/transposition`, -36, 36),
    staves: arr(o.staves, `${path}/staves`, 1, LIMITS.maxStavesPerPart).map((s, i) =>
      staff(s, `${path}/staves/${i}`),
    ),
  };
  if (o.tuning !== undefined) {
    out.tuning = arr(o.tuning, `${path}/tuning`, 1, LIMITS.maxTuning).map((p, i) =>
      pitch(p, `${path}/tuning/${i}`),
    );
  }
  if (o.capo !== undefined) out.capo = int(o.capo, `${path}/capo`, 0, 24);
  return out;
}

function timeSignature(v: unknown, path: string): TimeSignature {
  const o = obj(v, path, ['beats', 'beatType']);
  return {
    beats: int(o.beats, `${path}/beats`, 1, 32),
    beatType: oneOf(o.beatType, `${path}/beatType`, BEAT_TYPES),
  };
}

function tempo(v: unknown, path: string): number {
  return int(v, path, 20, 400);
}

function measureInfo(v: unknown, path: string): MeasureInfo {
  const o = obj(v, path, ['id'], ['time', 'keyFifths', 'tempoBpm', 'length']);
  const out: { -readonly [K in keyof MeasureInfo]: MeasureInfo[K] } = {
    id: idOf(o.id, `${path}/id`),
  };
  if (o.time !== undefined) out.time = timeSignature(o.time, `${path}/time`);
  if (o.keyFifths !== undefined) out.keyFifths = int(o.keyFifths, `${path}/keyFifths`, -7, 7);
  if (o.tempoBpm !== undefined) out.tempoBpm = tempo(o.tempoBpm, `${path}/tempoBpm`);
  if (o.length !== undefined) {
    out.length = int(o.length, `${path}/length`, MIN_TICKS, MAX_MEASURE_TICKS);
    if (out.length % MIN_TICKS !== 0) fail(`${path}/length`, `Expected a multiple of ${MIN_TICKS}`);
  }
  return out;
}

function slur(v: unknown, path: string): Slur {
  const o = obj(v, path, ['id', 'startEventId', 'endEventId']);
  return {
    id: idOf(o.id, `${path}/id`),
    startEventId: idOf(o.startEventId, `${path}/startEventId`),
    endEventId: idOf(o.endEventId, `${path}/endEventId`),
  };
}

/** Structural decode of already-migrated JSON. Throws ScoreFormatError on the first problem. */
function decode(json: unknown): Score {
  const o = obj(json, '', ['schemaVersion', 'meta', 'measures', 'parts', 'slurs'], ['id']);
  oneOf(o.schemaVersion, '/schemaVersion', [SCHEMA_VERSION] as const);
  const m = obj(o.meta, '/meta', ['title', 'composer', 'tempoBpm']);
  const meta = {
    title: str(m.title, '/meta/title', LIMITS.maxTitleLength),
    composer: str(m.composer, '/meta/composer', LIMITS.maxTitleLength),
    tempoBpm: tempo(m.tempoBpm, '/meta/tempoBpm'),
  };
  const base = {
    schemaVersion: SCHEMA_VERSION,
    meta,
    measures: arr(o.measures, '/measures', 1, LIMITS.maxMeasures).map((x, i) =>
      measureInfo(x, `/measures/${i}`),
    ),
    parts: arr(o.parts, '/parts', 1, LIMITS.maxParts).map((x, i) => part(x, `/parts/${i}`)),
    slurs: arr(o.slurs, '/slurs', 0, LIMITS.maxSlurs).map((x, i) => slur(x, `/slurs/${i}`)),
  };
  return o.id === undefined ? base : { ...base, id: idOf(o.id, '/id') };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** JSON text of a score (compact). Contains only the fields of the format. */
export function serialize(score: Score): string {
  return JSON.stringify(score);
}

/**
 * Parses, migrates, structurally decodes and semantically validates untrusted JSON text.
 * Throws ScoreFormatError; never returns an invalid score.
 */
export function deserialize(text: string): Score {
  if (typeof text !== 'string' || text.length > LIMITS.maxJsonLength) {
    fail('', 'Input is not a string or is too large', 'too-large');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail('', 'Invalid JSON', 'invalid-json');
  }
  return fromJson(json);
}

/** Same as `deserialize` for an already parsed value (e.g. a request body). */
export function fromJson(json: unknown): Score {
  const score = decode(migrate(json));
  const issues = validateScore(score);
  if (issues.length > 0) throw new ScoreFormatError(issues);
  return score;
}
