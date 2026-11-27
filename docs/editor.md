# Editor

**English** · [Français](editor.fr.md)

A stored score opens at `#/scores/<id>` from the [library](library.md), the signed-in home; it loads the score and saves it as you write (see [library.md](library.md)). `#/editor` is a scratch editor that is never saved, used by previews, fixtures and tests (hash routing, no router dependency).

## Layout

| Area        | Role                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Top bar     | Back link, instruments toggle, editable score title, save status (`Saved`, `Saving…`, `Offline`, `Conflict`, `Not saved`, `Sign-in needed`), Simple/Advanced toggle, Import, Share (dialog: read-only link and export buttons, `Ctrl+Shift+L`, see [sharing.md](sharing.md)) and Export menu (MusicXML, MXL, MIDI, PDF, PNG; see [musicxml.md](musicxml.md) and [export.md](export.md)), theme and language switches, inspector toggle (Advanced only) |
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
| `P`                           | Show or hide the on-screen piano                                                    |
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

## Chord symbols

Chord symbols (`C`, `Am7`, `G/B`, `F#m7b5`...) sit above the staff, and guitar and ukulele parts can show a **fretboard diagram** with them. The model is in [score-format.md](score-format.md#chord-symbols), the drawing in [engraving.md](engraving.md#chord-symbols-and-fretboard-diagrams), MusicXML in [musicxml.md](musicxml.md#chord-symbols), the sound in [playback.md](playback.md#chord-playback). Code: `web/src/editor/ChordEntry.tsx` (the field), `EditorStore` (`openChordEntry`, `commitChord`, `moveChordEntry`...), `web/src/score/chords.ts` (parser).

| Key (in the field)     | Action                                                                          |
| ---------------------- | ------------------------------------------------------------------------------- |
| `Alt+K` (`Option+K`)   | Open the field at the cursor (a symbol that is already there is edited)         |
| `Space`, `Shift+Space` | Write, then move to the next, previous beat (MuseScore behavior)                |
| `Tab`, `Shift+Tab`     | Write, then move to the first beat of the next, previous measure                |
| `Enter`                | Write and close                                                                 |
| `Esc`                  | Close without writing                                                           |
| click on a symbol      | Open the field on it                                                            |
| empty field            | Removes the symbol (on `Enter`, `Space` or `Tab`)                               |

`Ctrl+K` is the command palette here, so chord entry is **`Alt+K`** (K as in MuseScore's chord key; `Alt+K` is free in the shortcut registry and works while a checkbox of the instruments panel has the focus). The field appears over the score where the symbol will be drawn; focus returns to the score when it closes.

- **What you can type.** Letters `A` to `G` (upper or lower case), `#` and `b` or `♯` and `♭`, double alterations (`##`, `bb`, `x`), and the usual quality spellings: `m`, `min`, `-`, `maj7`, `M7`, `Δ7`, `^7`, `7`, `6`, `69` or `6/9`, `9`, `11`, `13`, `dim`, `°`, `o7`, `ø`, `m7b5`, `aug`, `+`, `sus`, `sus2`, `sus4`, `7sus4`, `add9`, `5`, alterations `b5 #5 b9 #9 #11 b13` (with or without parentheses), and a bass note after `/` (`G/B`, `Am7/G`). Everything is **normalized**: `CM7`, `C^7` and `Cmaj7` are stored and shown as `Cmaj7`. Text that is not a chord keeps the field open (red border, announced), and nothing is written.
- **French note names** are accepted as input: `Do`, `Ré` (or `Re`), `Mi`, `Fa`, `Sol`, `La`, `Si`, with `#` and `b` (`Sib`, `Fa#m7b5`, `Rém7`, `Sol/Si`), in upper or lower case. `Do` is always read as the note C (type `Ddim` for D diminished). The symbol is displayed with letters; a "show note names as Do Ré Mi" display preference is **not implemented** (`formatChord(chord, 'solfege')` exists and is tested, and the field's hint shows how the text was understood, for example "Shown as Dm7" for `rém7`).
- **Where.** A symbol belongs to the first staff of the part (the standard staff of a "standard + TAB" part) at a position in the measure, in ticks. Space moves by the beat of the time signature (a dotted quarter in 6/8, 9/8, 12/8); a symbol can sit anywhere, not only on a note: a symbol between two notes gets its own column.
- **Undo.** Every written, replaced or removed symbol is one undo step.
- **Transposition.** The palette has "Chords: transpose the symbols up / down a semitone", which transpose every symbol of the current part with the correct spelling: `C` up 3 semitones is `Eb`, `Am` up 1 is `Bbm`, `F#m7b5` up 1 is `Gm7b5`; sharps or flats follow the key signature of the measure when it has accidentals (`C` up 1 in D major is `C#`), else the usual chord names (Db, Eb, F#, Ab, Bb; C#m, F#m, G#m but Bbm, Ebm); a slash bass follows its root. The notes are **not** touched: chord symbols name concert (sounding) pitches, so transposing notes, changing the instrument or its transposition never changes them, and a note edit never changes a symbol.
- **Diagrams and the capo** (instruments panel, for parts with strings). "Fretboard diagrams": none, the first time each chord appears, or every chord (the part's choice); the palette command "Chords: show or hide the diagram of the chord at the cursor" forces or hides one. With a **capo**, the symbol is the sounding chord and the diagram is the shape you play, counted from the capo: with a capo on fret 2, `D` shows the `C` shape. "With the capo, also show the shape to play" writes it next to the symbol: `D (C)`. Both are choices of the part, saved in the score.
- **Other commands.** "Chords: remove the chord symbol at the cursor" (palette).
- **Playback** of chord symbols is an option of the mixer (Advanced mode), muted by default: see [playback.md](playback.md#chord-playback).

Accessibility: the field is a labelled text input ("Chord symbol, measure 3, beat 2") described by its keys, `aria-invalid` on text that is not a chord, visible focus ring in both themes, and the notices ("Chord Am7.", "Chord removed.") go through the polite live region. The chord text is also in `data-chord` on each symbol of the SVG, for tests (the symbols are not read one by one by screen readers yet: the score is one image with a summary, as for the notes).

The state of the field is `store.getState().chordEntry` (`{ staffId, measure, tick }` or `null`), also used by the Playwright tests (`e2e/chords.spec.ts`).

## Parts, instruments and measures

Every change below is a score-model command run through `History` (exact undo and redo, one step per action). The UI is `web/src/editor/InstrumentsPanel.tsx` (left panel), `Inspector.tsx` (right panel, Advanced mode) and `entry/structureShortcuts.ts` (palette commands).

### Instruments panel (left)

- **Parts.** One row per part: name and instrument (French or English by interface language). Click a row to edit that part (its first staff becomes the note-entry staff and the selection is cleared). Reorder with the arrow buttons, with `Alt+↑` / `Alt+↓` on a focused row, or by dragging. The remove button asks for a confirmation in the row; the last part cannot be removed.
- **Add an instrument.** A searchable picker grouped by family (guitars and ukuleles, bowed strings, keyboard, voice, woodwinds). Search matches the English and French names, accents ignored ("violoncelle" finds the cello). The command palette has "Add an instrument…" too.
- **Settings of the selected part.** Rename; change the instrument; for guitars and ukuleles the notation (`Standard + TAB`, `TAB only`, `Standard only`), the tuning and the capo.
- **Changing the instrument** keeps every note's **sounding pitch**: because notes store the written pitch, they move by the difference of the two transpositions (guitar to ukulele: an octave down on the page). The clef becomes the new instrument's default if the old one is not allowed (clef changes it does not list are removed). Going to piano adds an empty bass staff; leaving piano needs an empty second staff (otherwise refused with a notice). Tuning and capo are reset to the new instrument's defaults and frets are recomputed. The part name follows the instrument unless you renamed the part.
- **Tuning presets.** Guitar: standard, drop D, DADGAD, open G, open D, half step down, whole step down. Ukulele: standard re-entrant GCEA, low G, baritone DGBE, D tuning. Pick **Custom…** to type one note name per string (`E2`, `F#3`, `Bb3`). Notes keep their pitch; frets are recomputed. The instrument range extends down to the lowest string of a custom tuning (drop D allows a D2).
- **Capo.** Fret 1 to 12 (below the fret count). Frets are recomputed so the sounding pitch is unchanged.
- **Notation of fretted instruments.** `Standard + TAB` adds a TAB staff built from the standard staff (frets derived: lowest fret, string kept when possible). The TAB staff **follows the notes** of the staff being edited: after every edit the other staff of the part is rebuilt from it (same undo step, event ids reused position by position); it is not played twice (playback and the mixer ignore it). `TAB only` converts the staff in place and derives frets. Frets are chosen by the fingering algorithm (see below) and stay put while you edit other notes; the tick "Show rests on the TAB staff" draws the rests of the tablature (hidden by default). Editing the tablature itself is described in "Tablature entry".

### Tablature entry

Select a TAB staff (click on it) and switch to note input (`N`). The cursor now has a **string** (shown by the `String n.` announcement; the mouse sets it: click a string position).

| Key                            | On a TAB staff                                                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`–`9`                        | the **fret** on the current string: writes a note of the current duration and moves on. `0` is the open string. A second digit within 500 ms makes one fret (`1` then `2` = fret 12; `5` then `3` stay two notes, 53 does not exist) |
| `↑` / `↓`                      | move the input string (`↑` = towards the first, highest string). In select mode they still raise or lower the selection by a semitone (the fret is derived again)                 |
| `Alt+↑` / `Alt+↓`              | move the selected (or last entered) note to the adjacent string keeping its pitch (the fret changes); the new fretting is yours                                                   |
| `Shift+3` … `Shift+7`          | durations (16th to whole), because the bare digits are frets here; `Shift+0` enters a rest (`0` is the open string). On other staves `3`–`7` and `0` keep their usual meaning |
| `Del`, `T`, `S`, `.`, `Ctrl+Z` | as everywhere (a tie or slur is drawn as an arc on the tablature)                                                                                                                 |

In select mode a digit sets the fret of the selected note on its own string. The standard staff of a `Standard + TAB` part follows at once (written pitch from string + fret + capo + transposition, same undo step); notes typed on a standard staff get a derived fret on the TAB. Palette commands: input string up / down, automatic fingering for the selection (hands manual frets back to the algorithm), show or hide rests on this staff, move to the string above / below. A fret you type or re-fret is a **manual fretting**: the automatic fingering never changes it (tuning and capo changes keep it while it still sounds the right note). On AZERTY keyboards use the unshifted digit keys for frets (the keys are matched by position) and `Shift` + digit for durations.

A note no string can play (below the lowest string, above the last fret, under a capo) shows `?` on the tablature with the warning color and mark of out-of-range notes, a tooltip ("No string can play this note on ...") and an entry in the inspector.

### Inspector (right, Advanced mode)

It acts on the measure under the cursor (the cursor follows selection and note entry):

| Control                                       | Effect                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Key signature                                 | `setKeySignature` from this measure (pitches untouched)                                                                                          |
| Time signature + "Pickup measure"             | `setTimeSignature`; a pickup is a measure shorter than the bar (`MeasureInfo.length`, in beats)                                                  |
| Tempo                                         | `setTempo` (20 to 400, quarter notes per minute) from this measure, "Remove change" clears it                                                    |
| Clef from this measure                        | `setClef` on the staff being edited, limited to the clefs of its instrument: cello bass / tenor / treble, guitar treble 8vb, piano treble / bass |
| Insert before / after, Append, Delete measure | `insertMeasure` / `deleteMeasure` on every staff                                                                                                 |
| Out of range                                  | the list of out-of-range notes with a text message                                                                                               |

Clef changes apply at the **start of a measure**; mid-measure clef changes are not in the model yet.

### Palette commands and keys

Commands without a key are palette-only (`shortcut.keys` empty): they appear in `Ctrl+K` and not in the cheat sheet. Keys: `Insert` insert a measure before the current one, `Ctrl+Insert` append a measure at the end, `Ctrl+Delete` delete the current measure (`Ctrl+B` stays the instruments panel). Palette commands: insert after, key signature (one more sharp, one more flat, none), time signature (2/4, 3/4, 4/4, 6/8), tempo change here (10 faster, 10 slower, remove), clef from this measure (treble, bass, tenor, alto, treble 8vb; dimmed when already in force or on a TAB staff), add an instrument.

### Out-of-range notes

A note outside the range of its part's instrument (sounding range, extended by a custom tuning) is drawn in the warning color (`--warn`), with a **triangle mark** above it (not color alone) whose tooltip says "Out of range for <instrument> (<low> to <high>)", and is listed in the inspector. It is a warning: nothing is blocked. Selection and playback colors win over the warning color.

## On-screen piano and MIDI keyboard

Code in `web/src/editor/piano/` (`Piano.tsx`, `midi.ts`), one lazy chunk fetched the first time the piano opens (it is not in the initial bundle). `P` (or the palette command "Show or hide the on-screen piano") shows and hides it; the choice is kept in `localStorage` (`polymnia.piano`, failures ignored). It sits under the score and is hidden in focus mode.

- **Keys**: 88 keys (A0 to C8) in a horizontal scroller, opened around the middle line of the clef of the current staff (treble: B4, bass: D3, ...), and re-centered when another staff is used. Every key is a button named after the note in the interface language ("C4" / "Do4", "C sharp 4" / "Do dièse 4"); `←` / `→` / `Home` / `End` move between keys (one tab stop), `Enter` or `Space` plays one.
- **Click, touch or `Enter`**: in note input the note is entered at the current duration, as `A`–`G` do; `Shift` adds it to the chord of the note just entered. In select mode the selected notes move to that pitch (`Shift`: the pitch is added to them). With nothing to change, the key only plays the note. Every entered note is heard through `onNoteEntered`.
- **Spelling**: the pitch is spelled from the key signature at the cursor (`midiToPitch`): notes of the key keep their spelling (B flat in F major), the other black keys are sharps in C major and sharp keys and flats in flat keys (D flat in B flat major). Notes entered this way do not use the armed accidental (`+`, `-`, `=`).
- **Lit keys**: the notes selected (or, in note input, the note just entered) are lit in the accent color, the notes sounding during playback in the playback color. Both are class toggles done outside React (the key buttons render once, again only when the key signature or the language changes), so playback does not re-render the piano; a Playwright test checks that the key DOM only sees class changes. Closed, the piano does no work at all.
- **MIDI keyboard**: the "Connect MIDI keyboard" button in the piano header is the only thing that calls `navigator.requestMIDIAccess` (never on load), with `sysex: false`. Once connected, note-on events enter notes at the current duration in note input mode, or change the selected notes in select mode. Notes pressed within 50 ms of the first one of a group are added to its chord (the first note is entered at once, no delay). Several devices: a picker ("All devices" by default). Hot-plug is handled: devices that appear or disappear update the list, and a picked device that goes away falls back to all devices. The MIDI input stays active while the piano is hidden. **Sustain pedal, velocity, pitch bend and note-off are ignored in V1** (a note-on with velocity 0 counts as a note-off); running status and real-time bytes are parsed.
- **Fallbacks**: without Web MIDI (Safari has none; Firefox needs its site permission add-on) the button is replaced by an explanation, and a denied permission or a failure shows a message with a retry button. The on-screen piano works either way. The API sends `Permissions-Policy: midi=(self)`, so Web MIDI is allowed for the app's own origin.
- **Accessibility**: keys are labelled buttons with a visible focus ring, AA contrast in both themes (white keys keep a piano look; lit keys use the accent and playback tokens), transitions only when motion is allowed, and the connection messages are a polite live region.

## Accessibility

Landmarks (`header`, `aside`, `main`, status bar), visible focus, `aria-label` on icon buttons, `aria-expanded` on panel toggles, `aria-pressed` on toggles, polite announcements for input mode, save status and the entered or selected note (through the score live region), and `prefers-reduced-motion` honored.
