import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStore, newEditorScore } from '../editor/entry/editorStore';
import { entryShortcuts } from '../editor/entry/entryShortcuts';
import { buildCommands, buildSheet, searchEntries } from './commands';
import { loadRecent, pushRecent, RECENT_STORAGE_KEY } from './recent';
import { createShortcutRegistry, matches, type Shortcut } from './registry';
import { normalize, rank, scoreToken } from './search';

function ids(store = new EditorStore(newEditorScore(2)), query = '', recent: string[] = []) {
  const commands = buildCommands(entryShortcuts(store));
  return rank(searchEntries(commands), query, recent);
}

describe('normalize', () => {
  it('drops accents, case and apostrophes', () => {
    expect(normalize('  Bémol  d’ÉTÉ ')).toBe('bemol d ete');
  });
});

describe('scoreToken', () => {
  it('prefers word starts to the middle of a word', () => {
    expect(scoreToken('rest', 'enter a rest')).toBeGreaterThan(scoreToken('rest', 'forest'));
  });

  it('allows a tight subsequence but not a scattered one', () => {
    expect(scoreToken('rst', 'rest')).toBeGreaterThan(0);
    expect(scoreToken('rest', 'raise by a semitone')).toBe(0);
  });
});

describe('command search', () => {
  it('finds the rest command in French and in English, whatever the UI language', () => {
    for (const q of ['silence', 'rest', 'SILENCE', 'Rést']) {
      expect(ids(undefined, q)[0], q).toBe('entry.rest');
    }
  });

  it('ignores accents on both sides', () => {
    expect(ids(undefined, 'becarre')).toContain('entry.natural');
    expect(ids(undefined, 'bémol')).toContain('entry.flat');
    expect(ids(undefined, 'duree croche')[0]).toBe('entry.duration.4');
  });

  it('requires every word and returns nothing for gibberish', () => {
    expect(ids(undefined, 'xqzv')).toEqual([]);
    expect(ids(undefined, 'duration quarter')).toEqual(['entry.duration.5']);
  });

  it('ranks word starts before looser matches', () => {
    const result = ids(undefined, 'tie');
    expect(result[0]).toBe('entry.tie');
  });

  it('lists recently used commands first, most recent first, for an empty query', () => {
    const result = ids(undefined, '', ['entry.undo', 'entry.tie']);
    expect(result.slice(0, 2)).toEqual(['entry.undo', 'entry.tie']);
    expect(result).toHaveLength(new Set(result).size);
  });

  it('uses recency to break ties between equally good matches', () => {
    const entries = [
      { id: 'a', texts: ['move left'] },
      { id: 'b', texts: ['move down'] },
    ];
    expect(rank(entries, 'move')).toEqual(['a', 'b']);
    expect(rank(entries, 'move', ['b'])).toEqual(['b', 'a']);
  });

  it('keeps a bounded keystroke time on the whole registry', () => {
    const commands = buildCommands(entryShortcuts(new EditorStore(newEditorScore(2))));
    const entries = searchEntries(commands);
    const start = performance.now();
    for (let i = 0; i < 100; i++) rank(entries, 'duree', []);
    expect((performance.now() - start) / 100).toBeLessThan(5);
  });
});

describe('buildCommands', () => {
  it('reads the registry: one command per label, merged keys, no per-letter variants', () => {
    const commands = buildCommands(entryShortcuts(new EditorStore(newEditorScore(2))));
    const byId = new Map(commands.map((c) => [c.id, c]));
    expect(byId.get('entry.redo')?.keys).toEqual(['Mod+Y', 'Mod+Shift+Z']);
    expect(byId.get('entry.delete')?.keys).toEqual(['Delete', 'Backspace']);
    expect(byId.has('entry.note.A')).toBe(false);
    expect(byId.has('entry.duration.1')).toBe(false);
    expect(byId.get('entry.duration.5')?.labelKey).toBe('command.durationQuarter');
  });

  it('runs and disables from the context', () => {
    const store = new EditorStore(newEditorScore(2));
    const commands = buildCommands(entryShortcuts(store));
    const undo = commands.find((c) => c.id === 'entry.undo')!;
    const tie = commands.find((c) => c.id === 'entry.tie')!;
    expect(undo.enabled()).toBe(false);
    expect(tie.enabled()).toBe(false);
    store.toggleInputMode();
    expect(tie.enabled()).toBe(true);
    commands.find((c) => c.id === 'entry.rest')!.run();
    expect(undo.enabled()).toBe(true);
  });

  it('skips shortcuts that opt out of the palette', () => {
    const hidden: Shortcut = {
      id: 'x.hidden',
      keys: 'Mod+H',
      labelKey: 'shortcut.copy',
      palette: false,
      handler: () => {},
    };
    expect(buildCommands([hidden])).toEqual([]);
  });
});

describe('buildSheet', () => {
  it('groups rows from the registry, with ranges for A to G', () => {
    const sections = buildSheet(entryShortcuts(new EditorStore(newEditorScore(2))));
    expect(sections.map((s) => s.group)).toEqual(['input', 'edit', 'navigation']);
    const input = sections[0]!.rows;
    const notes = input.find((r) => r.labelKey === 'shortcut.enterNote');
    expect(notes?.keys).toHaveLength(7);
    // Reserved digits 1, 2, 8 and 9 are not listed: 3 to 7 only.
    expect(input.find((r) => r.labelKey === 'shortcut.duration')?.keys).toEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
  });
});

describe('recent commands', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the latest first, without duplicates, at most 8', () => {
    for (let i = 0; i < 10; i++) pushRecent(`c${i}`);
    pushRecent('c5');
    const list = loadRecent();
    expect(list[0]).toBe('c5');
    expect(list).toHaveLength(8);
    expect(new Set(list).size).toBe(8);
  });

  it('survives corrupt or unavailable storage', () => {
    localStorage.setItem(RECENT_STORAGE_KEY, '{not json');
    expect(loadRecent()).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(pushRecent('a')).toEqual(['a']);
    vi.restoreAllMocks();
  });
});

describe('registry additions', () => {
  it('runs a shortcut by id', () => {
    const registry = createShortcutRegistry();
    const handler = vi.fn();
    registry.register({ id: 'a', keys: 'Mod+K', labelKey: 'shortcut.copy', handler });
    expect(registry.run('a')).toBe(true);
    expect(registry.run('nope')).toBe(false);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('ignores the keyboard while a modal dialog is open', () => {
    const registry = createShortcutRegistry();
    const handler = vi.fn();
    registry.register({ id: 'a', keys: 'N', labelKey: 'shortcut.copy', handler });
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    const event = new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', cancelable: true });
    expect(registry.handle(event, false)).toBe(false);
    dialog.remove();
    expect(registry.handle(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN' }), false)).toBe(
      true,
    );
  });

  it('matches "?" on QWERTY (Shift+/) and AZERTY (Shift+,) alike', () => {
    expect(
      matches(
        new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true }),
        'Question',
        false,
      ),
    ).toBe(true);
    expect(
      matches(
        new KeyboardEvent('keydown', { key: '?', code: 'Comma', shiftKey: true }),
        'Question',
        false,
      ),
    ).toBe(true);
    expect(
      matches(new KeyboardEvent('keydown', { key: '/', code: 'Slash' }), 'Question', false),
    ).toBe(false);
  });
});
