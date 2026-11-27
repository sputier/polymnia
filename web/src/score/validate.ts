import { fretToMidi, getInstrument, partFrets, partTuning } from './instruments';
import { isPartInRange } from './tuning';
import { parseQuality } from './chords';
import { LIMITS } from './limits';
import { pitchEquals, pitchToMidi, soundingMidi } from './pitch';
import { canTie } from './query';
import { durationTicks, MIN_TICKS, timeSignatureTicks } from './ticks';
import type { Issue, Part, Score, StaffMeasure, TimeSignature, Voice } from './types';

/**
 * Semantic validation of a structurally well-typed score (the decoder checks shapes and ranges).
 * Returns every problem found; an empty array means the score is valid.
 */
export function validateScore(score: Score): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });

  const ids = new Set<string>();
  const claim = (id: string, path: string) => {
    if (ids.has(id)) add('duplicate-id', path, `Id "${id}" is used more than once`);
    ids.add(id);
  };

  // Measures: resolved lengths and start ticks.
  const lengths: number[] = [];
  const starts: number[] = [];
  let time: TimeSignature | undefined;
  let acc = 0;
  score.measures.forEach((m, i) => {
    const path = `/measures/${i}`;
    claim(m.id, `${path}/id`);
    if (m.time) time = m.time;
    if (i === 0 && (!m.time || m.keyFifths === undefined)) {
      add('first-measure-attributes', path, 'The first measure must define time and keyFifths');
    }
    const nominal = time ? timeSignatureTicks(time) : 0;
    if (m.length !== undefined) {
      if (
        !Number.isInteger(m.length) ||
        m.length <= 0 ||
        m.length % MIN_TICKS !== 0 ||
        m.length > nominal
      ) {
        add(
          'bad-measure-length',
          `${path}/length`,
          `Length ${m.length} must be a positive multiple of ${MIN_TICKS} and at most ${nominal}`,
        );
      }
    }
    const len = m.length ?? nominal;
    lengths.push(len);
    starts.push(acc);
    acc += len;
  });

  const slurIds = new Set<string>();
  for (const s of score.slurs) {
    slurIds.add(s.startEventId);
    slurIds.add(s.endEventId);
  }
  const eventPos = new Map<string, { staff: string; tick: number }>();

  score.parts.forEach((part, pi) => {
    claim(part.id, `/parts/${pi}/id`);
    part.staves.forEach((staff, si) => {
      const spath = `/parts/${pi}/staves/${si}`;
      claim(staff.id, `${spath}/id`);
      if (staff.measures.length !== score.measures.length) {
        add(
          'measure-count',
          `${spath}/measures`,
          `Staff has ${staff.measures.length} measures, score has ${score.measures.length}`,
        );
      }
      staff.measures.forEach((sm, m) => {
        const mpath = `${spath}/measures/${m}`;
        if (sm.voices.length === 0)
          add('voice-missing', `${mpath}/voices`, 'A measure needs at least one voice');
        checkChords(sm, mpath, lengths[m] ?? 0, part);
        sm.voices.forEach((voice, vi) => {
          const vpath = `${mpath}/voices/${vi}`;
          claim(voice.id, `${vpath}/id`);
          const next = staff.measures[m + 1]?.voices[vi]?.events[0];
          checkVoice(voice, vpath, lengths[m] ?? 0, next, part, (id, offset) => {
            if (slurIds.has(id))
              eventPos.set(id, { staff: staff.id, tick: (starts[m] ?? 0) + offset });
          });
        });
      });
    });
  });

  function checkChords(sm: StaffMeasure, mpath: string, length: number, part: Part): void {
    let last = -1;
    sm.chords?.forEach((c, ci) => {
      const cpath = `${mpath}/chords/${ci}`;
      claim(c.id, `${cpath}/id`);
      if (c.tick >= length)
        add(
          'chord-position',
          `${cpath}/tick`,
          `Tick ${c.tick} is outside the measure (${length} ticks)`,
        );
      if (c.tick <= last)
        add('chord-order', `${cpath}/tick`, 'Chord symbols must be sorted by tick, one per tick');
      last = c.tick;
      if (parseQuality(c.quality) === null)
        add('chord-quality', `${cpath}/quality`, `Unknown chord quality "${c.quality}"`);
      if (c.frame) {
        const strings = partTuning(part)?.length;
        if (strings !== undefined && c.frame.frets.length !== strings)
          add(
            'chord-frame',
            `${cpath}/frame/frets`,
            `The frame has ${c.frame.frets.length} strings, the part has ${strings}`,
          );
        const b = c.frame.barre;
        if (b && (b.from > b.to || b.to > c.frame.frets.length))
          add('chord-frame', `${cpath}/frame/barre`, 'The barre must span existing strings');
      }
    });
  }

  function checkVoice(
    voice: Voice,
    vpath: string,
    length: number,
    next: Voice['events'][number] | undefined,
    part: Part,
    onEvent: (id: string, offset: number) => void,
  ): void {
    const ratio = new Map<string, number>();
    const inTuplet = new Set<string>();
    const index = new Map(voice.events.map((e, i) => [e.id, i]));
    voice.tuplets.forEach((t, ti) => {
      const tpath = `${vpath}/tuplets/${ti}`;
      claim(t.id, `${tpath}/id`);
      if (t.actual === t.normal || t.actual < 2 || t.normal < 2) {
        add('tuplet-ratio', tpath, `Invalid ratio ${t.actual}:${t.normal}`);
      }
      let prev = -2;
      for (const eid of t.eventIds) {
        const i = index.get(eid);
        if (i === undefined) {
          add('tuplet-ref', tpath, `Event "${eid}" is not in this voice`);
          continue;
        }
        if (i !== prev + 1 && prev !== -2)
          add('tuplet-contiguous', tpath, 'Tuplet events must be consecutive and ordered');
        prev = i;
        if (inTuplet.has(eid)) add('tuplet-overlap', tpath, `Event "${eid}" is in two tuplets`);
        inTuplet.add(eid);
        ratio.set(eid, t.normal / t.actual);
      }
      if (t.eventIds.length < 2) add('tuplet-size', tpath, 'A tuplet needs at least two events');
    });

    let sum = 0;
    voice.events.forEach((e, i) => {
      const epath = `${vpath}/events/${i}`;
      claim(e.id, `${epath}/id`);
      const ticks = durationTicks(e.duration) * (ratio.get(e.id) ?? 1);
      if (!Number.isInteger(ticks))
        add('non-integer-ticks', epath, `Event lasts ${ticks} ticks, not an integer`);
      onEvent(e.id, sum);
      sum += ticks;
      if (e.kind === 'note') {
        if (e.pitches.length === 0) add('empty-chord', epath, 'A note needs at least one pitch');
        const following = voice.events[i + 1] ?? next;
        e.pitches.forEach((p, k) => {
          const ppath = `${epath}/pitches/${k}`;
          if (e.pitches.findIndex((q) => pitchEquals(p, q)) !== k)
            add('duplicate-pitch', ppath, 'Pitch repeated in a chord');
          if (p.tieToNext && !canTie(p, following))
            add(
              'tie-target',
              ppath,
              'tieToNext needs the same pitch in the next event of the voice',
            );
          if (p.fretting) checkFretting(part, p, ppath);
        });
      }
    });
    if (sum !== length)
      add('voice-length', vpath, `Voice lasts ${sum} ticks, measure lasts ${length}`);
  }

  function checkFretting(
    part: Part,
    p: Parameters<typeof pitchToMidi>[0] & { fretting?: { string: number; fret: number } },
    path: string,
  ): void {
    const f = p.fretting!;
    const tuning = partTuning(part);
    if (!tuning)
      return void add(
        'fretting-no-tuning',
        `${path}/fretting`,
        'No tuning known for this part (set Part.tuning)',
      );
    const open = tuning[f.string - 1];
    if (!open)
      return void add(
        'fretting-string',
        `${path}/fretting/string`,
        `String ${f.string} does not exist (${tuning.length} strings)`,
      );
    const frets = partFrets(part) ?? LIMITS.maxFret;
    if (f.fret > frets)
      add('fretting-fret', `${path}/fretting/fret`, `Fret ${f.fret} exceeds ${frets}`);
    const expected = fretToMidi(open, part.capo ?? 0, f.fret);
    if (expected !== soundingMidi(p, part.transposition)) {
      add(
        'fretting-mismatch',
        `${path}/fretting`,
        `String ${f.string} fret ${f.fret} sounds MIDI ${expected}, the written pitch sounds ${soundingMidi(p, part.transposition)}`,
      );
    }
  }

  score.slurs.forEach((s, i) => {
    const path = `/slurs/${i}`;
    claim(s.id, `${path}/id`);
    const a = eventPos.get(s.startEventId);
    const b = eventPos.get(s.endEventId);
    if (!a || !b) return void add('slur-ref', path, 'A slur must start and end on existing events');
    if (a.staff !== b.staff) add('slur-staff', path, 'A slur must stay on one staff');
    else if (a.tick >= b.tick) add('slur-order', path, 'A slur must end after it starts');
  });

  return issues;
}

/**
 * Warnings (not errors): notes outside the sounding range of a catalog instrument.
 * Parts with an unknown instrument id are skipped.
 */
export function rangeWarnings(score: Score): Issue[] {
  const out: Issue[] = [];
  score.parts.forEach((part, pi) => {
    const inst = getInstrument(part.instrument);
    if (!inst) return;
    part.staves.forEach((staff, si) =>
      staff.measures.forEach((sm, m) =>
        sm.voices.forEach((v, vi) =>
          v.events.forEach((e, ei) => {
            if (e.kind === 'note' && e.pitches.some((p) => !isPartInRange(part, p))) {
              out.push({
                code: 'out-of-range',
                path: `/parts/${pi}/staves/${si}/measures/${m}/voices/${vi}/events/${ei}`,
                message: `Outside the range of ${inst.id}`,
              });
            }
          }),
        ),
      ),
    );
  });
  return out;
}
