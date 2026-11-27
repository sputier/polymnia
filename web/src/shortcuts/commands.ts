import type { MessageKey } from '../i18n/en';
import { LANGUAGES, messageIn } from '../i18n/i18n';
import { normalize, type SearchEntry } from './search';
import type { Shortcut } from './registry';

/** Display order of the groups in the palette and the cheat sheet. */
export const GROUP_ORDER = [
  'input',
  'edit',
  'navigation',
  'view',
  'playback',
  'file',
  'help',
  'other',
] as const;
export type GroupId = (typeof GROUP_ORDER)[number];

export const GROUP_LABEL: Record<GroupId, MessageKey> = {
  input: 'group.input',
  edit: 'group.edit',
  navigation: 'group.navigation',
  view: 'group.view',
  playback: 'group.playback',
  file: 'group.file',
  help: 'group.help',
  other: 'group.other',
};

/** One palette entry: registered shortcuts that share a label are one command. */
export interface Command {
  /** Id of the first shortcut. */
  id: string;
  group: GroupId;
  labelKey: MessageKey;
  /** Every key combo, in registration order. */
  keys: string[];
  enabled: () => boolean;
  run: () => void;
}

function groupOf(shortcut: Shortcut): GroupId {
  return shortcut.group ?? 'other';
}

/** Buckets of shortcuts that share group and label (`Delete` and `Backspace`, `Ctrl+Y` and `Ctrl+Shift+Z`). */
function merge(
  list: readonly Shortcut[],
  keep: (s: Shortcut) => boolean,
  labelOf: (s: Shortcut) => MessageKey,
): Shortcut[][] {
  const buckets = new Map<string, Shortcut[]>();
  for (const s of list) {
    if (!keep(s)) continue;
    const key = `${groupOf(s)}|${labelOf(s)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(s);
    else buckets.set(key, [s]);
  }
  return [...buckets.values()];
}

/** The palette commands, straight from the registry (there is no second list). */
export function buildCommands(list: readonly Shortcut[]): Command[] {
  const label = (s: Shortcut) => s.paletteLabelKey ?? s.labelKey;
  return merge(list, (s) => s.palette !== false, label).map((bucket) => {
    const first = bucket[0]!;
    return {
      id: first.id,
      group: groupOf(first),
      labelKey: label(first),
      keys: bucket.map((s) => s.keys).filter(Boolean),
      enabled: () => first.enabled?.() ?? true,
      run: () => {
        first.handler();
      },
    };
  });
}

export interface SheetRow {
  labelKey: MessageKey;
  keys: string[];
}
export interface SheetSection {
  group: GroupId;
  rows: SheetRow[];
}

/** The cheat sheet: grouped rows, one per label (`A` to `G` is one row). */
export function buildSheet(list: readonly Shortcut[]): SheetSection[] {
  const rows = merge(
    list,
    (s) => s.sheet !== false && s.keys !== '',
    (s) => s.labelKey,
  ).map((bucket) => ({
    group: groupOf(bucket[0]!),
    row: { labelKey: bucket[0]!.labelKey, keys: bucket.map((s) => s.keys) },
  }));
  return GROUP_ORDER.map((group) => ({
    group,
    rows: rows.filter((r) => r.group === group).map((r) => r.row),
  })).filter((section) => section.rows.length > 0);
}

/** Search entries: the label in every language plus the group names, so "rest" and "silence" both work. */
export function searchEntries(commands: readonly Command[]): SearchEntry[] {
  return commands.map((c) => ({
    id: c.id,
    texts: [
      ...LANGUAGES.map((l) => normalize(messageIn(l, c.labelKey))),
      ...LANGUAGES.map((l) => normalize(messageIn(l, GROUP_LABEL[c.group]))),
    ],
    weights: [...LANGUAGES.map(() => 1), ...LANGUAGES.map(() => 0.4)],
  }));
}
