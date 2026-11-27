/**
 * Part commands: add, remove, reorder, rename, change instrument, staff layout (standard / tab),
 * tuning and capo. Rules are documented in docs/score-format.md ("Parts and instruments").
 */
import { idGen, newId, type IdGen } from '../ids';
import { getInstrument, type InstrumentDef } from '../instruments';
import { LIMITS } from '../limits';
import { comparePitch, midiToPitch, pitchToMidi, shiftOctaves } from '../pitch';
import { findStaff, keyFifthsAt, measureLength } from '../query';
import { assignFretting } from '../tuning';
import type {
  Clef,
  NotePitch,
  Part,
  Pitch,
  Score,
  ScoreEvent,
  Staff,
  StaffMeasure,
  Voice,
} from '../types';
import {
  CommandError,
  defineCommand,
  pruneSlurs,
  pruneTies,
  restsFor,
  type Command,
  type VoiceAddress,
} from './core';

/** How a fretted instrument is written: standard staff, tablature, or both (two staves). */
export type StaffLayout = 'standard' | 'tab' | 'standard+tab';

function partIndexOf(score: Score, partId: string): number {
  const i = score.parts.findIndex((p) => p.id === partId);
  if (i < 0) throw new CommandError('not-found', `No part "${partId}"`);
  return i;
}

function replacePart(score: Score, index: number, part: Part): Score {
  const parts = score.parts.slice();
  parts[index] = part;
  return { ...score, parts };
}

function emptyStaff(score: Score, clef: Clef, type: Staff['type'], gen: IdGen): Staff {
  return {
    id: gen(),
    clef,
    type,
    measures: score.measures.map((_, m) => ({
      voices: [{ id: gen(), events: restsFor(0, measureLength(score, m), gen), tuplets: [] }],
    })),
  };
}

function hasNotes(staff: Staff): boolean {
  return staff.measures.some((sm) =>
    sm.voices.some((v) => v.events.some((e) => e.kind === 'note')),
  );
}

function eventIdsOf(staff: Staff): string[] {
  return staff.measures.flatMap((sm) => sm.voices.flatMap((v) => v.events.map((e) => e.id)));
}

/** Layout of the staves of a part, from their types. */
export function staffLayoutOf(part: Part): StaffLayout {
  const tab = part.staves.some((s) => s.type === 'tab');
  const standard = part.staves.some((s) => s.type === 'standard');
  return tab && standard ? 'standard+tab' : tab ? 'tab' : 'standard';
}

// ---------------------------------------------------------------------------------------------
// Fretting helpers
// ---------------------------------------------------------------------------------------------

function mapStaffPitches(staff: Staff, fn: (p: NotePitch) => NotePitch): Staff {
  return {
    ...staff,
    measures: staff.measures.map((sm) => ({
      ...sm,
      voices: sm.voices.map((v) => ({
        ...v,
        events: v.events.map((e): ScoreEvent =>
          e.kind === 'note' ? { ...e, pitches: e.pitches.map((q) => fn(q)) } : e,
        ),
      })),
    })),
  };
}

function withFretting(p: NotePitch, f: NotePitch['fretting']): NotePitch {
  const copy: { fretting?: NonNullable<NotePitch['fretting']> } & NotePitch = { ...p };
  delete copy.fretting;
  if (f) copy.fretting = f;
  return copy;
}

/** Recomputes the fretting of a staff: every note on a tab staff, the already fretted ones elsewhere. */
function refretStaff(part: Part, staff: Staff, fretted: boolean): Staff {
  return mapStaffPitches(staff, (q) => {
    if (!fretted) return q.fretting ? withFretting(q, undefined) : q;
    if (staff.type !== 'tab' && !q.fretting) return q;
    return withFretting(q, assignFretting(part, q, q.fretting?.string));
  });
}

function refretPart(part: Part): Part {
  const fretted = !!getInstrument(part.instrument)?.strings || !!part.tuning;
  return { ...part, staves: part.staves.map((s) => refretStaff(part, s, fretted)) };
}

// ---------------------------------------------------------------------------------------------
// Add / remove / reorder / rename
// ---------------------------------------------------------------------------------------------

function stavesFor(
  score: Score,
  inst: InstrumentDef | undefined,
  layout: StaffLayout,
  gen: IdGen,
): Staff[] {
  if (inst?.staves === 2) {
    return [
      emptyStaff(score, 'treble', 'standard', gen),
      emptyStaff(score, 'bass', 'standard', gen),
    ];
  }
  const clef = inst?.clefs[0] ?? 'treble';
  const fretted = !!inst?.strings;
  const out: Staff[] = [];
  if (!fretted || layout !== 'tab') out.push(emptyStaff(score, clef, 'standard', gen));
  if (fretted && layout !== 'standard') out.push(emptyStaff(score, clef, 'tab', gen));
  return out;
}

/**
 * Adds a part with the given catalog instrument at `index` (default: last). The staves are empty
 * (rests) and match the score's measures: piano gets a grand staff, fretted instruments the
 * requested `layout` (default standard). `name` defaults to the instrument's English name.
 */
export function addPart(p: {
  instrument: string;
  name?: string;
  index?: number;
  layout?: StaffLayout;
}): Command {
  const seed = newId('ap');
  return defineCommand('addPart', (score) => {
    const inst = getInstrument(p.instrument);
    if (!inst) throw new CommandError('not-found', `Unknown instrument "${p.instrument}"`);
    if (score.parts.length >= LIMITS.maxParts)
      throw new CommandError('invalid-argument', 'Too many parts');
    const index = p.index ?? score.parts.length;
    if (!Number.isInteger(index) || index < 0 || index > score.parts.length)
      throw new CommandError('bad-position', `Cannot insert a part at ${index}`);
    const name = (p.name ?? inst.names.en).trim().slice(0, LIMITS.maxNameLength);
    const gen = idGen(seed);
    const part: Part = {
      id: gen(),
      name,
      instrument: inst.id,
      transposition: inst.transposition,
      staves: stavesFor(score, inst, p.layout ?? 'standard', gen),
    };
    const parts = [...score.parts.slice(0, index), part, ...score.parts.slice(index)];
    return { ...score, parts };
  });
}

/** Removes a part and the slurs on its notes. The last part cannot be removed (`last-part`). */
export function removePart(p: { partId: string }): Command {
  return defineCommand('removePart', (score) => {
    const index = partIndexOf(score, p.partId);
    if (score.parts.length === 1)
      throw new CommandError('last-part', 'Cannot remove the last part');
    const removed = new Set(score.parts[index]!.staves.flatMap(eventIdsOf));
    const parts = score.parts.filter((_, i) => i !== index);
    return pruneSlurs({ ...score, parts }, removed);
  });
}

/** Moves a part so that it ends at `toIndex` in the part list. */
export function movePart(p: { partId: string; toIndex: number }): Command {
  return defineCommand('movePart', (score) => {
    const from = partIndexOf(score, p.partId);
    if (!Number.isInteger(p.toIndex) || p.toIndex < 0 || p.toIndex >= score.parts.length)
      throw new CommandError('bad-position', `Cannot move a part to ${p.toIndex}`);
    if (from === p.toIndex) return score;
    const parts = score.parts.slice();
    const [part] = parts.splice(from, 1);
    parts.splice(p.toIndex, 0, part!);
    return { ...score, parts };
  });
}

export function renamePart(p: { partId: string; name: string }): Command {
  return defineCommand('renamePart', (score) => {
    const index = partIndexOf(score, p.partId);
    const name = p.name.trim();
    if (name.length > LIMITS.maxNameLength)
      throw new CommandError('invalid-argument', 'Part name is too long');
    const part = score.parts[index]!;
    return part.name === name ? score : replacePart(score, index, { ...part, name });
  });
}

// ---------------------------------------------------------------------------------------------
// Change instrument
// ---------------------------------------------------------------------------------------------

function shiftPitch(q: NotePitch, semitones: number, fifths: number): NotePitch {
  const moved =
    semitones % 12 === 0
      ? shiftOctaves(q, semitones / 12)
      : midiToPitch(pitchToMidi(q) + semitones, fifths, semitones < 0);
  const midi = pitchToMidi(moved);
  if (midi < 0 || midi > 127) throw new CommandError('pitch-out-of-range', 'Pitch out of range');
  const out: NotePitch = { step: moved.step, alter: moved.alter, octave: moved.octave };
  return q.tieToNext ? { ...out, tieToNext: true } : out;
}

function shiftStaff(staff: Staff, semitones: number, score: Score): Staff {
  if (semitones === 0) return staff;
  return {
    ...staff,
    measures: staff.measures.map((sm, m) => {
      const fifths = keyFifthsAt(score, m);
      return {
        ...sm,
        voices: sm.voices.map((v) => ({
          ...v,
          events: v.events.map((e): ScoreEvent =>
            e.kind === 'note'
              ? {
                  ...e,
                  pitches: e.pitches
                    .map((q) => shiftPitch(q, semitones, fifths))
                    .sort(comparePitch),
                }
              : e,
          ),
        })),
      };
    }),
  };
}

function fitClefs(staff: Staff, allowed: readonly Clef[], fallback: Clef): Staff {
  const clef = allowed.includes(staff.clef) ? staff.clef : fallback;
  const changed = staff.measures.some((sm) => sm.clef && !allowed.includes(sm.clef));
  if (clef === staff.clef && !changed) return staff;
  return {
    ...staff,
    clef,
    measures: changed
      ? staff.measures.map((sm): StaffMeasure => {
          if (!sm.clef || allowed.includes(sm.clef)) return sm;
          const { clef: _drop, ...rest } = sm;
          void _drop;
          return rest;
        })
      : staff.measures,
  };
}

function toStandard(staff: Staff, clef: Clef): Staff {
  return { ...staff, type: 'standard', clef };
}

function pruneAllTies(score: Score, partIndex: number): Score {
  let out = score;
  const part = score.parts[partIndex]!;
  part.staves.forEach((staff, staffIndex) =>
    staff.measures.forEach((sm, measure) =>
      sm.voices.forEach((_, voiceIndex) => {
        const a: VoiceAddress = { partIndex, staffIndex, measure, voiceIndex };
        out = pruneTies(out, a);
      }),
    ),
  );
  return out;
}

/**
 * Changes the instrument of a part. Rules:
 * - **Sounding pitch is kept.** Notes store the written pitch, so when the transposition changes
 *   the written pitches move by the difference (a guitar to a ukulele moves notes down an octave
 *   on the page). Spelling follows the key signature of each measure.
 * - **Clefs.** A clef (initial or at a measure) that the new instrument does not list becomes the
 *   instrument's default clef or is removed; allowed clefs are kept.
 * - **Staves.** Piano gets a grand staff (an empty bass staff is added). Going to a one-staff
 *   instrument keeps the first staff; the others must be empty (`not-empty` otherwise). A fretted
 *   instrument keeps its staff layout (standard, tab or both) when the previous instrument was
 *   fretted too, else a standard staff.
 * - **Tuning and capo** are reset to the new instrument's defaults; frets are recomputed.
 * - **Name.** Replaced by `name` when given, else kept.
 */
export function changeInstrument(p: {
  partId: string;
  instrument: string;
  name?: string;
}): Command {
  const seed = newId('ci');
  return defineCommand('changeInstrument', (score) => {
    const index = partIndexOf(score, p.partId);
    const part = score.parts[index]!;
    const inst = getInstrument(p.instrument);
    if (!inst) throw new CommandError('not-found', `Unknown instrument "${p.instrument}"`);
    if (part.instrument === inst.id) return score;
    const gen = idGen(seed);
    const oldFretted = !!getInstrument(part.instrument)?.strings || !!part.tuning;
    const layout = oldFretted && inst.strings ? staffLayoutOf(part) : 'standard';
    const defaultClef = inst.clefs[0] ?? 'treble';

    // 1. Which staves survive.
    const standards = part.staves.filter((s) => s.type === 'standard');
    const tabs = part.staves.filter((s) => s.type === 'tab');
    const primary = (standards[0] ?? (tabs[0] ? toStandard(tabs[0], defaultClef) : undefined))!;
    let kept: Staff[];
    if (inst.staves === 2) {
      const second = standards[1] ?? emptyStaff(score, 'bass', 'standard', gen);
      kept = [primary, second];
    } else if (inst.strings && layout === 'tab') {
      kept = [tabs[0] ?? { ...primary, type: 'tab' as const }];
    } else if (inst.strings && layout === 'standard+tab') {
      kept = [primary, tabs[0]!];
    } else {
      kept = [primary];
    }
    const dropped = part.staves.filter((s) => !kept.some((k) => k.id === s.id));
    for (const s of dropped) {
      if (s.type === 'standard' && hasNotes(s))
        throw new CommandError('not-empty', 'The extra staff holds notes');
    }
    const removed = new Set(dropped.flatMap(eventIdsOf));

    // 2. Pitches, clefs, frets.
    const shift = part.transposition - inst.transposition;
    const { tuning: _tuning, capo: _capo, ...base } = part;
    void _tuning;
    void _capo;
    const next: Part = {
      ...base,
      name: p.name === undefined ? part.name : p.name.trim().slice(0, LIMITS.maxNameLength),
      instrument: inst.id,
      transposition: inst.transposition,
      staves: kept.map((s, i) => {
        const clefs: readonly Clef[] = inst.staves === 2 ? ['treble', 'bass'] : inst.clefs;
        const fallback: Clef = inst.staves === 2 ? (i === 0 ? 'treble' : 'bass') : defaultClef;
        return fitClefs(shiftStaff(s, shift, score), clefs, fallback);
      }),
    };
    const fretted = refretPart(next);
    const out = pruneAllTies(replacePart(score, index, fretted), index);
    return pruneSlurs(out, removed);
  });
}

// ---------------------------------------------------------------------------------------------
// Staff layout of fretted instruments
// ---------------------------------------------------------------------------------------------

/**
 * Copies the notes of `source` into a staff of `type` (tab: frets derived; standard: frets dropped).
 * The copy takes the id of `replaces` and, position by position, the event ids of its events when
 * they exist, so slurs and selections on the old copy stay valid; other ids are fresh.
 */
function cloneStaff(
  part: Part,
  source: Staff,
  type: Staff['type'],
  gen: IdGen,
  replaces?: Staff,
): Staff {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const idOf = (id: string, reuse: string | undefined): string => {
    const known = ids.get(id);
    if (known) return known;
    const fresh = reuse && !used.has(reuse) ? reuse : gen();
    used.add(fresh);
    ids.set(id, fresh);
    return fresh;
  };
  const defaultClef = getInstrument(part.instrument)?.clefs[0] ?? source.clef;
  const clone: Staff = {
    id: replaces?.id ?? gen(),
    clef: type === 'tab' ? source.clef : source.type === 'tab' ? defaultClef : source.clef,
    type,
    measures: source.measures.map((sm, m): StaffMeasure => {
      const old = replaces?.measures[m];
      return {
        ...(type === 'standard' && sm.clef ? { clef: sm.clef } : {}),
        voices: sm.voices.map((v, vi): Voice => {
          const oldEvents = old?.voices[vi]?.events;
          return {
            id: gen(),
            events: v.events.map((e, i): ScoreEvent => {
              const copy = { ...e, id: idOf(e.id, oldEvents?.[i]?.id) } as ScoreEvent;
              return type === 'standard' && copy.kind === 'note'
                ? { ...copy, pitches: copy.pitches.map((q) => withFretting(q, undefined)) }
                : copy;
            }),
            tuplets: v.tuplets.map((t) => ({
              ...t,
              id: gen(),
              eventIds: t.eventIds.map((id) => ids.get(id) ?? id),
            })),
          };
        }),
      };
    }),
  };
  return type === 'tab' ? refretStaff(part, clone, true) : clone;
}

/** Same notes (kind, duration, pitches, ties, tuplets), ignoring ids and frets. */
function sameNotes(a: Staff, b: Staff): boolean {
  if (a.measures.length !== b.measures.length) return false;
  return a.measures.every((am, m) => {
    const bm = b.measures[m]!;
    return (
      am.voices.length === bm.voices.length &&
      am.voices.every((av, vi) => {
        const bv = bm.voices[vi]!;
        if (av.events.length !== bv.events.length || av.tuplets.length !== bv.tuplets.length)
          return false;
        const events = av.events.every((ae, i) => {
          const be = bv.events[i]!;
          if (ae.kind !== be.kind) return false;
          if (ae.duration.base !== be.duration.base || ae.duration.dots !== be.duration.dots)
            return false;
          if (ae.kind !== 'note' || be.kind !== 'note') return true;
          return (
            ae.pitches.length === be.pitches.length &&
            ae.pitches.every((q, k) => {
              const r = be.pitches[k]!;
              return (
                q.step === r.step &&
                q.alter === r.alter &&
                q.octave === r.octave &&
                !!q.tieToNext === !!r.tieToNext
              );
            })
          );
        });
        const position = (v: Voice, id: string) => v.events.findIndex((e) => e.id === id);
        return (
          events &&
          av.tuplets.every((at, k) => {
            const bt = bv.tuplets[k]!;
            return (
              at.actual === bt.actual &&
              at.normal === bt.normal &&
              at.eventIds.length === bt.eventIds.length &&
              at.eventIds.every((id, j) => position(av, id) === position(bv, bt.eventIds[j]!))
            );
          })
        );
      })
    );
  });
}

/**
 * Keeps the two staves of a "standard + TAB" part in step while one of them is being edited: the
 * other staff of the part of `staffId` is rebuilt from it when its notes differ (no-op otherwise,
 * and for parts with another layout). Event ids are reused position by position. The editor runs
 * it after every edit, in the same undo step.
 */
export function syncCompanionStaff(p: { staffId: string }): Command {
  const seed = newId('sy');
  return defineCommand('syncCompanionStaff', (score) => {
    const loc = findStaff(score, p.staffId);
    if (!loc) throw new CommandError('not-found', `No staff "${p.staffId}"`);
    const part = score.parts[loc.partIndex]!;
    if (part.staves.length !== 2 || staffLayoutOf(part) !== 'standard+tab') return score;
    const master = part.staves[loc.staffIndex]!;
    const otherIndex = 1 - loc.staffIndex;
    const other = part.staves[otherIndex]!;
    if (sameNotes(master, other)) return score;
    const copy = cloneStaff(
      part,
      master,
      master.type === 'standard' ? 'tab' : 'standard',
      idGen(seed),
      other,
    );
    const staves = part.staves.slice();
    staves[otherIndex] = copy;
    const kept = new Set(eventIdsOf(copy));
    const removed = new Set(eventIdsOf(other).filter((id) => !kept.has(id)));
    return pruneSlurs(replacePart(score, loc.partIndex, { ...part, staves }), removed);
  });
}

/**
 * Chooses how a fretted instrument is written: `standard`, `tab` (tablature only) or
 * `standard+tab` (two staves). Converting to tab derives the frets (lowest fret, string kept when
 * possible); `standard+tab` copies the standard staff into the tab staff, and choosing it again
 * refreshes that copy. Editing tablature directly comes with the tab editor.
 */
export function setStaffLayout(p: { partId: string; layout: StaffLayout }): Command {
  const seed = newId('sl');
  return defineCommand('setStaffLayout', (score) => {
    const index = partIndexOf(score, p.partId);
    const part = score.parts[index]!;
    const inst = getInstrument(part.instrument);
    if (!inst?.strings && !part.tuning)
      throw new CommandError('no-tuning', 'This instrument has no strings');
    if (inst?.staves === 2)
      throw new CommandError('invalid-argument', 'A grand staff has no tablature');
    if (p.layout === staffLayoutOf(part) && p.layout !== 'standard+tab') return score;
    const gen = idGen(seed);
    const defaultClef = inst?.clefs[0] ?? 'treble';
    const standard = part.staves.find((s) => s.type === 'standard');
    const tab = part.staves.find((s) => s.type === 'tab');
    const master = standard ?? toStandard(tab!, defaultClef);
    let staves: Staff[];
    if (p.layout === 'standard') staves = [master];
    else if (p.layout === 'tab') staves = [refretStaff(part, { ...master, type: 'tab' }, true)];
    else staves = [master, cloneStaff(part, master, 'tab', gen, tab)];
    const removed = new Set(
      part.staves.filter((s) => !staves.some((k) => k.id === s.id)).flatMap(eventIdsOf),
    );
    return pruneSlurs(replacePart(score, index, { ...part, staves }), removed);
  });
}

// ---------------------------------------------------------------------------------------------
// Tuning and capo
// ---------------------------------------------------------------------------------------------

/**
 * Sets the tuning of a fretted part (sounding pitches, high string to low string, as many as the
 * instrument has strings) or `null` for the catalog tuning. Notes keep their pitch; the frets are
 * recomputed (a note no string can play loses its fretting).
 */
export function setTuning(p: { partId: string; tuning: readonly Pitch[] | null }): Command {
  return defineCommand('setTuning', (score) => {
    const index = partIndexOf(score, p.partId);
    const part = score.parts[index]!;
    const catalog = getInstrument(part.instrument)?.strings;
    if (!catalog) throw new CommandError('no-tuning', 'This instrument has no strings');
    const { tuning: _old, ...rest } = part;
    void _old;
    let next: Part = rest;
    if (p.tuning !== null) {
      if (p.tuning.length !== catalog.length)
        throw new CommandError('invalid-argument', `A tuning needs ${catalog.length} strings`);
      for (const s of p.tuning) {
        const midi = pitchToMidi(s);
        if (!Number.isInteger(midi) || midi < 0 || midi > 127 || Math.abs(s.alter) > 2)
          throw new CommandError('invalid-argument', 'Invalid string pitch');
      }
      const same = p.tuning.every((s, i) => pitchToMidi(s) === pitchToMidi(catalog[i]!));
      if (!same) next = { ...rest, tuning: p.tuning.map((s) => ({ ...s })) };
    }
    if (next.tuning === undefined && part.tuning === undefined) return score;
    return replacePart(score, index, refretPart(next));
  });
}

/** Sets the capo fret (0 removes it; below the instrument's fret count and at most 12). Frets are recomputed. */
export function setCapo(p: { partId: string; capo: number }): Command {
  return defineCommand('setCapo', (score) => {
    const index = partIndexOf(score, p.partId);
    const part = score.parts[index]!;
    const inst = getInstrument(part.instrument);
    if (!inst?.strings) throw new CommandError('no-tuning', 'This instrument has no strings');
    const max = Math.min(12, (inst.frets ?? 12) - 1);
    if (!Number.isInteger(p.capo) || p.capo < 0 || p.capo > max)
      throw new CommandError('invalid-argument', `Capo must be between 0 and ${max}`);
    if ((part.capo ?? 0) === p.capo) return score;
    const { capo: _old, ...rest } = part;
    void _old;
    const next: Part = p.capo === 0 ? rest : { ...rest, capo: p.capo };
    return replacePart(score, index, refretPart(next));
  });
}
