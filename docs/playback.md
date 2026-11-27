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

A TAB-only part is played from its TAB staff, with the written pitch derived from string + fret + capo + transposition when the fret is typed (so a capo is never added twice); tests cover a capo, a TAB-only part and a standard + TAB part typed on the TAB staff.

Samples are short Ogg Opus excerpts, a few pitches per instrument; Tone's `Sampler` repitches the nearest one. Only the sets used by the staves of the score are downloaded, and only when you play or enter a note.

| Instrument                 | Set            | Download (Ogg Opus / AAC) | Source (CC0 1.0 unless noted)                                     |
| -------------------------- | -------------- | ------------------------- | ----------------------------------------------------------------- |
| Classical guitar           | `guitar-nylon` | 172 / 214 KB              | FreePats, Spanish classical guitar                                |
| Steel-string guitar        | `guitar-steel` | 244 / 301 KB              | Meta Open Sound, _Meta Steel Guitar_ (medium layer)               |
| Ukulele (all sizes)        | `ukulele`      | 85 / 107 KB               | FreePats, tenor ukulele                                           |
| Cello                      | `cello`        | 206 / 254 KB              | Karoryfer x bigcat cello, solo, sustained mf                      |
| Piano, unknown instruments | `piano`        | 180 / 223 KB              | FreePats, Upright Piano KW                                        |
| Voice                      | `voice`        | 128 / 158 KB              | epic-choir alto and soprano "ah" (**CC BY 4.0**, credit required) |
| Flute                      | `flute`        | 182 / 225 KB              | VSCO 2 CE                                                         |
| Violin                     | `violin`       | 208 / 257 KB              | VSCO 2 CE, solo violin                                            |
| Clarinet                   | `clarinet`     | 164 / 203 KB              | FreePats                                                          |
| Double bass                | `double-bass`  | 145 / 179 KB              | VSCO 2 CE, solo contrabass                                        |

Authors, URLs and license texts are in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). The Ogg Opus files weigh 1.71 MB in the repository (92 files) and their AAC twins 2.12 MB; a browser downloads one of the two formats.

- **Every catalog instrument has a recording.** The steel-string guitar and the voice were stand-ins (nylon guitar, flute) until #62. Baritone and low-G ukuleles reach below the recorded range (C4), the sampler transposes down; so does a voice part written below the choir's range (A#3 to F#5). Unknown instruments play the piano, and the mixer says so.
- **Credits are shown in the application.** CC BY 4.0 (the voice) requires a credit, a link to the license and a notice of changes. The "About and credits" button (editor toolbar and library) and the command palette command open a dialog (`web/src/credits/`, its own lazy chunk, French and English) listing every set with its recording, author, license and source link. `credits.test.tsx` checks that every set is listed and that the list matches `THIRD_PARTY_NOTICES.md`.
- **Licenses are a hard gate.** Never add a sample that is not CC0, CC-BY (3.0 or 4.0), MIT, BSD, OFL-like or similar, with the license verified at the source and recorded in `THIRD_PARTY_NOTICES.md`. Never CC-BY-SA, CC-BY-NC, GPL (the FreePats steel-string guitar is GPL-3.0 with an exception and was not used), "personal use" or an unclear license. General MIDI soundfonts (FluidR3, MuseScore General, the "midi-js-soundfonts" builds) were not used: their terms depend on the underlying recordings and were not worth the risk.
- **Format.** Ogg Opus, mono, 40 kbps, 3.5 to 5 s per pitch with a fade-out. Chromium and Firefox decode Ogg Opus; Safari is handled by the fallback below.
- **Safari and the AAC fallback.** What the sources say: Apple's WWDC25 session "What's new in Safari and WebKit" states "in Safari 19, we've added Ogg Opus and Ogg Vorbis to the list of media we support" ([video](https://developer.apple.com/videos/play/wwdc2025/233/); the release that followed WWDC25 is Safari 26, see the [WebKit announcement](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)); caniuse lists Ogg Vorbis as supported from Safari 18.4 and Opus as supported on iOS from 18.4 but only "partial" on desktop Safari, both for the `<audio>` element only ([Ogg Vorbis](https://caniuse.com/ogg-vorbis), [Opus](https://caniuse.com/opus)); the WebKit notes for Safari 27.0 fix "MP4 files containing Opus audio tracks could not be decoded with `decodeAudioData`" ([notes](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)). **No source states that Web Audio's `decodeAudioData` decodes Ogg Opus in Safari**, and it was not tested on a device, so the application does not guess: `sampleFormat.ts` decodes a 123-byte Ogg Opus clip once per page load (`OfflineAudioContext.decodeAudioData`) and, when that fails, loads the AAC-LC `.m4a` twin of every file instead (`sampleUrls(set, 'm4a')`). Only one format is ever downloaded; Chromium and Firefox never request an `.m4a`.
- **Building the AAC twins.** `node scripts/samples/build-fallback.mjs [set id...]` (Windows only) decodes every shipped `.ogg` in Chromium, writes 16-bit WAV files to a temporary folder and encodes them with the Windows Media Foundation AAC encoder (`scripts/samples/aac-encode.ps1`, mono, about 48 kbps) into `<Note>.m4a` next to the `.ogg`. Chromium's WebCodecs cannot encode AAC (checked in Playwright's Chromium, Chrome and Edge) and no other AAC encoder is available to the project. The twin is therefore a second lossy generation derived from the Opus file, and `build-samples.mjs` (which wipes the set folder) must be followed by `build-fallback.mjs` for the same set. `samples.test.ts` fails when an `.ogg` has no `.m4a` twin on the same pitch and when a set goes over its budget (250 KB Ogg Opus, 310 KB AAC; the steel-string guitar is 301 KB in AAC).
- **Same origin, immutable.** `import.meta.glob('./samples/*/*.{ogg,m4a}', { query: '?url' })` makes Vite emit each file as `/assets/<Note>-<hash>.ogg` (or `.m4a`; never inlined, see `assetsInlineLimit` in `vite.config.ts`), which the API serves with `Cache-Control: immutable`. The Content-Security-Policy (`default-src 'self'`, `connect-src 'self'`) allows it. Nothing is loaded from a CDN. Tone.js starts a blob Web Worker for its clock when it loads, which `script-src 'self'` forbids: `index.ts` hides `Worker` for the instant Tone's module evaluates so that it uses a timer, and the Tone context is created with `clockSource: 'timeout'` (the scheduler does not use Tone's clock). A browser test runs the real engine under the API's policy and fails on any violation other than styles.

### Adding an instrument

1. Find a recording whose license is verifiable at the source (CC0, CC-BY, MIT, OFL-like). Record URL, author and license in `THIRD_PARTY_NOTICES.md`.
2. Download the originals (WAV or FLAC, one file per pitch, a pitch every 3 to 5 semitones) into a scratch folder.
3. Add an entry to `web/scripts/samples/sets.mjs` (set id, which file is which note, `seconds`, `fadeOut`, `octaveShift` if the source labels octaves differently, as VSCO does).
4. From `web/`: `SAMPLES_SRC=<folder> node scripts/samples/build-samples.mjs <set id>`. It decodes, trims, normalizes and encodes with the Chromium of Playwright (WebCodecs), writes `src/playback/samples/<set>/<Note>.ogg` (`s` for a sharp) and prints each file's measured pitch against its label. A line flagged `CHECK PITCH` usually means the auto-detection picked a harmonic, but a deviation of about 1200 cents on every file means a wrong octave label.
5. Add the set id to `instrumentSets.ts` (`SampleSetId`, `SAMPLE_SET_IDS`) and map the catalog ids to it; add its release time in `toneBackend.ts`; add the instrument to `web/src/score/instruments.ts` if it is not in the catalog.
6. `node scripts/samples/build-fallback.mjs <set id>` for the AAC twins (Windows), then add the set to `web/src/credits/content.ts` (the credits dialog).
7. `npm test` (`samples.test.ts` checks every set covers its range without large holes, has an `.m4a` twin for each `.ogg` and stays within its budget; `credits.test.tsx` checks the credits against `THIRD_PARTY_NOTICES.md`), update the table above and `THIRD_PARTY_NOTICES.md`.

## Chord playback

Chord symbols (see [editor.md](editor.md#chord-symbols)) can be heard. It is an option of the mixer (Advanced mode, "Chord symbols"): **Muted** (default), **Block chords** (all the notes together) or **Strum** (the strings one after the other, low to high, 36 ticks apart, about 19 ms at 120 bpm). Code: `web/src/playback/chordVoicing.ts` (pure) and `timeline.ts` (`buildTimeline(score, { chords, lookup })`); `PlaybackController.setChordPlayback(mode)`.

- **On the part's instrument.** The chord notes belong to the staff that carries the symbols, so they are played by that staff's sampler (a guitar chord on the guitar samples, a ukulele chord on the ukulele) and obey that staff's mute and solo.
- **Voicing.** On a part with strings the notes are the **shape of the diagram**: string by string, open string pitch plus capo plus fret (the sounding pitch is the symbol's, whatever the capo), so what you hear is what the diagram shows; a custom fingering (`frame`) is played as drawn. Otherwise (piano, voice...) a close voicing: the bass note (the slash bass, else the root) in the octave below middle C, the chord tones above it in one octave from middle C, at most five of them (the fifth is dropped first in a 9th, 11th or 13th chord). The chord library is loaded the first time the option is switched on, and never otherwise.
- **Length.** A chord rings until the next symbol of its measure, or to the end of the measure; a chord does not carry over a barline (write the symbol again in the next measure, as on a chart).
- **Muted by default, not highlighted.** With the option off the timeline has no chord note at all; chord notes have no event id, so they do not light up notes or move the cursor, and they are not in the MIDI export (which is the notes of the score).
- **Changing the option** stops playback, rebuilds the timeline and keeps the playhead. The timeline is rebuilt like after an edit: lazily.

## Performance

Measured in Chromium (Windows 11 laptop, production build, local server, no network throttling; the figure is dominated by decoding and scheduling, the download is about 60 KB gzip of Tone plus the set).

| What                                                   | Budget             | Measured                                                          |
| ------------------------------------------------------ | ------------------ | ----------------------------------------------------------------- |
| Time to first note, cold (engine + piano set + decode) | < 3 s              | 120 to 330 ms (local)                                             |
| Time to first note, cached                             | < 1 s              | 55 to 100 ms                                                      |
| Playback chunk (Tone.js + engine)                      | ≤ 80 KB gzip, lazy | 57.7 KB gzip, not in the initial bundle                           |
| Sample sets                                            | ≤ 3 MB in total    | 1.71 MB Ogg Opus (2.12 MB AAC twins), 85 to 244 KB per instrument |
| Initial JS                                             | ≤ 150 KB gzip      | 94.7 KB (the controller is a few KB of it)                        |
| Keystroke in note entry (100 measures)                 | < 16 ms            | about 9 ms (the preview does not rebuild the timeline)            |

On a real network the first note adds the download of the Tone chunk and of the instrument (about 250 to 270 KB), a second or so on a 2 Mbit/s connection, nothing once cached (hashed files, `immutable`).

## Tests

- Chords: `chordPlayback.test.ts` (voicings on guitar, ukulele and keyboard, capo, custom fingering, block and strum timelines, ordering, controller option, playhead kept), `e2e/chords.spec.ts` (the mixer option, muted by default).
- Unit: `timeline.test.ts` (tempo and tempo changes, dots, ties incl. across barlines and per chord pitch, triplets, rests, chords, voices, several parts and staves, transposition, capo, pickup, beats), `clock.test.ts` (loop maths, mute/solo), `controller.test.ts` (scheduling times, look-ahead, pause/resume, stop, seek, play from selection, tempo, loop, metronome, mute/solo, frames, score edits, preview, audio failure), `samples.test.ts` (coverage, AAC twins, budgets), `sampleFormat.test.ts` (Ogg Opus or AAC choice, probe, one decision per page load), `credits/credits.test.tsx` (every set credited, in step with `THIRD_PARTY_NOTICES.md`, CC BY credit, French).
- Browser, audio mocked (`e2e/playback.spec.ts`, `window.__polymniaAudio = 'mock'`; the backend records its calls in `window.__polymniaAudioLog`): play/stop, cursor and highlight toggling, `Space`/`Home`, `Space` ignored in a text field, play from selection and loop, preview on entry, tempo and metronome, mute/solo, page scrolling, steel-string guitar / voice / cello each loading their set.
- Browser, real engine (`e2e/playback-audio.spec.ts`): decoding with the real samples, time to first note cold and cached, same-origin hashed files, no policy violation, the steel-string guitar, voice and cello decoded for real (Ogg Opus, no `.m4a` requested). `e2e/credits.spec.ts`: the credits dialog from the toolbar and the palette, in English and French.
- `npm run size` budgets the playback chunk and the sample files (3 MB per format, Ogg Opus and AAC separately).
