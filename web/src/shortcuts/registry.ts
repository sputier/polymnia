import type { MessageKey } from '../i18n/en';

/**
 * A tiny keyboard shortcut registry, shared by the editor shell, note entry and the
 * command palette. Keys are written as `Mod+B`, `Alt+A`, `Shift+Mod+Z`, `Escape`...
 * `Mod` means Cmd on macOS and Ctrl everywhere else.
 */
export interface Shortcut {
  id: string;
  keys: string;
  labelKey: MessageKey;
  /** Return `false` to leave the event alone (no preventDefault). */
  handler: (event: KeyboardEvent) => void | false;
  /** Fire even while typing in an input (default: false). */
  allowInInput?: boolean;
}

interface Combo {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  return /mac|iphone|ipad/i.test(platform ?? navigator.platform ?? '');
}

export function parseCombo(keys: string): Combo {
  const combo: Combo = { mod: false, alt: false, shift: false, key: '' };
  for (const part of keys.split('+')) {
    const p = part.toLowerCase();
    if (p === 'mod') combo.mod = true;
    else if (p === 'alt') combo.alt = true;
    else if (p === 'shift') combo.shift = true;
    else combo.key = p;
  }
  return combo;
}

function keyMatches(event: KeyboardEvent, key: string): boolean {
  // Letters and digits go through `code`: on macOS Alt+A types "å" in `key`.
  if (/^[a-z]$/.test(key)) {
    return event.code === `Key${key.toUpperCase()}` || event.key.toLowerCase() === key;
  }
  if (/^[0-9]$/.test(key)) return event.code === `Digit${key}` || event.key === key;
  return event.key.toLowerCase() === key;
}

export function matches(event: KeyboardEvent, keys: string, mac = isMac()): boolean {
  const combo = parseCombo(keys);
  const wantCtrl = combo.mod && !mac;
  const wantMeta = combo.mod && mac;
  return (
    event.ctrlKey === wantCtrl &&
    event.metaKey === wantMeta &&
    event.altKey === combo.alt &&
    event.shiftKey === combo.shift &&
    keyMatches(event, combo.key)
  );
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

const DISPLAY: Record<string, string> = {
  escape: 'Esc',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  ' ': 'Space',
};

/** Splits a combo into the labels to show in `<kbd>` badges. */
export function formatKeys(keys: string, mac = isMac()): string[] {
  const combo = parseCombo(keys);
  const out: string[] = [];
  if (combo.mod) out.push(mac ? '⌘' : 'Ctrl');
  if (combo.alt) out.push(mac ? '⌥' : 'Alt');
  if (combo.shift) out.push(mac ? '⇧' : 'Shift');
  out.push(DISPLAY[combo.key] ?? combo.key.toUpperCase());
  return out;
}

export interface ShortcutRegistry {
  register: (shortcut: Shortcut) => () => void;
  list: () => Shortcut[];
  /** Returns true when a shortcut handled the event. */
  handle: (event: KeyboardEvent, mac?: boolean) => boolean;
}

export function createShortcutRegistry(): ShortcutRegistry {
  const shortcuts = new Map<string, Shortcut>();
  return {
    register(shortcut) {
      shortcuts.set(shortcut.id, shortcut);
      return () => {
        if (shortcuts.get(shortcut.id) === shortcut) shortcuts.delete(shortcut.id);
      };
    },
    list: () => [...shortcuts.values()],
    handle(event, mac = isMac()) {
      if (event.defaultPrevented || event.isComposing) return false;
      const typing = isEditableTarget(event.target);
      for (const shortcut of shortcuts.values()) {
        if (typing && !shortcut.allowInInput) continue;
        if (!matches(event, shortcut.keys, mac)) continue;
        const result = shortcut.handler(event);
        if (result !== false) event.preventDefault();
        return true;
      }
      return false;
    },
  };
}

/** The app-wide registry. */
export const shortcuts = createShortcutRegistry();
