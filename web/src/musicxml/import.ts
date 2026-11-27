import {
  decompose,
  durationTicks,
  fromJson,
  getInstrument,
  idGen,
  LIMITS,
  newId,
  partTuning,
  pitchEquals,
  STEPS,
  timeSignatureTicks,
  validateScore,
  ScoreFormatError,
  type Alter,
  type ChordData,
  type ChordFrame,
  type ChordSymbol,
  type Clef,
  type Duration,
  type Fretting,
  type IdGen,
  type NotePitch,
  type NoteBase,
  type Part,
  type Pitch,
  type Score,
  type StepName,
  type TimeSignature,
} from '../score';
import { lookupShape } from '../chords/library';
import { diagramPlan } from '../engraving/chords';
import {
  CHORD_CAPO_FIELD,
  CHORD_DIAGRAMS_FIELD,
  CHORD_FLAGS_FIELD,
  INSTRUMENT_FIELD,
  MANUAL_FRETTING,
} from './export';
import { parseHarmony } from './harmony';
import { MUSICXML_LIMITS } from './limits';
import { looksLikeZip, unpackMxl } from './mxl';
import { MusicXmlError, type ImportResult } from './types';
import { cleanText, decodeXml, parseXmlSafely } from './xml';

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

class Counter {
  readonly counts: Record<string, number> = Object.create(null) as Record<string, number>;
  add(name: string, n = 1): void {
    this.counts[name] = (this.counts[name] ?? 0) + n;
  }
}

// Walks siblings instead of `el.children`: building the live collection is slow in some DOMs.
const kids = (el: Element): Element[] => {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) out.push(c);
  return out;
};
const child = (el: Element, name: string): Element | undefined => {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name) return c;
  }
  return undefined;
};
const childText = (el: Element, name: string): string | undefined =>
  child(el, name)?.textContent?.trim();
const num = (text: string | undefined): number | undefined => {
  if (text === undefined || text === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
};
const int = (text: string | undefined): number | undefined => {
  const n = num(text);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
};
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const UNIT_TICKS: Record<string, number> = {
  whole: 3840,
  half: 1920,
  quarter: 960,
  eighth: 480,
  '16th': 240,
  '32nd': 120,
};
const BASES: readonly NoteBase[] = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'];

/** Every (base, dots) the model can hold, by ticks. */
const DURATION_BY_TICKS = new Map<number, Duration>();
for (const base of BASES) {
  for (const dots of [0, 1, 2] as const) {
    const d: Duration = { base, dots };
    const t = durationTicks(d);
    if (!DURATION_BY_TICKS.has(t)) DURATION_BY_TICKS.set(t, d);
  }
}
const findDuration = (ticks: number): Duration | undefined => DURATION_BY_TICKS.get(ticks);
const BASE_TICKS = new Set([7680, 3840, 1920, 960, 480, 240, 120, 60, 30]);

// ---------------------------------------------------------------------------------------------
// Raw (file-shaped) structures
// ---------------------------------------------------------------------------------------------

interface RawPitch {
  step: StepName;
  alter: Alter;
  octave: number;
  tie: boolean;
  fretting?: Fretting;
}

interface Ratio {
  readonly actual: number;
  readonly normal: number;
}

interface RawItem {
  start: number;
  dur: number;
  kind: 'note' | 'rest';
  pitches: RawPitch[];
  ratio?: Ratio | undefined;
  tupletStart: boolean;
  tupletStop: boolean;
  slurStarts: string[];
  slurStops: string[];
  group?: RawItem[] | undefined;
  nominal?: Duration | undefined;
  wholeMeasure: boolean;
}

type ClefOrTab = Clef | 'tab';

interface RawChord {
  readonly staff: number;
  readonly tick: number;
  readonly chord: ChordData;
  readonly frame?: ChordFrame | undefined;
}

interface RawMeasure {
  /** Chord symbols (`<harmony>`) in reading order. */
  chords: RawChord[];
  /** staff number -> voice key -> items */
  staffItems: Map<number, Map<string, RawItem[]>>;
  clefs: Map<number, ClefOrTab>;
  contentTicks: number;
  time?: TimeSignature;
  key?: number;
  tempo?: number;
}

interface RawPart {
  id: string;
  measures: RawMeasure[];
  staffCount: number;
  tabStaves: Set<number>;
  voiceKeys: Map<number, Set<string>>;
  transposition?: number;
  tuning?: Pitch[];
  capo: number;
}

interface PartInfo {
  /** Chord options kept by Polymnia (see harmony.ts / docs/musicxml.md). */
  diagrams?: 'first' | 'all';
  capoShapes?: boolean;
  /** `measure.staff.tick` -> explicit diagram flag. */
  flags?: Map<string, boolean>;
  name: string;
  sound?: string;
  instrument?: string;
}

// ---------------------------------------------------------------------------------------------
// Reading a part
// ---------------------------------------------------------------------------------------------

const NOTE_KNOWN = new Set([
  'grace',
  'chord',
  'pitch',
  'unpitched',
  'rest',
  'duration',
  'tie',
  'instrument',
  'voice',
  'type',
  'dot',
  'accidental',
  'time-modification',
  'stem',
  'notehead',
  'staff',
  'beam',
  'notations',
  'footnote',
  'level',
  'cue',
]);
const SILENT_NOTATIONS = new Set(['footnote', 'level']);
const NAMED_CONTAINERS = new Set(['articulations', 'ornaments', 'dynamics']);
const SILENT_ATTRIBUTES = new Set(['footnote', 'level']);

interface PartState {
  divisions: number;
  time: TimeSignature;
  pendingClefs: Map<number, ClefOrTab>;
  staves: number;
}

function readPitch(
  stepText: string | undefined,
  alterText: string | undefined,
  octaveText: string | undefined,
  ctx: Ctx,
): RawPitch | undefined {
  const step = stepText as StepName | undefined;
  const octave = int(octaveText);
  if (!step || !STEPS.includes(step) || octave === undefined || octave < -1 || octave > 9) {
    ctx.dropped.add('pitch (out of range)');
    return undefined;
  }
  const rawAlter = num(alterText) ?? 0;
  let alter = Math.round(rawAlter);
  if (alter !== rawAlter) ctx.adjusted.add('alter (microtone)');
  if (alter < -2 || alter > 2) {
    alter = clamp(alter, -2, 2);
    ctx.adjusted.add('alter (out of range)');
  }
  return { step, alter: alter as Alter, octave, tie: false };
}

const parsePitch = (el: Element, ctx: Ctx): RawPitch | undefined =>
  readPitch(childText(el, 'step'), childText(el, 'alter'), childText(el, 'octave'), ctx);

function metronomeBpm(el: Element, report: Counter): number | undefined {
  const units = kids(el).filter((c) => c.localName === 'beat-unit');
  if (units.length !== 1 || child(el, 'metronome-note')) {
    report.add('metronome');
    return undefined;
  }
  const unit = UNIT_TICKS[units[0]!.textContent?.trim() ?? ''];
  const dots = kids(el).filter((c) => c.localName === 'beat-unit-dot').length;
  const perMinute = num(childText(el, 'per-minute')?.split(/[-–\s]/)[0]);
  if (!unit || perMinute === undefined) {
    report.add('metronome');
    return undefined;
  }
  return (perMinute * unit * (2 - 0.5 ** dots)) / 960;
}

function parseClef(el: Element, adjust: Counter): ClefOrTab {
  const sign = childText(el, 'sign');
  const line = int(childText(el, 'line'));
  const octave = int(childText(el, 'clef-octave-change')) ?? 0;
  switch (sign) {
    case 'G':
      if (octave < 0) return 'treble-8vb';
      if (octave > 0 || (line !== undefined && line !== 2)) adjust.add('clef');
      return 'treble';
    case 'F':
      if (line !== undefined && line !== 4) adjust.add('clef');
      return 'bass';
    case 'C':
      if (line === 3) return 'alto';
      if (line === 4) return 'tenor';
      adjust.add('clef');
      return line !== undefined && line > 3 ? 'tenor' : 'alto';
    case 'percussion':
      return 'percussion';
    case 'TAB':
      return 'tab';
    default:
      adjust.add('clef');
      return 'treble';
  }
}

interface Ctx {
  dropped: Counter;
  adjusted: Counter;
}

function parseAttributes(
  el: Element,
  part: RawPart,
  st: PartState,
  rm: RawMeasure,
  cursor: number,
  ctx: Ctx,
  first: boolean,
): void {
  for (const a of kids(el)) {
    switch (a.localName) {
      case 'divisions': {
        const d = num(a.textContent?.trim());
        if (d !== undefined && d > 0) st.divisions = d;
        break;
      }
      case 'key': {
        const number = a.getAttribute('number');
        if (child(a, 'key-step')) {
          ctx.dropped.add('key (non-traditional)');
          break;
        }
        const fifths = int(childText(a, 'fifths'));
        if (fifths === undefined || (number && number !== '1')) break;
        if (first) rm.key = clamp(fifths, -7, 7);
        break;
      }
      case 'time': {
        if (child(a, 'senza-misura')) {
          ctx.dropped.add('senza-misura');
          break;
        }
        const beatsEls = kids(a).filter((c) => c.localName === 'beats');
        const types = kids(a).filter((c) => c.localName === 'beat-type');
        if (beatsEls.length > 1) ctx.dropped.add('time (composite)');
        const beats = (beatsEls[0]?.textContent ?? '')
          .split('+')
          .reduce((sum, p) => sum + (int(p.trim()) ?? 0), 0);
        const beatType = int(types[0]?.textContent?.trim());
        if (
          beats < 1 ||
          beats > 32 ||
          beatType === undefined ||
          ![1, 2, 4, 8, 16, 32].includes(beatType)
        ) {
          ctx.dropped.add('time (unsupported)');
          break;
        }
        const time: TimeSignature = { beats, beatType: beatType as TimeSignature['beatType'] };
        st.time = time;
        if (first) rm.time = time;
        break;
      }
      case 'staves': {
        const n = int(a.textContent?.trim());
        if (n !== undefined && n >= 1) st.staves = n;
        break;
      }
      case 'clef': {
        const number = int(a.getAttribute('number') ?? undefined) ?? 1;
        const clef = parseClef(a, ctx.adjusted);
        if (clef === 'tab') part.tabStaves.add(number);
        if (cursor <= 0.5) rm.clefs.set(number, clef);
        else if (cursor >= timeSignatureTicks(st.time) - 0.5) st.pendingClefs.set(number, clef);
        else ctx.dropped.add('clef (mid-measure)');
        break;
      }
      case 'staff-details': {
        const lines = kids(a).filter((c) => c.localName === 'staff-tuning');
        if (lines.length > 0 && !part.tuning) {
          const byLine = lines
            .map((l, i) => ({
              line: int(l.getAttribute('line') ?? undefined) ?? i + 1,
              pitch: readPitch(
                childText(l, 'tuning-step'),
                childText(l, 'tuning-alter'),
                childText(l, 'tuning-octave'),
                ctx,
              ),
            }))
            .sort((x, y) => x.line - y.line);
          if (
            byLine.every((l) => l.pitch !== undefined) &&
            byLine.length <= LIMITS.maxTuning &&
            byLine.length > 0
          ) {
            // Lines count from the lowest string; the model lists strings high to low.
            part.tuning = byLine
              .map((l) => ({ step: l.pitch!.step, alter: l.pitch!.alter, octave: l.pitch!.octave }))
              .reverse();
          }
        }
        const capo = int(childText(a, 'capo'));
        if (capo !== undefined && capo > 0 && capo <= 24 && part.capo === 0) part.capo = capo;
        for (const d of kids(a)) {
          if (
            ![
              'staff-lines',
              'staff-tuning',
              'capo',
              'staff-type',
              'staff-size',
              'show-frets',
              'print-object',
            ].includes(d.localName)
          ) {
            ctx.dropped.add(d.localName);
          }
        }
        break;
      }
      case 'transpose': {
        const chromatic = int(childText(a, 'chromatic')) ?? 0;
        const octaves = int(childText(a, 'octave-change')) ?? 0;
        const total = chromatic + 12 * octaves;
        if (child(a, 'double')) ctx.dropped.add('double');
        if (part.transposition === undefined && total >= -36 && total <= 36) {
          part.transposition = total;
        } else if (part.transposition !== total) ctx.dropped.add('transpose (change)');
        break;
      }
      default:
        if (!SILENT_ATTRIBUTES.has(a.localName)) ctx.dropped.add(a.localName);
    }
  }
}

interface MeasureCtx {
  cursor: number;
  last?: RawItem | undefined;
  lastPitch?: RawPitch | undefined;
}

function parseNote(
  n: Element,
  part: RawPart,
  st: PartState,
  rm: RawMeasure,
  mc: MeasureCtx,
  ctx: Ctx,
): void {
  // One pass over the children of the note.
  let grace = false;
  let isChord = false;
  let staffText: string | undefined;
  let voiceText: string | undefined;
  let durText: string | undefined;
  let restEl: Element | undefined;
  let pitchEl: Element | undefined;
  let tmEl: Element | undefined;
  const ties: Element[] = [];
  const notationsList: Element[] = [];
  for (let c = n.firstElementChild; c; c = c.nextElementSibling) {
    const name = c.localName;
    if (!NOTE_KNOWN.has(name)) ctx.dropped.add(name);
    else if (name === 'grace') grace = true;
    else if (name === 'chord') isChord = true;
    else if (name === 'staff') staffText = c.textContent?.trim();
    else if (name === 'voice') voiceText = c.textContent?.trim();
    else if (name === 'duration') durText = c.textContent?.trim();
    else if (name === 'rest') restEl = c;
    else if (name === 'pitch') pitchEl = c;
    else if (name === 'time-modification') tmEl = c;
    else if (name === 'tie') ties.push(c);
    else if (name === 'notations') notationsList.push(c);
    else if (name === 'unpitched') ctx.dropped.add('unpitched');
  }
  if (grace) {
    ctx.dropped.add('grace');
    return;
  }
  const staffRaw = int(staffText) ?? 1;
  const voiceKey = voiceText || '1';

  let rawPitch: RawPitch | undefined;
  if (!restEl && pitchEl) {
    rawPitch = parsePitch(pitchEl, ctx);
  }
  const asRest = !rawPitch;

  const durDivs = num(durText);
  let item: RawItem;
  if (isChord && mc.last && mc.last.kind === 'note' && rawPitch) {
    item = mc.last;
    if (item.pitches.length < LIMITS.maxPitchesPerChord) item.pitches.push(rawPitch);
    else ctx.dropped.add('pitch (chord too large)');
  } else if (isChord) {
    // A chord note attached to a rest or to nothing: nothing to add.
    return;
  } else {
    let dur = ((durDivs ?? 0) * 960) / st.divisions;
    const wholeMeasure = restEl?.getAttribute('measure') === 'yes';
    if (wholeMeasure && !(dur > 0)) dur = timeSignatureTicks(st.time);
    item = {
      start: mc.cursor,
      dur,
      kind: asRest ? 'rest' : 'note',
      pitches: rawPitch ? [rawPitch] : [],
      tupletStart: false,
      tupletStop: false,
      slurStarts: [],
      slurStops: [],
      wholeMeasure,
    };
    if (tmEl) {
      const actual = int(childText(tmEl, 'actual-notes'));
      const normal = int(childText(tmEl, 'normal-notes'));
      if (actual && normal) item.ratio = { actual, normal };
    }
    mc.cursor += dur;
    rm.contentTicks = Math.max(rm.contentTicks, mc.cursor);
    mc.last = item;
    if (!(dur > 0)) {
      ctx.dropped.add('note (no duration)');
      return;
    }
    const staffNo = staffRaw;
    if (staffNo < 1 || staffNo > LIMITS.maxStavesPerPart) {
      ctx.dropped.add('staff');
      return;
    }
    let perStaff = rm.staffItems.get(staffNo);
    if (!perStaff) rm.staffItems.set(staffNo, (perStaff = new Map()));
    let list = perStaff.get(voiceKey);
    if (!list) perStaff.set(voiceKey, (list = []));
    list.push(item);
    let keys = part.voiceKeys.get(staffNo);
    if (!keys) part.voiceKeys.set(staffNo, (keys = new Set()));
    keys.add(voiceKey);
    part.staffCount = Math.max(part.staffCount, staffNo);
  }

  // Ties, notations.
  for (const t of ties) {
    if (t.getAttribute('type') === 'start' && rawPitch) rawPitch.tie = true;
  }
  const slurKey = (number: string | null) => `${staffRaw}|${voiceKey}|${number ?? '1'}`;
  for (const notations of notationsList) {
    for (const c of kids(notations)) {
      const type = c.getAttribute('type');
      switch (c.localName) {
        case 'tied':
          if (type === 'start' && rawPitch) rawPitch.tie = true;
          break;
        case 'slur': {
          const key = slurKey(c.getAttribute('number'));
          if (type === 'start' && !item.slurStarts.includes(key)) item.slurStarts.push(key);
          else if (type === 'stop' && !item.slurStops.includes(key)) item.slurStops.push(key);
          break;
        }
        case 'tuplet':
          if (type === 'start') item.tupletStart = true;
          else if (type === 'stop') item.tupletStop = true;
          break;
        case 'technical': {
          let manual = false;
          for (const t of kids(c)) {
            if (t.localName === 'string' || t.localName === 'fret') continue;
            if (
              t.localName === 'other-technical' &&
              cleanText(t.textContent, 64) === MANUAL_FRETTING
            ) {
              manual = true;
              continue;
            }
            ctx.dropped.add(t.localName);
          }
          if (rawPitch) {
            const string = int(childText(c, 'string'));
            const fret = int(childText(c, 'fret'));
            if (
              string !== undefined &&
              fret !== undefined &&
              string >= 1 &&
              string <= LIMITS.maxTuning &&
              fret >= 0 &&
              fret <= LIMITS.maxFret
            ) {
              rawPitch.fretting = manual ? { string, fret, manual: true } : { string, fret };
            }
          }
          break;
        }
        default:
          if (SILENT_NOTATIONS.has(c.localName)) break;
          if (NAMED_CONTAINERS.has(c.localName)) {
            const inner = kids(c);
            if (inner.length === 0) ctx.dropped.add(c.localName);
            for (const x of inner) ctx.dropped.add(x.localName);
          } else ctx.dropped.add(c.localName);
      }
    }
  }
}

function parsePart(el: Element, id: string, first: boolean, ctx: Ctx): RawPart {
  const part: RawPart = {
    id,
    measures: [],
    staffCount: 1,
    tabStaves: new Set(),
    voiceKeys: new Map(),
    capo: 0,
  };
  const st: PartState = {
    divisions: 1,
    time: { beats: 4, beatType: 4 },
    pendingClefs: new Map(),
    staves: 1,
  };
  for (const m of kids(el)) {
    if (m.localName !== 'measure') {
      ctx.dropped.add(m.localName);
      continue;
    }
    if (part.measures.length >= LIMITS.maxMeasures) {
      throw new MusicXmlError('too-many-measures', 'Too many measures');
    }
    const rm: RawMeasure = {
      staffItems: new Map(),
      clefs: new Map(st.pendingClefs),
      contentTicks: 0,
      chords: [],
    };
    st.pendingClefs.clear();
    const mc: MeasureCtx = { cursor: 0 };
    for (const c of kids(m)) {
      switch (c.localName) {
        case 'attributes':
          parseAttributes(c, part, st, rm, mc.cursor, ctx, first);
          break;
        case 'note':
          parseNote(c, part, st, rm, mc, ctx);
          break;
        case 'backup':
          mc.cursor = Math.max(
            0,
            mc.cursor - ((num(childText(c, 'duration')) ?? 0) * 960) / st.divisions,
          );
          mc.last = undefined;
          break;
        case 'forward':
          mc.cursor += ((num(childText(c, 'duration')) ?? 0) * 960) / st.divisions;
          rm.contentTicks = Math.max(rm.contentTicks, mc.cursor);
          mc.last = undefined;
          break;
        case 'direction':
          parseDirection(c, rm, mc, ctx);
          break;
        case 'harmony': {
          const h = parseHarmony(c);
          for (const d of h.dropped) ctx.dropped.add(d);
          if (!('chord' in h)) break;
          const tick = Math.round(mc.cursor + (h.offset * 960) / st.divisions);
          if (tick < 0) ctx.dropped.add('harmony (outside measure)');
          else rm.chords.push({ staff: h.staff, tick, chord: h.chord, frame: h.frame });
          break;
        }
        case 'sound':
          applyTempo(num(c.getAttribute('tempo') ?? undefined), rm, mc, ctx);
          break;
        case 'barline':
          for (const b of kids(c)) {
            if (!['bar-style', 'footnote', 'level'].includes(b.localName))
              ctx.dropped.add(b.localName);
          }
          break;
        case 'print':
          break;
        default:
          ctx.dropped.add(c.localName);
      }
    }
    part.measures.push(rm);
  }
  part.staffCount = clamp(Math.max(part.staffCount, st.staves), 1, LIMITS.maxStavesPerPart);
  return part;
}

function applyTempo(bpm: number | undefined, rm: RawMeasure, mc: MeasureCtx, ctx: Ctx): void {
  if (bpm === undefined || bpm <= 0) return;
  if (mc.cursor > 0.5) {
    ctx.dropped.add('tempo (mid-measure)');
    return;
  }
  let value = Math.round(bpm);
  if (value < 20 || value > 400) {
    value = clamp(value, 20, 400);
    ctx.adjusted.add('tempo');
  }
  rm.tempo ??= value;
}

function parseDirection(el: Element, rm: RawMeasure, mc: MeasureCtx, ctx: Ctx): void {
  let sound: number | undefined;
  let metronome: number | undefined;
  for (const c of kids(el)) {
    if (c.localName === 'direction-type') {
      for (const x of kids(c)) {
        if (x.localName === 'metronome') metronome = metronomeBpm(x, ctx.dropped) ?? metronome;
        else ctx.dropped.add(x.localName);
      }
    } else if (c.localName === 'sound') {
      sound = num(c.getAttribute('tempo') ?? undefined) ?? sound;
    }
  }
  applyTempo(sound ?? metronome, rm, mc, ctx);
}

// ---------------------------------------------------------------------------------------------
// Building the model
// ---------------------------------------------------------------------------------------------

type MPitch = {
  -readonly [K in keyof NotePitch]: NotePitch[K];
};
interface MNote {
  kind: 'note';
  id: string;
  duration: Duration;
  pitches: MPitch[];
}
interface MRest {
  kind: 'rest';
  id: string;
  duration: Duration;
}
type MEvent = MNote | MRest;
interface MVoice {
  id: string;
  events: MEvent[];
  tuplets: { id: string; actual: number; normal: number; eventIds: string[] }[];
}

interface BuildCtx extends Ctx {
  gen: IdGen;
  /** event id -> position, only for events that carry a slur mark */
  positions: Map<string, { staff: string; at: number }>;
}

const sameRatio = (a: Ratio, b: Ratio): boolean => a.actual === b.actual && a.normal === b.normal;

function groupTuplets(items: RawItem[]): RawItem[][] {
  const groups: RawItem[][] = [];
  let open: RawItem[] | undefined;
  let marked = false;
  const close = () => {
    if (open) groups.push(open);
    open = undefined;
    marked = false;
  };
  for (const it of items) {
    if (!it.ratio) {
      close();
      continue;
    }
    if (open && (it.tupletStart || !sameRatio(open[0]!.ratio!, it.ratio))) close();
    if (!open) {
      open = [];
      marked = it.tupletStart;
    }
    open.push(it);
    it.group = open;
    if (it.tupletStop) close();
    else if (!marked) {
      const total = open.reduce((s, x) => s + x.dur, 0);
      const unit = total / it.ratio.normal;
      if (Math.abs(unit - Math.round(unit)) < 0.01 && BASE_TICKS.has(Math.round(unit))) close();
    }
  }
  close();
  return groups;
}

function validateGroups(groups: RawItem[][], ctx: Ctx): void {
  for (const g of groups) {
    const r = g[0]!.ratio!;
    let ok =
      g.length >= 2 &&
      g.length <= LIMITS.maxTupletEvents &&
      r.actual !== r.normal &&
      r.actual >= 2 &&
      r.actual <= 9 &&
      r.normal >= 2 &&
      r.normal <= 9;
    if (ok) {
      for (const it of g) {
        const d = findDuration(Math.round((it.dur * r.actual) / r.normal));
        if (!d || !Number.isInteger((durationTicks(d) * r.normal) / r.actual)) {
          ok = false;
          break;
        }
        it.nominal = d;
      }
    }
    if (!ok) {
      ctx.adjusted.add('tuplet');
      for (const it of g) {
        it.ratio = undefined;
        it.group = undefined;
        it.nominal = undefined;
      }
    }
  }
}

function restVoice(len: number, ctx: BuildCtx): MVoice {
  return {
    id: ctx.gen(),
    events: decompose(len, 0).map((duration) => ({ kind: 'rest', id: ctx.gen(), duration })),
    tuplets: [],
  };
}

function buildVoice(
  rawItems: RawItem[],
  len: number,
  measureStart: number,
  staffId: string,
  ctx: BuildCtx,
  slurs: SlurState,
): MVoice {
  const items = rawItems.slice().sort((a, b) => a.start - b.start);
  validateGroups(groupTuplets(items), ctx);
  const events: MEvent[] = [];
  const tuplets: MVoice['tuplets'] = [];
  const voiceId = ctx.gen();
  let cursor = 0;
  let failed = false;
  const idOfItem = new WeakMap<RawItem, string>();

  const pushRests = (ticks: number) => {
    const from = Math.round(cursor / 120) * 120;
    for (const duration of decompose(ticks, from)) {
      events.push({ kind: 'rest', id: ctx.gen(), duration });
    }
    cursor += ticks;
  };

  for (const it of items) {
    if (failed) break;
    const gap = Math.round(it.start) - cursor;
    if (gap >= 60) {
      const g = Math.round(gap / 120) * 120;
      if (g > 0 && cursor + g <= len) pushRests(g);
    } else if (gap <= -60) {
      ctx.dropped.add('overlap');
      continue;
    }
    const at = cursor;
    let firstId = '';
    let lastId = '';

    if (it.group && it.nominal) {
      const r = it.ratio!;
      const scaled = (durationTicks(it.nominal) * r.normal) / r.actual;
      if (cursor + scaled > len + 0.5) {
        failed = true;
        break;
      }
      const id = ctx.gen();
      events.push(makeEvent(it, id, it.nominal, false));
      idOfItem.set(it, id);
      cursor += scaled;
      firstId = lastId = id;
      const group = it.group;
      if (group[group.length - 1] === it) {
        const ids = group.map((x) => idOfItem.get(x));
        const from = events.findIndex((e) => e.id === ids[0]);
        if (from < 0 || ids.some((x, k) => events[from + k]?.id !== x)) {
          failed = true;
          break;
        }
        tuplets.push({
          id: ctx.gen(),
          actual: r.actual,
          normal: r.normal,
          eventIds: ids as string[],
        });
      }
    } else {
      let ticks = Math.round(it.dur);
      const q = Math.max(120, Math.round(ticks / 120) * 120);
      if (q !== ticks) ctx.adjusted.add('duration (quantized)');
      ticks = q;
      const remaining = len - cursor;
      if (ticks > remaining) {
        if (remaining >= 120) {
          ticks = Math.floor(remaining / 120) * 120;
          ctx.adjusted.add('overfull measure');
        } else {
          ctx.dropped.add('overfull measure');
          continue;
        }
      }
      const pieces = decompose(ticks, Math.round(cursor / 120) * 120);
      pieces.forEach((d, i) => {
        const id = ctx.gen();
        if (i === 0) firstId = id;
        lastId = id;
        events.push(makeEvent(it, id, d, i < pieces.length - 1));
      });
      cursor += ticks;
    }

    const pos = { staff: staffId, at: measureStart + at };
    for (const key of it.slurStops) {
      const start = slurs.open.get(key);
      slurs.open.delete(key);
      if (start && start.at < pos.at) slurs.done.push({ start: start.id, end: lastId });
      else ctx.dropped.add('slur');
    }
    for (const key of it.slurStarts) slurs.open.set(key, { id: firstId, ...pos });
  }

  const rest = len - cursor;
  if (!failed && rest > 0 && rest % 120 === 0) pushRests(rest);
  else if (failed || rest !== 0) {
    ctx.adjusted.add('unreadable measure');
    return restVoice(len, ctx);
  }
  return { id: voiceId, events, tuplets };
}

function makeEvent(it: RawItem, id: string, duration: Duration, tiedToNext: boolean): MEvent {
  if (it.kind === 'rest') return { kind: 'rest', id, duration };
  return {
    kind: 'note',
    id,
    duration,
    pitches: it.pitches.map((p) => {
      const out: MPitch = { step: p.step, alter: p.alter, octave: p.octave };
      if (tiedToNext || p.tie) out.tieToNext = true;
      if (p.fretting) out.fretting = { ...p.fretting };
      return out;
    }),
  };
}

interface SlurState {
  open: Map<string, { id: string; staff: string; at: number }>;
  done: { start: string; end: string }[];
}

const SOUND_TO_INSTRUMENT: readonly (readonly [string, string])[] = [
  ['keyboard.piano', 'piano'],
  ['voice.', 'voice'],
  ['wind.flutes.flute', 'flute'],
  ['strings.violin', 'violin'],
  ['strings.cello', 'cello'],
  ['pluck.guitar.nylon-string', 'guitar-classical'],
  ['pluck.guitar', 'guitar-steel'],
  ['pluck.ukulele', 'ukulele-soprano'],
];
const NAME_TO_INSTRUMENT: readonly (readonly [RegExp, string])[] = [
  [/piano|klavier|pianoforte/i, 'piano'],
  [/voice|vocal|voix|chant|soprano|alto\b|tenor\b|bass\b|baritone/i, 'voice'],
  [/flute|fl[uû]te/i, 'flute'],
  [/violoncel|cello/i, 'cello'],
  [/violin|violon/i, 'violin'],
  [/ukulele|ukul[eé]l[eé]/i, 'ukulele-soprano'],
  [/guitar|guitare|gitarre/i, 'guitar-classical'],
];

/** Chord symbols of one staff measure (see docs/musicxml.md, "Chord symbols"). */
function buildChords(
  raw: readonly RawChord[],
  staffNumber: number,
  staffCount: number,
  length: number,
  o: {
    gen: IdGen;
    ctx: Ctx;
    /** Number of strings of the part, undefined without a tuning. */
    strings: number | undefined;
    flag: (tick: number) => boolean | undefined;
  },
): ChordSymbol[] {
  // A harmony aimed at a staff that does not exist goes to the first one.
  const mine = raw.filter(
    (c) => c.staff === staffNumber || (c.staff > staffCount && staffNumber === 1),
  );
  const out: ChordSymbol[] = [];
  const used = new Set<number>();
  for (const c of [...mine].sort((a, b) => a.tick - b.tick)) {
    if (c.tick >= length) {
      o.ctx.dropped.add('harmony (outside measure)');
      continue;
    }
    if (used.has(c.tick) || out.length >= LIMITS.maxChordsPerMeasure) {
      o.ctx.dropped.add('harmony (same position)');
      continue;
    }
    used.add(c.tick);
    let frame = c.frame;
    if (frame) {
      const b = frame.barre;
      const fits =
        o.strings === frame.frets.length && (!b || (b.from <= b.to && b.to <= o.strings));
      if (!fits) {
        o.ctx.dropped.add('frame');
        frame = undefined;
      }
    }
    const flag = o.flag(c.tick);
    out.push({
      id: o.gen(),
      tick: c.tick,
      root: c.chord.root,
      quality: c.chord.quality,
      ...(c.chord.bass ? { bass: c.chord.bass } : {}),
      ...(flag !== undefined ? { diagram: flag } : {}),
      ...(frame ? { frame } : {}),
    });
  }
  return out;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * A diagram that equals the library shape is not custom: the frame is dropped. A chord that came
 * with a diagram the part's mode does not show gets its own flag, so the diagram stays visible.
 */
function settleDiagrams(part: Record<string, unknown>): void {
  const staves = part.staves as { measures: { chords?: Mutable<ChordSymbol>[] }[] }[];
  const framed = new Set<string>();
  const tuning = partTuning(part as unknown as Part);
  const capo = (part.capo as number | undefined) ?? 0;
  for (const staff of staves) {
    for (const sm of staff.measures) {
      for (const c of sm.chords ?? []) {
        if (!c.frame) continue;
        framed.add(c.id);
        if (tuning && sameFrame(c.frame, lookupShape(c, tuning, capo))) delete c.frame;
      }
    }
  }
  if (framed.size === 0) return;
  const plan = diagramPlan({ parts: [part] } as unknown as Score);
  for (const staff of staves) {
    for (const sm of staff.measures) {
      for (const c of sm.chords ?? []) {
        if (framed.has(c.id) && !plan.has(c.id) && c.diagram === undefined) c.diagram = true;
      }
    }
  }
}

function sameFrame(a: ChordFrame, b: ChordFrame | undefined): boolean {
  if (!b) return false;
  return (
    a.base === b.base &&
    a.frets.length === b.frets.length &&
    a.frets.every((f, i) => f === b.frets[i]) &&
    a.barre?.fret === b.barre?.fret &&
    a.barre?.from === b.barre?.from &&
    a.barre?.to === b.barre?.to
  );
}

function resolveInstrument(info: PartInfo | undefined): string {
  if (info?.instrument) return cleanText(info.instrument, LIMITS.maxInstrumentLength) || 'custom';
  if (info?.sound) {
    for (const [prefix, id] of SOUND_TO_INSTRUMENT) if (info.sound.startsWith(prefix)) return id;
  }
  if (info?.name) {
    for (const [re, id] of NAME_TO_INSTRUMENT) if (re.test(info.name)) return id;
  }
  return 'custom';
}

function parsePartList(root: Element, ctx: Ctx): Map<string, PartInfo> {
  const infos = new Map<string, PartInfo>();
  const list = child(root, 'part-list');
  if (!list) return infos;
  const fields = new Map<string, string>();
  const diagrams = new Map<string, string>();
  const capo = new Map<string, string>();
  const flags = new Map<string, string>();
  const misc = child(child(root, 'identification') ?? root, 'miscellaneous');
  if (misc) {
    for (const f of kids(misc)) {
      const name = f.getAttribute('name') ?? '';
      if (f.localName !== 'miscellaneous-field') continue;
      const value = f.textContent?.trim() ?? '';
      if (name.startsWith(INSTRUMENT_FIELD)) fields.set(name.slice(INSTRUMENT_FIELD.length), value);
      else if (name.startsWith(CHORD_DIAGRAMS_FIELD))
        diagrams.set(name.slice(CHORD_DIAGRAMS_FIELD.length), value);
      else if (name.startsWith(CHORD_CAPO_FIELD))
        capo.set(name.slice(CHORD_CAPO_FIELD.length), value);
      else if (name.startsWith(CHORD_FLAGS_FIELD))
        flags.set(name.slice(CHORD_FLAGS_FIELD.length), value);
    }
  }
  for (const c of kids(list)) {
    if (c.localName === 'score-part') {
      const id = c.getAttribute('id') ?? '';
      const info: PartInfo = {
        name: cleanText(childText(c, 'part-name'), LIMITS.maxNameLength),
      };
      const sound = childText(child(c, 'score-instrument') ?? c, 'instrument-sound');
      if (sound) info.sound = sound;
      const exact = fields.get(id);
      if (exact) info.instrument = exact;
      const mode = diagrams.get(id);
      if (mode === 'first' || mode === 'all') info.diagrams = mode;
      if (capo.get(id) === '1') info.capoShapes = true;
      const list = flags.get(id);
      if (list) {
        info.flags = new Map(
          list
            .split(';')
            .map((entry) => entry.split('='))
            .filter((kv): kv is [string, string] => kv.length === 2 && /^[01]$/.test(kv[1]!))
            .map(([key, v]) => [key, v === '1']),
        );
      }
      infos.set(id, info);
    } else if (c.localName === 'part-group') ctx.dropped.add('part-group');
  }
  return infos;
}

/** Imports MusicXML text (partwise) into a validated score and a report of what was dropped. */
export function parseMusicXml(text: string): ImportResult {
  const doc = parseXmlSafely(text);
  const root = doc.documentElement;
  if (root.localName === 'score-timewise') {
    throw new MusicXmlError('unsupported-format', 'Timewise MusicXML is not supported');
  }
  if (root.localName !== 'score-partwise') {
    throw new MusicXmlError('unsupported-format', 'Not a MusicXML score');
  }
  const ctx: Ctx = { dropped: new Counter(), adjusted: new Counter() };
  const infos = parsePartList(root, ctx);

  for (const c of kids(root)) {
    if (
      ![
        'work',
        'movement-number',
        'movement-title',
        'identification',
        'defaults',
        'part-list',
        'part',
      ].includes(c.localName)
    ) {
      ctx.dropped.add(c.localName);
    }
  }

  const rawParts: RawPart[] = [];
  for (const el of kids(root).filter((c) => c.localName === 'part')) {
    if (rawParts.length >= LIMITS.maxParts) {
      ctx.dropped.add('part');
      continue;
    }
    rawParts.push(parsePart(el, el.getAttribute('id') ?? '', rawParts.length === 0, ctx));
  }
  if (rawParts.length === 0) throw new MusicXmlError('empty', 'The file contains no part');
  const count = Math.max(...rawParts.map((p) => p.measures.length));
  if (count === 0) throw new MusicXmlError('empty', 'The file contains no measure');
  if (count > LIMITS.maxMeasures) {
    throw new MusicXmlError('too-many-measures', 'Too many measures');
  }

  const gen = idGen(newId('i'));
  const bctx: BuildCtx = { ...ctx, gen, positions: new Map() };

  // Measures: shared attributes and lengths.
  const pick = <K extends 'time' | 'key' | 'tempo'>(m: number, k: K): RawMeasure[K] => {
    const fromFirst = rawParts[0]!.measures[m]?.[k];
    if (fromFirst !== undefined) return fromFirst;
    if (k === 'tempo' || m === 0) {
      for (const p of rawParts) {
        const v = p.measures[m]?.[k];
        if (v !== undefined) return v;
      }
    }
    return undefined as RawMeasure[K];
  };
  const measures: {
    id: string;
    time?: TimeSignature;
    keyFifths?: number;
    tempoBpm?: number;
    length?: number;
  }[] = [];
  const lengths: number[] = [];
  const starts: number[] = [];
  let time: TimeSignature = { beats: 4, beatType: 4 };
  let tempo = 100;
  let acc = 0;
  for (let m = 0; m < count; m++) {
    const info: (typeof measures)[number] = { id: gen() };
    const t = pick(m, 'time');
    const k = pick(m, 'key');
    const bpm = pick(m, 'tempo');
    if (t) {
      time = t;
      info.time = t;
    } else if (m === 0) info.time = time;
    if (k !== undefined) info.keyFifths = k;
    else if (m === 0) info.keyFifths = 0;
    if (m === 0) tempo = bpm ?? 100;
    else if (bpm !== undefined && bpm !== tempo) {
      info.tempoBpm = bpm;
      tempo = bpm;
    }
    const nominal = timeSignatureTicks(time);
    const content = Math.max(...rawParts.map((p) => p.measures[m]?.contentTicks ?? 0));
    let length = nominal;
    if (content > 0 && content < nominal - 0.5) {
      length = Math.min(nominal, Math.max(120, Math.round(content / 120) * 120));
      if (length < nominal) info.length = length;
    }
    measures.push(info);
    lengths.push(length);
    starts.push(acc);
    acc += length;
  }

  // Parts.
  const slurs: SlurState = { open: new Map(), done: [] };
  const parts = rawParts.map((raw, pi) => {
    const info = infos.get(raw.id);
    const instrument = resolveInstrument(info);
    const def = getInstrument(instrument);
    const name = info?.name || def?.names.en || cleanText(`Part ${pi + 1}`, LIMITS.maxNameLength);
    const staves = Array.from({ length: raw.staffCount }, (_, i) => {
      const number = i + 1;
      const staffId = gen();
      const tab = raw.tabStaves.has(number);
      const sorted = Array.from(raw.voiceKeys.get(number) ?? []).sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a < b ? -1 : 1;
      });
      const keptKeys = sorted.slice(0, LIMITS.maxVoicesPerMeasure);
      const defaultClef: Clef = def?.clefs[0] ?? 'treble';
      let current: Clef = tab ? defaultClef : 'treble';
      let initial: Clef = current;
      const staffMeasures = [];
      for (let m = 0; m < count; m++) {
        const rm = raw.measures[m];
        const perStaff = rm?.staffItems.get(number);
        const voices: MVoice[] = [];
        let maxRank = -1;
        if (perStaff) {
          sorted.forEach((key, rank) => {
            if (!perStaff.has(key)) return;
            if (rank >= LIMITS.maxVoicesPerMeasure) ctx.dropped.add('voice');
            else maxRank = Math.max(maxRank, rank);
          });
        }
        for (let r = 0; r <= maxRank; r++) {
          const list = perStaff?.get(keptKeys[r]!);
          voices.push(
            list
              ? buildVoice(list, lengths[m]!, starts[m]!, staffId, bctx, slurs)
              : restVoice(lengths[m]!, bctx),
          );
        }
        if (voices.length === 0) voices.push(restVoice(lengths[m]!, bctx));
        let clef: Clef | undefined;
        const wanted = rm?.clefs.get(number);
        if (!tab && wanted && wanted !== 'tab') {
          if (m === 0) {
            initial = wanted;
            current = wanted;
          } else if (wanted !== current) {
            clef = wanted;
            current = wanted;
          }
        }
        const chords = buildChords(rm?.chords ?? [], number, raw.staffCount, lengths[m]!, {
          gen,
          ctx,
          strings: raw.tuning?.length ?? def?.strings?.length,
          flag: (tick) => info?.flags?.get(`${m}.${i}.${tick}`),
        });
        staffMeasures.push({
          ...(clef ? { clef } : {}),
          voices,
          ...(chords.length > 0 ? { chords } : {}),
        });
      }
      return {
        id: staffId,
        clef: initial,
        type: tab ? 'tab' : 'standard',
        measures: staffMeasures,
      };
    });
    const part: Record<string, unknown> = {
      id: gen(),
      name,
      instrument,
      transposition: raw.transposition ?? 0,
      staves,
    };
    if (raw.tuning) {
      const same =
        def?.strings &&
        def.strings.length === raw.tuning.length &&
        def.strings.every((s, i) => pitchEquals(s, raw.tuning![i]!));
      if (!same) part.tuning = raw.tuning;
    }
    if (raw.capo > 0) part.capo = raw.capo;
    if (info?.diagrams) part.chordDiagrams = info.diagrams;
    if (info?.capoShapes) part.chordCapoShapes = true;
    settleDiagrams(part);
    return part;
  });
  if (slurs.open.size > 0) ctx.dropped.add('slur', slurs.open.size);

  // Ties must reach the same pitch in the next event of the same voice.
  for (const part of parts) {
    for (const staff of part.staves as { measures: { voices: MVoice[] }[] }[]) {
      staff.measures.forEach((sm, m) =>
        sm.voices.forEach((voice, vi) =>
          voice.events.forEach((e, i) => {
            if (e.kind !== 'note') return;
            const next = voice.events[i + 1] ?? staff.measures[m + 1]?.voices[vi]?.events[0];
            for (const p of e.pitches) {
              if (!p.tieToNext) continue;
              if (!(next?.kind === 'note' && next.pitches.some((q) => pitchEquals(p, q)))) {
                delete p.tieToNext;
                ctx.dropped.add('tie');
              }
            }
          }),
        ),
      );
    }
  }

  const eventIds = new Set<string>();
  if (slurs.done.length > 0) {
    for (const part of parts) {
      for (const staff of part.staves as { measures: { voices: MVoice[] }[] }[]) {
        for (const sm of staff.measures) {
          for (const v of sm.voices) for (const e of v.events) eventIds.add(e.id);
        }
      }
    }
  }
  const slurList = slurs.done
    .filter((s) => eventIds.has(s.start) && eventIds.has(s.end))
    .slice(0, LIMITS.maxSlurs)
    .map((s) => ({ id: gen(), startEventId: s.start, endEventId: s.end }));
  if (slurList.length < slurs.done.length)
    ctx.dropped.add('slur', slurs.done.length - slurList.length);

  const score = {
    schemaVersion: 1,
    meta: {
      title: cleanText(
        childText(child(root, 'work') ?? root, 'work-title') ?? childText(root, 'movement-title'),
        LIMITS.maxTitleLength,
      ),
      composer: cleanText(
        kids(child(root, 'identification') ?? root).find(
          (c) => c.localName === 'creator' && c.getAttribute('type') === 'composer',
        )?.textContent,
        LIMITS.maxTitleLength,
      ),
      tempoBpm: pick(0, 'tempo') ?? 100,
    },
    measures,
    parts,
    slurs: slurList,
  } as unknown as Score;

  const final = finish(score, ctx);
  return {
    score: final,
    report: { dropped: { ...ctx.dropped.counts }, adjusted: { ...ctx.adjusted.counts } },
  };
}

/** Removes frettings that disagree with the tuning, then validates and decodes the score. */
function finish(score: Score, ctx: Ctx): Score {
  let issues = validateScore(score);
  const bad = issues.filter((i) => i.code.startsWith('fretting-'));
  if (bad.length > 0) {
    for (const issue of bad) {
      const segments = issue.path.split('/').slice(1);
      const at = segments.indexOf('fretting');
      let node: unknown = score;
      for (const seg of segments.slice(0, at)) {
        node = (node as Record<string, unknown>)[seg];
      }
      if (node && typeof node === 'object' && 'fretting' in node) {
        delete (node as { fretting?: unknown }).fretting;
        ctx.dropped.add('fretting');
      }
    }
    issues = validateScore(score);
  }
  if (issues.length > 0) {
    throw new MusicXmlError('invalid-score', `${issues[0]!.code}: ${issues[0]!.message}`);
  }
  try {
    return fromJson(score);
  } catch (error) {
    if (error instanceof ScoreFormatError) {
      throw new MusicXmlError('invalid-score', error.message);
    }
    throw error;
  }
}

/** Imports a file: plain MusicXML (`.musicxml`, `.xml`) or compressed (`.mxl`). */
export function importMusicXml(data: Uint8Array): ImportResult {
  if (data.length > MUSICXML_LIMITS.maxInputBytes) {
    throw new MusicXmlError('too-large', 'The file is too large');
  }
  const bytes = looksLikeZip(data) ? unpackMxl(data) : data;
  return parseMusicXml(decodeXml(bytes));
}
