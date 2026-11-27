import {
  getInstrument,
  partTuning,
  pitchEquals,
  timeSignatureTicks,
  voiceEventTicks,
  type Clef,
  type NotePitch,
  type Part,
  type Pitch,
  type Score,
  type ScoreEvent,
  type Staff,
  type Tuplet,
  type Voice,
} from '../score';
import { MUSICXML_DIVISIONS } from './limits';
import { escapeXml as esc } from './xml';

const HEADER =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" ' +
  '"http://www.musicxml.org/dtds/partwise.dtd">\n';

/** `<instrument-sound>` ids of the MusicXML sound library for the catalog instruments. */
export const INSTRUMENT_SOUND: Readonly<Record<string, string>> = {
  piano: 'keyboard.piano',
  voice: 'voice.vocals',
  flute: 'wind.flutes.flute',
  violin: 'strings.violin',
  cello: 'strings.cello',
  'guitar-classical': 'pluck.guitar.nylon-string',
  'guitar-steel': 'pluck.guitar.steel-string',
  'ukulele-soprano': 'pluck.ukulele',
  'ukulele-concert': 'pluck.ukulele',
  'ukulele-tenor': 'pluck.ukulele',
  'ukulele-tenor-low-g': 'pluck.ukulele',
  'ukulele-baritone': 'pluck.ukulele',
};

/** Name of the `<miscellaneous-field>` that keeps the exact catalog id of a part. */
export const INSTRUMENT_FIELD = 'polymnia-instrument-';

const CLEF_XML: Record<Clef, string> = {
  treble: '<sign>G</sign><line>2</line>',
  bass: '<sign>F</sign><line>4</line>',
  alto: '<sign>C</sign><line>3</line>',
  tenor: '<sign>C</sign><line>4</line>',
  'treble-8vb': '<sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change>',
  percussion: '<sign>percussion</sign>',
};

function pitchXml(p: Pitch, tag: 'pitch' | 'tuning'): string {
  const [step, alter, octave] =
    tag === 'pitch'
      ? ['step', 'alter', 'octave']
      : ['tuning-step', 'tuning-alter', 'tuning-octave'];
  return (
    `<${step}>${p.step}</${step}>` +
    (p.alter ? `<${alter}>${p.alter}</${alter}>` : '') +
    `<${octave}>${p.octave}</${octave}>`
  );
}

function transposeXml(semitones: number): string {
  const octaves = Math.trunc(semitones / 12);
  const chromatic = semitones - octaves * 12;
  return (
    '<transpose>' +
    `<chromatic>${chromatic}</chromatic>` +
    (octaves ? `<octave-change>${octaves}</octave-change>` : '') +
    '</transpose>'
  );
}

interface SlurMarks {
  start: number[];
  stop: number[];
}

/**
 * MusicXML numbers overlapping slurs 1 to 16 within a part. Each slur gets the lowest number not
 * used by a slur still open at its start.
 */
function assignSlurNumbers(score: Score): Map<string, SlurMarks> {
  const marks = new Map<string, SlurMarks>();
  if (score.slurs.length === 0) return marks;
  const wanted = new Set<string>();
  for (const s of score.slurs) {
    wanted.add(s.startEventId);
    wanted.add(s.endEventId);
  }
  const pos = new Map<string, { part: number; at: number }>();
  const lengths: number[] = [];
  let time = score.measures[0]?.time ?? { beats: 4, beatType: 4 };
  let start = 0;
  const starts: number[] = [];
  score.measures.forEach((m) => {
    if (m.time) time = m.time;
    const length = m.length ?? timeSignatureTicks(time);
    lengths.push(length);
    starts.push(start);
    start += length;
  });
  score.parts.forEach((part, pi) =>
    part.staves.forEach((staff) =>
      staff.measures.forEach((sm, m) =>
        sm.voices.forEach((voice) => {
          let offset = 0;
          const ticks = voiceEventTicks(voice);
          voice.events.forEach((e, i) => {
            if (wanted.has(e.id)) pos.set(e.id, { part: pi, at: (starts[m] ?? 0) + offset });
            offset += ticks[i] ?? 0;
          });
        }),
      ),
    ),
  );
  const ordered = score.slurs
    .map((s) => ({ s, a: pos.get(s.startEventId), b: pos.get(s.endEventId) }))
    .filter(
      (
        x,
      ): x is {
        s: (typeof score.slurs)[number];
        a: NonNullable<typeof x.a>;
        b: NonNullable<typeof x.b>;
      } => !!x.a && !!x.b,
    )
    .sort((x, y) => x.a.part - y.a.part || x.a.at - y.a.at);
  const active = new Map<number, { end: number; num: number }[]>();
  for (const { s, a, b } of ordered) {
    const list = (active.get(a.part) ?? []).filter((o) => o.end >= a.at);
    const used = new Set(list.map((o) => o.num));
    let num = 1;
    while (used.has(num) && num <= 16) num++;
    if (num > 16) continue;
    list.push({ end: b.at, num });
    active.set(a.part, list);
    const get = (id: string): SlurMarks => {
      let v = marks.get(id);
      if (!v) marks.set(id, (v = { start: [], stop: [] }));
      return v;
    };
    get(s.startEventId).start.push(num);
    get(s.endEventId).stop.push(num);
  }
  return marks;
}

interface Ctx {
  slurs: Map<string, SlurMarks>;
  staves: number;
}

function noteXml(
  e: ScoreEvent,
  ticks: number,
  voiceNumber: number,
  staffNumber: number,
  tuplet: { t: Tuplet; first: boolean; last: boolean } | undefined,
  prev: ScoreEvent | undefined,
  ctx: Ctx,
): string {
  const common = `<duration>${ticks}</duration>`; // placed after pitch/rest, see below
  const tail =
    `<voice>${voiceNumber}</voice><type>${e.duration.base}</type>` +
    '<dot/>'.repeat(e.duration.dots) +
    (tuplet
      ? `<time-modification><actual-notes>${tuplet.t.actual}</actual-notes><normal-notes>${tuplet.t.normal}</normal-notes></time-modification>`
      : '') +
    (ctx.staves > 1 ? `<staff>${staffNumber}</staff>` : '');

  const eventNotations = (): string => {
    let s = '';
    const marks = ctx.slurs.get(e.id);
    if (marks) {
      for (const n of marks.stop) s += `<slur type="stop" number="${n}"/>`;
      for (const n of marks.start) s += `<slur type="start" number="${n}"/>`;
    }
    if (tuplet?.first) s += '<tuplet type="start" bracket="yes"/>';
    if (tuplet?.last) s += '<tuplet type="stop"/>';
    return s;
  };

  if (e.kind === 'rest') {
    const notations = eventNotations();
    return (
      `<note><rest/>${common}${tail}` +
      (notations ? `<notations>${notations}</notations>` : '') +
      '</note>'
    );
  }
  let xml = '';
  e.pitches.forEach((p: NotePitch, i) => {
    const tiedFrom =
      prev?.kind === 'note' && prev.pitches.some((q) => q.tieToNext && pitchEquals(q, p));
    let notations = i === 0 ? eventNotations() : '';
    if (tiedFrom) notations += '<tied type="stop"/>';
    if (p.tieToNext) notations += '<tied type="start"/>';
    if (p.fretting) {
      notations += `<technical><string>${p.fretting.string}</string><fret>${p.fretting.fret}</fret></technical>`;
    }
    xml +=
      '<note>' +
      (i > 0 ? '<chord/>' : '') +
      `<pitch>${pitchXml(p, 'pitch')}</pitch>` +
      common +
      (tiedFrom ? '<tie type="stop"/>' : '') +
      (p.tieToNext ? '<tie type="start"/>' : '') +
      tail +
      (notations ? `<notations>${notations}</notations>` : '') +
      '</note>';
  });
  return xml;
}

function voiceXml(
  voice: Voice,
  voiceNumber: number,
  staffNumber: number,
  prev: ScoreEvent | undefined,
  ctx: Ctx,
): string {
  const ticks = voiceEventTicks(voice);
  const byEvent = new Map<string, { t: Tuplet; first: boolean; last: boolean }>();
  for (const t of voice.tuplets) {
    t.eventIds.forEach((id, i) =>
      byEvent.set(id, { t, first: i === 0, last: i === t.eventIds.length - 1 }),
    );
  }
  let xml = '';
  let before = prev;
  voice.events.forEach((e, i) => {
    xml += noteXml(e, ticks[i] ?? 0, voiceNumber, staffNumber, byEvent.get(e.id), before, ctx);
    before = e;
  });
  return xml;
}

function staffDetailsXml(part: Part, staff: Staff, number: number, multi: boolean): string {
  const tuning = partTuning(part);
  const tab = staff.type === 'tab';
  if (!tab && !tuning) return '';
  let xml = multi ? `<staff-details number="${number}">` : '<staff-details>';
  if (tab) xml += `<staff-lines>${tuning?.length ?? 6}</staff-lines>`;
  if (tuning) {
    // MusicXML counts tuning lines from the lowest string; the model lists strings high to low.
    tuning.forEach((p, j) => {
      xml += `<staff-tuning line="${tuning.length - j}">${pitchXml(p, 'tuning')}</staff-tuning>`;
    });
  }
  if (part.capo) xml += `<capo>${part.capo}</capo>`;
  return xml + '</staff-details>';
}

function scorePartXml(part: Part, index: number): string {
  const id = `P${index + 1}`;
  const inst = getInstrument(part.instrument);
  let xml = `<score-part id="${id}"><part-name>${esc(part.name)}</part-name>`;
  if (inst) {
    xml += `<score-instrument id="${id}-I1"><instrument-name>${esc(inst.names.en)}</instrument-name>`;
    const sound = INSTRUMENT_SOUND[inst.id];
    if (sound) xml += `<instrument-sound>${sound}</instrument-sound>`;
    xml += `</score-instrument><midi-instrument id="${id}-I1"><midi-program>${inst.gmProgram + 1}</midi-program></midi-instrument>`;
  }
  return xml + '</score-part>';
}

/** Exports the score as an uncompressed MusicXML 4.0 partwise document. */
export function scoreToMusicXml(score: Score): string {
  const out: string[] = [HEADER, '<score-partwise version="4.0">'];
  if (score.meta.title) out.push(`<work><work-title>${esc(score.meta.title)}</work-title></work>`);
  out.push('<identification>');
  if (score.meta.composer) {
    out.push(`<creator type="composer">${esc(score.meta.composer)}</creator>`);
  }
  out.push('<encoding><software>Polymnia</software></encoding><miscellaneous>');
  score.parts.forEach((part, i) => {
    out.push(
      `<miscellaneous-field name="${INSTRUMENT_FIELD}P${i + 1}">${esc(part.instrument)}</miscellaneous-field>`,
    );
  });
  out.push('</miscellaneous></identification><part-list>');
  score.parts.forEach((part, i) => out.push(scorePartXml(part, i)));
  out.push('</part-list>');

  const slurs = assignSlurNumbers(score);
  const lengths: number[] = [];
  let time = score.measures[0]?.time ?? { beats: 4, beatType: 4 };
  for (const m of score.measures) {
    if (m.time) time = m.time;
    lengths.push(m.length ?? timeSignatureTicks(time));
  }

  score.parts.forEach((part, pi) => {
    out.push(`<part id="P${pi + 1}">`);
    const multi = part.staves.length > 1;
    const ctx: Ctx = { slurs, staves: part.staves.length };
    const prev = new Map<string, ScoreEvent | undefined>();
    score.measures.forEach((info, m) => {
      out.push(
        `<measure number="${m + 1}"${m === 0 && info.length !== undefined ? ' implicit="yes"' : ''}>`,
      );

      let attrs = '';
      if (m === 0) attrs += `<divisions>${MUSICXML_DIVISIONS}</divisions>`;
      if (info.keyFifths !== undefined) attrs += `<key><fifths>${info.keyFifths}</fifths></key>`;
      if (info.time) {
        attrs += `<time><beats>${info.time.beats}</beats><beat-type>${info.time.beatType}</beat-type></time>`;
      }
      if (m === 0 && multi) attrs += `<staves>${part.staves.length}</staves>`;
      part.staves.forEach((staff, si) => {
        const clef = m === 0 ? staff.clef : staff.measures[m]?.clef;
        const num = multi ? ` number="${si + 1}"` : '';
        if (m === 0 && staff.type === 'tab') {
          attrs += `<clef${num}><sign>TAB</sign><line>5</line></clef>`;
        } else if (clef && staff.type !== 'tab') {
          attrs += `<clef${num}>${CLEF_XML[clef]}</clef>`;
        }
      });
      if (m === 0) {
        part.staves.forEach((staff, si) => {
          attrs += staffDetailsXml(part, staff, si + 1, multi);
        });
        if (part.transposition) attrs += transposeXml(part.transposition);
      }
      if (attrs) out.push(`<attributes>${attrs}</attributes>`);

      if (pi === 0) {
        const bpm = m === 0 ? (info.tempoBpm ?? score.meta.tempoBpm) : info.tempoBpm;
        if (bpm !== undefined) {
          out.push(
            '<direction placement="above"><direction-type><metronome>' +
              `<beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type>` +
              `<sound tempo="${bpm}"/></direction>`,
          );
        }
      }

      const voices: { si: number; vi: number; voice: Voice }[] = [];
      part.staves.forEach((staff, si) =>
        staff.measures[m]?.voices.forEach((voice, vi) => voices.push({ si, vi, voice })),
      );
      voices.forEach(({ si, vi, voice }, k) => {
        const key = `${si}:${vi}`;
        out.push(voiceXml(voice, si * 4 + vi + 1, si + 1, prev.get(key), ctx));
        prev.set(key, voice.events[voice.events.length - 1]);
        if (k < voices.length - 1) out.push(`<backup><duration>${lengths[m]}</duration></backup>`);
      });
      out.push('</measure>');
    });
    out.push('</part>');
  });
  out.push('</score-partwise>\n');
  return out.join('');
}
