# Engraving

**English** · [Français](engraving.fr.md)

The engraver turns a score (see [score-format.md](score-format.md)) into SVG. It lives in [`web/src/engraving/`](../web/src/engraving). Drawing is done by [VexFlow](https://www.vexflow.com/) 5.11.0 (MIT, pinned exactly in `package.json`); **layout is ours**: VexFlow only draws notes, staves and symbols where our layout tells it to.

## Modules

| File | Role | VexFlow |
| ---- | ---- | ------- |
| `notation.ts` | Staff geometry (clef to y), accidental state, beam groups, tick helpers | no |
| `layout.ts` | Measure widths, system breaking, justification, event x positions | no |
| `hitTest.ts` | Point to `{partId, staffId, measureIndex, eventId, pitch}`, event bounding boxes | no |
| `draw.ts` | Draws one system (staves, notes, beams, tuplets, ties, slurs, connectors, names) | yes |
| `engraver.ts` | Owns the SVG, incremental re-render, highlighting | yes |
| `ScoreView.tsx` | React component: lazy loading, resize, props to engraver | no (lazy) |

Everything that does not need VexFlow is pure TypeScript and unit-tested in jsdom. `ScoreView` loads `engraver.ts` (and so VexFlow) with a dynamic `import()` after the first paint: **VexFlow is not in the initial bundle**. VexFlow is MIT licensed; the `vexflow/bravura` entry point is used (Bravura music font and Academico text font embedded as data), the only ESM entry that works without a separate font download. It is not tree-shakable in practice, so the lazy chunk is large (about 468 KB gzip, see "Numbers").

## Layout algorithm

All sizes are px; one staff space is 10 px (13 px on tab staves).

1. **Measure shape** (cached per measure). All staves of a measure are analysed together so that notes of different staves line up. The events are grouped in *columns*, one per distinct onset (tick). Each column gets:
   - `lead`: room before the notehead for accidentals (4 + 11 px per stacked accidental, up to 3),
   - `glyph`: notehead, dots (7 px each), displaced second in a chord, flag,
   - `stretch`: proportional space after the column, `4 + 12 x log2(gap / 120 + 1)` where `gap` is the time (ticks) to the next column or to the end of the measure. A quarter gets about 43 px, a half about 54 px, a 16th about 23 px: widths grow with duration but sub-linearly.
   The minimum note area of a measure is `padLeft + sum(lead + glyph + stretch) + padRight`. Accidentals follow the key signature and the measure-local state (any voice, in time order; a pitch tied from the previous measure does not repeat its accidental).
2. **Start modifiers.** The first measure of a system gets a full clef, the key signature (if not C major) and, at the start of the score or when it changes, the time signature. A mid-system measure only shows what changes: a small clef, a key signature with naturals cancelling the old one, a time signature.
3. **Packing.** Systems are filled greedily: a measure joins the system while the sum of widths (start modifiers included) fits the available width. If the next measure announces a key, time or clef change, the end of the system needs room for the **courtesy** signs; measures are removed from the system until they fit.
4. **Justification.** The free space of a system is spread over its measures in proportion to their note area, then inside each measure over the `stretch` of every column: spacing stays proportional. The last system is stretched by at most 1.35. A single measure wider than the page keeps its glyph room and gives up proportional space.
5. **Positions.** Every column gets an x. After VexFlow has prepared the notes (accidentals, stems, dots), each tick context is moved to that x. A measure that only holds a rest is centered. The same x values feed the hit test, so no DOM measurement is needed.
6. **Vertical stacking.** Staves of one part are 56 px apart, parts 72 px, with 44 px above and below each system. Tab staves have as many lines as the instrument has strings (`Part.tuning` or the catalog).

Other rules: a pickup measure uses its own `length` (it gets less width); braces join the staves of a part with two standard staves (a bracket for standard + tab), a bracket joins the parts; part names are drawn on the first system only; the last measure gets the final barline; `treble-8vb` is a treble clef with a small 8 below (the written position is the treble one); beaming follows the beat (a dotted quarter in compound meters), never across rests or beats; tuplet members are beamed by their real duration; the second voice of a staff has stems down; slurs and ties may cross systems.

## Hit testing and boxes

`hitTest(layout, x, y)` (or `engraver.hitTest`) works on SVG coordinates (`clientX - svg.left`). It returns `null` outside the systems, otherwise `{systemIndex, partId, staffId, measureIndex, eventId?, pitch?}`:

- the staff is the nearest one to `y` (between two staves the closer wins);
- `eventId` is set when the point is on a notehead, rest or tab number (small tolerance);
- `pitch` is the natural pitch drawn at that height for the clef in force at that measure, up to 3.5 staff spaces away from the staff (ledger lines), on standard staves only. The key signature is not applied: the input code decides.

`eventBox(layout, id)` and `eventBoxes(layout)` give the bounding box of events (for selection and playback highlighting). A Playwright test checks that the boxes match where VexFlow really drew the noteheads.

## Theming and highlighting

The SVG sets `color: var(--score-ink)` and VexFlow draws with `currentColor`; a few hard-coded colors of VexFlow (stems, ledger lines) are overridden in `engraving.css`. Each event is a `<g class="pm-event" data-event-id="...">`. `setSelection(ids)` adds `pm-selected` (color `--accent`, plus a soft `--accent-soft` rectangle in a separate overlay group); `setPlaying(ids)` adds `pm-playing` (color `--play`). Both are class toggles on existing nodes, so they never re-engrave and work with the dark theme.

## Incremental rendering

The model shares unchanged objects between versions, so references are the change detector.

- Measure shapes are cached by measure index and invalidated when the staff measures (or the previous one, for ties) or the clef/key/time context change by reference or value.
- Each system is drawn in its own `<g>`, in coordinates local to the system, and positioned with `transform`. A system keeps its DOM node when its *signature* is unchanged: the placement (every x, width and modifier), the staff measure references it uses (and the one before it), the slurs touching it and the part names. An edit therefore re-engraves only the affected system(s), and the following systems are only translated if the height above them changed. A width change (resize) re-engraves everything, debounced at 120 ms in `ScoreView`.
- `engraver.render(score, width)` returns `{ms, systems, drawn, reused, overflow}`. `overflow` counts systems whose start modifiers were wider than what the layout reserved: it must stay 0 (checked on every fixture by the browser tests).

## Accessibility

The SVG has `role="img"` and an `aria-label` summary (title, number of instruments and measures, in the current language). `ScoreView` also renders a visually hidden `role="status"` / `aria-live="polite"` region fed by the `liveMessage` prop: the description of the selected event will go there (#19). The overlay is `aria-hidden`.

## Using `ScoreView`

```tsx
<ScoreView
  score={score}              // optional: defaults to the "Au clair de la lune" fixture for now
  selection={['e12']}        // event ids, class toggle
  playing={['e13']}          // event ids, class toggle
  onHit={(hit, event) => {}} // pointer down: what is under the pointer
  liveMessage="C4, quarter note"
/>
```

### Preview hook (tests)

`#/editor?fixture=<name>&width=<px>` shows a fixture from `web/src/score/fixtures` (or `accidentals`, `benchmark100`) at a fixed width and exposes `window.__polymnia = { engraver, score, width }`. The browser tests use it; it adds nothing to the initial bundle.

## Tests

- Unit (Vitest): `notation.test.ts`, `layout.test.ts` (system breaking, widths, justification, courtesy changes, cache), `hitTest.test.ts`, `ScoreView.test.tsx`.
- Browser (Playwright, `e2e/engraving.spec.ts`): every fixture engraves without error and without overflow, layout agrees with VexFlow, real click hit test, highlight toggles, dark theme, resize, **performance budgets**.
- Visual (`e2e/visual/`): screenshots of single staff, grand staff, chords, accidentals and key changes, ties and slurs, triplets, guitar standard + tab, cello clef changes, pickup measure, dark theme with highlights.

## Updating the visual baselines

Pixels differ between operating systems, so the baselines in `web/e2e/__screenshots__/` are generated on Linux inside the official Playwright Docker image (the same version as `@playwright/test`), which is what CI runs. On Windows and macOS the visual tests are skipped. With Docker running, from `web/`:

```
npm run test:visual:update   # regenerate the baselines, then review the diff of the PNG files
npm run test:visual:docker   # check against the committed baselines in the same image
```

Commit the changed PNG files with the code that changed the rendering, and say why in the pull request.

## Numbers

Measured in Chromium (Windows 11 laptop, production build), `benchmark100`: 100 measures, grand staff, 34 systems at 1100 px, mostly eighth notes with accidentals and ties.

| What | Budget | Measured |
| ---- | ------ | -------- |
| Full render, first ever (JIT cold) | n/a | 210 to 260 ms |
| Full render, warm (median of 7) | < 200 ms | about 120 ms |
| One edit, median / max of 25 | < 16 ms | about 6 ms / 10 ms |
| Highlight (selection + playing) | class toggle | < 1 ms |
| Layout alone (jsdom) | n/a | a few ms |
| Initial JS | <= 150 KB gzip | 72.7 KB |
| Lazy chunk (VexFlow + fonts) | n/a | 468 KB gzip |

The browser test asserts warm full render < 200 ms, cold < 600 ms (JIT, parallel workers, slower CI machines), edit median < 16 ms.
