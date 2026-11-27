/**
 * Tiny text DSL to write test scores by hand (not part of the public API).
 *
 * Event tokens, separated by spaces, one string per voice and measure:
 *   `C4:q`  `F#4:e.`  `Bb3:h`  `r:q` (rest)  `C4+E4+G4:q` (chord)
 *   `C4:q~`  tie to next    `C4:q<` / `D4:q>`  slur start / end
 *   `E3@6.0`  fretting (string 6, fret 0) on a pitch
 *   `(3 C4:e D4:e E4:e)`  3:2 triplet (`(actual ...)`, normal = 2 for 3, 4 for 5/6, 3 for 4)
 * Durations: w h q e s (16th) t (32nd), each with up to two `.` dots.
 */
import { getInstrument } from '../instruments';
import { decompose } from '../ticks';
import type {
  Alter,
  Clef,
  Duration,
  MeasureInfo,
  NoteBase,
  NotePitch,
  Part,
  Pitch,
  Score,
  ScoreEvent,
  Slur,
  StaffMeasure,
  StaffType,
  StepName,
  TimeSignature,
  Tuplet,
  Voice,
} from '../types';

const BASES: Record<string, NoteBase> = {
  w: 'whole',
  h: 'half',
  q: 'quarter',
  e: 'eighth',
  s: '16th',
  t: '32nd',
};
const NORMAL: Record<number, number> = { 2: 3, 3: 2, 4: 3, 5: 4, 6: 4 };

export type MeasureCell =
  string | readonly string[] | { clef: Clef; voices: string | readonly string[] };

export interface StaffSpec {
  clef?: Clef;
  type?: StaffType;
  measures: readonly MeasureCell[];
}
export interface PartSpec {
  name: string;
  instrument: string;
  transposition?: number;
  tuning?: readonly Pitch[];
  capo?: number;
  staves: readonly StaffSpec[];
}
export interface ScoreSpec {
  title: string;
  composer?: string;
  tempoBpm?: number;
  time?: TimeSignature;
  keyFifths?: number;
  /** Extra attributes by measure index (time/key changes, tempo, pickup length). */
  measureInfo?: Readonly<Record<number, Partial<Omit<MeasureInfo, 'id'>>>>;
  parts: readonly PartSpec[];
}

export function pitchOf(token: string): NotePitch {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)(?:@(\d+)\.(\d+))?$/.exec(token);
  if (!m) throw new Error(`Bad pitch "${token}"`);
  const acc = m[2] ?? '';
  const alter = ((acc.startsWith('#') ? 1 : -1) * acc.length) as Alter;
  const out: { -readonly [K in keyof NotePitch]: NotePitch[K] } = {
    step: m[1] as StepName,
    alter: acc ? alter : 0,
    octave: Number(m[3]),
  };
  if (m[4]) out.fretting = { string: Number(m[4]), fret: Number(m[5]) };
  return out;
}

function durationOf(code: string): Duration {
  const m = /^([whqest])(\.{0,2})$/.exec(code);
  if (!m) throw new Error(`Bad duration "${code}"`);
  return { base: BASES[m[1]!]!, dots: m[2]!.length as 0 | 1 | 2 };
}

class Ids {
  private n: Record<string, number> = {};
  next(prefix: string): string {
    this.n[prefix] = (this.n[prefix] ?? 0) + 1;
    return `${prefix}${this.n[prefix]}`;
  }
}

function buildVoice(text: string, ids: Ids, slurStack: string[], slurs: Slur[]): Voice {
  const events: ScoreEvent[] = [];
  const tuplets: Tuplet[] = [];
  const parseToken = (raw: string): ScoreEvent => {
    let tok = raw;
    const flags = { tie: false, slurStart: false, slurEnd: false };
    for (;;) {
      if (tok.endsWith('~')) flags.tie = true;
      else if (tok.endsWith('<')) flags.slurStart = true;
      else if (tok.endsWith('>')) flags.slurEnd = true;
      else break;
      tok = tok.slice(0, -1);
    }
    const [what, dur] = tok.split(':');
    if (!what || !dur) throw new Error(`Bad token "${raw}"`);
    const duration = durationOf(dur);
    const id = ids.next('e');
    if (flags.slurStart) slurStack.push(id);
    if (flags.slurEnd) {
      const start = slurStack.pop();
      if (!start) throw new Error('Slur end without start');
      slurs.push({ id: ids.next('sl'), startEventId: start, endEventId: id });
    }
    if (what === 'r') return { kind: 'rest', id, duration };
    const pitches = what.split('+').map(pitchOf);
    return {
      kind: 'note',
      id,
      duration,
      pitches: flags.tie ? pitches.map((p) => ({ ...p, tieToNext: true })) : pitches,
    };
  };
  for (const m of text.matchAll(/\([^)]*\)|\S+/g)) {
    const tok = m[0];
    if (tok.startsWith('(')) {
      const [count, ...rest] = tok.slice(1, -1).trim().split(/\s+/);
      const actual = Number(count);
      const members = rest.map(parseToken);
      events.push(...members);
      tuplets.push({
        id: ids.next('t'),
        actual,
        normal: NORMAL[actual]!,
        eventIds: members.map((e) => e.id),
      });
    } else events.push(parseToken(tok));
  }
  return { id: ids.next('v'), events, tuplets };
}

export function buildScore(spec: ScoreSpec): Score {
  const ids = new Ids();
  const count = spec.parts[0]!.staves[0]!.measures.length;
  const slurs: Slur[] = [];
  const measures: MeasureInfo[] = [];
  for (let i = 0; i < count; i++) {
    const base: { id: string; time?: TimeSignature; keyFifths?: number } = { id: ids.next('m') };
    if (i === 0) {
      base.time = spec.time ?? { beats: 4, beatType: 4 };
      base.keyFifths = spec.keyFifths ?? 0;
    }
    measures.push({ ...base, ...spec.measureInfo?.[i] });
  }
  const parts: Part[] = spec.parts.map((p) => {
    const inst = getInstrument(p.instrument);
    const part: { -readonly [K in keyof Part]: Part[K] } = {
      id: ids.next('p'),
      name: p.name,
      instrument: p.instrument,
      transposition: p.transposition ?? inst?.transposition ?? 0,
      staves: p.staves.map((s) => {
        const stack: string[] = [];
        return {
          id: ids.next('s'),
          clef: s.clef ?? inst?.clefs[0] ?? 'treble',
          type: s.type ?? 'standard',
          measures: s.measures.map((cell): StaffMeasure => {
            const isObj = typeof cell === 'object' && !Array.isArray(cell);
            const obj = isObj
              ? (cell as { clef: Clef; voices: string | readonly string[] })
              : undefined;
            const voices = obj ? obj.voices : (cell as string | readonly string[]);
            const list = typeof voices === 'string' ? [voices] : voices;
            const voiceList = list.map((t) => buildVoice(t, ids, stack, slurs));
            const clef = obj?.clef;
            return clef ? { clef, voices: voiceList } : { voices: voiceList };
          }),
        };
      }),
    };
    if (p.tuning) part.tuning = p.tuning;
    if (p.capo) part.capo = p.capo;
    return part;
  });
  return {
    schemaVersion: 1,
    meta: { title: spec.title, composer: spec.composer ?? '', tempoBpm: spec.tempoBpm ?? 100 },
    measures,
    parts,
    slurs,
  };
}

/** Rests filling one measure of `ticks` (used by generators). */
export function restToken(ticks: number): string {
  const codes = { whole: 'w', half: 'h', quarter: 'q', eighth: 'e', '16th': 's', '32nd': 't' };
  return decompose(ticks, 0)
    .map((d) => `r:${codes[d.base]}${'.'.repeat(d.dots)}`)
    .join(' ');
}
