# MusicXML import and export

**English** · [Français](musicxml.fr.md)

Polymnia reads and writes MusicXML 4.0 **partwise** scores, uncompressed (`.musicxml`, `.xml`) and compressed (`.mxl`). The code is in [`web/src/musicxml/`](../web/src/musicxml), pure functions over the [score model](score-format.md), loaded on first use (a separate chunk of about 16 KB gzip, so the initial bundle is unchanged).

```ts
import {
  exportMusicXml,
  importMusicXml,
  scoreToMusicXml,
  parseMusicXml,
} from "./musicxml";

const file = exportMusicXml(score, "mxl"); // { bytes, mime, extension }
const { score, report } = importMusicXml(bytes); // .musicxml, .xml or .mxl, throws MusicXmlError
```

## In the editor

- **Export** (top bar) opens a menu: MusicXML (`.musicxml`) or compressed MusicXML (`.mxl`). The file is named after the score title.
- **Import** (top bar button, or drop a file on the editor) reads the file, then asks for confirmation (the current score is replaced and its history is dropped), then shows the **import report** when something was left out or adjusted.
- The menu, the dialogs and the live region are keyboard accessible and announced to screen readers; strings exist in English and French.

## Mapping

| Score model                          | MusicXML                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ticks (960 per quarter)              | `<divisions>960</divisions>` on export; any `<divisions>` on import, converted to ticks                                                                                |
| part, staves of a part               | `<part>` with `<staves>` and `<staff>`; backup between staves and voices                                                                                               |
| voice _v_ of staff _s_               | `<voice>` `4s+v+1`; on import, per staff, voices are ranked by number (voice 1 or the lowest number is voice 0)                                                        |
| spelled pitch (written)              | `<pitch>` step, alter, octave; `<accidental>` is not needed                                                                                                            |
| `Part.transposition`                 | `<transpose>` (chromatic and octave-change, written to sounding)                                                                                                       |
| clef, clef change at a measure start | `<clef>` (G2, F4, C3 alto, C4 tenor, G2 with octave change -1, percussion)                                                                                             |
| `time`, `keyFifths`                  | `<time>`, `<key><fifths>` (sparse: only where they change)                                                                                                             |
| `tempoBpm`                           | `<direction>` with `<metronome>` and `<sound tempo>`; on import `<sound tempo>` first, else the metronome (dotted units converted to quarters per minute)              |
| pickup (`length`)                    | `implicit="yes"` on export; on import any measure whose content is shorter than the time signature gets a `length`                                                     |
| chord                                | `<chord/>` notes                                                                                                                                                       |
| duration, dots                       | `<type>`, `<dot/>`, `<duration>`; unrepresentable durations on import become tied notes or several rests                                                               |
| tuplet                               | `<time-modification>` and `<tuplet type>`; on import 3:2 and the other ratios 2 to 9, with or without tuplet marks                                                     |
| `tieToNext`                          | `<tie>` and `<tied>` start/stop                                                                                                                                        |
| slur                                 | `<slur type number>` (numbers 1 to 16 per part)                                                                                                                        |
| tab staff                            | clef `TAB`, `<staff-details>` (`<staff-lines>`, `<staff-tuning line>`, `<capo>`)                                                                                       |
| `fretting`                           | `<technical><string><fret>`                                                                                                                                            |
| chord symbol, diagram                | `<harmony>` (`root`, `kind`, `bass`, `degree`), `<frame>`, see "Chord symbols" below                                                                               |
| instrument                           | `<instrument-sound>` and a `polymnia-instrument-Pn` miscellaneous field (exact catalog id, for round trips); on import the sound id, then the part name, then `custom` |

A fretting the user chose (`manual`) is written with an extra `<other-technical>polymnia-manual-fingering</other-technical>` inside `<technical>` (the standard extension element, ignored by other programs); on import it restores the flag, so user frettings survive a round trip and derived ones stay derived. Frettings from other programs import as derived-but-valid (they are kept while the notes around are edited).

Round trip: every fixture exports and imports back to the same score (ids are regenerated), with an empty report. Exported tab staves lose their (unused) clef: it comes back as the instrument default.

## Chord symbols

Chord symbols are written and read as `<harmony>` (code in `web/src/musicxml/harmony.ts`), diagrams as `<frame>`. Model: [score-format.md](score-format.md#chord-symbols).

**Export.** Before the notes of each measure, one `<harmony>` per symbol, in the order of the schema: `<root>` (`root-step`, `root-alter` when not 0), `<kind text="m7">minor-seventh</kind>`, `<bass>`, `<degree>` elements, `<frame>`, `<offset>` (in divisions, which are ticks here, written when the symbol is not at the start of the measure), `<staff>` (when the part has several staves). The cursor is at the start of the measure, so the position is the offset: other programs place it correctly, and a harmony does not need a note under it.

| Quality                                            | `<kind>`                                                                                                      | `<degree>`                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| major (empty), `m`, `aug`, `dim` | `major` `minor` `augmented` `diminished` | |
| `6` `m6` `6/9`                                     | `major-sixth` `minor-sixth` `major-sixth`                                                                     | `6/9`: ninth, type `add`                        |
| `7` `maj7` `m7` `dim7` `aug7` `m7b5` `m(maj7)`     | `dominant` `major-seventh` `minor-seventh` `diminished-seventh` `augmented-seventh` `half-diminished` `major-minor` |                                                 |
| `9` `11` `13`, `maj9`..., `m9`...                  | `dominant-ninth`, `major-ninth`, `minor-ninth`, `...-11th`, `...-13th`                                        |                                                 |
| `sus2` `sus4` `5`                                  | `suspended-second` `suspended-fourth` `power`                                                                 |                                                 |
| `b5 #5 b9 #9 #11 b13`                              | (unchanged)                                                                                                   | `<degree-type>alter</degree-type>` with the alteration |
| `add9` `add11` `add13` `add2` `add4`               | (unchanged)                                                                                                   | `<degree-type>add</degree-type>`                |
| anything else (`7sus4`, `maj7#5`, `dim7add9`...)   | `other`                                                                                                       | none: the quality is in `text`                  |

`kind@text` always holds the normalized quality, so a Polymnia file comes back exactly. Every quality of the parser is tested through `.musicxml`.

**Import.** The structure comes first: the `kind` gives the quality (the table above, plus `none`, which is dropped as "no chord"), the `<degree>` elements complete it (`alter` or `add` with a non-zero `degree-alter` is an alteration; `add` of 9, 11 or 13 an added tone; `add` of 6 or 7 a sixth or a seventh; `subtract` and anything else is dropped), a sixth with an added ninth is a six-nine. For `kind="other"` the `text` attribute is parsed (so `text="7sus4"` works, `text="alt"` does not). The position is the cursor plus `<offset>` (in divisions), and the staff is `<staff>` (the first staff when it is absent or does not exist). Two harmonies at the same position keep the first one; one past the end of the measure is dropped. A root alteration is rounded and limited to -2..2.

**Not imported, and counted in the report** (`dropped`): harmonies with a `<numeral>` or `<function>` instead of a root (`harmony (numeral or function)`), kind `none` (`harmony (no chord)`), kinds that are not chords of the model (`harmony (kind Neapolitan)`), a quality the parser cannot read (`harmony (quality)`), a degree it cannot apply (`harmony degree`), a second harmony at the same position and one outside the measure (`harmony (same position)`, `harmony (outside measure)`). Only the first `<harmony-chord>` of a polychord is read. `<inversion>`, `<bass-separator>` and the print attributes are ignored.

**Diagrams.** On export, `<frame>` is written for every chord that shows a diagram, with the library shape (or the custom one): `frame-strings`, `frame-frets` 4, `first-fret` when the window is not at the nut, one `frame-note` per sounded string, lowest string first (`string` 1 is the highest, as everywhere in MusicXML; open strings have `fret` 0, muted strings no note), `<barre type="start">` on the lowest string of the barre and `type="stop"` on the highest. Frets are counted from the capo, as in the editor. On import, a frame whose string count matches the part's tuning is read (`frets`, `base`, `barre`); a frame with another number of strings is dropped (`frame` in the report). A frame **equal to the shape the library would draw** is not custom and is dropped; the chord gets `diagram: true` when the part's mode would not have shown it, so a diagram that came with a file stays visible and a Polymnia file round-trips exactly. A frame that differs is kept as the chord's custom fingering and played as drawn.

**Polymnia fields.** The model has options that MusicXML has no place for (a part's diagram mode, the capo shape option, a chord's own diagram flag). They are written as `<miscellaneous-field>` of the file (the same mechanism as `polymnia-instrument-Pn`): `polymnia-chord-diagrams-Pn` (`first` or `all`), `polymnia-chord-capo-shapes-Pn` (`1`) and `polymnia-chord-flags-Pn` (`measure.staff.tick=1|0` separated by `;`). Other programs ignore them; on import they restore the options, so every fixture with chords round-trips to the same score.

## What is not imported

Unsupported elements are dropped and **counted per element type** in the report (`dropped`), for example `dynamics`, `words`, `wedge`, `lyric`, `fermata`, `trill-mark`, `staccato`, `grace`, `repeat`, `ending`, `credit`, `part-group`, `up-bow`, `fingering`, `clef (mid-measure)`, `tempo (mid-measure)`, `voice` (a fifth voice and beyond), `staff` (beyond four). Content that is kept in an approximate form is counted in `adjusted`: `alter (microtone)`, `duration (quantized)` (to a 32nd), `overfull measure`, `unreadable measure` (replaced by rests), `tuplet` (kept as plain notes when it cannot be a tuplet), `clef` (an unusual clef mapped to the closest supported one).

Other rules: unpitched notes become rests; `forward` becomes a rest; time and key come from the first part, tempo from any part; timewise scores (`score-timewise`) are refused; additive time signatures are summed (`3+2` over 8 is 5/8); a note outside the range of the model's octaves is dropped; frettings that disagree with the tuning are dropped (`fretting`).

## Security

The file is untrusted. In order:

1. **Size**: at most 20 MB as received, and 20 MB of XML text.
2. **Entities**: the text is scanned before parsing. Any `<!ENTITY` and any DOCTYPE with an internal subset (`[ ... ]`) is rejected (entity expansion, "billion laughs", external entities). A DOCTYPE that only names the public MusicXML DTD is accepted: the browser parser never loads it.
3. **Element count**: more than 1.5 million tags are rejected before any DOM is built.
4. **Parser**: the browser `DOMParser` (`application/xml`), which does not fetch external resources. Parse errors are rejected.
5. **MXL (ZIP)**: at most 100 entries, no absolute path, drive letter, backslash, control character or `..` segment in any entry name, declared uncompressed sizes of at most 20 MB in total, all checked **before inflating**; only the container and the score entry are inflated, into buffers sized from the checked declarations (a header that lies cannot make the archive expand beyond them), and the result is checked again.
6. **Result**: the score goes through `validateScore` and the strict decoder (`fromJson`: shapes, ranges and the size limits of [score-format.md](score-format.md)). It never returns an invalid score.
7. **Rendering**: nothing from the file is ever inserted as HTML. Text (title, composer, part names, report entries) is plain strings, stripped of control characters and truncated, displayed by React as text.

## Limits

20 MB file, 20 MB XML, 100 archive entries, 1.5 M tags, 2000 measures, 32 parts, 4 staves per part, 4 voices per measure, 12 pitches per chord, 512 events per voice (the model limits). MusicXML octaves go from 0 to 9, the model also holds octave -1 (MIDI 0 to 11). On export such pitches are **left out** (never moved to another octave): a note whose pitches are all below C0 becomes a rest, and the export report (dialog after the download, `dropped` in `exportMusicXml`) counts them as `pitch (below octave 0)`.

The commands are also in the command palette (`Ctrl+K`, group File): import (`Ctrl+O`), export MusicXML (`Ctrl+Shift+E`), export MXL (`Ctrl+Shift+M`).

## Performance

Budget: import and export of a 500-measure score under 500 ms each. Measured in Chromium by `e2e/musicxml-perf.spec.ts` (500 measures, 2 staves) with User Timing marks around the MusicXML code: import about 23 ms, export about 4 ms (about 325 ms and 110 ms wall clock including the file hand-off, the dialog and the download). The unit tests (jsdom, a JavaScript XML parser several times slower than a browser) measure on 500 measures and 4 staves (1 MB of XML) export 7 ms, export `.mxl` 18 ms, import about 260 ms, and only guard against regressions (2 s).

## Tests

`web/src/musicxml/*.test.ts` (`harmony.test.ts`: every kind, degrees, offsets and positions, staves, frames and barres, what is dropped, and a round trip of 49 qualities, roots, basses, diagram flags and custom fingerings): round trip on every fixture (`.musicxml` and `.mxl`), hand-written import fixtures in `web/src/musicxml/fixtures/` (public-domain melodies: Ode to Joy in the style of common notation software with `backup`/`forward`, several voices and `divisions` 2; a guitar tab in drop D with a capo; a pickup measure with key, time, tempo and clef changes and an untagged triplet; a file full of unsupported elements for the report), security tests (entities, size, zip bomb, lying header, path traversal, element count) and performance. `web/e2e/musicxml.spec.ts` covers downloads, the keyboard menu, import with confirmation and report, and a refused file.
