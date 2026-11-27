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
  addPart,
  changeInstrument,
  deleteMeasure,
  movePart,
  removePart,
  renamePart,
  setCapo,
  setClef,
  setKeySignature,
  setMeasureLength,
  setStaffLayout,
  setTempo,
  setTimeSignature,
  setTuning,
  staffLayoutOf,
  autoFinger,
  ensureFretting,
  fretboardOf,
  moveToString,
  pitchOfFretting,
  setFretting,
  setTabRests,
  syncCompanionStaff,
  measureLength,
  type Clef,
  type StaffLayout,
  type TimeSignature,
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
  midiToPitch,
  formatChord,
  parseChord,
  removeChord,
  setChord,
  setChordCapoShapes,
  setChordDiagram,
  setChordDiagramMode,
  timeSignatureAt,
  transposeChords,
} from '../../score';
import { diagramPlan } from '../../score/diagrams';
import { beatTicks } from '../../playback/timeline';
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

/** Where the chord symbol text field is open: a position of the first staff of a part. */
export interface ChordEntryPos {
  readonly staffId: string;
  readonly measure: number;
  /** Offset in the measure, in ticks. */
  readonly tick: number;
}

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
  /** TAB staves, note input: string (1 = highest) the next fret typed goes on. */
  readonly tabString: number;
  /** The chord symbol text field is open here (docs/editor.md, "Chord symbols"). */
  readonly chordEntry: ChordEntryPos | null;
  readonly announcement: Announcement | null;
}

/** Two digits typed within this time make one fret (1 then 2 = fret 12). */
export const FRET_CHORD_MS = 500;

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
    case 'last-part':
      return { key: 'notice.lastPart' };
    case 'not-empty':
      return { key: 'notice.notEmpty' };
    case 'last-measure':
      return { key: 'notice.lastMeasure' };
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
  /** Last fret typed on a tab: a second digit within `FRET_CHORD_MS` completes it. */
  private fretBuffer: { eventId: string; string: number; fret: number; at: number } | null = null;
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
      tabString: 1,
      chordEntry: null,
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
      after = this.history.execute(this.withCompanionSync(before, cmd));
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

  /**
   * A "standard + TAB" part keeps its second staff in step: after any edit the other staff of the
   * edited part is rebuilt from the one being edited, in the same undo step.
   */
  private withCompanionSync(before: Score, cmd: Command): Command {
    if (!before.parts.some((p) => p.staves.some((s) => s.type === 'tab'))) return cmd;
    const staffId = this.state.staffId;
    const follow: Command[] = [];
    if (before.parts.some((p) => staffLayoutOf(p) === 'standard+tab')) {
      follow.push(syncCompanionStaff({ staffId }));
    }
    // Every note of a tab staff stays fretted (notes entered, transposed or re-spelled).
    follow.push(ensureFretting({ staffId }));
    return composite(cmd.name, [cmd], follow);
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
    // On a TAB staff the digits are frets; the durations move to Shift+3..7 (`tabDurationKey`).
    if (this.onTab() && this.fretKey(digit)) return;
    this.tabDurationKey(digit);
  }

  /** Shift+digit (works everywhere, the way to pick a duration on a TAB staff). */
  tabDurationKey(digit: string): void {
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

  /**
   * A key of the on-screen piano or a MIDI note (docs/editor.md). The spelling follows the key
   * signature: sharps in sharp keys, flats in flat keys, natural notes of the key as written.
   * Note input: enters the note at the current duration; `chord` adds it to the note just entered.
   * Select mode: moves the selected notes to it (`chord`: adds it to them). With nothing to change
   * the note is only played.
   */
  enterMidi(midi: number, chord = false): void {
    const s = this.state;
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) return;
    if (s.mode === 'note') {
      const last = chord && s.lastEntered ? findEvent(s.score, s.lastEntered) : undefined;
      if (last?.event.kind === 'note' && s.lastEntered) {
        const pitch = midiToPitch(midi, keyFifthsAt(s.score, last.measure));
        const id = s.lastEntered;
        const ok = this.commit(addPitch({ eventId: id, pitch }), () => ({
          lastPitch: pitch,
          pendingAlter: null,
          ...this.sayEvent(id),
        }));
        if (ok) this.onNoteEntered?.(pitch);
        return;
      }
      if (!findStaff(s.score, s.staffId)) return;
      this.place(midiToPitch(midi, keyFifthsAt(s.score, s.cursor.measure)), {
        staffId: s.staffId,
        ...s.cursor,
      });
      return;
    }
    const cmds: Command[] = [];
    let heard: Pitch | undefined;
    for (const id of s.selection) {
      const loc = findEvent(s.score, id);
      if (loc?.event.kind !== 'note') continue;
      const pitch = midiToPitch(midi, keyFifthsAt(s.score, loc.measure));
      heard = pitch;
      cmds.push(chord ? addPitch({ eventId: id, pitch }) : setPitch({ eventId: id, pitch }));
    }
    if (!cmds.length) {
      this.onNoteEntered?.(midiToPitch(midi, keyFifthsAt(s.score, s.cursor.measure)));
      return;
    }
    const ids = s.selection;
    const ok = this.commit(composite(chord ? 'addPitch' : 'setPitch', cmds), (after) => ({
      selection: this.liveSelection(after, ids),
      pendingAlter: null,
      ...(s.focus ? this.sayEvent(s.focus) : {}),
    }));
    if (ok && heard) this.onNoteEntered?.(heard);
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
    // `0` is the open string on a TAB staff; the rest is Shift+0 there (`enterTabRest`).
    if (this.onTab() && this.fretKey('0')) return;
    this.enterTabRest();
  }

  enterTabRest(): void {
    const s = this.state;
    if (s.mode === 'select') {
      this.deleteSelection();
      return;
    }
    this.place(null, { staffId: s.staffId, ...s.cursor });
  }

  private place(
    pitch: Pitch | null,
    at: { staffId: string; measure: number; tick: number },
    fretting?: { string: number; fret: number },
  ): boolean {
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
      // Typed on a TAB staff: the string and fret are the user's choice.
      if (pitch && fretting) required.push(setFretting({ eventId: ids[i]!, ...fretting }));
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
    return ok;
  }

  // ---------------------------------------------------------------------------------------------
  // Tablature (see docs/editor.md, "Tablature entry")
  // ---------------------------------------------------------------------------------------------

  /** Is the staff being edited a TAB staff? */
  onTab(): boolean {
    const loc = findStaff(this.state.score, this.state.staffId);
    return !!loc && this.state.score.parts[loc.partIndex]!.staves[loc.staffIndex]!.type === 'tab';
  }

  private tabBoard() {
    const loc = findStaff(this.state.score, this.state.staffId);
    return loc ? fretboardOf(this.state.score.parts[loc.partIndex]!) : undefined;
  }

  /** `↑`/`↓` on a TAB staff in note input: the string the next fret goes on (`up` = first, highest string). */
  moveString(direction: 'up' | 'down'): boolean {
    const board = this.tabBoard();
    if (!board) return false;
    const next = Math.min(
      board.open.length,
      Math.max(1, this.state.tabString + (direction === 'up' ? -1 : 1)),
    );
    this.set({
      tabString: next,
      ...this.say({ key: 'notice.tabString', params: { string: next } }),
    });
    return true;
  }

  /** Mouse: the string under a click on a TAB staff becomes the input string. */
  setTabString(string: number): void {
    const board = this.tabBoard();
    if (!board || string < 1 || string > board.open.length) return;
    this.set({ tabString: string });
  }

  /**
   * A digit on a TAB staff is a fret. Note input: writes a note on the current string (a second digit
   * within 500 ms makes it a two-digit fret: 1 then 2 = 12). Select mode: sets the fret of the
   * selected note on its string. Returns false when the digit cannot be used (not on a TAB staff).
   */
  fretKey(digit: string, now: number = Date.now()): boolean {
    if (!this.onTab()) return false;
    const board = this.tabBoard();
    if (!board) return false;
    const d = Number(digit);
    if (!Number.isInteger(d) || d < 0 || d > 9) return false;
    const s = this.state;

    if (s.mode === 'select') {
      const id = s.focus;
      const loc = id ? findEvent(s.score, id) : undefined;
      if (!id || loc?.event.kind !== 'note') {
        this.set(this.say({ key: 'notice.nothingSelected' }));
        return true;
      }
      const pitchIndex = Math.max(
        0,
        loc.event.pitches.findIndex((p) => p.fretting?.string === s.tabString),
      );
      const string = loc.event.pitches[pitchIndex]!.fretting?.string ?? s.tabString;
      const prev = this.fretBuffer;
      const combined =
        prev &&
        prev.eventId === id &&
        now - prev.at <= FRET_CHORD_MS &&
        prev.fret * 10 + d <= board.frets
          ? prev.fret * 10 + d
          : d;
      this.applyFret(id, pitchIndex, string, combined, now);
      return true;
    }

    // Note input.
    const prev = this.fretBuffer;
    if (
      prev &&
      s.lastEntered === prev.eventId &&
      now - prev.at <= FRET_CHORD_MS &&
      prev.fret >= 1 &&
      prev.fret * 10 + d <= board.frets
    ) {
      this.applyFret(prev.eventId, 0, prev.string, prev.fret * 10 + d, now);
      return true;
    }
    const at = { staffId: s.staffId, ...s.cursor };
    const pitch = pitchOfFretting(s.score, at.staffId, at.measure, s.tabString, d);
    if (!pitch) {
      this.set(this.say({ key: 'notice.fretRange' }));
      return true;
    }
    const piecesBefore = this.state.score;
    const ok = this.place(pitch, at, { string: s.tabString, fret: d });
    if (ok && this.state.lastEntered && this.state.score !== piecesBefore) {
      const id = this.state.lastEntered;
      // A note split over a barline is several tied events: only a lone one can take a second digit.
      const single = !id.includes('.');
      this.fretBuffer = single ? { eventId: id, string: s.tabString, fret: d, at: now } : null;
    }
    return true;
  }

  private applyFret(
    eventId: string,
    pitchIndex: number,
    string: number,
    fret: number,
    now: number,
  ): void {
    const s = this.state;
    const ok = this.commit(setFretting({ eventId, pitchIndex, string, fret }), (after) => {
      const loc = findEvent(after, eventId);
      const p = loc?.event.kind === 'note' ? loc.event.pitches[pitchIndex] : undefined;
      return {
        ...(p ? { lastPitch: { step: p.step, alter: p.alter, octave: p.octave } } : {}),
        ...this.sayEvent(eventId),
      };
    });
    if (!ok) {
      if (this.state.announcement === s.announcement)
        this.set(this.say({ key: 'notice.fretRange' }));
      return;
    }
    this.fretBuffer = { eventId, string, fret, at: now };
    const loc = findEvent(this.state.score, eventId);
    const p = loc?.event.kind === 'note' ? loc.event.pitches[pitchIndex] : undefined;
    if (p) this.onNoteEntered?.({ step: p.step, alter: p.alter, octave: p.octave });
  }

  /** `Alt+↑`/`Alt+↓`: moves the selected (or last entered) note to the adjacent string, same pitch. */
  refret(direction: 'up' | 'down'): boolean {
    const s = this.state;
    if (!this.onTab()) {
      this.set(this.say({ key: 'notice.tabOnly' }));
      return false;
    }
    const ids = this.targets();
    if (!ids.length) {
      this.set(this.say({ key: 'notice.nothingSelected' }));
      return false;
    }
    const cmds: Command[] = [];
    for (const id of ids) {
      const loc = findEvent(s.score, id);
      if (loc?.event.kind !== 'note') continue;
      const k = loc.event.pitches.findIndex((p) => p.fretting?.string === s.tabString);
      cmds.push(moveToString({ eventId: id, pitchIndex: Math.max(0, k), direction }));
    }
    if (!cmds.length) return false;
    try {
      for (const cmd of cmds) cmd.apply(s.score);
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
      this.set(this.say({ key: 'notice.noOtherString' }));
      return false;
    }
    return this.commit(composite('moveToString', cmds), () => ({
      ...(ids[0] ? this.sayEvent(ids[0]) : {}),
    }));
  }

  /** Hands the selected notes (or the last entered one) back to automatic fingering. */
  autoFinger(): boolean {
    const ids = this.targets();
    if (!ids.length) {
      this.set(this.say({ key: 'notice.nothingSelected' }));
      return false;
    }
    return this.commit(autoFinger({ eventIds: ids }), () => ({
      ...this.say({ key: 'notice.autoFingered' }),
    }));
  }

  /** Shows or hides the rests of the TAB staff being edited. */
  toggleTabRests(): boolean {
    const loc = findStaff(this.state.score, this.state.staffId);
    if (!loc || !this.onTab()) {
      this.set(this.say({ key: 'notice.tabOnly' }));
      return false;
    }
    const staff = this.state.score.parts[loc.partIndex]!.staves[loc.staffIndex]!;
    return this.setTabRests(staff.id, !staff.showRests);
  }

  /** Shows or hides the rests of a TAB staff (hidden by default). */
  setTabRests(staffId: string, show: boolean): boolean {
    return this.commit(setTabRests({ staffId, show }), () =>
      this.say({ key: show ? 'notice.tabRestsShown' : 'notice.tabRestsHidden' }),
    );
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
    if (hit.chord) {
      this.openChordEntry({
        staffId: hit.staffId,
        measure: hit.measureIndex,
        tick: hit.chord.tick,
      });
      return;
    }
    if (s.chordEntry) this.set({ chordEntry: null });
    if (s.mode === 'note') {
      if (hit.tick === undefined) return;
      const at = { staffId: hit.staffId, measure: hit.measureIndex, tick: hit.tick };
      if (hit.pitch) this.enterAt({ step: hit.pitch.step, octave: hit.pitch.octave }, at);
      else
        this.set({
          staffId: at.staffId,
          cursor: { measure: at.measure, tick: at.tick },
          lastEntered: null,
          ...(hit.string ? { tabString: hit.string } : {}),
        });
      return;
    }
    if (hit.eventId) {
      this.clickEvent(hit.eventId, extend);
      if (hit.string) this.setTabString(hit.string);
      return;
    }
    this.set({
      selection: [],
      anchor: null,
      focus: null,
      staffId: hit.staffId,
      cursor: { measure: hit.measureIndex, tick: hit.tick ?? 0 },
      ...(hit.string ? { tabString: hit.string } : {}),
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

  /** Arrow up/down: the string cursor on a TAB staff in note input, a semitone otherwise. */
  arrow(direction: 'up' | 'down'): boolean {
    if (this.state.mode === 'note' && this.onTab()) return this.moveString(direction);
    return this.shiftPitch(direction === 'up' ? 1 : -1);
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
  // Structure: measures, attributes, parts (every one is a score command, so undo is exact)
  // ---------------------------------------------------------------------------------------------

  /** Keeps staff, cursor and selection valid after a structural edit. */
  private keepValid(after: Score): Partial<EditorState> {
    const s = this.state;
    let staffId = s.staffId;
    if (!findStaff(after, staffId)) {
      const old = findStaff(s.score, staffId);
      const part = after.parts[Math.min(old?.partIndex ?? 0, after.parts.length - 1)]!;
      staffId = part.staves[Math.min(old?.staffIndex ?? 0, part.staves.length - 1)]!.id;
    }
    const measure = Math.min(s.cursor.measure, after.measures.length - 1);
    const tick =
      measure === s.cursor.measure && s.cursor.tick < measureLength(after, measure)
        ? s.cursor.tick
        : 0;
    const selection = this.liveSelection(after, s.selection);
    return {
      staffId,
      cursor: { measure, tick },
      selection,
      anchor: s.anchor && selection.includes(s.anchor) ? s.anchor : (selection[0] ?? null),
      focus:
        s.focus && selection.includes(s.focus)
          ? s.focus
          : (selection[selection.length - 1] ?? null),
      lastEntered: s.lastEntered && findEvent(after, s.lastEntered) ? s.lastEntered : null,
      pendingTie: null,
      pendingSlur: null,
    };
  }

  private structure(cmd: Command, notice: Notice, patch?: Partial<EditorState>): boolean {
    return this.commit(cmd, (after) => ({
      ...this.keepValid(after),
      ...patch,
      ...this.say(notice),
    }));
  }

  /** Inserts an empty measure before the cursor measure, after it, or at the end; the cursor moves onto it. */
  insertMeasure(where: 'before' | 'after' | 'end'): boolean {
    const m = this.state.cursor.measure;
    const index =
      where === 'before' ? m : where === 'after' ? m + 1 : this.state.score.measures.length;
    return this.structure(
      insertMeasure({ index }),
      { key: 'notice.measureInserted' },
      {
        cursor: { measure: index, tick: 0 },
      },
    );
  }

  /** Deletes the measure of the cursor (all staves). */
  deleteMeasure(): boolean {
    return this.structure(deleteMeasure({ index: this.state.cursor.measure }), {
      key: 'notice.measureDeleted',
    });
  }

  setKeySignature(fifths: number): boolean {
    return this.structure(setKeySignature({ measure: this.state.cursor.measure, fifths }), {
      key: 'notice.keySet',
      params: { measure: this.state.cursor.measure + 1 },
    });
  }

  setTimeSignature(time: TimeSignature): boolean {
    return this.structure(setTimeSignature({ measure: this.state.cursor.measure, time }), {
      key: 'notice.timeSet',
      params: { time: `${time.beats}/${time.beatType}`, measure: this.state.cursor.measure + 1 },
    });
  }

  /** Pickup / shortened measure at the cursor: length in ticks, or null for the full length. */
  setMeasureLength(length: number | null): boolean {
    return this.structure(setMeasureLength({ measure: this.state.cursor.measure, length }), {
      key: 'notice.lengthSet',
      params: { measure: this.state.cursor.measure + 1 },
    });
  }

  /** Tempo change at the cursor measure; `null` removes it. */
  setTempo(bpm: number | null): boolean {
    const measure = this.state.cursor.measure;
    return this.structure(
      setTempo({ measure, bpm }),
      bpm === null
        ? { key: 'notice.tempoCleared', params: { measure: measure + 1 } }
        : { key: 'notice.tempoSet', params: { bpm, measure: measure + 1 } },
    );
  }

  /** Clef change at the cursor measure, on the staff being edited (measure 1 sets the initial clef). */
  setClef(clef: Clef): boolean {
    const { staffId, cursor } = this.state;
    return this.structure(setClef({ staffId, measure: cursor.measure, clef }), {
      key: 'notice.clefSet',
      params: { measure: cursor.measure + 1 },
    });
  }

  addPart(instrument: string, opts: { name?: string; layout?: StaffLayout } = {}): boolean {
    const index = this.state.score.parts.length;
    if (!this.structure(addPart({ instrument, ...opts }), { key: 'notice.partAdded' }))
      return false;
    this.focusPart(index);
    return true;
  }

  /** Makes the first staff of a part the one being edited. */
  focusPart(partIndex: number): void {
    const part = this.state.score.parts[partIndex];
    if (!part) return;
    // The selection goes: note input starts where the focus is, and the focus is now this part.
    this.set({ staffId: part.staves[0]!.id, selection: [], anchor: null, focus: null });
  }

  removePart(partId: string): boolean {
    return this.structure(removePart({ partId }), { key: 'notice.partRemoved' });
  }

  movePart(partId: string, toIndex: number): boolean {
    const ok = this.structure(movePart({ partId, toIndex }), { key: 'notice.partMoved' });
    return ok;
  }

  renamePart(partId: string, name: string): boolean {
    return this.structure(renamePart({ partId, name }), { key: 'notice.partRenamed' });
  }

  changeInstrument(partId: string, instrument: string, name?: string): boolean {
    return this.structure(changeInstrument({ partId, instrument, ...(name ? { name } : {}) }), {
      key: 'notice.instrumentChanged',
    });
  }

  setStaffLayout(partId: string, layout: StaffLayout): boolean {
    return this.structure(setStaffLayout({ partId, layout }), { key: 'notice.layoutSet' });
  }

  setTuning(partId: string, tuning: readonly Pitch[] | null): boolean {
    return this.structure(setTuning({ partId, tuning }), { key: 'notice.tuningSet' });
  }

  setCapo(partId: string, capo: number): boolean {
    return this.structure(
      setCapo({ partId, capo }),
      capo === 0 ? { key: 'notice.capoOff' } : { key: 'notice.capoSet', params: { fret: capo } },
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Chord symbols
  // ---------------------------------------------------------------------------------------------

  /** The staff that carries the chord symbols of the part holding `staffId`: its first staff. */
  private chordStaffOf(staffId: string): string {
    const part = this.state.score.parts.find((p) => p.staves.some((st) => st.id === staffId));
    return part ? part.staves[0]!.id : staffId;
  }

  private chordAtPos(pos: ChordEntryPos) {
    const loc = findStaff(this.state.score, pos.staffId);
    if (!loc) return undefined;
    const sm = this.state.score.parts[loc.partIndex]!.staves[loc.staffIndex]!.measures[pos.measure];
    return sm?.chords?.find((c) => c.tick === pos.tick);
  }

  /** The chord symbol at a position of the entry staff, as text (the text field shows it). */
  chordTextAt(pos: ChordEntryPos): string {
    const c = this.chordAtPos(pos);
    return c ? formatChord(c) : '';
  }

  /**
   * Opens the chord symbol text field at the cursor (or at `at`): the staff of the cursor, its
   * measure, the nearest tick the measure holds. An existing symbol is edited.
   */
  openChordEntry(at?: ChordEntryPos): boolean {
    const s = this.state;
    const staffId = this.chordStaffOf(at?.staffId ?? s.staffId);
    const measure = Math.min(at?.measure ?? s.cursor.measure, s.score.measures.length - 1);
    const length = measureLength(s.score, measure);
    const wanted = Math.round(at?.tick ?? s.cursor.tick);
    const tick = Math.max(0, Math.min(wanted, length - 1));
    this.set({ chordEntry: { staffId, measure, tick } });
    return true;
  }

  closeChordEntry(): void {
    if (this.state.chordEntry) this.set({ chordEntry: null });
  }

  /**
   * Writes the text of the open field: a chord symbol (any spelling the parser accepts) sets or
   * replaces the symbol, an empty text removes it. Returns false, with a notice, for a text that is
   * not a chord symbol (the field stays open).
   */
  commitChord(text: string): boolean {
    const pos = this.state.chordEntry;
    if (!pos) return false;
    const trimmed = text.trim();
    const existing = this.chordAtPos(pos);
    if (trimmed === '') {
      if (!existing) return true;
      this.commit(removeChord(pos), () => this.say({ key: 'notice.chordRemoved' }));
      return true;
    }
    const chord = parseChord(trimmed);
    if (!chord) {
      this.set(this.say({ key: 'notice.chordInvalid', params: { text: trimmed } }));
      return false;
    }
    this.commit(setChord({ ...pos, chord }), () => ({
      cursor: { measure: pos.measure, tick: pos.tick },
      ...this.say({ key: 'notice.chordSet', params: { chord: formatChord(chord) } }),
    }));
    return true;
  }

  /**
   * Moves the open field to the next or previous beat (Space), or measure (Tab). A beat is the
   * time signature's beat (a dotted quarter in 6/8). Stays put at the start or the end of the score.
   */
  moveChordEntry(unit: 'beat' | 'measure', direction: 1 | -1): boolean {
    const s = this.state;
    const pos = s.chordEntry;
    if (!pos) return false;
    const count = s.score.measures.length;
    let { measure, tick } = pos;
    if (unit === 'measure') measure += direction;
    else {
      const time = timeSignatureAt(s.score, measure);
      const beat = beatTicks(time.beats, time.beatType);
      const length = measureLength(s.score, measure);
      if (direction === 1) {
        tick = (Math.floor(tick / beat) + 1) * beat;
        if (tick >= length) {
          measure += 1;
          tick = 0;
        }
      } else if (tick % beat > 0) tick = Math.floor(tick / beat) * beat;
      else if (tick - beat >= 0) tick -= beat;
      else {
        measure -= 1;
        if (measure >= 0) {
          const prev = timeSignatureAt(s.score, measure);
          const unitTicks = beatTicks(prev.beats, prev.beatType);
          tick = Math.floor((measureLength(s.score, measure) - 1) / unitTicks) * unitTicks;
        }
      }
    }
    if (measure < 0 || measure >= count) return false;
    if (unit === 'measure') tick = 0;
    this.set({
      chordEntry: { staffId: pos.staffId, measure, tick },
      cursor: { measure, tick },
    });
    return true;
  }

  /** Removes the chord symbol at the cursor. */
  deleteChordAtCursor(): boolean {
    const s = this.state;
    const pos: ChordEntryPos = {
      staffId: this.chordStaffOf(s.staffId),
      measure: s.cursor.measure,
      tick: Math.round(s.cursor.tick),
    };
    if (!this.chordAtPos(pos)) {
      this.set(this.say({ key: 'notice.chordNone' }));
      return false;
    }
    return this.commit(removeChord(pos), () => this.say({ key: 'notice.chordRemoved' }));
  }

  /**
   * Transposes every chord symbol of the part being edited by semitones, spelled for the key
   * signature of each measure. The notes are not touched (chord symbols name concert pitches).
   */
  transposeChords(semitones: number): boolean {
    const s = this.state;
    const part = s.score.parts.find((p) => p.staves.some((st) => st.id === s.staffId));
    if (!part) return false;
    const ok = this.commit(
      transposeChords({ semitones, staffIds: part.staves.map((st) => st.id) }),
      () => this.say({ key: 'notice.chordTransposed', params: { semitones } }),
    );
    if (!ok) this.set(this.say({ key: 'notice.chordNone' }));
    return ok;
  }

  /** Shows or hides the diagram of the chord symbol at the cursor, whatever the part's mode says. */
  toggleChordDiagram(): boolean {
    const s = this.state;
    const pos: ChordEntryPos = {
      staffId: this.chordStaffOf(s.staffId),
      measure: s.cursor.measure,
      tick: Math.round(s.cursor.tick),
    };
    const chord = this.chordAtPos(pos);
    if (!chord) {
      this.set(this.say({ key: 'notice.chordNone' }));
      return false;
    }
    const shown = diagramPlan(s.score).has(chord.id);
    return this.commit(setChordDiagram({ ...pos, diagram: !shown }), () =>
      this.say({
        key: shown ? 'notice.chordDiagramOff' : 'notice.chordDiagramOn',
        params: { chord: formatChord(chord) },
      }),
    );
  }

  setChordDiagramMode(partId: string, mode: 'first' | 'all' | null): boolean {
    return this.commit(setChordDiagramMode({ partId, mode }), () => ({}));
  }

  setChordCapoShapes(partId: string, on: boolean): boolean {
    return this.commit(setChordCapoShapes({ partId, on }), () => ({}));
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
      chordEntry: null,
      ...this.say({ key }),
    });
  }
}
