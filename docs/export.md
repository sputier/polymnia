# Export: MIDI, PDF and PNG

**English** · [Français](export.fr.md)

Three ways to get a score out of Polymnia as a file, next to [MusicXML](musicxml.md). The code is in [`web/src/export/`](../web/src/export), loaded on first use with `import('../export')` (a separate chunk of about 51 KB gzip, so the initial bundle does not change; the engraver chunk it reuses is already loaded by the editor).

## Using it

| Action           | How                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export a file    | Top bar **Export** menu: MIDI (`.mid`), PDF, PNG images. Also the command palette (group "File") and `Ctrl/Cmd+Shift+U` (MIDI), `Ctrl/Cmd+Shift+F` (PDF), `Ctrl/Cmd+Shift+G` (PNG)                              |
| Choose the paper | Same menu, **Paper: A4** or **Paper: Letter** (checked item). Default from the browser language: Letter for en-US, en-CA, es-MX and a few others, A4 elsewhere. Remembered in `localStorage` (`polymnia.paper`) |
| Follow progress  | A small panel (bottom right, `role="status"`) shows "Page 3 of 11" for PDF and PNG; the live region announces the start and the file name                                                                       |

File names come from the score title (`Long-piece.pdf`, `score.mid` without a title). A one-page PNG export is one `.png`; several pages are one `.zip` of `page-01.png`, `page-02.png`... (one download instead of a burst of downloads that browsers block, and the pages stay together). If the format cannot hold something, the **export report** dialog of the MusicXML export lists it with counts (staves over the 15 MIDI channels, pitches outside 0 to 127, glyphs without an outline).

## MIDI

`midi.ts` writes a Standard MIDI File, **format 1**, 960 ticks per quarter note (the score's own resolution, so triplets, quintuplets and every duration of the model are exact; nothing is quantized).

- **Timing comes from playback.** The notes are the ones `buildTimeline` ([playback.md](playback.md)) produces: sounding pitch (written pitch plus the part transposition, capo already included), ties merged into one note (also across barlines and per chord pitch), tuplet-scaled durations, pickup measures at their real length, every voice of every staff. Playback and file cannot disagree.
- **Track 0 (conductor):** title as track name, a tempo event at every tempo change (`60 000 000 / bpm` microseconds per quarter), a time signature event at the start and at each change, a key signature event (sharps/flats, major) at the start and at each change, end of track at the end of the music.
- **One track per staff**, named after the part (`Piano 1`, `Piano 2` for the two staves of a piano), a program change to the instrument's General MIDI program (`gmProgram` of the [catalog](score-format.md)), then note on / note off at velocity 80. At equal ticks a note off sorts before a note on, so repeated notes re-attack.
- **Channels.** Each staff has its own channel. Channel 10 (index 9) is General MIDI percussion and is **never** used, which leaves 15 channels: a file holds at most 15 staves; the others are left out and counted in the report as `midi-staff-over-15-channels`. Pitches outside 0 to 127 are left out (`midi-pitch-out-of-range`).
- No dependency: the encoder is about 150 lines (VLQ, chunks, meta events).

## PDF

`pages.ts` + `svgItems.ts` + `pdf.ts`. A4 (595.28 x 841.89 pt) or Letter (612 x 792 pt), margins 48 pt, title centered and composer right-aligned on the first page, `n / N` at the bottom of every page.

**Approach, and why.** We evaluated (a) jsPDF 4.2.1 + svg2pdf.js 2.9.0 (both MIT), (b) `window.print()` with a print stylesheet, and (c) our own small PDF writer. We chose **(c)**, fed by the same SVG the engraver produces:

|                       | (a) jsPDF + svg2pdf.js                                                                                                                                                                             | (b) print stylesheet                                                                                                     | (c) own writer (chosen)                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Size                  | jsPDF is 30 MB unpacked on npm and its browser build is on the order of 100 KB gzip or more (not measured here), svg2pdf.js adds to it                                                             | none                                                                                                                     | 6 KB of code, `fflate` (already a dependency) for Flate                |
| Bravura glyphs        | VexFlow 5 draws notes as `<text>` in Bravura. jsPDF embeds **TrueType only**; we ship `woff2` (and the package has a CFF `.otf`), so we would need a font conversion step and a font file download | the browser prints the web font                                                                                          | glyph outlines are drawn as vector paths (see below), no font to embed |
| Control               | pages, margins, header, page numbers, A4/Letter per request                                                                                                                                        | page breaks and headers depend on the browser, no page count, no title block control, theme variables must be overridden | full                                                                   |
| Always black on white | needs care                                                                                                                                                                                         | needs care and a print dialog                                                                                            | by construction: colors are dropped                                    |
| Where it runs         | main thread                                                                                                                                                                                        | print dialog, the user picks "Save as PDF" (no file produced by us, cannot be tested headless)                           | main thread                                                            |

So (a) does not satisfy "embed Bravura correctly" without extra machinery, and (b) cannot produce a file or be tested. (c) gives exact output for the SVG subset VexFlow uses.

- **Page content.** The score is engraved **once** at the page width (`printGeometry`: a staff space of 10 px becomes 1.75 mm, about 4.96 pt, `DEFAULT_STAFF_SPACE_MM`, the usual size of printed scores on A4; `exportPdf` and `exportPng` take an optional `staffSpaceMm`; if one system is taller than a page the scale shrinks until it fits) by the same `Engraver` and layout as on screen, in an off-screen container. `planPages` fills pages greedily with whole systems (a system never splits; the first page keeps room for the title block). A page that is not the last one then spreads its leftover height evenly between its systems (`systemSpread`, at most 24 pt per gap), so full pages look filled with the same distance between systems; the last page keeps the natural distance. Part names are abbreviated after the first system (see [engraving.md](engraving.md)). A 100-measure 4/4 piano score (quarter notes over half notes) takes 4 to 5 measures per system and 3 pages on A4 (it took 7 before #46). Each page is then read back from the SVG.
- **SVG to drawing items** (`svgItems.ts`, `paths.ts`). `path`, `rect`, `line`, `g` (with `translate`/`scale`/`matrix`) and `text` are converted to a flat list of items: filled/stroked paths (absolute move, line, cubic, close; quadratics and arcs become cubics) and text. Fill and stroke are kept as flags only: ink is black whatever the theme, CSS classes (`pm-selected`, `pm-playing`) are ignored, hit rectangles (`opacity="0"`) and overlays are skipped.
- **Bravura glyphs as vector outlines.** `text` made of Private Use Area characters (SMuFL) becomes the glyph outline, scaled and positioned like the text would have been. The outlines (164 glyphs: brace and brackets, clefs, time signature digits, noteheads, dots, flags, accidentals, rests, tuplet digits) are in `web/src/export/bravura-outlines.json` (124 KB, 41 KB gzip), generated from the Bravura `.otf` by `node scripts/export/build-glyphs.mjs` (dev dependency `opentype.js`, MIT). A glyph outside the table is **reported** (`glyph-U+XXXX`), never silently drawn as a box; a unit test engraves every fixture and fails if one is missing. When the engraver learns new symbols (articulations, dynamics), add their range in the script and rerun it.
- **Chord symbols and diagrams.** They are in the engraver's SVG, so they are in the PDF and the PNG. The accidentals of a symbol are Bravura glyphs (outlines, like the notes' accidentals); the text of a symbol is drawn like the other text (below), one text per run, raised extensions at their smaller size; a fretboard diagram is paths (strings, frets, nut, barre, open and muted marks) and dots. The diagram stays vector at any zoom. The symbols follow the "Chord names" preference (`Rém7` or `Dm7`, [editor.md](editor.md#chord-symbols)); the French names use WinAnsi characters only (`é`), so they stay Helvetica text and load no outline table. A page break never cuts a diagram from its system (it is above the staff, inside the system).
- **Other text** (part names, tab fret numbers, title, composer, page number, chord symbols and any text item) goes one of two ways. Text WinAnsi can show (Latin-1 plus the Windows-1252 extras: `é`, `ç`, `€`, curly quotes, em dash...) is Helvetica, one of the 14 standard PDF fonts (nothing to embed); this is the common case and loads nothing. As soon as an item holds a character outside WinAnsi, that item is drawn as **Inter outlines** (Regular, SIL OFL 1.1) like the music glyphs, see below.
- **Unicode text (#47).** `textFont.ts`. The PDF writer embeds no font file, so text outside WinAnsi is drawn as filled vector paths from Inter outlines, and the advance widths come from Inter (alignment, centering and truncation of titles use them too). The outlines are built by `node scripts/export/build-text-outlines.mjs` (dev dependency `opentype.js`, source: the `@fontsource/inter` subsets, quantized to a 1000 units em grid, relative coordinates, quadratics kept as they are) into four tables in `web/src/export/inter/`, each loaded by `import()` only when needed (separate hashed chunks, same origin, so the CSP is untouched):

  | Table       | Covers                                                                                                   | Glyphs | Gzip    |
  | ----------- | -------------------------------------------------------------------------------------------------------- | ------ | ------- |
  | `latin`     | ASCII, Latin-1, general punctuation, `€`, `Œ`, `Š`, `Ž`... (loaded with any other table, for mixed text) | 213    | 16.5 KB |
  | `latin-ext` | Latin Extended-A and -B, Latin Extended Additional (Polish, Czech, Turkish, Vietnamese...)               | 531    | 36 KB   |
  | `greek`     | Greek and Greek Extended (polytonic)                                                                     | 338    | 17 KB   |
  | `cyrillic`  | Cyrillic and Cyrillic Supplement (Russian, Ukrainian, Serbian, Bulgarian...)                             | 249    | 18 KB   |

  A document with a Cyrillic title loads `latin` + `cyrillic` (about 35 KB gzip); a Latin-1 document loads none. `npm run size` fails when one table passes 40 KB gzip, and the export chunk itself stays at 51 KB (budget 70 KB). **Text stays text:** every outlined item is also written in an invisible layer (render mode 3, a non-embedded Type0 font with Identity-H CIDs and a `ToUnicode` CMap), so the PDF can be searched, selected and copied, and pdf.js extracts exactly the original string. **Limits:** no kerning (advance widths only; titles are short), Regular weight only, no combining marks (text is NFC normalized first, and the precomposed letters of the tables cover the languages above). **CJK and other scripts** (and symbols outside the tables) have no outline: they are drawn as `?`, listed in the export report (`pdf-text-U+XXXX`) and still present in the text layer with their real code point, so search and copy work. Shipping a CJK font (several MB) is not worth it for titles; a subset fetched on demand could replace the `?` later. **PNG** needs nothing: canvas text uses the browser fonts, which fall back to a system font for every script.

- **File.** PDF 1.4, one Flate-compressed content stream per page, a white rectangle first then black ink (`0 g 0 G`, no other color operator, so a viewer in dark mode still shows a white sheet), `Title`, `Author` (composer), `Creator` and `Producer` in the information dictionary. Output is vector: zoom as far as you like.

## PNG

`png.ts`. Each page is drawn on a `<canvas>` from the **same items** with `Path2D` (white paper, black ink) and encoded with `canvas.toBlob`. Resolution is **2x** the CSS pixel size of the page (96 dpi x 2 = 192 dpi): Letter is 1632 x 2112 px, A4 1587 x 2245 px. Because the glyphs are paths, no font has to be loaded, and there is no SVG-to-image round trip (which would not draw the music font anyway: an SVG used as an image cannot load web fonts, and the Content-Security-Policy does not allow `blob:` images). Same page layout as the PDF.

One page gives one `.png`; several pages give one `.zip` (`fflate`, stored without recompression since PNG is compressed) of `page-NN.png`, numbered with leading zeros so that they sort.

## Security and CSP

Nothing is loaded from a third party and no worker is created: the export runs in the main thread, yielding between pages (`setTimeout`) so the progress panel repaints. Downloads use the same `Blob` + `<a download>` path as MusicXML (`blob:` is not fetched by the page, only navigated by the download). Text from the score (title, composer, part names) is only ever written as PDF hex strings or canvas text, never as markup.

## Performance

Chromium, production build, Windows 11 laptop, a 100-measure piano score (grand staff, 3 pages A4), measured with User Timing in `e2e/export.spec.ts` (best-of-three after the lazy chunk is loaded):

| What                        | Budget                             | Measured                                                                                       |
| --------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| MIDI                        | < 50 ms                            | 0.4 to 1.6 ms                                                                                  |
| PDF (engrave, pages, write) | < 3 s                              | 100 to 120 ms                                                                                  |
| PNG (3 pages at 2x, zipped) | < 2 s                              | 155 to 175 ms                                                                                  |
| Export chunk                | gzip budget 70 KB (`npm run size`) | 50.6 KB (41 KB of it are the Bravura outlines; the Inter tables are separate lazy chunks)      |
| Initial JS                  | <= 110 KB gzip                     | unchanged by the export code (the menu items and the paper preference are a few hundred bytes) |

## Tests

- Unit `midi.test.ts`: a small independent Standard MIDI File reader parses the output and compares tracks, track names, programs, channels (never 9), tempo map, time and key signatures, note on/off ticks, ties (across barlines, per chord pitch), triplets and quintuplets, transposition (clarinet, double bass), pickup measure, event ordering, the 15-staff limit and its report, and the 50 ms budget.
- Unit `pdf.test.ts`: path parser (relative, implicit, quadratic, arc), SVG conversion (colors dropped, hit areas skipped, glyph outlines, unknown glyph reported), PDF structure (header, xref offsets point at the objects, page count, inflated content stream, WinAnsi), pagination, and a full export of a 100-measure score. `paperPref.test.ts`: A4/Letter by locale.
- Unit `unicode.test.ts` (#47): `é ł ß Ω Ж`, mixed Cyrillic/Greek/Latin strings and polytonic Greek are written, then read back with pdf.js (dev dependency `pdfjs-dist`) and must extract identically; CJK is extractable and reported; the Latin-1 case loads no table and has no Type0 font; glyph coverage of the alphabets of Latin Extended-A, Greek, Cyrillic and WinAnsi punctuation; gzip size budget of every table; Inter widths used to truncate a long Cyrillic title.
- Playwright `e2e/export.spec.ts` (signed in with `mockSignedIn`): each export downloads a non-empty file of the right type (`MThd`, `%PDF-`, PNG signature, ZIP of PNGs), the PDF page count of a 100-measure score and its media box for Letter and A4, the shortcuts and palette commands, the performance budgets, a title "Этюд — Ωδή — Étude" whose PDF text pdf.js extracts exactly (and whose PNG has ink in the title band), and in the **dark theme** the PNG is white with black ink only (pixels sampled, no colored pixel) and the PDF starts with a white page and uses no color operator.

## Known limits

- PDF text in CJK (and symbols outside the Inter tables) is drawn as `?` (reported, but searchable); Latin Extended, Greek and Cyrillic are fine (#47). No kerning in outlined text.
- Notation the engraver does not draw yet (dynamics, articulations) will need its glyphs added to the outline table.
- Repeats, lyrics and page-level options (margins, system spacing) are not exported yet; the staff space is 1.75 mm unless the `staffSpaceMm` argument says otherwise (no menu entry yet).
- MIDI has no dynamics, pedal or articulation (the model has none yet).
