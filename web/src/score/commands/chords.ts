import { transposeChord, type ChordData } from '../chords';
import { idGen, newId } from '../ids';
import { findStaff, keyFifthsAt, measureLength } from '../query';
import type { ChordSymbol, Part, Score, StaffMeasure } from '../types';
import { CommandError, defineCommand, mapStaffMeasure, type Command } from './core';

function locate(score: Score, staffId: string) {
  const loc = findStaff(score, staffId);
  if (!loc) throw new CommandError('not-found', `No staff "${staffId}"`);
  return loc;
}

function withChords(sm: StaffMeasure, chords: readonly ChordSymbol[]): StaffMeasure {
  const { chords: _old, ...rest } = sm;
  void _old;
  return chords.length > 0 ? { ...rest, chords } : rest;
}

function sameChord(a: ChordSymbol, b: ChordData): boolean {
  return (
    a.root.step === b.root.step &&
    a.root.alter === b.root.alter &&
    a.quality === b.quality &&
    a.bass?.step === b.bass?.step &&
    a.bass?.alter === b.bass?.alter
  );
}

/**
 * Sets the chord symbol at a position of a staff measure (replaces the one at the same tick, keeps
 * its id and its diagram flag). `tick` is the offset in the measure.
 */
export function setChord(p: {
  staffId: string;
  measure: number;
  tick: number;
  chord: ChordData;
}): Command {
  const seed = newId('ch');
  return defineCommand('setChord', (score) => {
    const loc = locate(score, p.staffId);
    if (p.measure < 0 || p.measure >= score.measures.length)
      throw new CommandError('bad-position', `No measure ${p.measure}`);
    const length = measureLength(score, p.measure);
    if (!Number.isInteger(p.tick) || p.tick < 0 || p.tick >= length)
      throw new CommandError('bad-position', `Tick ${p.tick} is outside the measure`);
    const sm = score.parts[loc.partIndex]!.staves[loc.staffIndex]!.measures[p.measure]!;
    const list = sm.chords ?? [];
    const at = list.findIndex((c) => c.tick === p.tick);
    const old = at >= 0 ? list[at] : undefined;
    if (old && sameChord(old, p.chord)) return score;
    const next: ChordSymbol = {
      id: old?.id ?? idGen(seed)(),
      tick: p.tick,
      root: p.chord.root,
      quality: p.chord.quality,
      ...(p.chord.bass ? { bass: p.chord.bass } : {}),
      ...(old?.diagram !== undefined ? { diagram: old.diagram } : {}),
    };
    const chords = [...list.filter((c) => c.tick !== p.tick), next].sort((a, b) => a.tick - b.tick);
    return mapStaffMeasure(score, { ...loc, measure: p.measure }, (m) => withChords(m, chords));
  });
}

/** Removes the chord symbol at a position (no-op when there is none). */
export function removeChord(p: { staffId: string; measure: number; tick: number }): Command {
  return defineCommand('removeChord', (score) => {
    const loc = locate(score, p.staffId);
    const sm = score.parts[loc.partIndex]!.staves[loc.staffIndex]!.measures[p.measure];
    if (!sm?.chords?.some((c) => c.tick === p.tick)) return score;
    const chords = sm.chords.filter((c) => c.tick !== p.tick);
    return mapStaffMeasure(score, { ...loc, measure: p.measure }, (m) => withChords(m, chords));
  });
}

/** Forces (true) or hides (false) the diagram of one chord symbol, or `null` to follow the part's mode. */
export function setChordDiagram(p: {
  staffId: string;
  measure: number;
  tick: number;
  diagram: boolean | null;
}): Command {
  return defineCommand('setChordDiagram', (score) => {
    const loc = locate(score, p.staffId);
    const sm = score.parts[loc.partIndex]!.staves[loc.staffIndex]!.measures[p.measure];
    const old = sm?.chords?.find((c) => c.tick === p.tick);
    if (!sm || !old || (old.diagram ?? null) === p.diagram) return score;
    const { diagram: _d, ...rest } = old;
    void _d;
    const next: ChordSymbol = p.diagram === null ? rest : { ...rest, diagram: p.diagram };
    const chords = sm.chords!.map((c) => (c === old ? next : c));
    return mapStaffMeasure(score, { ...loc, measure: p.measure }, (m) => withChords(m, chords));
  });
}

function mapParts(score: Score, partId: string, fn: (part: Part) => Part): Score {
  const index = score.parts.findIndex((q) => q.id === partId);
  if (index < 0) throw new CommandError('not-found', `No part "${partId}"`);
  const part = score.parts[index]!;
  const next = fn(part);
  if (next === part) return score;
  const parts = score.parts.slice();
  parts[index] = next;
  return { ...score, parts };
}

/** Diagram display mode of a part: first occurrence, every one, or `null` (only the forced ones). */
export function setChordDiagramMode(p: { partId: string; mode: 'first' | 'all' | null }): Command {
  return defineCommand('setChordDiagramMode', (score) =>
    mapParts(score, p.partId, (part) => {
      if ((part.chordDiagrams ?? null) === p.mode) return part;
      const { chordDiagrams: _d, ...rest } = part;
      void _d;
      return p.mode === null ? rest : { ...rest, chordDiagrams: p.mode };
    }),
  );
}

/** With a capo, symbols also show the shape to play: `D (C)`. */
export function setChordCapoShapes(p: { partId: string; on: boolean }): Command {
  return defineCommand('setChordCapoShapes', (score) =>
    mapParts(score, p.partId, (part) => {
      if (!!part.chordCapoShapes === p.on) return part;
      const { chordCapoShapes: _c, ...rest } = part;
      void _c;
      return p.on ? { ...rest, chordCapoShapes: true } : rest;
    }),
  );
}

/**
 * Transposes every chord symbol of the given staves (all staves when `staffIds` is omitted) by
 * semitones. Spelling follows the sharps/flats of the key signature of each measure after the move
 * (`keyFifths`, when given, replaces it) and the direction. Whole octaves change nothing.
 */
export function transposeChords(p: {
  semitones: number;
  staffIds?: readonly string[];
  keyFifths?: number;
}): Command {
  return defineCommand('transposeChords', (score) => {
    if (!Number.isInteger(p.semitones))
      throw new CommandError('invalid-argument', 'semitones must be an integer');
    if (p.semitones % 12 === 0) return score;
    const wanted = p.staffIds ? new Set(p.staffIds) : undefined;
    let out = score;
    score.parts.forEach((part, partIndex) =>
      part.staves.forEach((staff, staffIndex) => {
        if (wanted && !wanted.has(staff.id)) return;
        staff.measures.forEach((sm, measure) => {
          if (!sm.chords) return;
          const fifths = p.keyFifths ?? keyFifthsAt(score, measure);
          const chords = sm.chords.map((c) => {
            const moved = transposeChord(c, p.semitones, { fifths });
            // A custom fingering no longer matches the chord.
            const { frame: _f, ...rest } = c;
            void _f;
            return {
              ...rest,
              root: moved.root,
              quality: moved.quality,
              ...(moved.bass ? { bass: moved.bass } : {}),
            } as ChordSymbol;
          });
          out = mapStaffMeasure(out, { partIndex, staffIndex, measure }, (m) =>
            withChords(m, chords),
          );
        });
      }),
    );
    return out;
  });
}

/** All chord symbols of a staff in score order, with their measure. */
export function staffChords(
  score: Score,
  staffId: string,
): { measure: number; chord: ChordSymbol }[] {
  const loc = findStaff(score, staffId);
  if (!loc) return [];
  const out: { measure: number; chord: ChordSymbol }[] = [];
  score.parts[loc.partIndex]!.staves[loc.staffIndex]!.measures.forEach((sm, measure) =>
    sm.chords?.forEach((chord) => out.push({ measure, chord })),
  );
  return out;
}

/** The staff of a part that carries its chord symbols: the first one. */
export function chordStaffId(part: Part): string {
  return part.staves[0]!.id;
}
