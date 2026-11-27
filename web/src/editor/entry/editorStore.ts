/**
 * Editor state: the score (through History), selection, input mode, duration, entry cursor.
 * Framework-free class so it is unit-testable; React binds to it through useSyncExternalStore.
 * Every score edit is a score-model command executed through History (exact undo/redo); the UI
 * state around it (cursor, selection) is restored by a parallel snapshot stack.
 */
import {
  addPitch,
  addSlur,
  changeDuration,
  clefAt,
  CommandError,
  createScore,
  createTriplet,
  deleteEvent,
  durationTicks,
  findEvent,
  findStaff,
  History,
  insertMeasure,
  newId,
  putEvent,
  removeSlur,
  setAccidental,
  setPitch,
  toggleDot,
  toggleTie,
  transpose,
  type Alter,
  type Command,
  type Duration,
  type NoteBase,
  type NotePitch,
  type Pitch,
  type Score,
  type StepName,
  keyAlter,
  keyFifthsAt,
} from '../../score';
import type { HitResult } from '../../engraving/hitTest';
import type { Notice } from './describe';
import { alterInForce, nearestOctave, referencePitch } from './pitchInput';
import {
  composite,
  indexAt,
  lengthOf,
  planPieces,
  sequenceOf,
  type Piece,
  type SeqItem,
} from './plan';

export type InputMode = 'select' | 'note';

export interface Cursor {
  readonly measure: number;
  readonly tick: number;
}

/** What the live region says: an event ("C5 quarter, measure 3 beat 2") or a short notice. */
export type Announcement =
  | { readonly seq: number; readonly eventId: string }
  | { readonly seq: number; readonly notice: Notice };

export interface EditorState {
  readonly score: Score;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly mode: InputMode;
  readonly duration: Duration;
  readonly staffId: string;
  readonly voice: number;
  readonly cursor: Cursor;
  /** Selected event ids, in reading order (select mode). */
  readonly selection: readonly string[];
  readonly anchor: string | null;
  readonly focus: string | null;
  /** Last event written in note input: target of chord, tie, pitch and delete keys. */
  readonly lastEntered: string | null;
  /** Reference for the "nearest octave" rule. */
  readonly lastPitch: Pitch | null;
  /** Accidental armed for the next entered note. */
  readonly pendingAlter: Alter | null;
  readonly pendingTie: string | null;
  readonly pendingSlur: string | null;
  readonly announcement: Announcement | null;
}

interface UiSnapshot {
  readonly cursor: Cursor;
  readonly selection: readonly string[];
  readonly anchor: string | null;
  readonly focus: string | null;
  readonly lastEntered: string | null;
  readonly lastPitch: Pitch | null;
  readonly staffId: string;
  readonly voice: number;
}

type ClipItem =
  | { readonly kind: 'note'; readonly duration: Duration; readonly pitches: readonly Pitch[] }
  | { readonly kind: 'rest'; readonly duration: Duration };

const EPS = 1e-6;
const DURATION_OF_KEY: Record<string, NoteBase> = {
  '3': '16th',
  '4': 'eighth',
  '5': 'quarter',
  '6': 'half',
  '7': 'whole',
};

/** Digit key -> note value (3 to 7). Other digits are reserved. */
export function durationForKey(digit: string): NoteBase | undefined {
  return DURATION_OF_KEY[digit];
}

/** The empty score the editor opens with: a piano, 4/4, C major, `measures` empty measures. */
export function newEditorScore(measures = 8): Score {
  return createScore({ measures, instruments: ['piano'] });
}

function noticeFor(e: CommandError): Notice {
  switch (e.code) {
    case 'exceeds-measure':
      return { key: 'notice.noFit' };
    case 'tuplet-conflict':
      return { key: 'notice.tuplet' };
    case 'pitch-out-of-range':
      return { key: 'notice.pitchRange' };
    case 'duplicate-pitch':
      return { key: 'notice.duplicate' };
    case 'no-tie-target':
      return { key: 'notice.noTie' };
    default:
      return { key: 'notice.cannot' };
  }
}

export class EditorStore {
  /** Hook for audible feedback (#10): called with the written pitch of every entered note. */
  onNoteEntered?: (pitch: Pitch) => void;

  private state: EditorState;
  private history: History;
  private readonly listeners = new Set<() => void>();
  private uiUndo: UiSnapshot[] = [];
  private uiRedo: UiSnapshot[] = [];
  private clipboard: ClipItem[] = [];
  private seq = 0;

  constructor(score: Score = newEditorScore()) {
    this.history = new History(score);
    this.state = this.initialState(score);
  }

  private initialState(score: Score): EditorState {
    return {
      score,
      canUndo: false,
      canRedo: false,
      mode: 'select',
      duration: { base: 'quarter', dots: 0 },
      staffId: score.parts[0]!.staves[0]!.id,
      voice: 0,
      cursor: { measure: 0, tick: 0 },
      selection: [],
      anchor: null,
      focus: null,
      lastEntered: null,
      lastPitch: null,
      pendingAlter: null,
      pendingTie: null,
      pendingSlur: null,
      announcement: null,
    };
  }

  getState = (): EditorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Replaces the document (new file, tests): history and clipboard of positions are dropped. */
  loadScore(score: Score): void {
    this.history = new History(score);
    this.uiUndo = [];
    this.uiRedo = [];
    this.state = this.initialState(score);
    this.emit();
  }

  // ---------------------------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------------------------

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  private set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private say(notice: Notice): Partial<EditorState> {
    return { announcement: { seq: ++this.seq, notice } };
  }

  private sayEvent(eventId: string): Partial<EditorState> {
    return { announcement: { seq: ++this.seq, eventId } };
  }

  private snapshot(): UiSnapshot {
    const s = this.state;
    return {
      cursor: s.cursor,
      selection: s.selection,
      anchor: s.anchor,
      focus: s.focus,
      lastEntered: s.lastEntered,
      lastPitch: s.lastPitch,
      staffId: s.staffId,
      voice: s.voice,
    };
  }

  private fail(error: unknown): false {
    if (error instanceof CommandError) {
      this.set(this.say(noticeFor(error)));
      return false;
    }
    throw error;
  }

  /** Executes a command through History. Returns false when it was refused or changed nothing. */
  private commit(cmd: Command, patch: (after: Score) => Partial<EditorState>): boolean {
    const before = this.history.score;
    let after: Score;
    try {
      after = this.history.execute(cmd);
    } catch (e) {
      return this.fail(e);
    }
    if (after === before) return false;
    this.uiUndo.push(this.snapshot());
    this.uiRedo = [];
    this.set({
      ...patch(after),
      score: after,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
    return true;
  }

  private seqOfCurrent(): SeqItem[] {
    return sequenceOf(this.state.score, this.state.staffId, this.state.voice);
  }

  /** Staff id, voice and cursor position of an event. */
  private positionOf(score: Score, eventId: string) {
    const loc = findEvent(score, eventId);
    if (!loc) return null;
    const staffId = score.parts[loc.partIndex]!.staves[loc.staffIndex]!.id;
    const item = sequenceOf(score, staffId, loc.voiceIndex).find((s) => s.id === eventId);
    return item ? { staffId, voice: loc.voiceIndex, measure: item.measure, tick: item.tick } : null;
  }

  private selectPatch(
    score: Score,
    ids: readonly string[],
    anchor: string,
    focus: string,
  ): Partial<EditorState> {
    const pos = this.positionOf(score, focus);
    return {
      selection: ids,
      anchor,
      focus,
      ...(pos
        ? {
            staffId: pos.staffId,
            voice: pos.voice,
            cursor: { measure: pos.measure, tick: pos.tick },
          }
        : {}),
      ...this.sayEvent(focus),
    };
  }

  private liveSelection(score: Score, ids: readonly string[]): string[] {
    return ids.filter((id) => findEvent(score, id));
  }

  // ---------------------------------------------------------------------------------------------
  // Modes and durations
  // ---------------------------------------------------------------------------------------------

  toggleInputMode(): void {
    const s = this.state;
    if (s.mode === 'select') {
      const pos = s.focus ? this.positionOf(s.score, s.focus) : null;
      this.set({
        mode: 'note',
        selection: [],
        anchor: null,
        focus: null,
        lastEntered: null,
        pendingAlter: null,
        pendingTie: null,
        pendingSlur: null,
        ...(pos
          ? {
              staffId: pos.staffId,
              voice: pos.voice,
              cursor: { measure: pos.measure, tick: pos.tick },
            }
          : {}),
        ...this.say({ key: 'notice.inputOn' }),
      });
      return;
    }
    // Leaving input selects the note just entered, else the event under the cursor.
    const seq = this.seqOfCurrent();
    const last =
      s.lastEntered && findEvent(s.score, s.lastEntered)
        ? s.lastEntered
        : (seq[indexAt(seq, s.cursor.measure, s.cursor.tick)]?.id ?? null);
    this.set({
      mode: 'select',
      selection: last ? [last] : [],
      anchor: last,
      focus: last,
      lastEntered: null,
      pendingAlter: null,
      pendingTie: null,
      pendingSlur: null,
      ...(last ? this.sayEvent(last) : this.say({ key: 'notice.inputOff' })),
    });
  }

  /** Digit key 3 to 7. Other digits are reserved: a polite notice, nothing else. */
  durationKey(digit: string): void {
    const base = DURATION_OF_KEY[digit];
    if (!base) {
      this.set(this.say({ key: 'notice.durationUnavailable' }));
      return;
    }
    this.setDuration(base);
  }

  setDuration(base: NoteBase): void {
    const s = this.state;
    const duration: Duration = { base, dots: 0 };
    if (s.mode === 'select' && s.selection.length) {
      const cmds = s.selection.map((eventId) => changeDuration({ eventId, duration }));
      const ids = s.selection;
      this.commit(composite('setDuration', cmds), (after) => ({
        duration,
        selection: this.liveSelection(after, ids),
        ...(s.focus ? this.sayEvent(s.focus) : {}),
      }));
      return;
    }
    this.set({ duration });
  }

  toggleDot(): void {
    const s = this.state;
    if (s.mode === 'select' && s.selection.length) {
      const cmds = s.selection.map((eventId) => toggleDot({ eventId }));
      const ids = s.selection;
      this.commit(composite('toggleDot', cmds), (after) => {
        const focus = s.focus ? findEvent(after, s.focus) : undefined;
        return {
          ...(focus ? { duration: focus.event.duration } : {}),
          selection: this.liveSelection(after, ids),
          ...(s.focus ? this.sayEvent(s.focus) : {}),
        };
      });
      return;
    }
    this.set({ duration: { base: s.duration.base, dots: s.duration.dots ? 0 : 1 } });
  }

  // ---------------------------------------------------------------------------------------------
  // Entering notes
  // ---------------------------------------------------------------------------------------------

  /** Letter key A to G. Note input: enters a note. Select mode: moves the selected notes to it. */
  enterStep(step: StepName, chord = false): void {
    const s = this.state;
    if (s.mode === 'select') {
      this.respell(step);
      return;
    }
    const staff = findStaff(s.score, s.staffId);
    if (!staff) return;
    if (chord && s.lastEntered) {
      const loc = findEvent(s.score, s.lastEntered);
      if (loc?.event.kind === 'note') {
        const ref = s.lastPitch ?? loc.event.pitches[loc.event.pitches.length - 1]!;
        const octave = nearestOctave(step, ref);
        const item = this.seqOfCurrent().find((i) => i.id === s.lastEntered);
        const pitch: Pitch = {
          step,
          octave,
          alter:
            s.pendingAlter ??
            alterInForce(
              s.score,
              { ...staff, measure: loc.measure },
              item?.tick ?? 0,
              step,
              octave,
            ),
        };
        const id = s.lastEntered;
        this.commit(addPitch({ eventId: id, pitch }), () => ({
          lastPitch: pitch,
          pendingAlter: null,
          ...this.sayEvent(id),
        }));
        return;
      }
    }
    const clef = clefAt(
      s.score.parts[staff.partIndex]!.staves[staff.staffIndex]!,
      s.cursor.measure,
    );
    const octave = nearestOctave(step, s.lastPitch ?? referencePitch(clef));
    this.enterAt({ step, octave }, { staffId: s.staffId, ...s.cursor });
  }

  /** Writes a note at a position (mouse and keyboard share it). `alter` defaults from the key. */
  private enterAt(
    p: { step: StepName; octave: number },
    at: { staffId: string; measure: number; tick: number },
  ): void {
    const s = this.state;
    const staff = findStaff(s.score, at.staffId);
    if (!staff) return;
    const alter =
      s.pendingAlter ??
      alterInForce(s.score, { ...staff, measure: at.measure }, at.tick, p.step, p.octave);
    this.place({ step: p.step, alter, octave: p.octave }, at);
  }

  /** `0`: a rest of the current duration at the cursor (select mode: turns the selection into rests). */
  enterRest(): void {
    const s = this.state;
    if (s.mode === 'select') {
      this.deleteSelection();
      return;
    }
    this.place(null, { staffId: s.staffId, ...s.cursor });
  }

  private place(pitch: Pitch | null, at: { staffId: string; measure: number; tick: number }): void {
    const s = this.state;
    const score = s.score;
    const seq = sequenceOf(score, at.staffId, s.voice);
    const atIdx = indexAt(seq, at.measure, at.tick);
    const item = atIdx >= 0 ? seq[atIdx] : undefined;
    // Inside a triplet an event keeps its slot: no barline splitting, time scaled by the ratio.
    const ratio = item?.inTuplet ? item.ticks / durationTicks(item.event.duration) : 1;
    // Tuplet ticks are fractions: use the event's own start so putEvent finds the slot exactly.
    const tick = item && Math.abs(item.tick - at.tick) < 1e-3 ? item.tick : at.tick;
    const pieces: Piece[] = item?.inTuplet
      ? [{ measure: at.measure, tick, duration: s.duration }]
      : planPieces(score, at.measure, tick, s.duration);

    const mainId = newId('n');
    const ids = pieces.map((_, i) => (i === 0 ? mainId : `${mainId}.${i}`));
    let count = score.measures.length;
    const required: Command[] = [];
    pieces.forEach((pc, i) => {
      while (pc.measure >= count) required.push(insertMeasure({ index: count++ }));
      required.push(
        putEvent({
          staffId: at.staffId,
          measure: pc.measure,
          voice: s.voice,
          tick: pc.tick,
          id: ids[i]!,
          event: pitch
            ? { kind: 'note', duration: pc.duration, pitches: [pitch] }
            : { kind: 'rest', duration: pc.duration },
        }),
      );
    });
    if (pitch) {
      for (let i = 0; i < ids.length - 1; i++) required.push(toggleTie({ eventId: ids[i]! }));
    }
    const last = pieces[pieces.length - 1]!;
    let endMeasure = last.measure;
    let endTick = last.tick + durationTicks(last.duration) * ratio;
    if (endTick >= lengthOf(score, endMeasure) - EPS) {
      endMeasure++;
      endTick = 0;
      while (endMeasure >= count) required.push(insertMeasure({ index: count++ }));
    }
    const optional: Command[] = [];
    if (pitch && s.pendingTie) optional.push(toggleTie({ eventId: s.pendingTie }));
    if (pitch && s.pendingSlur) {
      optional.push(addSlur({ startEventId: s.pendingSlur, endEventId: mainId }));
    }

    const ok = this.commit(
      composite(pitch ? 'enterNote' : 'enterRest', required, optional),
      () => ({
        staffId: at.staffId,
        cursor: { measure: endMeasure, tick: endTick },
        lastEntered: pitch ? ids[ids.length - 1]! : null,
        lastPitch: pitch ?? s.lastPitch,
        pendingAlter: null,
        pendingTie: null,
        pendingSlur: null,
        ...this.sayEvent(mainId),
      }),
    );
    if (ok && pitch) this.onNoteEntered?.(pitch);
  }

  /** Select mode, letter key: moves each selected note to that letter's nearest pitch. */
  private respell(step: StepName): void {
    const s = this.state;
    const cmds: Command[] = [];
    for (const id of s.selection) {
      const loc = findEvent(s.score, id);
      if (loc?.event.kind !== 'note') continue;
      const old = loc.event.pitches[0]!;
      const octave = nearestOctave(step, old);
      const tick = this.positionOf(s.score, id)?.tick ?? 0;
      const alter = s.pendingAlter ?? alterInForce(s.score, loc, tick, step, octave);
      cmds.push(setPitch({ eventId: id, pitch: { step, alter, octave } }));
    }
    if (!cmds.length) return;
    const ids = s.selection;
    this.commit(composite('setPitch', cmds), (after) => ({
      selection: this.liveSelection(after, ids),
      pendingAlter: null,
      ...(s.focus ? this.sayEvent(s.focus) : {}),
    }));
  }

  /** `+`, `-`, `=`. Note input: arms the accidental for the next note. Select mode: applies it. */
  accidental(alter: Alter): void {
    const s = this.state;
    if (s.mode === 'note') {
      const next = s.pendingAlter === alter ? null : alter;
      this.set({
        pendingAlter: next,
        ...(next === null
          ? this.say({ key: 'notice.accidentalOff' })
          : this.say({
              key: 'notice.accidental',
              params: {
                name: alter === 0 ? '♮' : alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter),
              },
            })),
      });
      return;
    }
    const cmds: Command[] = [];
    for (const id of s.selection) {
      const loc = findEvent(s.score, id);
      if (loc?.event.kind !== 'note') continue;
      loc.event.pitches.forEach((p, pitchIndex) => {
        const diatonic = keyAlter(p.step, keyFifthsAt(s.score, loc.measure));
        cmds.push(
          setAccidental({ eventId: id, pitchIndex, alter: p.alter === alter ? diatonic : alter }),
        );
      });
    }
    if (!cmds.length) return;
    this.commit(composite('setAccidental', cmds), () => (s.focus ? this.sayEvent(s.focus) : {}));
  }

  // ---------------------------------------------------------------------------------------------
  // Moving, selecting
  // ---------------------------------------------------------------------------------------------

  /** Left/right arrows. Note input: moves the cursor. Select mode: moves or extends the selection. */
  move(direction: -1 | 1, extend = false): boolean {
    const s = this.state;
    const seq = this.seqOfCurrent();
    if (!seq.length) return false;
    if (s.mode === 'note') {
      const idx = indexAt(seq, s.cursor.measure, s.cursor.tick);
      const here = seq[idx];
      let target: number;
      if (idx < 0) target = direction > 0 ? 0 : seq.length - 1;
      else if (direction < 0) target = here!.tick < s.cursor.tick - EPS ? idx : idx - 1;
      else target = idx + 1;
      const to = seq[target];
      if (!to) return false;
      this.set({
        cursor: { measure: to.measure, tick: to.tick },
        lastEntered: null,
        pendingTie: null,
        pendingSlur: null,
        ...this.sayEvent(to.id),
      });
      return true;
    }
    let focusIdx = s.focus ? seq.findIndex((i) => i.id === s.focus) : -1;
    if (focusIdx < 0) {
      const at = indexAt(seq, s.cursor.measure, s.cursor.tick);
      const first = seq[Math.max(at, 0)]!;
      this.set(this.selectPatch(s.score, [first.id], first.id, first.id));
      return true;
    }
    const target = seq[focusIdx + direction];
    if (!target) return false;
    const anchorId = extend ? (s.anchor ?? s.focus!) : target.id;
    const anchorIdx = seq.findIndex((i) => i.id === anchorId);
    focusIdx = focusIdx + direction;
    const [from, to] = anchorIdx <= focusIdx ? [anchorIdx, focusIdx] : [focusIdx, anchorIdx];
    const ids = seq.slice(Math.max(from, 0), to + 1).map((i) => i.id);
    this.set(this.selectPatch(s.score, ids, anchorId, target.id));
    return true;
  }

  /** Click on an event (select mode). Shift extends the range from the anchor. */
  clickEvent(eventId: string, extend = false): void {
    const s = this.state;
    const pos = this.positionOf(s.score, eventId);
    if (!pos) return;
    const seq = sequenceOf(s.score, pos.staffId, pos.voice);
    const anchorId = extend && s.anchor && seq.some((i) => i.id === s.anchor) ? s.anchor : eventId;
    const a = seq.findIndex((i) => i.id === anchorId);
    const b = seq.findIndex((i) => i.id === eventId);
    const ids = seq.slice(Math.min(a, b), Math.max(a, b) + 1).map((i) => i.id);
    this.set({ mode: 'select', ...this.selectPatch(s.score, ids, anchorId, eventId) });
  }

  /** Pointer press on the score, as resolved by the engraver's hit test. */
  click(hit: HitResult | null, extend = false): void {
    if (!hit) return;
    const s = this.state;
    if (s.mode === 'note') {
      if (hit.tick === undefined) return;
      const at = { staffId: hit.staffId, measure: hit.measureIndex, tick: hit.tick };
      if (hit.pitch) this.enterAt({ step: hit.pitch.step, octave: hit.pitch.octave }, at);
      else
        this.set({
          staffId: at.staffId,
          cursor: { measure: at.measure, tick: at.tick },
          lastEntered: null,
        });
      return;
    }
    if (hit.eventId) {
      this.clickEvent(hit.eventId, extend);
      return;
    }
    this.set({
      selection: [],
      anchor: null,
      focus: null,
      staffId: hit.staffId,
      cursor: { measure: hit.measureIndex, tick: hit.tick ?? 0 },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Editing the selection / the last entered note
  // ---------------------------------------------------------------------------------------------

  /** Targets of pitch, tie and delete keys: the selection, or the last entered note in note input. */
  private targets(): string[] {
    const s = this.state;
    if (s.mode === 'note')
      return s.lastEntered && findEvent(s.score, s.lastEntered) ? [s.lastEntered] : [];
    return [...s.selection];
  }

  /** Arrows up/down (1 or 12 semitones). */
  shiftPitch(semitones: number): boolean {
    const s = this.state;
    const ids = this.targets();
    if (!ids.length) return false;
    const noteMode = s.mode === 'note';
    const ok = this.commit(transpose({ eventIds: ids, semitones }), (after) => {
      const id = noteMode ? ids[0]! : s.focus;
      const loc = id ? findEvent(after, id) : undefined;
      const top: NotePitch | undefined =
        loc?.event.kind === 'note' ? loc.event.pitches[loc.event.pitches.length - 1] : undefined;
      return {
        ...(noteMode && top
          ? { lastPitch: { step: top.step, alter: top.alter, octave: top.octave } }
          : {}),
        ...(id ? this.sayEvent(id) : {}),
      };
    });
    if (ok && noteMode) {
      const loc = findEvent(this.state.score, ids[0]!);
      if (loc?.event.kind === 'note') {
        const top = loc.event.pitches[loc.event.pitches.length - 1]!;
        this.onNoteEntered?.({ step: top.step, alter: top.alter, octave: top.octave });
      }
    }
    return ok;
  }

  toggleTie(): void {
    const s = this.state;
    const ids = this.targets();
    if (!ids.length) {
      this.set(this.say({ key: 'notice.nothingSelected' }));
      return;
    }
    const cmds: Command[] = [];
    for (const id of ids) {
      const loc = findEvent(s.score, id);
      if (loc?.event.kind !== 'note') continue;
      loc.event.pitches.forEach((_, pitchIndex) =>
        cmds.push(toggleTie({ eventId: id, pitchIndex })),
      );
    }
    const done = this.commit(composite('toggleTie', [], cmds), () =>
      s.focus ? this.sayEvent(s.focus) : {},
    );
    if (done) return;
    if (s.mode === 'note') {
      // Nothing to tie to yet: the next entered note is tied when it has the same pitch.
      this.set({ pendingTie: ids[0]! });
    } else this.set(this.say({ key: 'notice.noTie' }));
  }

  toggleSlur(): void {
    const s = this.state;
    if (s.mode === 'note') {
      if (s.lastEntered) this.set({ pendingSlur: s.pendingSlur ? null : s.lastEntered });
      return;
    }
    const seq = this.seqOfCurrent();
    const picked = seq.filter((i) => s.selection.includes(i.id));
    const notes = picked.filter((i) => i.event.kind === 'note');
    const start = notes[0];
    let end = notes[notes.length - 1];
    if (start && start === end)
      end = seq.slice(seq.indexOf(start) + 1).find((i) => i.event.kind === 'note');
    if (!start || !end || start === end) {
      this.set(this.say({ key: 'notice.slur' }));
      return;
    }
    const existing = s.score.slurs.find(
      (x) => x.startEventId === start.id && x.endEventId === end.id,
    );
    const cmd = existing
      ? removeSlur({ slurId: existing.id })
      : addSlur({ startEventId: start.id, endEventId: end.id });
    this.commit(cmd, () => ({}));
  }

  /** Ctrl+3: turns the selected (or cursor) event into a triplet of the next shorter value. */
  triplet(): void {
    const s = this.state;
    let id: string | undefined;
    if (s.mode === 'select') id = s.focus ?? undefined;
    else {
      const seq = this.seqOfCurrent();
      id = seq[indexAt(seq, s.cursor.measure, s.cursor.tick)]?.id;
    }
    if (!id) {
      this.set(this.say({ key: 'notice.nothingSelected' }));
      return;
    }
    const target = id;
    // Note input: the event under the cursor first takes the current duration (a quarter
    // becomes three eighths), like MuseScore.
    const cmd =
      s.mode === 'note'
        ? composite('triplet', [
            changeDuration({ eventId: target, duration: s.duration }),
            createTriplet({ eventId: target }),
          ])
        : createTriplet({ eventId: target });
    this.commit(cmd, (after) => {
      const loc = findEvent(after, target);
      return {
        ...(loc ? { duration: loc.event.duration } : {}),
        ...(s.mode === 'select' ? { selection: [target], anchor: target, focus: target } : {}),
        ...this.sayEvent(target),
      };
    });
  }

  /** Del: turns the selection (or the last entered note) into rests. */
  deleteSelection(): void {
    const s = this.state;
    const ids = this.targets();
    if (!ids.length) return;
    const pos = s.mode === 'note' ? this.positionOf(s.score, ids[0]!) : null;
    this.commit(
      composite(
        'delete',
        ids.map((eventId) => deleteEvent({ eventId })),
      ),
      () => ({
        ...(pos ? { cursor: { measure: pos.measure, tick: pos.tick }, lastEntered: null } : {}),
        ...this.say({ key: 'notice.deleted' }),
      }),
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Clipboard (internal: nothing is written to the system clipboard)
  // ---------------------------------------------------------------------------------------------

  copy(): void {
    const s = this.state;
    const picked = this.seqOfCurrent().filter((i) => s.selection.includes(i.id));
    if (!picked.length) {
      this.set(this.say({ key: 'notice.nothingSelected' }));
      return;
    }
    if (picked.some((i) => i.inTuplet)) {
      this.set(this.say({ key: 'notice.copyTuplet' }));
      return;
    }
    this.clipboard = picked.map((i): ClipItem =>
      i.event.kind === 'note'
        ? {
            kind: 'note',
            duration: i.event.duration,
            pitches: i.event.pitches.map((p) => ({
              step: p.step,
              alter: p.alter,
              octave: p.octave,
            })),
          }
        : { kind: 'rest', duration: i.event.duration },
    );
    this.set(this.say({ key: 'notice.copied', params: { count: picked.length } }));
  }

  /** Pastes the copied range at the cursor, overwriting what is there; measures are appended as needed. */
  paste(): void {
    const s = this.state;
    if (!this.clipboard.length) {
      this.set(this.say({ key: 'notice.nothingToPaste' }));
      return;
    }
    const seed = newId('v');
    let count = s.score.measures.length;
    let { measure, tick } = s.cursor;
    const required: Command[] = [];
    const ids: string[] = [];
    for (const [i, item] of this.clipboard.entries()) {
      const ticks = durationTicks(item.duration);
      const len = lengthOf(s.score, measure);
      if (tick + ticks > len + EPS) {
        this.set(this.say({ key: 'notice.noFit' }));
        return;
      }
      while (measure >= count) required.push(insertMeasure({ index: count++ }));
      const id = `${seed}.${i}`;
      ids.push(id);
      required.push(
        putEvent({
          staffId: s.staffId,
          measure,
          voice: s.voice,
          tick,
          id,
          event:
            item.kind === 'note'
              ? { kind: 'note', duration: item.duration, pitches: item.pitches }
              : { kind: 'rest', duration: item.duration },
        }),
      );
      tick += ticks;
      if (tick >= len - EPS) {
        measure++;
        tick = 0;
      }
    }
    while (measure >= count) required.push(insertMeasure({ index: count++ }));
    const end = { measure, tick };
    const first = ids[0]!;
    const last = ids[ids.length - 1]!;
    this.commit(composite('paste', required), (after) =>
      s.mode === 'select'
        ? {
            ...this.selectPatch(after, ids, first, last),
            ...this.say({ key: 'notice.pasted', params: { count: ids.length } }),
            cursor: end,
          }
        : { cursor: end, ...this.say({ key: 'notice.pasted', params: { count: ids.length } }) },
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Undo / redo
  // ---------------------------------------------------------------------------------------------

  undo(): void {
    if (!this.history.canUndo) return;
    const before = this.uiUndo.pop();
    const current = this.snapshot();
    const score = this.history.undo();
    if (before) this.uiRedo.push(current);
    this.restore(score, before, 'notice.undone');
  }

  redo(): void {
    if (!this.history.canRedo) return;
    const after = this.uiRedo.pop();
    const current = this.snapshot();
    const score = this.history.redo();
    if (after) this.uiUndo.push(current);
    this.restore(score, after, 'notice.redone');
  }

  private restore(
    score: Score,
    ui: UiSnapshot | undefined,
    key: 'notice.undone' | 'notice.redone',
  ): void {
    const selection = this.liveSelection(score, ui?.selection ?? this.state.selection);
    this.set({
      ...(ui ?? {}),
      score,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      selection,
      anchor: ui?.anchor && selection.includes(ui.anchor) ? ui.anchor : (selection[0] ?? null),
      focus:
        ui?.focus && selection.includes(ui.focus)
          ? ui.focus
          : (selection[selection.length - 1] ?? null),
      lastEntered: ui?.lastEntered && findEvent(score, ui.lastEntered) ? ui.lastEntered : null,
      pendingAlter: null,
      pendingTie: null,
      pendingSlur: null,
      ...this.say({ key }),
    });
  }
}
