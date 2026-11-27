/**
 * Structure commands (measures, key, time, tempo, clef, parts): palette commands, with a key only
 * where one is free (`Ctrl+B` belongs to the panels). All of them run on the measure under the
 * cursor and are score-model commands underneath (undo and redo are exact).
 */
import type { MessageKey } from '../../i18n/en';
import { clefAt, findStaff, keyFifthsAt, tempoAt, type Clef } from '../../score';
import type { Shortcut } from '../../shortcuts/registry';
import type { EditorStore } from './editorStore';

interface Spec {
  readonly id: string;
  readonly keys: string;
  readonly labelKey: MessageKey;
  /** Hidden from the cheat sheet (commands without a key never show there). */
  readonly enabled?: (store: EditorStore) => boolean;
  readonly run: (store: EditorStore) => boolean | void;
}

const keyEnabled = (min: number, max: number, delta: number) => (s: EditorStore) => {
  const { score, cursor } = s.getState();
  const next = keyFifthsAt(score, cursor.measure) + delta;
  return next >= min && next <= max;
};

function onTabStaff(s: EditorStore): boolean {
  const { score, staffId } = s.getState();
  const loc = findStaff(score, staffId);
  return !!loc && score.parts[loc.partIndex]!.staves[loc.staffIndex]!.type === 'tab';
}

const clefSpec = (clef: Clef, labelKey: MessageKey): Spec => ({
  id: `structure.clef.${clef}`,
  keys: '',
  labelKey,
  enabled: (s) => {
    if (onTabStaff(s)) return false;
    const { score, staffId, cursor } = s.getState();
    const loc = findStaff(score, staffId);
    const staff = loc ? score.parts[loc.partIndex]!.staves[loc.staffIndex] : undefined;
    return !!staff && clefAt(staff, cursor.measure) !== clef;
  },
  run: (s) => s.setClef(clef),
});

const timeSpec = (beats: number, beatType: 2 | 4 | 8, labelKey: MessageKey): Spec => ({
  id: `structure.time.${beats}-${beatType}`,
  keys: '',
  labelKey,
  run: (s) => s.setTimeSignature({ beats, beatType }),
});

const specs: Spec[] = [
  {
    id: 'structure.insertMeasure',
    keys: 'Insert',
    labelKey: 'shortcut.insertMeasure',
    run: (s) => s.insertMeasure('before'),
  },
  {
    id: 'structure.insertMeasureAfter',
    keys: '',
    labelKey: 'shortcut.insertMeasureAfter',
    run: (s) => s.insertMeasure('after'),
  },
  {
    id: 'structure.appendMeasure',
    keys: 'Mod+Insert',
    labelKey: 'shortcut.appendMeasure',
    run: (s) => s.insertMeasure('end'),
  },
  {
    id: 'structure.deleteMeasure',
    keys: 'Mod+Delete',
    labelKey: 'shortcut.deleteMeasure',
    enabled: (s) => s.getState().score.measures.length > 1,
    run: (s) => s.deleteMeasure(),
  },
  {
    id: 'structure.key.sharp',
    keys: '',
    labelKey: 'shortcut.keyMoreSharp',
    enabled: keyEnabled(-7, 7, 1),
    run: (s) => {
      const { score, cursor } = s.getState();
      return s.setKeySignature(keyFifthsAt(score, cursor.measure) + 1);
    },
  },
  {
    id: 'structure.key.flat',
    keys: '',
    labelKey: 'shortcut.keyMoreFlat',
    enabled: keyEnabled(-7, 7, -1),
    run: (s) => {
      const { score, cursor } = s.getState();
      return s.setKeySignature(keyFifthsAt(score, cursor.measure) - 1);
    },
  },
  {
    id: 'structure.key.none',
    keys: '',
    labelKey: 'shortcut.keyNone',
    enabled: (s) => keyFifthsAt(s.getState().score, s.getState().cursor.measure) !== 0,
    run: (s) => s.setKeySignature(0),
  },
  timeSpec(2, 4, 'shortcut.time24'),
  timeSpec(3, 4, 'shortcut.time34'),
  timeSpec(4, 4, 'shortcut.time44'),
  timeSpec(6, 8, 'shortcut.time68'),
  {
    id: 'structure.tempo.faster',
    keys: '',
    labelKey: 'shortcut.tempoFaster',
    enabled: (s) => tempoAt(s.getState().score, s.getState().cursor.measure) + 10 <= 400,
    run: (s) => s.setTempo(tempoAt(s.getState().score, s.getState().cursor.measure) + 10),
  },
  {
    id: 'structure.tempo.slower',
    keys: '',
    labelKey: 'shortcut.tempoSlower',
    enabled: (s) => tempoAt(s.getState().score, s.getState().cursor.measure) - 10 >= 20,
    run: (s) => s.setTempo(tempoAt(s.getState().score, s.getState().cursor.measure) - 10),
  },
  {
    id: 'structure.tempo.clear',
    keys: '',
    labelKey: 'shortcut.tempoClear',
    enabled: (s) =>
      s.getState().score.measures[s.getState().cursor.measure]?.tempoBpm !== undefined,
    run: (s) => s.setTempo(null),
  },
  clefSpec('treble', 'shortcut.clefTreble'),
  clefSpec('bass', 'shortcut.clefBass'),
  clefSpec('tenor', 'shortcut.clefTenor'),
  clefSpec('alto', 'shortcut.clefAlto'),
  clefSpec('treble-8vb', 'shortcut.clefTreble8vb'),
];

/** Palette commands for measures and attributes; `onAddInstrument` opens the instrument picker. */
export function structureShortcuts(store: EditorStore, onAddInstrument: () => void): Shortcut[] {
  const fromSpecs = specs.map((spec): Shortcut => ({
    id: spec.id,
    keys: spec.keys,
    labelKey: spec.labelKey,
    group: 'edit',
    ...(spec.enabled ? { enabled: () => spec.enabled?.(store) ?? true } : {}),
    handler: () => (spec.run(store) === false ? false : undefined),
  }));
  return [
    ...fromSpecs,
    {
      id: 'structure.addInstrument',
      keys: '',
      labelKey: 'shortcut.addInstrument',
      group: 'edit',
      handler: onAddInstrument,
    },
  ];
}
