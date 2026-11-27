# Playback

**English** · [Français](playback.fr.md)

Hear the score while a cursor follows it. Code in [`web/src/playback/`](../web/src/playback), transport UI in `web/src/editor/TransportBar.tsx` and `Mixer.tsx`.

## Using it

| Action                       | How                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Play / pause                 | `Space` or the Play button (MuseScore behavior). A focused button or text field keeps `Space` for itself                                              |
| Back to the start            | `Home` or the first transport button                                                                                                                  |
| Stop (and back to the start) | Stop button                                                                                                                                           |
| Play from a note             | Select it (the playhead moves there), then play                                                                                                       |
| Loop                         | Loop button: loops the selected notes, or the whole score without a selection                                                                         |
| Tempo                        | Slider, 25 % to 200 % of the written tempo; `♩ = n` shows the effective tempo                                                                         |
| Metronome                    | Metronome button: a click on every beat, accented on the first beat of the bar (dotted beat in 6/8, 9/8, 12/8; the pickup counts as the end of a bar) |
| Mute / solo a staff          | Mixer in the inspector (Advanced mode). A solo silences every other staff and wins over mute                                                          |
| Hear each entered note       | Automatic: note entry calls `previewNote`                                                                                                             |

The audio starts after a user gesture (browser autoplay policies): the engine is fetched at the first click or key press in the editor, and the context starts when you press play.

## Architecture

```
score ──buildTimeline──▶ Timeline (notes, spans, tempo, beats)        timeline.ts   pure
                              │
        PlaybackController ◀──┘  transport, look-ahead scheduler,    controller.ts plain TS
              │                  playhead, loop, mute/solo
              ├── onFrame ──▶ followPlayback ──▶ Engraver             follow.ts     no React per frame
              └── AudioBackend (lazy)                                 backend.ts
                     ├── ToneBackend  Tone.js samplers, 1 per staff   toneBackend.ts  (own chunk)
                     └── MockBackend  silent, for the browser tests   mockBackend.ts
```

- **Score to events** (`timeline.ts`, pure and unit tested). Ticks stay the unit (960 per quarter). A note carries its _sounding_ MIDI number: written pitch plus the part transposition (`soundingMidi`). A capo is already part of the written pitch (the validator checks `string + capo + fret = written + transposition`), so it is **not** added again. Tied notes (across beats, barlines, chords pitch by pitch) become **one** sounding note; each tied event keeps its own span so it lights up for its own duration. Tuplets use their scaled durations, pickup measures their real `length`, every voice of every staff is played. The tempo map follows `tempoBpm` changes.
- **Time maths** (`clock.ts`, pure). Tempo map ticks ⇄ seconds, loop wrapping (`scoreSecondsAt`, `legsBetween`), mute/solo (`audibleStaves`).
- **Scheduling** (`controller.ts`). A 100 ms timer schedules every note starting in the next **1.2 s** of the audio clock (`LOOKAHEAD_SECONDS`) with absolute audio times, and Tone's context uses `latencyHint: 'playback'` with a 0.2 s look-ahead, so a busy UI thread (a re-engrave, a long task) does not make notes stutter: the sound is already in the audio graph. Changing the tempo, the loop or seeking restarts the scheduling from the playhead.
- **Cursor and highlight** (`follow.ts`). `requestAnimationFrame` reads the audio clock (minus the output latency), finds the notes under the playhead and, only when they change, calls `engraver.setPlaying(ids)` (CSS class `pm-playing`, color `--play`) and `engraver.setPlayCursor(ids)` (one `<rect class="pm-cursor">` that is moved). No React state changes per frame, no re-engraving. The page scrolls (`.score-area`) only when the cursor leaves the visible area, with `prefers-reduced-motion` respected.
- **Editing stops playback**; the playhead keeps its tick. The timeline is rebuilt lazily, not on every keystroke.
- **Preview** (`previewNote(partId, pitch)`, exported by `web/src/playback/index.ts`). Plays a 0.7 s note on the instrument of the part, written pitch in, transposition applied. The editor binds it to `EditorStore.onNoteEntered`.

## Instruments and samples

The instrument of a part comes from `Part.instrument`, so changing it in the instruments panel (#15) changes the sound at once. A TAB staff that repeats a standard staff of the same part ("standard + TAB") is skipped by the timeline and the mixer: the part is heard once.

Samples are short Ogg Opus excerpts, a few pitches per instrument; Tone's `Sampler` repitches the nearest one. Only the sets used by the staves of the score are downloaded, and only when you play or enter a note.

| Instrument                 | Set                           | Download | Source (all CC0 1.0)                                       |
| -------------------------- | ----------------------------- | -------- | ---------------------------------------------------------- |
| Classical guitar           | `guitar-nylon`                | 172 KB   | FreePats, Spanish classical guitar                         |
| Steel-string guitar        | `guitar-nylon` (**stand-in**) | same     | no permissive recording found, see below                   |
| Ukulele (all sizes)        | `ukulele`                     | 85 KB    | FreePats, tenor ukulele                                    |
| Cello                      | `cello`                       | 208 KB   | VSCO 2 CE, _Cello Section_ (no solo cello in the CC0 sets) |
| Piano, unknown instruments | `piano`                       | 180 KB   | FreePats, Upright Piano KW                                 |
| Voice                      | `flute` (**stand-in**)        | same     | no permissive recording found, see below                   |
| Flute                      | `flute`                       | 182 KB   | VSCO 2 CE                                                  |
| Violin                     | `violin`                      | 208 KB   | VSCO 2 CE, solo violin                                     |
| Clarinet                   | `clarinet`                    | 164 KB   | FreePats                                                   |
| Double bass                | `double-bass`                 | 145 KB   | VSCO 2 CE, solo contrabass                                 |

Authors, URLs and license texts are in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). The whole set is 1.34 MB in the repository.

- **Stand-ins.** The only steel-string guitar found in the FreePats collection is GPL-3.0 with an exception, which does not fit an MIT application, so it plays the nylon guitar. No permissively licensed solo voice or choir "aah" set was found, so the voice plays the flute. Baritone and low-G ukuleles reach below the recorded range (C4), the sampler transposes down. Unknown instruments play the piano. The mixer says when a stand-in is used.
- **Licenses are a hard gate.** Never add a sample that is not CC0, CC-BY, MIT, OFL-like or similar, with the license verified at the source and recorded in `THIRD_PARTY_NOTICES.md`. General MIDI soundfonts (FluidR3, MuseScore General, the "midi-js-soundfonts" builds) were not used: their terms depend on the underlying recordings and were not worth the risk when CC0 sets cover the priority instruments.
- **Format.** Ogg Opus, mono, 40 kbps, 3.5 to 5 s per pitch with a fade-out. Chromium and Firefox decode Ogg Opus. Safari support is recent and **was not tested on a device**; where it cannot decode it, playback reports "The sound could not start". There is no MP3/AAC fallback yet (it would need an encoder in the sample tool).
- **Same origin, immutable.** `import.meta.glob('./samples/*/*.ogg', { query: '?url' })` makes Vite emit each file as `/assets/<Note>-<hash>.ogg` (never inlined, see `assetsInlineLimit` in `vite.config.ts`), which the API serves with `Cache-Control: immutable`. The Content-Security-Policy (`default-src 'self'`, `connect-src 'self'`) allows it. Nothing is loaded from a CDN. Tone.js starts a blob Web Worker for its clock when it loads, which `script-src 'self'` forbids: `index.ts` hides `Worker` for the instant Tone's module evaluates so that it uses a timer, and the Tone context is created with `clockSource: 'timeout'` (the scheduler does not use Tone's clock). A browser test runs the real engine under the API's policy and fails on any violation other than styles.

### Adding an instrument

1. Find a recording whose license is verifiable at the source (CC0, CC-BY, MIT, OFL-like). Record URL, author and license in `THIRD_PARTY_NOTICES.md`.
2. Download the originals (WAV or FLAC, one file per pitch, a pitch every 3 to 5 semitones) into a scratch folder.
3. Add an entry to `web/scripts/samples/sets.mjs` (set id, which file is which note, `seconds`, `fadeOut`, `octaveShift` if the source labels octaves differently, as VSCO does).
4. From `web/`: `SAMPLES_SRC=<folder> node scripts/samples/build-samples.mjs <set id>`. It decodes, trims, normalizes and encodes with the Chromium of Playwright (WebCodecs), writes `src/playback/samples/<set>/<Note>.ogg` (`s` for a sharp) and prints each file's measured pitch against its label. A line flagged `CHECK PITCH` usually means the auto-detection picked a harmonic, but a deviation of about 1200 cents on every file means a wrong octave label.
5. Add the set id to `instrumentSets.ts` (`SampleSetId`, `SAMPLE_SET_IDS`) and map the catalog ids to it; add its release time in `toneBackend.ts`; add the instrument to `web/src/score/instruments.ts` if it is not in the catalog.
6. `npm test` (`samples.test.ts` checks every set covers its range without large holes), update the table above and `THIRD_PARTY_NOTICES.md`.

## Performance

Measured in Chromium (Windows 11 laptop, production build, local server, no network throttling; the figure is dominated by decoding and scheduling, the download is about 60 KB gzip of Tone plus the set).

| What                                                   | Budget             | Measured                                               |
| ------------------------------------------------------ | ------------------ | ------------------------------------------------------ |
| Time to first note, cold (engine + piano set + decode) | < 3 s              | 120 to 330 ms (local)                                  |
| Time to first note, cached                             | < 1 s              | 55 to 100 ms                                           |
| Playback chunk (Tone.js + engine)                      | ≤ 80 KB gzip, lazy | 57.7 KB gzip, not in the initial bundle                |
| Sample sets                                            | ≤ 3 MB in total    | 1.34 MB total, 85 to 208 KB per instrument             |
| Initial JS                                             | ≤ 150 KB gzip      | 94.7 KB (the controller is a few KB of it)             |
| Keystroke in note entry (100 measures)                 | < 16 ms            | about 9 ms (the preview does not rebuild the timeline) |

On a real network the first note adds the download of the Tone chunk and of the instrument (about 250 to 270 KB), a second or so on a 2 Mbit/s connection, nothing once cached (hashed files, `immutable`).

## Tests

- Unit: `timeline.test.ts` (tempo and tempo changes, dots, ties incl. across barlines and per chord pitch, triplets, rests, chords, voices, several parts and staves, transposition, capo, pickup, beats), `clock.test.ts` (loop maths, mute/solo), `controller.test.ts` (scheduling times, look-ahead, pause/resume, stop, seek, play from selection, tempo, loop, metronome, mute/solo, frames, score edits, preview, audio failure), `samples.test.ts`.
- Browser, audio mocked (`e2e/playback.spec.ts`, `window.__polymniaAudio = 'mock'`; the backend records its calls in `window.__polymniaAudioLog`): play/stop, cursor and highlight toggling, `Space`/`Home`, `Space` ignored in a text field, play from selection and loop, preview on entry, tempo and metronome, mute/solo, page scrolling.
- Browser, real engine (`e2e/playback-audio.spec.ts`): decoding with the real samples, time to first note cold and cached, same-origin hashed files, no policy violation.
- `npm run size` budgets the playback chunk and the sample files.
