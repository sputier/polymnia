/**
 * Tablature commands: keep every note of a tab staff fretted, move a note to another string,
 * return notes to automatic fingering, show or hide rests on a tab staff.
 * Rules are documented in docs/score-format.md ("Fretting and tablature").
 */
import { fretboardOf, isValidFretting, refretStaffNotes, soundingOf } from '../fretting';
import { midiToPitch } from '../pitch';
import { findStaff, keyFifthsAt } from '../query';
import type { NoteEvent, NotePitch, Part, Pitch, Score, Staff } from '../types';
import { CommandError, defineCommand, replaceEvent, requireNote, type Command } from './core';

function replacePartStaves(score: Score, partIndex: number, staves: readonly Staff[]): Score {
  const parts = score.parts.slice();
  parts[partIndex] = { ...score.parts[partIndex]!, staves };
  return { ...score, parts };
}

/**
 * Gives a fretting to every note of the tab staves of the part of `staffId` that has none (or
 * whose fretting no longer sounds its pitch), with the fingering algorithm. Frettings that are
 * valid stay. Returns the same score when nothing is missing. The editor runs it after every edit
 * so a note entered, transposed or re-spelled on a tab staff is always playable on the tab.
 */
export function ensureFretting(p: { staffId: string }): Command {
  return defineCommand('ensureFretting', (score) => {
    const loc = findStaff(score, p.staffId);
    if (!loc) throw new CommandError('not-found', `No staff "${p.staffId}"`);
    const part = score.parts[loc.partIndex]!;
    let changed = false;
    const staves = part.staves.map((s) => {
      if (s.type !== 'tab') return s;
      const next = refretStaffNotes(part, s, 'valid');
      if (next !== s) changed = true;
      return next;
    });
    return changed ? replacePartStaves(score, loc.partIndex, staves) : score;
  });
}

/**
 * Moves one pitch of a note to the adjacent string in `direction` (`up` = towards the first, highest
 * string, as drawn), keeping its pitch: the fret changes. Strings that cannot play the pitch or
 * are used by another note of the chord are skipped. The new fretting is manual.
 */
export function moveToString(p: {
  eventId: string;
  pitchIndex?: number;
  direction: 'up' | 'down';
}): Command {
  return defineCommand('moveToString', (score) => {
    const loc = requireNote(score, p.eventId);
    const part = score.parts[loc.partIndex]!;
    const board = fretboardOf(part);
    if (!board) throw new CommandError('no-tuning', 'The part has no tuning');
    const idx = p.pitchIndex ?? 0;
    const pitch = loc.event.pitches[idx];
    if (!pitch) throw new CommandError('invalid-argument', `No pitch at index ${idx}`);
    const midi = soundingOf(part, pitch);
    const from = pitch.fretting?.string ?? nearestString(part, pitch);
    const step = p.direction === 'up' ? -1 : 1;
    const taken = new Set(
      loc.event.pitches.filter((_, k) => k !== idx).map((q) => q.fretting?.string),
    );
    for (let s = from + step; s >= 1 && s <= board.open.length; s += step) {
      if (taken.has(s)) continue;
      const fretting = { string: s, fret: midi - board.open[s - 1]! - board.capo };
      if (!isValidFretting(board, midi, fretting)) continue;
      return replaceEvent(score, p.eventId, (e) => {
        const ev = e as NoteEvent;
        return {
          ...ev,
          pitches: ev.pitches.map((q, k): NotePitch =>
            k === idx ? { ...q, fretting: { ...fretting, manual: true } } : q,
          ),
        };
      });
    }
    throw new CommandError('invalid-argument', 'No other string can play this pitch');
  });
}

function nearestString(part: Part, pitch: NotePitch): number {
  const board = fretboardOf(part)!;
  const midi = soundingOf(part, pitch);
  let best = 1;
  let bestFret = Infinity;
  board.open.forEach((open, i) => {
    const fret = midi - open - board.capo;
    if (fret >= 0 && fret < bestFret) {
      best = i + 1;
      bestFret = fret;
    }
  });
  return best;
}

/**
 * Hands notes back to automatic fingering: their frettings lose the manual flag and are
 * recomputed on their tab staff (the one of their part when the event is on a standard staff).
 */
export function autoFinger(p: { eventIds: readonly string[] }): Command {
  return defineCommand('autoFinger', (score) => {
    const ids = new Set(p.eventIds);
    let out = score;
    score.parts.forEach((part, partIndex) => {
      const staves = part.staves.map((s) => {
        if (s.type !== 'tab') return s;
        const has = s.measures.some((m) =>
          m.voices.some((v) => v.events.some((e) => ids.has(e.id))),
        );
        return has ? refretStaffNotes(part, s, 'valid', ids) : s;
      });
      if (staves.some((s, i) => s !== part.staves[i])) {
        out = replacePartStaves(out, partIndex, staves);
      }
    });
    return out;
  });
}

/** Shows or hides the rests of a tab staff (hidden by default, as in most guitar tablature). */
export function setTabRests(p: { staffId: string; show: boolean }): Command {
  return defineCommand('setTabRests', (score) => {
    const loc = findStaff(score, p.staffId);
    if (!loc) throw new CommandError('not-found', `No staff "${p.staffId}"`);
    const part = score.parts[loc.partIndex]!;
    const staff = part.staves[loc.staffIndex]!;
    if (staff.type !== 'tab') throw new CommandError('invalid-argument', 'Not a tab staff');
    if (!!staff.showRests === p.show) return score;
    const { showRests: _old, ...rest } = staff;
    void _old;
    const next: Staff = p.show ? { ...rest, showRests: true } : rest;
    const staves = part.staves.slice();
    staves[loc.staffIndex] = next;
    return replacePartStaves(score, loc.partIndex, staves);
  });
}

/** Written pitch of a string and fret of the part owning `staffId`, spelled from the key at `measure`. */
export function pitchOfFretting(
  score: Score,
  staffId: string,
  measure: number,
  string: number,
  fret: number,
): Pitch | undefined {
  const loc = findStaff(score, staffId);
  if (!loc) return undefined;
  const part = score.parts[loc.partIndex]!;
  const board = fretboardOf(part);
  const open = board?.open[string - 1];
  if (!board || open === undefined || fret < 0 || fret > board.frets) return undefined;
  const midi = open + board.capo + fret - part.transposition;
  if (midi < 0 || midi > 127) return undefined;
  return midiToPitch(midi, keyFifthsAt(score, measure));
}
