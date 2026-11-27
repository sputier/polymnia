# Accessibility

Target: WCAG 2.2 level AA on every screen, in both themes and both languages. This page records what is checked
automatically, what was reviewed by hand, the findings of the audit (#19) and what remains manual.

## Automated checks

`web/e2e/a11y.spec.ts` runs axe (`@axe-core/playwright`, rule tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`wcag22aa` and `best-practice`) and fails on **any** violation, whatever its impact. `axe-core` and its Playwright
wrapper are MPL-2.0, used as dev dependencies only (nothing is bundled or shipped).

States audited, each in light + English and dark + French (the two diagonals of the theme x language matrix: the
theme changes the contrast, the language the names and the lengths):

- sign-in, privacy, contact (plain and prefilled to report a page);
- library: empty, filled, card menu, account menu, delete-account dialog, new-score dialog;
- editor: Simple, Advanced with the inspector and the instruments panel, on-screen piano, chord entry field, focus
  mode, command palette, cheat sheet, credits dialog, Export menu, Share dialog (not shared and shared), chord
  sheet view;
- the public viewer of a share link.

`web/e2e/a11y-behaviour.spec.ts` covers what axe cannot judge: skip links, focus going into a dialog, staying in and
coming back, the announcements, `prefers-reduced-motion`, reflow at 320 CSS px, and a keyboard-only walkthrough.
Unit tests (`describe.test.ts`) cover the text builders of the announcements, in English and French.

## Keyboard-only walkthrough

Tested by `a11y-behaviour.spec.ts` ("keyboard only walkthrough") and reviewed by hand in the code:

| Task               | Keys                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Skip the toolbar   | first `Tab` stop: **Skip to the content** (library) or **Skip to the score** (editor), `Enter` |
| Create a score     | library: `N`, fill the dialog, `Enter`                                                         |
| Enter a melody     | `N` (note input), `3` to `7` (duration), `A` to `G` (pitch), arrows to move, `Esc`             |
| Add a chord        | `Alt+K`, type the symbol, `Enter`, `Esc`                                                       |
| Play               | `Space` (play / pause), the transport buttons are in the Tab order                             |
| Share              | `Ctrl+Shift+L` (or the **Share** button), `Esc` closes                                         |
| Export             | **Export** button: `Enter` opens the menu, arrows move, `Esc` closes and returns to the button |
| Delete the account | account menu in the library, last item, then the confirmation dialog                           |

Rules that hold everywhere: every dialog moves the focus in, keeps `Tab` inside, closes on `Esc` and gives the focus
back to what opened it; every menu closes on `Esc` and gives the focus back to its button; the shortcuts keep working
while the score region has the focus (the keyboard model is global, the score itself is not a Tab stop).

## Screen reader semantics (reviewed by code, not run in NVDA)

- Landmarks and headings: one `main` and one `h1` per screen; dialogs have an `h2` name (`aria-labelledby`); library
  cards use `h2` under the page `h1`; the cheat sheet body is a labelled, focusable region (it scrolls).
- Names: icon-only buttons have an `aria-label`; a button with visible text has an accessible name that **contains**
  that text (WCAG 2.5.3, `label-content-name-mismatch`): the theme switch is named "Light: Switch to dark theme", the
  command palette button "Commands… Ctrl K", an instrument row "Edit Name Instrument".
- States: toggles use `aria-pressed`, menus `aria-expanded` / `aria-haspopup`, the current instrument
  `aria-current`, the dialogs `aria-modal`.
- The engraved score is one `role="img"` with a summary label (title, parts, measures). What a user needs inside it
  goes through the live region, below.
- Live regions are few and polite: the score region (below), the status bar (input mode and save state only), the
  transport status (loading, error, playback start and stop), the library count, the export progress. Nothing
  announces while playback runs or on every cursor move of the status bar.

### Score announcements

All strings exist in French and English (`describe.*`, `notice.*`, `playback.*`).

- Selecting or entering a note, chord or rest announces it: "C5 quarter, measure 3 beat 2", "C4, E4, G4 half, ...",
  "rest eighth, ...". The same sentence twice in a row is spoken twice (one element per announcement).
- Moving to a measure from the chord sheet announces the selected event, or "Measure 4, empty".
- **Describe the measure** (`Alt+M`, command palette): reads the measure under the selection or the cursor, on the
  current staff and voice: "Measure 3: C5 quarter, rest eighth, E5 half". After 24 events it ends with "and N more".
  Chord symbols are not part of it (they are in the chord sheet view, a labelled table).
- Playback: "Playback started", "Playback paused", "Playback stopped" once each, nothing while it plays.

## Colour, motion, zoom

- Contrast: axe's `color-contrast` runs on every state above in both themes (text and icons with text). The tokens in
  `web/src/styles/tokens.css` are chosen for AA; a new colour must be checked in both themes.
- Not by colour alone: an out-of-range note has a mark and a tooltip in addition to the warning colour; save state has
  a label; the selection has a highlight shape, not only a hue. Focus rings use `--accent` (3:1 or more against the
  page in both themes).
- `prefers-reduced-motion: reduce`: transitions and animations last 0.01 ms (`app.css`), `scroll-behavior` is
  forced to `auto`, and the playback scroll-follow uses `behavior: 'auto'` (`playback/follow.ts`).
- Zoom to 200 % and reflow at 320 CSS px (WCAG 1.4.10): library, dialogs, privacy, contact and the shared viewer have
  no horizontal scroll (tested). **The editor may scroll horizontally** at that width: the engraved score and the
  note palette keep their size, and playback scrolls the score for you.

## Findings of the audit (#19)

| Finding                                                                           | Fix                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Theme switch name did not contain its visible text                                | name is now "Light: Switch to dark theme"               |
| Command palette button name did not contain "Commands…"                           | name is its visible text, the tooltip says what it does |
| Library cards: `aria-label` hid the visible text, `h3` after `h1` skipped a level | name comes from the content, headings are `h2`          |
| Instrument row name did not contain the instrument shown                          | the name ends with the instrument                       |
| Triplet button showed a "3" that was not in its name                              | the "3" is a drawn glyph                                |
| Cheat sheet scroll region was not keyboard reachable                              | focusable, labelled region                              |
| Focus lost after closing the delete-account dialog (its opener unmounts)          | focus returns to the account button                     |
| Library, privacy, contact, viewer top bars overflowed at 320 px                   | toolbars wrap                                           |
| No way past the toolbar to the content                                            | skip links (library, editor)                            |
| Same announcement twice not repeated                                              | one live node per announcement                          |
| No text alternative for a measure                                                 | **Describe the measure** (`Alt+M`)                      |
| Playback state not announced                                                      | start, pause, stop announced                            |

## What stays manual

No screen reader was run: NVDA, VoiceOver and TalkBack passes are still worth doing before a release, especially the
live region wording and the chord symbol entry field. Non-text contrast of every graphic (WCAG 1.4.11) and text
spacing overrides (1.4.12) are not automated.
