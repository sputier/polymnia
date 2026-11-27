/**
 * Note-entry key map (MuseScore defaults, see docs/editor.md). Declared once as data; the editor
 * registers it in the shortcut registry and the palette reads the labels from it.
 */
import type { MessageKey } from '../../i18n/en';
import type { StepName } from '../../score';
import type { Shortcut } from '../../shortcuts/registry';
import type { EditorStore } from './editorStore';

interface Spec {
  readonly id: string;
  readonly keys: string;
  readonly labelKey: MessageKey;
  readonly run: (store: EditorStore) => boolean | void;
}

const STEPS: readonly StepName[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

const specs: Spec[] = [
  {
    id: 'entry.toggleInput',
    keys: 'N',
    labelKey: 'shortcut.toggleInput',
    run: (s) => s.toggleInputMode(),
  },
  // 1, 2, 8 and 9 are reserved (32nd, 64th...): they only explain that, politely.
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit): Spec => ({
    id: `entry.duration.${digit}`,
    keys: digit,
    labelKey: 'shortcut.duration',
    run: (s) => s.durationKey(digit),
  })),
  { id: 'entry.dot', keys: 'Period', labelKey: 'shortcut.dot', run: (s) => s.toggleDot() },
  { id: 'entry.rest', keys: '0', labelKey: 'shortcut.rest', run: (s) => s.enterRest() },
  ...STEPS.map((step): Spec => ({
    id: `entry.note.${step}`,
    keys: step,
    labelKey: 'shortcut.enterNote',
    run: (s) => s.enterStep(step),
  })),
  ...STEPS.map((step): Spec => ({
    id: `entry.chord.${step}`,
    keys: `Shift+${step}`,
    labelKey: 'shortcut.addToChord',
    run: (s) => s.enterStep(step, true),
  })),
  { id: 'entry.sharp', keys: 'Plus', labelKey: 'shortcut.sharp', run: (s) => s.accidental(1) },
  { id: 'entry.flat', keys: 'Minus', labelKey: 'shortcut.flat', run: (s) => s.accidental(-1) },
  { id: 'entry.natural', keys: 'Equal', labelKey: 'shortcut.natural', run: (s) => s.accidental(0) },
  {
    id: 'entry.pitchUp',
    keys: 'ArrowUp',
    labelKey: 'shortcut.pitchUp',
    run: (s) => s.shiftPitch(1),
  },
  {
    id: 'entry.pitchDown',
    keys: 'ArrowDown',
    labelKey: 'shortcut.pitchDown',
    run: (s) => s.shiftPitch(-1),
  },
  {
    id: 'entry.octaveUp',
    keys: 'Mod+ArrowUp',
    labelKey: 'shortcut.octaveUp',
    run: (s) => s.shiftPitch(12),
  },
  {
    id: 'entry.octaveDown',
    keys: 'Mod+ArrowDown',
    labelKey: 'shortcut.octaveDown',
    run: (s) => s.shiftPitch(-12),
  },
  { id: 'entry.tie', keys: 'T', labelKey: 'shortcut.tie', run: (s) => s.toggleTie() },
  { id: 'entry.slur', keys: 'S', labelKey: 'shortcut.slur', run: (s) => s.toggleSlur() },
  { id: 'entry.triplet', keys: 'Mod+3', labelKey: 'shortcut.triplet', run: (s) => s.triplet() },
  {
    id: 'entry.moveLeft',
    keys: 'ArrowLeft',
    labelKey: 'shortcut.moveLeft',
    run: (s) => s.move(-1),
  },
  {
    id: 'entry.moveRight',
    keys: 'ArrowRight',
    labelKey: 'shortcut.moveRight',
    run: (s) => s.move(1),
  },
  {
    id: 'entry.extendLeft',
    keys: 'Shift+ArrowLeft',
    labelKey: 'shortcut.extendLeft',
    run: (s) => s.move(-1, true),
  },
  {
    id: 'entry.extendRight',
    keys: 'Shift+ArrowRight',
    labelKey: 'shortcut.extendRight',
    run: (s) => s.move(1, true),
  },
  {
    id: 'entry.delete',
    keys: 'Delete',
    labelKey: 'shortcut.delete',
    run: (s) => s.deleteSelection(),
  },
  {
    id: 'entry.backspace',
    keys: 'Backspace',
    labelKey: 'shortcut.delete',
    run: (s) => s.deleteSelection(),
  },
  { id: 'entry.undo', keys: 'Mod+Z', labelKey: 'shortcut.undo', run: (s) => s.undo() },
  { id: 'entry.redo', keys: 'Mod+Y', labelKey: 'shortcut.redo', run: (s) => s.redo() },
  { id: 'entry.redoShift', keys: 'Mod+Shift+Z', labelKey: 'shortcut.redo', run: (s) => s.redo() },
  { id: 'entry.copy', keys: 'Mod+C', labelKey: 'shortcut.copy', run: (s) => s.copy() },
  { id: 'entry.paste', keys: 'Mod+V', labelKey: 'shortcut.paste', run: (s) => s.paste() },
];

/** Key combo of a shortcut id (for tooltips and the palette). */
export function keysOf(id: string): string {
  const spec = specs.find((s) => s.id === id);
  if (!spec) throw new Error(`Unknown entry shortcut: ${id}`);
  return spec.keys;
}

export const DURATION_SHORTCUT = {
  '16th': 'entry.duration.3',
  eighth: 'entry.duration.4',
  quarter: 'entry.duration.5',
  half: 'entry.duration.6',
  whole: 'entry.duration.7',
} as const;

/** The whole key map as registry entries bound to a store. */
export function entryShortcuts(store: EditorStore): Shortcut[] {
  return specs.map((spec) => ({
    id: spec.id,
    keys: spec.keys,
    labelKey: spec.labelKey,
    handler: () => {
      // Arrow keys fall back to scrolling when there is nothing to move.
      return spec.run(store) === false ? false : undefined;
    },
  }));
}
