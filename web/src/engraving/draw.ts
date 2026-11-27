/**
 * Draws one system with VexFlow. This module imports VexFlow: it is only ever loaded through a
 * dynamic import so the library stays out of the initial bundle.
 *
 * Positions come from the layout: after VexFlow has prepared the notes (modifier widths, stems,
 * accidentals) every tick context is moved to the x the layout computed. VexFlow draws, we place.
 */
import {
  Accidental,
  Barline,
  Beam,
  Curve,
  Dot,
  Formatter,
  GhostNote,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Stem,
  TabNote,
  TabStave,
  Tuplet,
  Voice as VfVoice,
  type Note,
  type RenderContext,
  type StemmableNote,
} from 'vexflow/core';
import { shortPartName } from '../score/instruments';
import type {
  Clef,
  Duration,
  NoteEvent,
  NotePitch,
  Part,
  Score,
  ScoreEvent,
  StaffMeasure,
} from '../score/types';
import {
  accidentalsFor,
  beamGroups,
  eventTicks,
  middleLine,
  sortedByStaffPosition,
  stepIndex,
  tieInFrom,
  tiedInKey,
  type AccidentalGlyph,
  clefChangeAt,
  clefGlyph,
} from './notation';
import { METRICS, type PlacedMeasure, type StaffSlot, type SystemLayout } from './layout';

const KEY_NAMES = [
  'Cb',
  'Gb',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
];
export function keyName(fifths: number): string {
  return KEY_NAMES[Math.max(-7, Math.min(7, fifths)) + 7]!;
}

const DURATION: Record<Duration['base'], string> = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  '16th': '16',
  '32nd': '32',
};

function vfClef(clef: Clef): string {
  return clef === 'treble-8vb' ? 'treble' : clef;
}

const REST_KEY: Record<Clef, string> = {
  treble: 'b/4',
  'treble-8vb': 'b/4',
  percussion: 'b/4',
  bass: 'd/3',
  alto: 'c/4',
  tenor: 'a/3',
};

function vfKey(p: NotePitch): string {
  return `${p.step.toLowerCase()}/${p.octave}`;
}

export interface DrawnSystem {
  readonly group: SVGGElement;
  /** SVG elements of each event (a score event can appear on a standard staff and a tab staff). */
  readonly elements: Map<string, SVGElement[]>;
  /** Start modifiers wider than the space the layout reserved (should stay 0). */
  readonly overflow: number;
}

interface BuiltVoice {
  readonly voice: VfVoice;
  readonly notes: (StemmableNote | Note)[];
  readonly byEvent: Map<string, { note: Note; event: ScoreEvent; pitches: NotePitch[] }>;
  readonly index: number;
}

export interface Slurs {
  readonly list: Score['slurs'];
}

function buildStaveNote(
  event: ScoreEvent,
  clef: Clef,
  acc: Map<string, (AccidentalGlyph | null)[]>,
  stem: number | undefined,
): { note: Note; pitches: NotePitch[] } {
  const base = DURATION[event.duration.base];
  if (event.kind === 'rest') {
    const note = new StaveNote({
      keys: [REST_KEY[clef]],
      duration: `${base}r`,
      clef: vfClef(clef),
    });
    for (let i = 0; i < event.duration.dots; i++) Dot.buildAndAttach([note], { all: true });
    return { note, pitches: [] };
  }
  const pitches = sortedByStaffPosition(event.pitches);
  const note = new StaveNote({
    keys: pitches.map(vfKey),
    duration: base,
    clef: vfClef(clef),
    stemDirection: stem ?? autoStem(pitches, clef),
  });
  const glyphs = acc.get(event.id) ?? [];
  pitches.forEach((p, i) => {
    const original = event.pitches.indexOf(p);
    const g = glyphs[original];
    if (g) note.addModifier(new Accidental(g), i);
  });
  for (let i = 0; i < event.duration.dots; i++) Dot.buildAndAttach([note], { all: true });
  return { note, pitches };
}

/** Stem down when the notes sit on or above the middle line, up below it. */
function autoStem(pitches: readonly NotePitch[], clef: Clef): number {
  const mid = middleLine(clef);
  const first = stepIndex(pitches[0]!);
  const last = stepIndex(pitches[pitches.length - 1]!);
  return Math.abs(first - mid) > Math.abs(last - mid)
    ? first > mid
      ? Stem.DOWN
      : Stem.UP
    : last >= mid
      ? Stem.DOWN
      : Stem.UP;
}

function buildTabNote(event: ScoreEvent): { note: Note; pitches: NotePitch[] } {
  const base = DURATION[event.duration.base];
  if (event.kind === 'rest') {
    const note = new GhostNote({ duration: base, dots: event.duration.dots });
    return { note, pitches: [] };
  }
  const fretted = event.pitches.filter((p) => p.fretting);
  if (!fretted.length) {
    return { note: new GhostNote({ duration: base, dots: event.duration.dots }), pitches: [] };
  }
  const note = new TabNote({
    positions: fretted.map((p) => ({ str: p.fretting!.string, fret: p.fretting!.fret })),
    duration: base,
  });
  for (let i = 0; i < event.duration.dots; i++) Dot.buildAndAttach([note], { all: true });
  return { note, pitches: fretted };
}

export function drawSystem(
  ctx: RenderContext,
  score: Score,
  system: SystemLayout,
  slurs: Score['slurs'],
  inSystem: (eventId: string) => boolean,
): DrawnSystem {
  const group = (ctx as unknown as { openGroup(cls: string): SVGGElement }).openGroup('pm-system');
  const elements = new Map<string, SVGElement[]>();
  let overflow = 0;

  // ---- Staves, voices, notes -------------------------------------------------------------
  interface StaffDraw {
    slot: StaffSlot;
    slotIndex: number;
    m: PlacedMeasure;
    stave: Stave;
    sm: StaffMeasure;
    voices: BuiltVoice[];
    beams: Beam[];
    tuplets: Tuplet[];
  }
  const draws: StaffDraw[] = [];
  const noteOf = new Map<string, { note: Note; slotIndex: number; stave: Stave }>();

  for (const m of system.measures) {
    const staves: Stave[] = [];
    system.staves.forEach((slot, slotIndex) => {
      const part = score.parts[slot.partIndex]!;
      const staff = part.staves[slot.staffIndex]!;
      const sm = staff.measures[m.index]!;
      const tab = slot.type === 'tab';
      const stave = tab
        ? new TabStave(m.x, slot.top, m.width, {
            numLines: slot.lines,
            spaceAboveStaffLn: 0,
            spacingBetweenLinesPx: slot.space,
          })
        : new Stave(m.x, slot.top, m.width, { spaceAboveStaffLn: 0 });
      const first = m === system.measures[0];
      if (!first) stave.setBegBarType(Barline.type.NONE);
      if (m.final) stave.setEndBarType(Barline.type.END);
      const clef = m.clefs[slotIndex]!;
      if (m.start.clef === 'full') {
        if (tab) stave.addClef('tab');
        else stave.addClef(vfClef(clef), 'default', clef === 'treble-8vb' ? '8vb' : undefined);
      } else if (m.start.clef === 'small' && !tab && clefChangeAt(staff, m.index)) {
        const g = clefGlyph(clef);
        stave.addClef(g.type, 'small', g.annotation);
      }
      if (m.start.key !== null && !tab) {
        stave.addKeySignature(
          keyName(m.start.key),
          m.start.cancelKey !== null ? keyName(m.start.cancelKey) : undefined,
        );
      }
      if (m.start.time) stave.addTimeSignature(`${m.start.time.beats}/${m.start.time.beatType}`);
      if (m.end) {
        const courtesy = tab ? null : clefChangeAt(staff, m.index + 1);
        if (m.end.clef && courtesy) {
          const g = clefGlyph(courtesy);
          stave.setEndClef(g.type, 'small', g.annotation);
        }
        if (m.end.key !== null && !tab) {
          stave.setEndKeySignature(keyName(m.end.key), keyName(m.end.cancelKey ?? 0));
        }
        if (m.end.time) stave.setEndTimeSignature(`${m.end.time.beats}/${m.end.time.beatType}`);
      }
      // VexFlow keeps ~5px after the barline even with no modifier: only flag a real overflow.
      if (stave.getNoteStartX() - m.x > m.start.width + 6) overflow = 1;
      stave.setNoteStartX(m.noteStartX);
      stave.setContext(ctx).draw();
      staves.push(stave);

      // ---- voices
      const acc = tab
        ? new Map()
        : accidentalsFor(
            sm,
            m.keyFifths,
            tieInFrom(m.index > 0 ? staff.measures[m.index - 1] : undefined),
          );
      const multi = sm.voices.length > 1;
      const voices: BuiltVoice[] = [];
      const beams: Beam[] = [];
      const tuplets: Tuplet[] = [];
      sm.voices.forEach((voice, vi) => {
        const stem = multi ? (vi % 2 === 0 ? Stem.UP : Stem.DOWN) : undefined;
        const notes: Note[] = [];
        const byEvent = new Map<string, { note: Note; event: ScoreEvent; pitches: NotePitch[] }>();
        voice.events.forEach((event) => {
          const { note, pitches } = tab
            ? buildTabNote(event)
            : buildStaveNote(event, clef, acc, stem);
          note.setStave(stave);
          notes.push(note);
          byEvent.set(event.id, { note, event, pitches });
          noteOf.set(event.id, { note, slotIndex, stave });
        });
        const v = new VfVoice({ numBeats: m.time.beats, beatValue: m.time.beatType });
        v.setMode(VfVoice.Mode.SOFT);
        v.addTickables(notes);
        voices.push({ voice: v, notes, byEvent, index: vi });
        if (!tab) {
          const beamed = new Set<number>();
          for (const g of beamGroups(voice, m.time)) {
            const members = g.map((i) => notes[i] as StemmableNote);
            const beam = new Beam(members, multi ? false : true);
            if (stem !== undefined) members.forEach((n) => n.setStemDirection(stem));
            beams.push(beam);
            g.forEach((i) => beamed.add(i));
          }
          for (const t of voice.tuplets) {
            const idx = t.eventIds.map((id) => voice.events.findIndex((e) => e.id === id));
            const members = idx.map((i) => notes[i]!);
            tuplets.push(
              new Tuplet(members, {
                numNotes: t.actual,
                notesOccupied: t.normal,
                bracketed: !idx.every((i) => beamed.has(i)),
                ratioed: false,
              }),
            );
          }
        }
      });
      draws.push({ slot, slotIndex, m, stave, sm, voices, beams, tuplets });
    });
    void staves;
  }

  // ---- Format, place, draw -------------------------------------------------------------------
  for (const d of draws) {
    if (!d.voices.length) continue;
    const vs = d.voices.map((b) => b.voice);
    const formatter = new Formatter();
    for (const v of vs) formatter.joinVoices([v]);
    // Spacing comes from the layout: VexFlow only prepares the notes (width 0 = no justification).
    formatter.format(vs, 0);
    const ticks = d.voices.map((b) => {
      const voice = d.sm.voices[b.index]!;
      return eventTicks(voice);
    });
    d.voices.forEach((b, vi) => {
      const voice = d.sm.voices[vi]!;
      let pos = 0;
      voice.events.forEach((event, i) => {
        const slot = d.m.shape.staves[d.slotIndex]!.find((e) => e.id === event.id)!;
        const note = b.notes[i]!;
        const want = d.m.colX[slot.col]!;
        const tc = note.getTickContext();
        tc.setX(tc.getX() + (want - note.getAbsoluteX()));
        pos += ticks[vi]![i]!;
      });
      void pos;
    });
    for (const b of d.voices) b.voice.setStave(d.stave);
    for (const b of d.voices) {
      b.voice.draw(ctx, d.stave);
      b.notes.forEach((n, i) => {
        const id = d.sm.voices[b.index]!.events[i]!.id;
        const el = n.getSVGElement();
        if (el) {
          el.classList.add('pm-event');
          el.setAttribute('data-event-id', id);
          const list = elements.get(id) ?? [];
          list.push(el);
          elements.set(id, list);
        }
      });
    }
    for (const beam of d.beams) beam.setContext(ctx).draw();
    for (const t of d.tuplets) t.setContext(ctx).draw();
  }

  // ---- Ties -------------------------------------------------------------------------------
  for (const d of draws) {
    if (d.slot.type === 'tab') continue;
    const staff = score.parts[d.slot.partIndex]!.staves[d.slot.staffIndex]!;
    for (const b of d.voices) {
      const events = d.sm.voices[b.index]!.events;
      events.forEach((event, i) => {
        if (event.kind !== 'note') return;
        const info = b.byEvent.get(event.id)!;
        const tied = info.pitches.map((p, k) => (p.tieToNext ? k : -1)).filter((k) => k >= 0);
        if (!tied.length) return;
        // Next event of the same voice, in this measure or the next one.
        let nextEvent: ScoreEvent | undefined = events[i + 1];
        if (!nextEvent) {
          nextEvent = staff.measures[d.m.index + 1]?.voices[b.index]?.events[0];
        }
        const target = nextEvent ? noteOf.get(nextEvent.id) : undefined;
        const targetPitches =
          nextEvent?.kind === 'note' ? sortedByStaffPosition(nextEvent.pitches) : [];
        const last = target && target.slotIndex === d.slotIndex ? target : undefined;
        const lastIndexes = tied.map((k) =>
          targetPitches.findIndex((q) => tiedInKey(q) === tiedInKey(info.pitches[k]!)),
        );
        try {
          new StaveTie({
            firstNote: info.note,
            lastNote: last?.note ?? null,
            firstIndexes: tied,
            lastIndexes: last ? lastIndexes.map((k) => Math.max(0, k)) : tied,
          })
            .setContext(ctx)
            .draw();
        } catch {
          /* a tie that cannot be drawn must never break the system */
        }
      });
      // Tie arriving from the previous system: draw its end.
      const first = events[0];
      if (d.m.index === system.firstMeasure && first?.kind === 'note') {
        const prev = d.m.index > 0 ? staff.measures[d.m.index - 1]?.voices[b.index] : undefined;
        const prevLast = prev?.events[prev.events.length - 1];
        if (prevLast?.kind === 'note') {
          const keys = new Set(prevLast.pitches.filter((p) => p.tieToNext).map(tiedInKey));
          const info = b.byEvent.get(first.id)!;
          const idx = info.pitches
            .map((p, k) => (keys.has(tiedInKey(p)) ? k : -1))
            .filter((k) => k >= 0);
          if (idx.length) {
            try {
              new StaveTie({
                firstNote: null,
                lastNote: info.note,
                firstIndexes: idx,
                lastIndexes: idx,
              })
                .setContext(ctx)
                .draw();
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  }

  // ---- Slurs ------------------------------------------------------------------------------
  for (const s of slurs) {
    const a = noteOf.get(s.startEventId);
    const b = noteOf.get(s.endEventId);
    const startHere = inSystem(s.startEventId) && a;
    const endHere = inSystem(s.endEventId) && b;
    if (!startHere && !endHere) continue;
    const from = startHere ? a.note : undefined;
    const to = endHere ? b.note : undefined;
    const ref = (from ?? to) as StaveNote;
    const stemUp = (() => {
      try {
        return (ref as StemmableNote).getStemDirection() === Stem.UP;
      } catch {
        return false;
      }
    })();
    try {
      new Curve(from, to, {
        cps: [
          { x: 0, y: 10 },
          { x: 0, y: 10 },
        ],
        invert: stemUp,
        position: Curve.Position.NEAR_HEAD,
        positionEnd: Curve.Position.NEAR_HEAD,
      })
        .setContext(ctx)
        .draw();
    } catch {
      /* ignore */
    }
  }

  // ---- Connectors, names ------------------------------------------------------------------
  drawConnectors(
    ctx,
    score,
    system,
    draws.filter((d) => d.m === system.measures[0]).map((d) => d.stave),
    'left',
  );
  for (const m of system.measures) {
    const staves = draws.filter((d) => d.m === m).map((d) => d.stave);
    drawConnectors(ctx, score, system, staves, 'right');
  }
  if (system.names) drawNames(ctx, score, system);

  (ctx as unknown as { closeGroup(): void }).closeGroup();
  return { group, elements, overflow };
}

function drawConnectors(
  ctx: RenderContext,
  score: Score,
  system: SystemLayout,
  staves: Stave[],
  side: 'left' | 'right',
): void {
  let offset = 0;
  const firstOfPart: Stave[] = [];
  const lastOfPart: Stave[] = [];
  score.parts.forEach((part: Part) => {
    const n = part.staves.length;
    const slice = staves.slice(offset, offset + n);
    offset += n;
    firstOfPart.push(slice[0]!);
    lastOfPart.push(slice[n - 1]!);
    if (n > 1) {
      const allStandard = part.staves.every((s) => s.type === 'standard');
      const line = side === 'left' ? 'singleLeft' : 'singleRight';
      new StaveConnector(slice[0]!, slice[n - 1]!).setType(line).setContext(ctx).draw();
      if (side === 'left') {
        new StaveConnector(slice[0]!, slice[n - 1]!)
          .setType(allStandard ? 'brace' : 'bracket')
          .setContext(ctx)
          .draw();
      }
    }
  });
  if (side === 'left' && score.parts.length > 1) {
    new StaveConnector(firstOfPart[0]!, lastOfPart[lastOfPart.length - 1]!)
      .setType('bracket')
      .setContext(ctx)
      .draw();
  }
  void system;
}

function drawNames(ctx: RenderContext, score: Score, system: SystemLayout): void {
  let slotIndex = 0;
  for (const part of score.parts) {
    const first = system.staves[slotIndex]!;
    const last = system.staves[slotIndex + part.staves.length - 1]!;
    slotIndex += part.staves.length;
    const y = (first.top + last.top + last.height) / 2 + 4;
    ctx.save();
    ctx.setFont('Inter, system-ui, sans-serif', 12, 'normal');
    ctx.fillText(truncate(system.shortNames ? shortPartName(part) : part.name), METRICS.marginX, y);
    ctx.restore();
  }
}

function truncate(name: string): string {
  const max = Math.floor(METRICS.nameMax / METRICS.nameChar);
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export type { NoteEvent };
