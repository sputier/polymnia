import { describe, expect, it, vi } from 'vitest';
import { createShortcutRegistry, formatKeys, matches } from './registry';

function key(init: KeyboardEventInit, target?: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('matches', () => {
  it('maps Mod to Ctrl on Windows/Linux and to Cmd on macOS', () => {
    const ctrlB = key({ key: 'b', code: 'KeyB', ctrlKey: true });
    const cmdB = key({ key: 'b', code: 'KeyB', metaKey: true });
    expect(matches(ctrlB, 'Mod+B', false)).toBe(true);
    expect(matches(cmdB, 'Mod+B', false)).toBe(false);
    expect(matches(cmdB, 'Mod+B', true)).toBe(true);
    expect(matches(ctrlB, 'Mod+B', true)).toBe(false);
  });

  it('requires exact modifiers', () => {
    expect(matches(key({ key: 'b', code: 'KeyB' }), 'Mod+B', false)).toBe(false);
    const extra = key({ key: 'b', code: 'KeyB', ctrlKey: true, shiftKey: true });
    expect(matches(extra, 'Mod+B', false)).toBe(false);
  });

  it('matches Alt+letter by physical key (macOS types "å")', () => {
    expect(matches(key({ key: 'å', code: 'KeyA', altKey: true }), 'Alt+A', true)).toBe(true);
  });

  it('matches named keys', () => {
    expect(matches(key({ key: 'Escape' }), 'Escape', false)).toBe(true);
  });
});

describe('formatKeys', () => {
  it('shows platform labels', () => {
    expect(formatKeys('Mod+B', false)).toEqual(['Ctrl', 'B']);
    expect(formatKeys('Mod+B', true)).toEqual(['⌘', 'B']);
    expect(formatKeys('Alt+A', true)).toEqual(['⌥', 'A']);
    expect(formatKeys('Alt+A', false)).toEqual(['Alt', 'A']);
  });
});

describe('registry', () => {
  it('runs the handler and prevents default', () => {
    const registry = createShortcutRegistry();
    const handler = vi.fn();
    registry.register({ id: 'x', keys: 'Mod+B', labelKey: 'shortcut.toggleInstruments', handler });
    const event = key({ key: 'b', code: 'KeyB', ctrlKey: true });
    expect(registry.handle(event, false)).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not prevent default when the handler returns false', () => {
    const registry = createShortcutRegistry();
    registry.register({
      id: 'x',
      keys: 'Escape',
      labelKey: 'shortcut.closePanels',
      handler: () => false,
    });
    const event = key({ key: 'Escape' });
    expect(registry.handle(event, false)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('is suppressed while typing in an input, unless allowed', () => {
    const registry = createShortcutRegistry();
    const blocked = vi.fn();
    const allowed = vi.fn();
    registry.register({
      id: 'a',
      keys: 'Alt+A',
      labelKey: 'shortcut.toggleMode',
      handler: blocked,
    });
    registry.register({
      id: 'b',
      keys: 'Mod+B',
      labelKey: 'shortcut.toggleInstruments',
      handler: allowed,
      allowInInput: true,
    });
    const input = document.createElement('input');
    expect(registry.handle(key({ key: 'a', code: 'KeyA', altKey: true }, input), false)).toBe(
      false,
    );
    expect(blocked).not.toHaveBeenCalled();
    expect(registry.handle(key({ key: 'b', code: 'KeyB', ctrlKey: true }, input), false)).toBe(
      true,
    );
    expect(allowed).toHaveBeenCalledOnce();
  });

  it('unregisters', () => {
    const registry = createShortcutRegistry();
    const off = registry.register({
      id: 'x',
      keys: 'Escape',
      labelKey: 'shortcut.closePanels',
      handler: vi.fn(),
    });
    off();
    expect(registry.list()).toHaveLength(0);
  });
});
