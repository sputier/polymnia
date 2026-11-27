/**
 * Note-entry key map (MuseScore defaults, see docs/editor.md). Declared once as data; the editor
 * registers it in the shortcut registry and the palette reads the labels from it.
 */
import type { MessageKey } from '../../i18n/en';
import type { StepName } from '../../score';
import type { CommandGroup, Shortcut } from '../../shortcuts/registry';
import type { EditorStore } from './editorStore';

interface Spec {
  readonly id: string;
  readonly keys: string;
  readonly labelKey: MessageKey;
  readonly group: CommandGroup;
  /** Palette label when several keys share `labelKey` (see `Shortcut.paletteLabelKey`). */
  readonly paletteLabelKey?: MessageKey;
  /** Hidden from the command palette (per-letter variants, reserved keys). */
  readonly palette?: false;
  /** Hidden from the cheat sheet. */
  readonly sheet?: false;
  /** Where the command does something; the palette shows it disabled otherwise. */
  readonly enabled?: (store: EditorStore) => boolean;
  readonly run: (store: EditorStore) => boolean | void;
}

const STEPS: readonly StepName[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

const hasTarget = (s: EditorStore) =>
  s.getState().mode === 'note' || s.getState().selection.length > 0;
const hasSelection = (s: EditorStore) => s.getState().selection.length > 0;

const DURATION_LABEL: Record<string, MessageKey> = {
  '3': 'command.duration16th',
  '4': 'command.durationEighth',
  '5': 'command.durationQuarter',
  '6': 'command.durationHalf',
  '7': 'command.durationWhole',
};

const specs: Spec[] = [
  {
    id: 'entry.toggleInput',
    keys: 'N',
    labelKey: 'shortcut.toggleInput',
    group: 'input',
    run: (s) => s.toggleInputMode(),
  },
  // 1, 2, 8 and 9 are reserved (32nd, 64th...): they only explain that, politely.
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit): Spec => {
    const label = DURATION_LABEL[digit];
    return {
      id: `entry.duration.${digit}`,
      keys: digit,
      labelKey: 'shortcut.duration',
      group: 'input',
      ...(label ? { paletteLabelKey: label } : { palette: false as const, sheet: false as const }),
      run: (s) => s.durationKey(digit),
    };
  }),
  {
    id: 'entry.dot',
    keys: 'Period',
    labelKey: 'shortcut.dot',
    group: 'input',
    run: (s) => s.toggleDot(),
  },
  {
    id: 'entry.rest',
    keys: '0',
    labelKey: 'shortcut.rest',
    group: 'input',
    run: (s) => s.enterRest(),
  },
  // One row ("A to G") in the cheat sheet, and not 14 palette commands: the letter is the command.
  ...STEPS.map((step): Spec => ({
    id: `entry.note.${step}`,
    keys: step,
    labelKey: 'shortcut.enterNote',
    group: 'input',
    palette: false,
    run: (s) => s.enterStep(step),
  })),
  ...STEPS.map((step): Spec => ({
    id: `entry.chord.${step}`,
    keys: `Shift+${step}`,
    labelKey: 'shortcut.addToChord',
    group: 'input',
    palette: false,
    run: (s) => s.enterStep(step, true),
  })),
  {
    id: 'entry.sharp',
    keys: 'Plus',
    labelKey: 'shortcut.sharp',
    group: 'input',
    run: (s) => s.accidental(1),
  },
  {
    id: 'entry.flat',
    keys: 'Minus',
    labelKey: 'shortcut.flat',
    group: 'input',
    run: (s) => s.accidental(-1),
  },
  {
    id: 'entry.natural',
    keys: 'Equal',
    labelKey: 'shortcut.natural',
    group: 'input',
    run: (s) => s.accidental(0),
  },
  {
    id: 'entry.pitchUp',
    keys: 'ArrowUp',
    labelKey: 'shortcut.pitchUp',
    group: 'edit',
    enabled: hasTarget,
    run: (s) => s.shiftPitch(1),
  },
  {
    id: 'entry.pitchDown',
    keys: 'ArrowDown',
    labelKey: 'shortcut.pitchDown',
    group: 'edit',
    enabled: hasTarget,
    run: (s) => s.shiftPitch(-1),
  },
  {
    id: 'entry.octaveUp',
    keys: 'Mod+ArrowUp',
    labelKey: 'shortcut.octaveUp',
    group: 'edit',
    enabled: hasTarget,
    run: (s) => s.shiftPitch(12),
  },
  {
    id: 'entry.octaveDown',
    keys: 'Mod+ArrowDown',
    labelKey: 'shortcut.octaveDown',
    group: 'edit',
    enabled: hasTarget,
    run: (s) => s.shiftPitch(-12),
  },
  {
    id: 'entry.tie',
    keys: 'T',
    labelKey: 'shortcut.tie',
    group: 'input',
    enabled: hasTarget,
    run: (s) => s.toggleTie(),
  },
  {
    id: 'entry.slur',
    keys: 'S',
    labelKey: 'shortcut.slur',
    group: 'input',
    enabled: hasTarget,
    run: (s) => s.toggleSlur(),
  },
  {
    id: 'entry.triplet',
    keys: 'Mod+3',
    labelKey: 'shortcut.triplet',
    group: 'input',
    enabled: hasTarget,
    run: (s) => s.triplet(),
  },
  {
    id: 'entry.moveLeft',
    keys: 'ArrowLeft',
    labelKey: 'shortcut.moveLeft',
    group: 'navigation',
    run: (s) => s.move(-1),
  },
  {
    id: 'entry.moveRight',
    keys: 'ArrowRight',
    labelKey: 'shortcut.moveRight',
    group: 'navigation',
    run: (s) => s.move(1),
  },
  {
    id: 'entry.extendLeft',
    keys: 'Shift+ArrowLeft',
    labelKey: 'shortcut.extendLeft',
    group: 'navigation',
    run: (s) => s.move(-1, true),
  },
  {
    id: 'entry.extendRight',
    keys: 'Shift+ArrowRight',
    labelKey: 'shortcut.extendRight',
    group: 'navigation',
    run: (s) => s.move(1, true),
  },
  {
    id: 'entry.delete',
    keys: 'Delete',
    labelKey: 'shortcut.delete',
    group: 'edit',
    enabled: hasSelection,
    run: (s) => s.deleteSelection(),
  },
  {
    id: 'entry.backspace',
    keys: 'Backspace',
    labelKey: 'shortcut.delete',
    group: 'edit',
    enabled: hasSelection,
    run: (s) => s.deleteSelection(),
  },
  {
    id: 'entry.undo',
    keys: 'Mod+Z',
    labelKey: 'shortcut.undo',
    group: 'edit',
    enabled: (s) => s.getState().canUndo,
    run: (s) => s.undo(),
  },
  {
    id: 'entry.redo',
    keys: 'Mod+Y',
    labelKey: 'shortcut.redo',
    group: 'edit',
    enabled: (s) => s.getState().canRedo,
    run: (s) => s.redo(),
  },
  {
    id: 'entry.redoShift',
    keys: 'Mod+Shift+Z',
    labelKey: 'shortcut.redo',
    group: 'edit',
    enabled: (s) => s.getState().canRedo,
    run: (s) => s.redo(),
  },
  {
    id: 'entry.copy',
    keys: 'Mod+C',
    labelKey: 'shortcut.copy',
    group: 'edit',
    enabled: hasSelection,
    run: (s) => s.copy(),
  },
  {
    id: 'entry.paste',
    keys: 'Mod+V',
    labelKey: 'shortcut.paste',
    group: 'edit',
    run: (s) => s.paste(),
  },
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
    group: spec.group,
    ...(spec.paletteLabelKey ? { paletteLabelKey: spec.paletteLabelKey } : {}),
    ...(spec.palette === false ? { palette: false } : {}),
    ...(spec.sheet === false ? { sheet: false } : {}),
    ...(spec.enabled ? { enabled: () => spec.enabled?.(store) ?? true } : {}),
    handler: () => {
      // Arrow keys fall back to scrolling when there is nothing to move.
      return spec.run(store) === false ? false : undefined;
    },
  }));
}
