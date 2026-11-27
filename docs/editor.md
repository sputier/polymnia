# Editor

**English** · [Français](editor.fr.md)

A stored score opens at `#/scores/<id>` from the [library](library.md), the signed-in home; it loads the score and saves it as you write (see [library.md](library.md)). `#/editor` is a scratch editor that is never saved, used by previews, fixtures and tests (hash routing, no router dependency).

## Layout

| Area        | Role                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Top bar     | Back link, instruments toggle, editable score title, save status (`Saved`, `Saving…`, `Offline`, `Conflict`, `Not saved`, `Sign-in needed`), Simple/Advanced toggle, Import, Share (placeholder) and Export menu (MusicXML, MXL, MIDI, PDF, PNG; see [musicxml.md](musicxml.md) and [export.md](export.md)), theme and language switches, inspector toggle (Advanced only) |
| Left panel  | Instruments, collapsible. In Simple mode it also shows a hint to reach Advanced mode                                                                                                                                                                                                 |
| Center      | The note input palette, the score on a "paper" surface and the shortcut reminder strip                                                                                                                                                                                               |
| Right panel | Inspector, collapsible, **Advanced mode only**                                                                                                                                                                                                                                       |
| Status bar  | Input mode (`NOTE INPUT` / `SELECT`), current duration, measure and beat, interface level, save status                                                                                                                                                                               |

The center also holds a **transport bar** above the score (play/pause, stop, back to start, loop, metronome, tempo) and, in Advanced mode, a mixer with mute and solo per staff in the inspector; see [playback](playback.md).

The shell components live in `web/src/editor/`. The status bar is fed by the editor store (mode, duration, measure and beat of the cursor) and shows the last notice.

### Simple and Advanced

The choice is stored in `localStorage` (`polymnia.uiMode`; failures are ignored). It will move to the user profile with accounts. Simple mode hides the inspector and advanced tools.

### Responsive

- 1100 px and wider: panels sit beside the score.
- Below 1100 px (down to 768 px): panels float over the score, start closed, show a close button, and close with `Esc` or a click outside. Opening one closes the other.

## Keyboard shortcuts

| Shortcut                      | Action                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `Ctrl+B` (`Cmd+B` on macOS)   | Show or hide the instruments panel                                                  |
| `Ctrl+I` (`Cmd+I` on macOS)   | Show or hide the inspector (Advanced only)                                          |
| `Alt+A` (`Option+A` on macOS) | Switch between Simple and Advanced                                                  |
| `Space`                       | Play or pause (MuseScore behavior; a focused button keeps it)                       |
| `Home`                        | Back to the start of the score                                                      |
| `Ctrl+K` (`Cmd+K` on macOS)   | Open the command palette (works while typing in a field)                            |
| `Alt+F` (`Option+F` on macOS) | Focus mode                                                                          |
| `Ctrl+S` (`Cmd+S` on macOS)   | Save now (a stored score; also works while typing in the title)                     |
| `Alt+L` (`Option+L` on macOS) | Back to the library                                                                 |
| `?`                           | Keyboard shortcut cheat sheet                                                       |
| `Esc`                         | Leave focus mode, else close the open panel (narrow screens), else leave note input |

Shortcuts do not fire while typing in a text field. Note-entry keys are listed in the next section.

### Shortcut registry

`web/src/shortcuts/` is the single place to declare shortcuts, shared with note entry and the command palette.

```ts
useShortcuts([
  {
    id: "editor.toggleInstruments",
    keys: "Mod+B",
    labelKey: "shortcut.toggleInstruments",
    handler,
  },
]);
```

- `keys`: `Mod` is `Cmd` on macOS and `Ctrl` elsewhere; also `Alt`, `Shift` and a key (`B`, `Escape`, ...). Letters match the physical key, so `Alt+A` works on macOS.
- `handler` may return `false` to leave the event untouched (no `preventDefault`).
- `allowInInput: true` opts in to firing while typing in a field.
- `shortcuts.list()` returns every registered shortcut (for the command palette and the cheat sheet); `formatKeys` and `<Kbd>` render platform-aware labels. `shortcuts.run(id)` runs one by id.
- `group` (`input`, `edit`, `navigation`, `view`, `playback`, `file`, `help`) sets the section in the palette and the cheat sheet; a shortcut without one lands in "Other". Playback and file shortcuts should set their group when they register.
- `paletteLabelKey` gives a distinct palette label when several shortcuts share a `labelKey` (the five durations). `palette: false` / `sheet: false` keep a shortcut out of the palette / cheat sheet (the 14 per-letter note keys are one cheat sheet row, "A–G", and no palette command). `enabled()` makes the palette show the command disabled (Undo with nothing to undo); the key itself still reaches the handler.
- Named symbol keys (`Plus`, `Minus`, `Equal`, `Period`, `Question`) match the character produced and ignore Shift, so `?` works on QWERTY (Shift+/) and AZERTY (Shift+,).
- While a modal dialog is open (`aria-modal="true"`) the registry ignores the keyboard: note keys never leak behind the palette.
- Several shortcuts with the same group and label are one command (`Del` and `Backspace`; `Ctrl+Y` and `Ctrl+Shift+Z`). A test checks that no two shortcuts share a key combo; `Ctrl+K` is the palette (MuseScore uses it for chord symbols; Polymnia does not).

## Command palette, focus mode, cheat sheet

Code in `web/src/editor/commands/` (dialogs) and `web/src/shortcuts/` (`commands.ts`, `search.ts`, `recent.ts`). One lazy chunk (about 3 KB gzip), fetched in idle time after the editor mounts so the first opening is instant; the search and the dialogs stay out of the initial bundle.

- **Palette** (`Ctrl+K` / `Cmd+K`, or the "Commands…" button in the top bar). Lists every command registered in the registry, with its key badges, under group headings; recently used commands come first (`localStorage`, key `polymnia.recentCommands`, 8 entries, failures ignored). Type to filter: accent- and case-insensitive, every word must match, matching is on the **French and English** labels whatever the interface language (`silence` and `rest` both find "Enter a rest"), with a tight subsequence fallback (`rst` finds `rest`). `↑`/`↓` (and `Home`/`End`) move, `Enter` runs, `Esc` or `Ctrl+K` closes, and focus goes back to where it was. Commands that do nothing in the current context are shown dimmed, announced as unavailable, skipped by the arrows and not run.
- **Focus mode** (`Alt+F`, or the top bar button): hides the top bar, panels, note palette, shortcut strip and status bar; a small "Focus mode · Esc to exit" pill stays. `Esc` leaves it (before anything else `Esc` does). Not persisted.
- **Cheat sheet** (`?`): every shortcut of the registry by group, in a dialog; the Print button prints the sheet alone (print stylesheet). `Ctrl+K` from the sheet goes to the palette.
- **Accessibility**: the palette is an ARIA 1.2 combobox (`role="combobox"`, `aria-controls`, `aria-activedescendant`) over a `listbox` of `option`s in labelled `group`s, with a polite result count; both dialogs are `role="dialog"` with `aria-modal`, a name, a focus trap and focus restoration; animation is disabled under `prefers-reduced-motion`; everything is available in French and English.
- **Performance** (`e2e/command-palette.spec.ts`): opening under 50 ms and a keystroke under 5 ms with the full registry (about 5 ms and 0.4 ms measured in Chromium).

## Note entry

Keys are the MuseScore 4 defaults (`Cmd` replaces `Ctrl` on macOS). They are declared once in `web/src/editor/entry/entryShortcuts.ts` and registered in the shortcut registry; the palette above the score mirrors them, with the key in each tooltip.

| Action                                        | Key                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Toggle note input mode (`Esc` also leaves it) | `N`                                                                                    |
| Duration 16th / 8th / quarter / half / whole  | `3` / `4` / `5` / `6` / `7` (`1`, `2`, `8`, `9` are reserved: they only show a notice) |
| Augmentation dot                              | `.`                                                                                    |
| Rest                                          | `0`                                                                                    |
| Enter a note                                  | `A`–`G`                                                                                |
| Add a note to the chord                       | `Shift+A`–`Shift+G`                                                                    |
| Sharp / flat / natural                        | `+` / `-` / `=`                                                                        |
| Pitch up / down a semitone                    | `↑` / `↓`                                                                              |
| Pitch up / down an octave                     | `Ctrl+↑` / `Ctrl+↓`                                                                    |
| Tie                                           | `T`                                                                                    |
| Slur                                          | `S`                                                                                    |
| Triplet                                       | `Ctrl+3`                                                                               |
| Move cursor or selection                      | `←` / `→`                                                                              |
| Extend the selection                          | `Shift+←` / `Shift+→`                                                                  |
| Delete (turns into rests)                     | `Del` or `Backspace`                                                                   |
| Copy / paste                                  | `Ctrl+C` / `Ctrl+V`                                                                    |
| Undo / redo                                   | `Ctrl+Z` / `Ctrl+Y` or `Ctrl+Shift+Z`                                                  |

### Behavior

- **State** lives in `EditorStore` (`web/src/editor/entry/editorStore.ts`, a plain class read with `useSyncExternalStore`): score through `History`, selection, input mode, current duration, voice and staff, entry cursor. The editor opens on a new piano score (4/4, C major, 8 measures); `#/editor?new=<n>` sets the measure count and `#/editor?fixture=<name>` shows an engraving fixture instead.
- **Every edit is a score-model command** run through `History`, so undo and redo are exact (the cursor and selection come back too). A multi-step edit (a note that crosses a barline, a paste) is one undo step.
- **Entering a note** writes at the cursor, overwriting what is there (leftover time becomes rests), then the cursor advances. When the last measure is full a measure is appended. A note longer than the room left in the measure is split into tied notes across the barline.
- **Pitch**: the letter picks the octave nearest to the previous note, by staff position (a fourth up beats a fifth down); the first note is near the middle line of the clef. The accidental comes from the key signature and from accidentals already written earlier in the measure. `+`, `-`, `=` arm an accidental for the next note (pressed again, they cancel); in select mode they change the selected notes. In select mode a letter moves the selected notes to that letter.
- **Arrows up/down** transpose the selection (or, in note input, the note just entered). **`T`** ties the selected notes to the next note of the same pitch; in note input it ties the note just entered to the next note if it has the same pitch. **`S`** slurs the first and last notes of the selection (a single note slurs to the next one); in note input it starts a slur ending on the next entered note. **`Ctrl+3`** turns the event under the cursor (or the selection) into a 3:2 triplet; the duration becomes the triplet value.
- **Mouse**: click a note to select it (`Shift` extends a range). In note input, click on a staff line or space to enter a note at that pitch and position (the engraver's `hitTest` returns the natural pitch and the tick of the nearest column; the key signature is applied by the entry code).
- **Selection**: a range is a run of events of one staff and voice. `Ctrl+C` copies it to an internal clipboard (nothing is written to the system clipboard; triplets cannot be copied yet); `Ctrl+V` pastes at the cursor, overwriting, continuing into the next measures and appending measures when needed. An event that would cross a barline is refused.
- **Hook for sound**: `store.onNoteEntered?.(pitch)` is called with every entered note (audible feedback is a separate feature).
- **Accessibility**: the entered or selected note is announced through the score's live region ("C5 quarter, measure 3 beat 2"), short notices ("Not enough room in the measure.") also appear in the status bar.

### Test hook

`window.__polymnia` holds `{ engraver, score, width, store }` (set once the systems are drawn; `store.getState()` is the live state). The Playwright tests use it.

## Accessibility

Landmarks (`header`, `aside`, `main`, status bar), visible focus, `aria-label` on icon buttons, `aria-expanded` on panel toggles, `aria-pressed` on toggles, polite announcements for input mode, save status and the entered or selected note (through the score live region), and `prefers-reduced-motion` honored.
