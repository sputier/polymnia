/**
 * MusicXML `<harmony>`: chord symbols (root, kind, bass, degrees) and `<frame>` (fretboard diagrams).
 *
 * Export writes the structured form other programs understand (`kind` and `degree`), plus the
 * normalized text in `kind@text`. Import reads the structure first and only falls back to the text
 * for `kind="other"`. See docs/musicxml.md ("Chord symbols").
 */
import { normalizeQuality, parseQuality, type ChordData, type Quality } from '../score/chords';
import type {
  Alter,
  ChordBarre,
  ChordFrame,
  ChordNote,
  ChordSymbol,
  StepName,
} from '../score/types';
import { MUSICXML_DIVISIONS } from './limits';
import { escapeXml as esc } from './xml';

// ---------------------------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------------------------

/** `kind` content -> quality suffix (what the kind alone means). */
const KIND_SUFFIX: Readonly<Record<string, string>> = {
  major: '',
  minor: 'm',
  augmented: 'aug',
  diminished: 'dim',
  dominant: '7',
  'major-seventh': 'maj7',
  'minor-seventh': 'm7',
  'diminished-seventh': 'dim7',
  'augmented-seventh': 'aug7',
  'half-diminished': 'm7b5',
  'major-minor': 'm(maj7)',
  'major-sixth': '6',
  'minor-sixth': 'm6',
  'dominant-ninth': '9',
  'major-ninth': 'maj9',
  'minor-ninth': 'm9',
  'dominant-11th': '11',
  'major-11th': 'maj11',
  'minor-11th': 'm11',
  'dominant-13th': '13',
  'major-13th': 'maj13',
  'minor-13th': 'm13',
  'suspended-second': 'sus2',
  'suspended-fourth': 'sus4',
  power: '5',
};

interface KindOf {
  readonly kind: string;
  readonly alt: readonly string[];
  readonly add: readonly number[];
}

/** The `kind` of a quality and the degrees that complete it; `other` when no kind fits. */
export function kindOf(q: Quality): KindOf {
  const alt = [...q.alt];
  const add = [...q.add];
  const other = (): KindOf => ({ kind: 'other', alt: [], add: [] });
  let kind: string | undefined;
  const plain = !q.dim && !q.aug;
  if (q.power) kind = 'power';
  else if (q.sus) {
    if (!q.seventh && !q.ext && !q.sixth && !q.minor && plain)
      kind = q.sus === 2 ? 'suspended-second' : 'suspended-fourth';
  } else if (q.sixth) {
    if (plain) {
      kind = q.minor ? 'minor-sixth' : 'major-sixth';
      if (q.sixth === 69) add.unshift(9);
    }
  } else if (!q.seventh && !q.ext) {
    kind = q.dim ? 'diminished' : q.aug ? 'augmented' : q.minor ? 'minor' : 'major';
  } else if (q.seventh === 7 && !q.ext) {
    if (q.dim) kind = 'diminished-seventh';
    else if (q.aug) kind = 'augmented-seventh';
    else if (q.minor && alt.includes('b5')) {
      kind = 'half-diminished';
      alt.splice(alt.indexOf('b5'), 1);
    } else kind = q.minor ? 'minor-seventh' : 'dominant';
  } else if (q.seventh === 11 && !q.ext) {
    if (plain) kind = q.minor ? 'major-minor' : 'major-seventh';
  } else if (q.ext && plain) {
    const n = q.ext === 9 ? 'ninth' : `${q.ext}th`;
    if (q.seventh === 11) kind = q.minor ? undefined : `major-${n}`;
    else kind = q.minor ? `minor-${n}` : `dominant-${n}`;
  }
  return kind ? { kind, alt, add } : other();
}

const ALT_DEGREE: Record<string, [number, number]> = {
  b5: [5, -1],
  '#5': [5, 1],
  b9: [9, -1],
  '#9': [9, 1],
  '#11': [11, 1],
  b13: [13, -1],
};

function degreeXml(value: number, alter: number, type: 'add' | 'alter'): string {
  return (
    `<degree><degree-value>${value}</degree-value><degree-alter>${alter}</degree-alter>` +
    `<degree-type>${type}</degree-type></degree>`
  );
}

function noteXml(n: ChordNote, tag: 'root' | 'bass'): string {
  return (
    `<${tag}><${tag}-step>${n.step}</${tag}-step>` +
    (n.alter ? `<${tag}-alter>${n.alter}</${tag}-alter>` : '') +
    `</${tag}>`
  );
}

function frameXml(frame: ChordFrame): string {
  const n = frame.frets.length;
  let xml = `<frame><frame-strings>${n}</frame-strings><frame-frets>4</frame-frets>`;
  if (frame.base > 1) xml += `<first-fret>${frame.base}</first-fret>`;
  // Lowest string first, as other programs write them (string 1 is the highest).
  for (let s = n; s >= 1; s--) {
    const fret = frame.frets[s - 1]!;
    if (fret < 0) continue;
    let barre = '';
    if (frame.barre && frame.barre.fret === fret) {
      if (s === frame.barre.to) barre = '<barre type="start"/>';
      else if (s === frame.barre.from) barre = '<barre type="stop"/>';
    }
    xml += `<frame-note><string>${s}</string><fret>${fret}</fret>${barre}</frame-note>`;
  }
  return xml + '</frame>';
}

/** One `<harmony>` element. `frame` is the diagram to write (custom or from the library). */
export function harmonyXml(
  c: ChordSymbol,
  opts: { staffNumber: number; multi: boolean; frame?: ChordFrame | undefined },
): string {
  const q = parseQuality(c.quality);
  const info = q ? kindOf(q) : { kind: 'other', alt: [], add: [] };
  let xml = `<harmony>${noteXml(c.root, 'root')}`;
  xml += `<kind text="${esc(c.quality)}">${info.kind}</kind>`;
  if (c.bass) xml += noteXml(c.bass, 'bass');
  for (const a of info.alt) {
    const [value, alter] = ALT_DEGREE[a]!;
    xml += degreeXml(value, alter, 'alter');
  }
  for (const a of info.add) xml += degreeXml(a, 0, 'add');
  if (opts.frame) xml += frameXml(opts.frame);
  if (c.tick > 0) {
    xml += `<offset>${Math.round((c.tick * MUSICXML_DIVISIONS) / 960)}</offset>`;
  }
  if (opts.multi) xml += `<staff>${opts.staffNumber}</staff>`;
  return xml + '</harmony>';
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

export interface ParsedHarmony {
  readonly chord: ChordData;
  readonly frame?: ChordFrame | undefined;
  /** Staff number (1-based), 1 when absent. */
  readonly staff: number;
  /** `<offset>` in divisions (0 when absent). */
  readonly offset: number;
  /** Things read but not kept (names for the import report). */
  readonly dropped: readonly string[];
}

const STEPS = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

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
const text = (el: Element | undefined): string | undefined => el?.textContent?.trim();

function readNote(el: Element | undefined, tag: 'root' | 'bass'): ChordNote | undefined {
  if (!el) return undefined;
  const step = text(child(el, `${tag}-step`));
  if (!step || !STEPS.has(step)) return undefined;
  const raw = Number(text(child(el, `${tag}-alter`)) ?? 0);
  const alter = Number.isFinite(raw) ? Math.max(-2, Math.min(2, Math.round(raw))) : 0;
  return { step: step as StepName, alter: alter as Alter };
}

function readFrame(el: Element): ChordFrame | undefined {
  const strings = Number(text(child(el, 'frame-strings')));
  if (!Number.isInteger(strings) || strings < 1 || strings > 12) return undefined;
  const firstFret = Number(text(child(el, 'first-fret')) ?? 1);
  const base = Number.isInteger(firstFret) && firstFret >= 1 && firstFret <= 36 ? firstFret : 1;
  const frets: number[] = new Array<number>(strings).fill(-1);
  let barreFret: number | undefined;
  const barreStrings: number[] = [];
  for (const note of kids(el)) {
    if (note.localName !== 'frame-note') continue;
    const s = Number(text(child(note, 'string')));
    const f = Number(text(child(note, 'fret')));
    if (!Number.isInteger(s) || s < 1 || s > strings || !Number.isInteger(f) || f < 0 || f > 36)
      continue;
    frets[s - 1] = f;
    if (child(note, 'barre')) {
      barreFret = f;
      barreStrings.push(s);
    }
  }
  let barre: ChordBarre | undefined;
  if (barreFret !== undefined && barreFret > 0 && barreStrings.length >= 2) {
    barre = { fret: barreFret, from: Math.min(...barreStrings), to: Math.max(...barreStrings) };
  }
  return { frets, base, ...(barre ? { barre } : {}) };
}

/** Reads one `<harmony>`: a chord, or a list of what could not be kept. */
export function parseHarmony(el: Element): ParsedHarmony | { readonly dropped: readonly string[] } {
  const rootEl = child(el, 'root');
  if (!rootEl) return { dropped: ['harmony (numeral or function)'] };
  const root = readNote(rootEl, 'root');
  if (!root) return { dropped: ['harmony (root)'] };
  const dropped: string[] = [];
  const kindEl = child(el, 'kind');
  const kind = text(kindEl) ?? '';
  let suffix: string | undefined;
  if (kind === 'none') return { dropped: ['harmony (no chord)'] };
  if (kind === 'other') suffix = kindEl?.getAttribute('text') ?? undefined;
  else suffix = KIND_SUFFIX[kind];
  if (suffix === undefined) return { dropped: [`harmony (kind ${kind || 'missing'})`] };

  // Degrees complete the kind: alterations and additions.
  let extra = '';
  for (const d of kids(el)) {
    if (d.localName !== 'degree') continue;
    const value = Number(text(child(d, 'degree-value')));
    const alter = Number(text(child(d, 'degree-alter')) ?? 0);
    const type = text(child(d, 'degree-type'));
    if (type === 'subtract' || !Number.isInteger(value)) {
      dropped.push('harmony degree');
      continue;
    }
    if (alter === 0 && type === 'add') {
      extra += value === 6 ? '6' : value === 7 ? '7' : `add${value}`;
    } else if (alter === 0) {
      dropped.push('harmony degree');
    } else {
      extra += `${alter < 0 ? 'b' : '#'}${value}`;
    }
  }
  // "6" then "add9" (six-nine) and a seventh added to a triad read as one quality.
  const quality = normalizeQuality(suffix + extra) ?? normalizeQuality(suffix);
  if (quality === null) return { dropped: ['harmony (quality)'] };
  if (normalizeQuality(suffix + extra) === null) dropped.push('harmony degree');

  const bass = readNote(child(el, 'bass'), 'bass');
  const chord: ChordData = { root, quality, ...(bass ? { bass } : {}) };
  const frameEl = child(el, 'frame');
  const frame = frameEl ? readFrame(frameEl) : undefined;
  const offset = Number(text(child(el, 'offset')) ?? 0);
  const staff = Number(text(child(el, 'staff')) ?? 1);
  return {
    chord,
    ...(frame ? { frame } : {}),
    staff: Number.isInteger(staff) && staff >= 1 ? staff : 1,
    offset: Number.isFinite(offset) ? offset : 0,
    dropped,
  };
}
