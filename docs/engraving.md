# Engraving

**English** · [Français](engraving.fr.md)

The engraver turns a score (see [score-format.md](score-format.md)) into SVG. It lives in [`web/src/engraving/`](../web/src/engraving). Drawing is done by [VexFlow](https://www.vexflow.com/) 5.11.0 (MIT, pinned exactly in `package.json`); **layout is ours**: VexFlow only draws notes, staves and symbols where our layout tells it to.

## Modules

| File              | Role                                                                             | VexFlow             |
| ----------------- | -------------------------------------------------------------------------------- | ------------------- |
| `notation.ts`     | Staff geometry (clef to y), accidental state, beam groups, tick helpers          | no                  |
| `layout.ts`       | Measure widths, system breaking, justification, event x positions                | no                  |
| `hitTest.ts`      | Point to `{partId, staffId, measureIndex, eventId, pitch}`, event bounding boxes | no                  |
| `draw.ts`         | Draws one system (staves, notes, beams, tuplets, ties, slurs, connectors, names) | yes                 |
| `chords.ts`, `chordMetrics.ts`, `chordAnchor.ts` | Chord symbol typography and widths, diagram sizes, where the text field goes | no |
| `drawChords.ts`   | Draws the chord symbols and fretboard diagrams of a measure (context text and paths) | context only (type import) |
| `engraver.ts`     | Owns the SVG, incremental and progressive re-render, highlighting                | yes                 |
| `vexflowSetup.ts` | Configures VexFlow (fonts) and loads Bravura                                     | yes                 |
| `fonts.ts`        | URL of the hashed Bravura file, `<link rel="preload">`                           | no (initial bundle) |
| `ScoreView.tsx`   | React component: lazy loading, resize, props to engraver                         | no (lazy)           |

Everything that does not need VexFlow is pure TypeScript and unit-tested in jsdom. `ScoreView` loads `engraver.ts` (and so VexFlow) with a dynamic `import()` after the first paint: **VexFlow is not in the initial bundle**. VexFlow is MIT licensed (see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)). The `vexflow/core` entry point is used: it carries **no font**. It is not tree-shakable in practice (the library registers its classes globally), so the editor chunk stays at about 180 KB gzip (see "Numbers").

## Fonts

- **Bravura** (SMuFL music font, SIL OFL 1.1) is a separate `bravura-<hash>.woff2` (247 KB), taken from the `@vexflow-fonts/bravura` package and emitted by Vite into `/assets`, so the API serves it with the immutable cache header. It is same-origin, which the CSP (`font-src 'self'`) requires: nothing is embedded as a `data:` URL.
- `ScoreView` adds `<link rel="preload" as="font" crossorigin>` for it as soon as the editor mounts (`fonts.ts`, initial bundle), in parallel with the download of the engraver chunk.
- `vexflowSetup.ts` calls `VexFlow.setFonts('Bravura')` and `Font.load(...)`. The glyph metrics ship with VexFlow, so **the font file never changes the layout**: it only provides the pixels (`font-display: block`).
- The first render waits for the font for at most 2.5 s. After that the score is engraved anyway and the glyphs appear when the font arrives; a failed download does not throw.
- **Academico is dropped.** Text drawn by VexFlow (tab numbers, annotations) uses the UI font (Inter, already self-hosted), like the part names.
- Only Bravura is needed: no other notation or text font is loaded.

## Layout algorithm

All sizes are px; one staff space is 10 px (13 px on tab staves).

1. **Measure shape** (cached per measure). All staves of a measure are analysed together so that notes of different staves line up. The events are grouped in _columns_, one per distinct onset (tick). Each column gets:
   - `lead`: room before the notehead for accidentals (3 + 10 px per stacked accidental, up to 3),
   - `glyph`: notehead, dots (6 px each), displaced second in a chord, flag,
   - `stretch`: proportional space after the column, `1 + 8 x log2(gap / 120 + 1)` where `gap` is the time (ticks) to the next column or to the end of the measure. A quarter gets about 26 px (plus its 13 px notehead), a half about 34 px, a 16th about 14 px: widths grow with duration but sub-linearly (a Gourlay-like logarithmic curve, so doubling a duration never doubles its space). The notehead width (13 px = the 1.18 staff space of Bravura plus a small gap) is the minimum distance between two columns; accidentals, dots, flags and displaced seconds add their own glyph widths, and a test checks that an accidental never runs into the previous note. The curve has a fixed reference rather than the shortest duration of the system, which keeps measure shapes cacheable per measure.
     The minimum note area of a measure is `padLeft + sum(lead + glyph + stretch) + padRight`. Accidentals follow the key signature and the measure-local state (any voice, in time order; a pitch tied from the previous measure does not repeat its accidental).
2. **Start modifiers.** (Widths are the room VexFlow really needs: clef 38 px, time signature 26 px, small clef 28 px; a test fails if VexFlow draws wider than reserved.) The first measure of a system gets a full clef, the key signature (if not C major) and, at the start of the score or when it changes, the time signature. A mid-system measure only shows what changes: a small clef, a key signature with naturals cancelling the old one, a time signature.
3. **Packing.** Systems are filled greedily: a measure joins the system while the sum of widths (start modifiers included) fits the available width. If the next measure announces a key, time or clef change, the end of the system needs room for the **courtesy** signs; measures are removed from the system until they fit.
4. **Justification.** The free space of a system is spread over its measures in proportion to their note area, then inside each measure over the `stretch` of every column: spacing stays proportional. Justification only stretches. A **last system shorter than 60 % of the line is left at its natural width**; a fuller one is justified like the others. A single measure wider than the page keeps its glyph room and gives up proportional space.
5. **Positions.** Every column gets an x. After VexFlow has prepared the notes (accidentals, stems, dots), each tick context is moved to that x. A measure that only holds a rest is centered. The same x values feed the hit test, so no DOM measurement is needed.
6. **Vertical stacking.** Staves of one part are 48 px apart, parts 56 px, with 36 px above and 32 px below each system. Tab staves have as many lines as the instrument has strings (`Part.tuning` or the catalog).

Other rules: a pickup measure uses its own `length` (it gets less width); braces join the staves of a part with two standard staves (a bracket for standard + tab), a bracket joins the parts; the first system shows the full part names and the following ones the **short names** (`InstrumentDef.short`, English and French, in the catalog: `Pno.`, `Vln.`, `Vc.`...; a part renamed by the user keeps its own name, cut to 8 characters with a dot when longer) in a narrower indent; the last measure gets the final barline; `treble-8vb` is a treble clef with a small 8 below (the written position is the treble one); beaming follows the beat (a dotted quarter in compound meters), never across rests or beats; tuplet members are beamed by their real duration; the second voice of a staff has stems down; slurs and ties may cross systems.

**Tablature** (VexFlow `TabStave` / `TabNote`, notes sorted by string): chords are stacked on their strings; **rests** are hidden (a ghost note keeps the rhythm gap) unless the staff has `showRests`, then they are drawn as on a standard staff; **ties and slurs** are arcs between the frets (`TabTie` without the h/p letter; ties across a barline or a system break are drawn as half arcs; a slur of a "standard + TAB" part is drawn on both staves, found by position from the standard events); a note no string can play is a `?` in the middle of the staff, with the out-of-range warning color, triangle mark and tooltip (the mark is not color alone). Tied frets are not parenthesised. `hitTest` adds `string` (1 = highest) on tab staves; clicking a string position sets the input string of the editor. The system cache key includes `showRests`.

## Chord symbols and fretboard diagrams

Chord symbols (and, for guitar and ukulele, diagrams) are part of the engraving, so the screen, the PDF and the PNG show the same thing. The model is described in [score-format.md](score-format.md#chord-symbols), entry in [editor.md](editor.md#chord-symbols).

**Typography** (`chords.ts`, pure). A symbol is a list of text _runs_: root letter, then the quality, then the bass. Everything is set in the UI font (Inter) at 15 px; `m`, `maj`, `dim`, `aug` and `sus` stay on the baseline; numbers, alterations and added tones (`7`, `b5`, `#9`, `6/9`, `add9`, `(maj7)`) are **raised** (5.5 px) and smaller (10.5 px); sharps and flats are **Bravura glyphs** (U+E262, U+E260, double sharp and flat), never `#` and `b`, lifted to the x-height. So `F#m7b5` is "F", sharp, "m", raised "7", raised flat, raised "5". With a capo and the "show the shape" option the shape follows in parentheses at 12 px: `D (C)`. Widths come from an estimate of Inter's advances (`charEm`): enough to keep neighbours apart, and it does not depend on the font having loaded.

**Layout** (`layout.ts`, `chords.ts`).

- A symbol sits on the **column of its tick**. A symbol between two notes creates a column with no notehead (`glyph` 0), so measures still line up across staves.
- **No collision.** After the columns are built, each symbol needs `width + 6 px` before the next symbol of its staff (or the end of the measure): the missing room, if any, is added to the last column in between, before the proportional space is spread. The room of a symbol is the wider of its text and its diagram. This is part of the cached measure shape (`MeasureShape.chords`), so it is incremental: the cache identity of a measure includes, for the staves that have symbols, which of them show a diagram, the number of strings, the capo and the capo-shape option.
- **Vertical.** Symbols alone take no extra height: the baseline is 18 px above the top staff line, inside the usual gap above a staff. A staff that carries diagrams gets a band of 47 px above it (`DIAGRAM_BAND`), in every system (system height stays constant, as before): the symbol is above the diagram, the diagram 12 px above the staff. `StaffSlot` has `diagrams`, `chordY` and `diagramY`; the band is added to `top`, so every consumer of the slots (hit test, highlight, export pagination) already knows about it. Which chords show a diagram is `diagramPlan(score)` (`score/diagrams.ts`: the part's mode, first occurrence or all, and the per-chord flag), computed once per layout.
- A measure with symbols is never "rest only" (its rest is not centered), so symbols keep their beat positions.

**Diagrams** (`drawChords.ts`, `chordMetrics.ts`; shapes from `web/src/chords/library.ts`). Strings are vertical, the lowest on the left, the nut at the top (thick at the neck's start, a plain line plus the fret number on the left when the shape is higher up), 4 fret rows (more when a shape needs them, the height stays the same), `o` for open strings and `x` for muted ones above the nut, filled dots for fingers, a bar for a barre. The diagram is centered under its symbol. The shapes:

- **Library** (`library.ts`, a separate lazy chunk of 2 KB gzip, fetched only when a score shows a diagram; `ScoreView` and the export call `ensureChordLibrary(score)` before the first render, scores without diagrams never load it): the usual open chords for guitar in standard tuning, drop D (the D family on the open low D, the guitar shapes that leave the low string out), ukulele GCEA (re-entrant or low G, same shapes) and baritone ukulele (DGBE, from the guitar). A shape of the same quality moves up the neck as a **barre chord** (E form, A form, C form... the one with the smallest shift wins): `F` is `133211`, `Bm` `x24432`, `Bb` `x13331`, `F#m` `244222`; a bar is drawn only for shapes with no open string, across the strings on its fret, when it reaches the end of the sounded strings (three strings at least, two on a four-string instrument).
- **Generator** for everything else (slash chords, extensions, any other tuning, 7 and 8 strings): a depth-first search over muted/open/fretted strings in a window of four frets, no muted string between two sounded ones, the bass is the lowest sounded string, all required chord tones present and nothing foreign; ranked by position, number of fretted strings, span, muted strings and open strings. Nine strings or more: no diagram.
- **Checked.** Every shape is validated against the chord tones before it is returned (`chordTones`: root, third, seventh, top extension, alterations and the bass are required, the fifth and the lower extensions optional), and a test checks every table entry for all 12 roots and 12 qualities on all tunings.
- **Capo.** Shapes are looked up for the chord the player forms: the sounding chord lowered by the capo (`shapeOf`), frets counted from the capo (the nut line is the capo). D with a capo on fret 2 shows the `C` shape.
- **Custom fingering** (`ChordSymbol.frame`, from a MusicXML `<frame>`) replaces the library shape.

**DOM.** Each symbol is `<g class="vf-pm-chord" data-chord-id data-chord>` (text runs inside) and each diagram `<g class="vf-pm-diagram" data-chord-id data-frets>`, in the system's group: a system that did not change keeps its nodes (the signature includes the placed chords and the tuning, capo and diagram options of the parts). `data-frets` lists the frets from the highest string. The export reads only `text`, `path` and `rect`: diagram strokes and dots are paths (arcs become cubics), the accidentals are outlines of the Bravura table, the text is Helvetica (see [export.md](export.md)).

**Hit testing.** `hitTest` returns `chord: { id, tick }` (and the staff that carries it) when the point is on a symbol or on its diagram: a click edits the chord. `chordAnchor(layout, staffId, measure, tick)` (`chordAnchor.ts`) gives where the text field goes, also for a position between two columns.

## Hit testing and boxes

`hitTest(layout, x, y)` (or `engraver.hitTest`) works on SVG coordinates (`clientX - svg.left`). It returns `null` outside the systems, otherwise `{systemIndex, partId, staffId, measureIndex, eventId?, pitch?, string?}`:

- the staff is the nearest one to `y` (between two staves the closer wins);
- `eventId` is set when the point is on a notehead, rest or tab number (small tolerance);
- `pitch` is the natural pitch drawn at that height for the clef in force at that measure, up to 3.5 staff spaces away from the staff (ledger lines), on standard staves only. The key signature is not applied: the input code decides.

- `string` is the string under the point (1 = highest), on tab staves only.

`eventBox(layout, id)` and `eventBoxes(layout)` give the bounding box of events (for selection and playback highlighting). A Playwright test checks that the boxes match where VexFlow really drew the noteheads.

## Theming and highlighting

The SVG sets `color: var(--score-ink)` and VexFlow draws with `currentColor`; a few hard-coded colors of VexFlow (stems, ledger lines) are overridden in `engraving.css`. Each event is a `<g class="pm-event" data-event-id="...">`. `setSelection(ids)` adds `pm-selected` (color `--accent`, plus a soft `--accent-soft` rectangle in a separate overlay group); `setPlaying(ids)` adds `pm-playing` (color `--play`); `setPlayCursor(ids)` moves one `<rect class="pm-cursor">` (color `--play`) over the given events and returns its box, for playback ([docs/playback.md](playback.md)). Both are class toggles on existing nodes, so they never re-engrave and work with the dark theme.

## Incremental rendering

The model shares unchanged objects between versions, so references are the change detector.

- Measure shapes are cached by measure index and invalidated when the staff measures (or the previous one, for ties) or the clef/key/time context change by reference or value.
- Each system is drawn in its own `<g>`, in coordinates local to the system, and positioned with `transform`. A system keeps its DOM node when its _signature_ is unchanged: the placement (every x, width and modifier), the staff measure references it uses (and the one before it), the slurs touching it and the part names. An edit therefore re-engraves only the affected system(s), and the following systems are only translated if the height above them changed. A width change (resize) re-engraves everything, debounced at 120 ms in `ScoreView`.
- `engraver.render(score, width)` returns `{ms, systems, drawn, reused, overflow}`. `overflow` counts systems whose start modifiers were wider than what the layout reserved: it must stay 0 (checked on every fixture by the browser tests).

## Progressive rendering

`engraver.render(score, width, { progressive: true })` (what `ScoreView` uses) computes the whole layout at once (it is pure and takes a few ms), sets the final size of the SVG, then engraves synchronously the systems that intersect the viewport (with a small margin), so the first system is painted quickly. The other systems are engraved in chunks of at most 20 ms in `requestIdleCallback` (`setTimeout` where it does not exist), in score order, and are inserted in the DOM at their place. `engraver.stats.complete` is `false` until the queue is empty and `await engraver.settled()` resolves when everything is drawn.

- Hit testing and boxes only use the layout, so they work on systems that are not drawn yet; selection and playback highlights are applied to a system as soon as it is drawn.
- Out-of-range warnings (#15) are class toggles like selection: `Engraver.setWarnings(list)` adds `pm-warn` (warning color) on the events and draws a triangle mark with a tooltip above each in a separate layer, from the layout boxes (so no re-engrave); a newly engraved system gets the class when it is drawn. The mark keeps the warning from relying on color alone.
- A new `render` cancels the pending chunks. Systems already drawn and unchanged are reused as usual, so an edit is still incremental, and `render(score, width)` without options stays fully synchronous (what the benchmarks use).
- `RenderStats` gains `firstSystemMs` (time to the first engraved system) and `complete`.

## Accessibility

The SVG has `role="img"` and an `aria-label` summary (title, number of instruments and measures, in the current language). `ScoreView` also renders a visually hidden `role="status"` / `aria-live="polite"` region fed by the `liveMessage` prop: the description of the selected event will go there (#19). The overlay is `aria-hidden`.

## Using `ScoreView`

```tsx
<ScoreView
  score={score} // optional: defaults to the "Au clair de la lune" fixture for now
  selection={["e12"]} // event ids, class toggle
  playing={["e13"]} // event ids, class toggle
  onHit={(hit, event) => {}} // pointer down: what is under the pointer
  liveMessage="C4, quarter note"
/>
```

### Preview hook (tests)

`#/editor?fixture=<name>&width=<px>` shows a fixture from `web/src/score/fixtures` (or `accidentals`, `benchmark100`) at a fixed width and exposes `window.__polymnia = { engraver, score, width }`. The browser tests use it; it adds nothing to the initial bundle.

### Re-flow while typing

An edit that moves line breaks (a measure gets wider, a note is added to a full measure) changes every following system, and several of them are on screen. A keystroke must stay under a 60 fps frame, so the synchronous part is time-boxed:

1. The layout is computed in full (about 1 ms with the shape cache) and the SVG size is final: hit testing, event boxes and the selection background are correct at once, even for systems not engraved yet.
2. The systems to engrave are the ones on screen, the one holding the selection first. They are engraved while the call has spent less than 6 ms (layout included) and the next one is not expected to overrun it (the cost of a system is a moving average of the measures, about 3 to 5 ms for a grand staff). The first one is always engraved: it holds the edit.
3. The visible systems left over are engraved one per task right after the call (`setTimeout`, not idle time), so a key pressed meanwhile is not kept waiting; the others follow in idle chunks. For a few milliseconds a system waiting for its turn is blank.
4. Highlights are not re-applied to the whole score on every render any more (it cost about 4 ms on 100 measures): only the systems engraved by the call, and `setSelection` toggles the difference between the old and the new selection.

Line-break hysteresis during note input was not needed to meet the budget and is not implemented: a measure never overflows the page width and the breaks always follow the pure layout.

## Tests

- Unit (Vitest): `notation.test.ts`, `layout.test.ts` (system breaking, widths, justification, courtesy changes, cache, density, spacing, accidentals, short last system), `../web/src/export/density.test.ts` (measures per system and A4 page count of the 100-measure fixture), `hitTest.test.ts`, `ScoreView.test.tsx`.
- Browser (Playwright, `e2e/engraving.spec.ts`): every fixture engraves without error and without overflow, layout agrees with VexFlow, real click hit test, highlight toggles, dark theme, resize, **performance budgets**.
- Browser, re-flow (`e2e/engraving.spec.ts`): after a re-flow, only part of the systems is engraved by the call, hit testing answers for the last (undrawn) system, then every system is drawn, in order.
- Browser, keystroke budget (`e2e/note-entry.spec.ts`, "performance"): real key events on a 100-measure score, time from the key to the end of the synchronous render, p95 < 16 ms for a filled score, for a re-flow at the top of a filled score and while filling an empty score. `PLAYWRIGHT_PORT` changes the preview port when another run uses 4173.
- Browser, fonts and progressive render (`e2e/engraving-fonts.spec.ts`): no font embedded in any JavaScript response, one hashed Bravura file and a preload link, the score renders when Bravura arrives late (the request is delayed by 3.5 s), progressive render (full height at once, partial drawing, then complete, first system under 100 ms).
- `npm run size` (after `npm run build`) fails when the initial JS, the editor chunk or the Bravura file exceed their budget, or when a font is embedded in a JS chunk.
- Chord symbols: `chords.test.ts` (runs, widths, diagram plan), `layoutChords.test.ts` (columns, no collision at any width, bands, incremental cache, anchors, hits), `../chords/library.test.ts` (every shape of every tuning checked against its chord tones, capo, generator), Playwright `e2e/chords.spec.ts` (entry, diagrams and capo with the real shapes, PDF content, performance).
- Visual (`e2e/visual/`): screenshots of single staff, grand staff, chords, accidentals and key changes, ties and slurs, triplets, guitar standard + tab, cello clef changes, pickup measure, dark theme with highlights.

## Updating the visual baselines

Pixels differ between operating systems, so the baselines in `web/e2e/__screenshots__/` are generated on Linux inside the official Playwright Docker image (the same version as `@playwright/test`), which is what CI runs. On Windows and macOS the visual tests are skipped. With Docker running, from `web/`:

```
npm run test:visual:update   # regenerate the baselines, then review the diff of the PNG files
npm run test:visual:docker   # check against the committed baselines in the same image
```

Commit the changed PNG files with the code that changed the rendering, and say why in the pull request.

## Numbers

Measured in Chromium (Windows 11 laptop, production build), `benchmark100`: 100 measures, grand staff, 23 systems at 1100 px (34 before #46), mostly eighth notes with accidentals and ties.

| What                                                                            | Budget          | Measured                                                                  |
| ------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------- |
| First system painted (after the chunk is loaded)                                | < 100 ms        | about 27 ms                                |
| Full render, first ever (JIT cold), all systems                                 | n/a             | about 207 ms (drawing runs in idle chunks) |
| Full render, warm (median of 7)                                                 | < 200 ms        | about 83 ms                                                              |
| One edit, median / max of 25                                                    | < 16 ms         | about 4.9 ms / 9 ms                                                        |
| Keystroke, filled score, median / p95 / max of 40                               | p95 < 16 ms     | 9.6 / 14.1 / 15.2 ms (edit on screen; systems hold more measures, so each one costs more)                                     |
| Keystroke with a re-flow at the top of a filled score, median / p95 / max of 40 | p95 < 16 ms     | 9.3 / 13.7 / 14.0 ms, 1 system at most    |
| Keystroke while filling an empty score, median / p95 / max of 400               | p95 < 16 ms     | 3.7 / 7.1 / 12.6 ms                         |
| Highlight (selection + playing)                                                 | class toggle    | < 1 ms                                                                    |
| Layout alone (jsdom)                                                            | n/a             | a few ms                                                                  |
| Initial JS                                                                      | <= 150 KB gzip  | 72.7 KB                                                                   |
| Editor chunk (VexFlow + engraving, no font)                                     | <= 200 KB gzip  | 180 KB (was 468 KB with the fonts)                                        |
| Bravura font file                                                               | <= 250 KB woff2 | 247 KB, separate file, immutable cache                                    |

The browser tests (`@perf`, project `perf`, see [development.md](development.md)) take warm-up iterations and many samples, assert the median against the strict budget and the p95 against twice the budget. They assert warm full render < 200 ms, cold < 600 ms (JIT, parallel workers, slower CI machines), edit median < 16 ms, keystroke median < 16 ms and p95 < 32 ms in the three scenarios above (CI runners are about twice as slow as the reference laptop).

**Chord symbols** (same machine, 100 measures, 800 eighth notes, a symbol on each of the first 240 beats, a chord typed or replaced in a measure on screen; `e2e/chords.spec.ts`): 40 edits end to end (the call that writes the chord to the end of the synchronous render), median 5.5 ms, p95 7.2 ms, max 8.3 ms, one system engraved per edit; note keystrokes on the same score: median 4.7 ms. The layout of the chords is cached per measure like the notes. Two engraver fixes came with it: the SVG size attributes are only set when the size changes (setting an attribute to the same value invalidated the layout of the whole SVG, which the next forced layout paid for: this alone took a keystroke on a filled 100-measure score from a median of 8.5 ms to 4.7 ms), and cancelling a pending idle chunk no longer throws "Illegal invocation" (`cancelIdleCallback` was called as a method of the job). The chord library is a separate 2 KB gzip chunk; the initial bundle went from about 136 KB to 144 KB gzip (parser, commands, strings, field), under the 150 KB budget.
