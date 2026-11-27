# Editor

**English** · [Français](editor.fr.md)

The editor lives at `#/editor` (hash routing, no router dependency). The home page links to it.

## Layout

| Area | Role |
| --- | --- |
| Top bar | Back link, instruments toggle, editable score title, save status (`Saved`, `Saving…`, `Offline`), Simple/Advanced toggle, Share and Export (placeholders), theme and language switches, inspector toggle (Advanced only) |
| Left panel | Instruments, collapsible. In Simple mode it also shows a hint to reach Advanced mode |
| Center | The score on a "paper" surface (placeholder until engraving lands) and the shortcut reminder strip |
| Right panel | Inspector, collapsible, **Advanced mode only** |
| Status bar | Input mode (`NOTE INPUT` / `SELECT`), current duration, measure and beat, interface level, save status |

The shell components live in `web/src/editor/`. The status bar is fed by props (`inputMode`, `duration`, `measure`, `beat`, `saveState`) so later features only have to pass real values.

### Simple and Advanced

The choice is stored in `localStorage` (`polymnia.uiMode`; failures are ignored). It will move to the user profile with accounts. Simple mode hides the inspector and advanced tools.

### Responsive

- 1100 px and wider: panels sit beside the score.
- Below 1100 px (down to 768 px): panels float over the score, start closed, show a close button, and close with `Esc` or a click outside. Opening one closes the other.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+B` (`Cmd+B` on macOS) | Show or hide the instruments panel |
| `Ctrl+I` (`Cmd+I` on macOS) | Show or hide the inspector (Advanced only) |
| `Alt+A` (`Option+A` on macOS) | Switch between Simple and Advanced |
| `Esc` | Close the open panel (narrow screens) |

Shortcuts do not fire while typing in a text field. The note-entry keys shown in the reminder strip (`N`, `1`–`5`, `A`–`G`, arrows, `0`) are a reminder only for now.

### Shortcut registry

`web/src/shortcuts/` is the single place to declare shortcuts, shared with note entry and the command palette.

```ts
useShortcuts([
  { id: 'editor.toggleInstruments', keys: 'Mod+B', labelKey: 'shortcut.toggleInstruments', handler },
]);
```

- `keys`: `Mod` is `Cmd` on macOS and `Ctrl` elsewhere; also `Alt`, `Shift` and a key (`B`, `Escape`, ...). Letters match the physical key, so `Alt+A` works on macOS.
- `handler` may return `false` to leave the event untouched (no `preventDefault`).
- `allowInInput: true` opts in to firing while typing in a field.
- `shortcuts.list()` returns every registered shortcut (for the command palette); `formatKeys` and `<Kbd>` render platform-aware labels.

## Accessibility

Landmarks (`header`, `aside`, `main`, status bar), visible focus, `aria-label` on icon buttons, `aria-expanded` on panel toggles, `aria-pressed` on toggles, polite announcements only for input mode and save status (not for the position, which changes on every note), and `prefers-reduced-motion` honored.
