# Score format

**English** · [Français](score-format.fr.md)

The score model is the single source of truth shared by the engraver, the editor, playback, MusicXML import/export and the API. It lives in [`web/src/score/`](../web/src/score) (pure TypeScript, no runtime dependency, no React or VexFlow). The JSON format is described by [`schema/score.v1.schema.json`](../schema/score.v1.schema.json) (JSON Schema draft 2020-12), which the API reuses to validate uploads and to store scores as PostgreSQL `jsonb`.

## Shape

```
Score { schemaVersion: 1, id?, meta, measures[], parts[], slurs[] }
  meta     { title, composer, tempoBpm }
  measures MeasureInfo[]            shared by every staff: { id, time?, keyFifths?, tempoBpm?, length? }
  parts    Part[]                   { id, name, instrument, transposition, tuning?, capo?, chordDiagrams?, chordCapoShapes?, staves[] }
    Staff  { id, clef, type, showRests?, measures[] }     measures[i] belongs to score.measures[i]
      StaffMeasure { clef?, voices[], chords? }              chords?: ChordSymbol[], see "Chord symbols"
        Voice { id, events[], tuplets[] }
          Note { kind: 'note', id, duration, pitches[] }     a chord has several pitches
          Rest { kind: 'rest', id, duration }
  slurs    Slur[]                   { id, startEventId, endEventId }
```

- **Sparse measure attributes.** `time`, `keyFifths` and `tempoBpm` are only written where they change; the first measure must define `time` and `keyFifths`. Helpers: `timeSignatureAt`, `keyFifthsAt`, `tempoAt`, `measureLength`.
- **Pickup measures.** `MeasureInfo.length` is the actual length in ticks of a shorter measure (a pickup, a truncated last bar). It must be a multiple of 120 and at most the time signature length.
- **Voices.** A staff measure holds 1 to 4 voices; each voice fills the measure on its own.
- **Part order.** `parts[i].staves[j]` is rendered top to bottom. A piano is one part with two staves.

## Time: integer ticks

`TICKS_PER_QUARTER = 960`, divisible by 2^n, 3 and 5, so triplets and quintuplets are exact. No floating point anywhere in the model.

| Duration | Ticks |
| -------- | ----- |
| whole    | 3840  |
| half     | 1920  |
| quarter  | 960   |
| eighth   | 480   |
| 16th     | 240   |
| 32nd     | 120   |

A duration is `{ base, dots }` (`dots` 0 to 2): ticks = base x (2 - 1/2^dots). The V1 interface exposes whole to 16th; the model accepts the 32nd. Positions inside a measure and measure lengths are multiples of 120 (a 32nd). A dotted or double-dotted 32nd (180 and 210 ticks) is off that grid: commands refuse it (`invalid-argument`).

**Tuplets** are groups `{ id, actual, normal, eventIds }` stored in the voice (a triplet is `actual: 3, normal: 2`). The members are consecutive events; each member lasts `nominal x normal / actual` ticks, which must be an integer. `createTriplet` makes a 3:2 triplet.

## Identifiers

Every object (measure, part, staff, voice, event, tuplet, slur) has a **stable string id** matching `^[A-Za-z0-9_.-]{1,64}$`. They are unique across the whole score and are used for selection, hit testing and incremental rendering. Ids never change when an event is edited (`setPitch`, `changeDuration`, `deleteEvent` keep the id). New ids come from `newId()` (random) or are derived from a seed stored in the command, so that redo produces the same ids.

## Pitch, transposition and instruments

A pitch is **spelled**, not a MIDI number: `{ step: 'C'..'B', alter: -2..2, octave: -1..9 }`, so `C#4` and `Db4` stay different (needed for engraving and MusicXML round trips). `pitchToMidi` and `midiToPitch(midi, keyFifths)` convert.

**Written pitch is stored**, exactly as MusicXML does: notes hold the pitch as it is **written** on the staff, and the part holds `transposition` (semitones, written to sounding; classical guitar is `-12`, written an octave above the sound). Playback calls `soundingPitch(pitch, part.transposition)` or `soundingMidi`. This keeps the engraved score, the editor and MusicXML export trivial, and only playback converts.

`instruments.ts` is a catalog: id, English and French names, default clefs, transposition, sounding range, General MIDI program and, for fretted instruments, open-string `strings` (sounding pitches, high string to low string) and `frets`. Seeded: piano, voice, flute, clarinet (B♭, transposition -2), violin, cello (bass, tenor, treble clefs), double bass (transposition -12), classical and steel-string guitar, ukulele soprano / concert / tenor / tenor low-G / baritone. A part stores its instrument id and copies `transposition`, so a score stays valid if the catalog changes or the id is unknown (custom instruments are allowed).

- **Tuning override and capo.** `Part.tuning` (sounding pitches, high to low) replaces the catalog tuning (drop D, ...); `Part.capo` raises every string by that many semitones.
- **Clefs.** `treble`, `bass`, `alto`, `tenor`, `treble-8vb` (guitar), `percussion` (reserved). `Staff.clef` is the initial clef; `StaffMeasure.clef` is a clef change at the start of that measure (`clefAt(staff, measure)`, `setClef`). Mid-measure clef changes are not modelled.
- **Staff type.** `standard` or `tab`. A fretted part is written `standard`, `tab` or both (two staves; `setStaffLayout` builds the second from the first and `syncCompanionStaff` keeps them in step while editing); `putEvent` on a tab staff derives the fretting.
- **Fretting.** A note pitch may carry `fretting: { string, fret, manual? }` (`string` 1 = highest; `fret` counts from the capo). `validateScore` checks that the string exists, the fret is within the instrument's frets, and that string + capo + fret sounds the same MIDI note as the written pitch plus the transposition. `manual: true` (optional, additive) means the user chose it: automatic fingering never changes a valid manual fretting. Absent = derived by the fingering algorithm.
- **Tab rests.** `Staff.showRests: true` (optional, additive, tab staves only) draws the rests on that tab staff; absent = hidden, as in most guitar tablature (`setTabRests`).
- **Fingering.** `fingering.ts` (pure, MIDI numbers in, `{ string, fret }` out) chooses a string and a fret for every note and chord of a voice: Viterbi over the few cheapest candidates of each event, minimising hand movement (the hand position is the lowest fretted fret; open strings do not move it and the position carries over them), preferring open strings and low positions, one note per string, at most 4 frets between the fretted notes of a chord (5 with a penalty), few skipped strings in a chord, no special case for re-entrant tunings (strings are looked up by pitch). A pitch no string can play gets no fretting. `fretting.ts` applies it to staves: `refretStaffNotes(part, staff, keep)` recomputes the frettings of a staff, keeping all valid ones (`valid`), only the valid manual ones (`manual`) or none, reusing untouched objects; `unplayableEvents(score)` lists notes of tab staves that no string can play (drawn as `?`, listed in the inspector). Cost: 2.5 µs per note, 4.5 µs per chord note (tests assert < 1 ms).
- **Stability.** Editing a "standard + TAB" part rebuilds the other staff, but a note whose pitch did not change keeps the fretting it had (position by position), manual or derived; only new or changed notes are fingered, from their neighbours. A tuning or capo change recomputes the derived frettings and keeps manual ones that are still valid. `ensureFretting` (run by the editor after every edit) fills the frettings a tab staff is missing.
- **Changing instrument.** `changeInstrument` moves every written pitch by `oldTransposition - newTransposition` (spelling from the key of each measure; ties re-checked), keeps allowed clefs and replaces others with the instrument's default, adds an empty bass staff for piano, drops extra staves only when empty (`not-empty`), resets tuning and capo and recomputes frets. A tab staff repeating a standard staff of the same part is not played (playback and the mixer skip it).
- **Tuning presets.** `tuningPresets(instrumentId)` (guitar: standard, drop D, DADGAD, open G, open D, half and whole step down; ukulele: GCEA, low G, baritone, D tuning), `matchTuningPreset`, `assignFretting` (a lone note: preferred string kept, else open strings and the lowest fret; in `fretting.ts`) and `partRange` (catalog range extended down to the lowest string of a custom tuning) are in `tuning.ts`.
- **Range.** `isInRange(instrument, pitch)` and `rangeWarnings(score)` report notes outside the sounding range as warnings, never errors.

## Ties, slurs

- **Tie**: `tieToNext: true` on a pitch of a note. It is valid only when the next event of the same voice (continuing in the next measure of the same voice index) is a note containing the same spelled pitch. Commands clear ties that become invalid.
- **Slur**: a span `{ id, startEventId, endEventId }` at score level. Both events must exist on the same staff, the start strictly before the end. A slur may cross barlines. Deleting an event removes its slurs.

## Chord symbols

Chord symbols and fretboard diagrams were added to version 1 as **optional, additive fields** (a score without them is unchanged, and an older reader that rejects unknown properties only rejects scores that use them). Code: `web/src/score/chords.ts` (parser, spelling, transposition, chord tones), `diagrams.ts` (which chords show a diagram), `commands/chords.ts`.

```
StaffMeasure { clef?, voices[], chords? }
  ChordSymbol { id, tick, root, quality, bass?, diagram?, frame? }
    root, bass   { step: 'A'..'G', alter: -2..2 }          spelled, no octave
    quality      "" | "m7" | "maj7" | "7#9" | "m7b5" | "sus4" | "6/9" | ...   normalized suffix
    tick         offset from the start of the measure, 0 <= tick < measure length, unique per measure, list sorted by tick
    diagram      true: always show the diagram, false: never (absent: follow the part)
    frame        { frets[], base, barre? }  custom fingering (see below)
Part { ..., chordDiagrams?: 'first' | 'all', chordCapoShapes?: true }
```

- **Where.** On a staff measure, at a tick: usually the first staff of a part (the standard staff of a "standard + TAB" part). Chord symbols are **not** voices and have no duration: they are not part of the notes that a "standard + TAB" part keeps in sync, and a measure that gets shorter (time signature, pickup length) drops the symbols that no longer fit.
- **Concert pitch.** A symbol names the sounding chord, whatever the part's `transposition` or `capo` (`D` with a capo on fret 2 is a D chord played with a C shape). Transposing notes, changing the instrument or the capo never changes a symbol; `transposeChords` is explicit.
- **Spelled, normalized.** `root` and `bass` keep their spelling (`Gb` is not `F#`). `quality` is the canonical text of the parsed quality: `parseQuality(text)` gives a structure (minor, diminished, augmented, power chord, suspension, seventh, extension 9/11/13, sixth or six-nine, alterations in the order `b5 #5 b9 #9 #11 b13`, added tones), `formatQuality` writes it back: `CM7`, `C^7`, `CΔ7` and `Cmaj7` are all `maj7`; `Co7` is `dim7`; `Cø` is `m7b5`; `C69` is `6/9`; `C7(#9)` is `7#9`; minor-major is `m(maj7)`. The text uses `A-Z a-z 0-9 # / + ( ) -` only (at most 24 characters). The validator requires a quality the parser reads, which is what playback, diagrams and MusicXML rely on.
- **Parsing.** `parseChord(text)` accepts letters (any case), `#` `b` `♯` `♭` `x`, French names (`Do Ré Mi Fa Sol La Si`, any case), the quality spellings above and `/bass`; it returns `null` for anything else (`H`, `C2`, `Csus5`, `Cmm`, empty). A reading must parse completely, so `Faug` is F augmented, not French "Fa" then "ug". `formatChord(chord, 'letters' | 'solfege')` writes `F#m7b5/A` or `Fa#m7b5/La`.
- **Chord tones.** `chordTones(chord)` gives the pitch classes a voicing must contain (root, third or suspension, seventh, top extension, alterations, added tones, the bass) and the optional ones (the fifth unless altered, lower extensions): diagrams and playback use it.
- **Transposition and spelling** (`transposeChord(chord, semitones, { fifths })`, command `transposeChords`). Whole octaves keep the spelling. Otherwise a black key is spelled from the key signature of the measure when it has accidentals (sharps in sharp keys, flats in flat keys), else the usual chord names: major roots Db, Eb, F#, Ab, Bb; minor roots C#m, Ebm, F#m, G#m, Bbm. The bass follows the family of the new root. A custom `frame` is dropped (it no longer fits).
- **Diagram options.** `Part.chordDiagrams` shows the diagram of the first occurrence of each chord (same root, quality and bass) or of every chord, on parts with strings (a tuning, from the catalog or `Part.tuning`); `ChordSymbol.diagram` overrides it for one chord. `Part.chordCapoShapes` writes the shape played with a capo next to the symbol, `D (C)`. Diagrams count frets from the capo.
- **Custom fingering.** `frame`: `frets` has one entry per string of the part, highest string first (like `Fretting.string`, 1 = highest): -1 muted, 0 open, otherwise the fret from the nut; `base` is the first fret of the window (1 = at the nut); `barre` is `{ fret, from, to }` (1-based strings, `from <= to`). Written by the MusicXML import for a diagram that is not the library's shape; the validator checks the number of strings against the tuning.
- **Commands** (`commands/chords.ts`, all through `History`): `setChord({ staffId, measure, tick, chord })` (replaces the symbol at the tick and keeps its id, `diagram` flag and frame only if the chord is unchanged), `removeChord`, `setChordDiagram` (`true`, `false` or `null`), `setChordDiagramMode` (`'first'`, `'all'`, `null`), `setChordCapoShapes`, `transposeChords({ semitones, staffIds?, keyFifths? })`. `staffChords(score, staffId)` lists the symbols of a staff in order; `chordStaffId(part)` is the staff that carries them.
- **Validation codes.** `chord-position` (tick outside the measure), `chord-order` (not sorted, or two symbols on the same tick), `chord-quality` (unknown quality), `chord-frame` (a frame with another number of strings than the part, or a barre outside the strings), plus the usual `duplicate-id` for symbol ids.
- **Limits** (schema and decoder, kept in sync by a test): at most 32 symbols per staff measure, `quality` up to 24 characters matching `^[A-Za-z0-9#/+()-]*# Score format

**English** · [Français](score-format.fr.md)

The score model is the single source of truth shared by the engraver, the editor, playback, MusicXML import/export and the API. It lives in [`web/src/score/`](../web/src/score) (pure TypeScript, no runtime dependency, no React or VexFlow). The JSON format is described by [`schema/score.v1.schema.json`](../schema/score.v1.schema.json) (JSON Schema draft 2020-12), which the API reuses to validate uploads and to store scores as PostgreSQL `jsonb`.

## Shape

```
Score { schemaVersion: 1, id?, meta, measures[], parts[], slurs[] }
  meta     { title, composer, tempoBpm }
  measures MeasureInfo[]            shared by every staff: { id, time?, keyFifths?, tempoBpm?, length? }
  parts    Part[]                   { id, name, instrument, transposition, tuning?, capo?, chordDiagrams?, chordCapoShapes?, staves[] }
    Staff  { id, clef, type, showRests?, measures[] }     measures[i] belongs to score.measures[i]
      StaffMeasure { clef?, voices[], chords? }              chords?: ChordSymbol[], see "Chord symbols"
        Voice { id, events[], tuplets[] }
          Note { kind: 'note', id, duration, pitches[] }     a chord has several pitches
          Rest { kind: 'rest', id, duration }
  slurs    Slur[]                   { id, startEventId, endEventId }
```

- **Sparse measure attributes.** `time`, `keyFifths` and `tempoBpm` are only written where they change; the first measure must define `time` and `keyFifths`. Helpers: `timeSignatureAt`, `keyFifthsAt`, `tempoAt`, `measureLength`.
- **Pickup measures.** `MeasureInfo.length` is the actual length in ticks of a shorter measure (a pickup, a truncated last bar). It must be a multiple of 120 and at most the time signature length.
- **Voices.** A staff measure holds 1 to 4 voices; each voice fills the measure on its own.
- **Part order.** `parts[i].staves[j]` is rendered top to bottom. A piano is one part with two staves.

## Time: integer ticks

`TICKS_PER_QUARTER = 960`, divisible by 2^n, 3 and 5, so triplets and quintuplets are exact. No floating point anywhere in the model.

| Duration | Ticks |
| -------- | ----- |
| whole    | 3840  |
| half     | 1920  |
| quarter  | 960   |
| eighth   | 480   |
| 16th     | 240   |
| 32nd     | 120   |

A duration is `{ base, dots }` (`dots` 0 to 2): ticks = base x (2 - 1/2^dots). The V1 interface exposes whole to 16th; the model accepts the 32nd. Positions inside a measure and measure lengths are multiples of 120 (a 32nd). A dotted or double-dotted 32nd (180 and 210 ticks) is off that grid: commands refuse it (`invalid-argument`).

**Tuplets** are groups `{ id, actual, normal, eventIds }` stored in the voice (a triplet is `actual: 3, normal: 2`). The members are consecutive events; each member lasts `nominal x normal / actual` ticks, which must be an integer. `createTriplet` makes a 3:2 triplet.

## Identifiers

Every object (measure, part, staff, voice, event, tuplet, slur) has a **stable string id** matching `^[A-Za-z0-9_.-]{1,64}$`. They are unique across the whole score and are used for selection, hit testing and incremental rendering. Ids never change when an event is edited (`setPitch`, `changeDuration`, `deleteEvent` keep the id). New ids come from `newId()` (random) or are derived from a seed stored in the command, so that redo produces the same ids.

## Pitch, transposition and instruments

A pitch is **spelled**, not a MIDI number: `{ step: 'C'..'B', alter: -2..2, octave: -1..9 }`, so `C#4` and `Db4` stay different (needed for engraving and MusicXML round trips). `pitchToMidi` and `midiToPitch(midi, keyFifths)` convert.

**Written pitch is stored**, exactly as MusicXML does: notes hold the pitch as it is **written** on the staff, and the part holds `transposition` (semitones, written to sounding; classical guitar is `-12`, written an octave above the sound). Playback calls `soundingPitch(pitch, part.transposition)` or `soundingMidi`. This keeps the engraved score, the editor and MusicXML export trivial, and only playback converts.

`instruments.ts` is a catalog: id, English and French names, default clefs, transposition, sounding range, General MIDI program and, for fretted instruments, open-string `strings` (sounding pitches, high string to low string) and `frets`. Seeded: piano, voice, flute, clarinet (B♭, transposition -2), violin, cello (bass, tenor, treble clefs), double bass (transposition -12), classical and steel-string guitar, ukulele soprano / concert / tenor / tenor low-G / baritone. A part stores its instrument id and copies `transposition`, so a score stays valid if the catalog changes or the id is unknown (custom instruments are allowed).

- **Tuning override and capo.** `Part.tuning` (sounding pitches, high to low) replaces the catalog tuning (drop D, ...); `Part.capo` raises every string by that many semitones.
- **Clefs.** `treble`, `bass`, `alto`, `tenor`, `treble-8vb` (guitar), `percussion` (reserved). `Staff.clef` is the initial clef; `StaffMeasure.clef` is a clef change at the start of that measure (`clefAt(staff, measure)`, `setClef`). Mid-measure clef changes are not modelled.
- **Staff type.** `standard` or `tab`. A fretted part is written `standard`, `tab` or both (two staves; `setStaffLayout` builds the second from the first and `syncCompanionStaff` keeps them in step while editing); `putEvent` on a tab staff derives the fretting.
- **Fretting.** A note pitch may carry `fretting: { string, fret, manual? }` (`string` 1 = highest; `fret` counts from the capo). `validateScore` checks that the string exists, the fret is within the instrument's frets, and that string + capo + fret sounds the same MIDI note as the written pitch plus the transposition. `manual: true` (optional, additive) means the user chose it: automatic fingering never changes a valid manual fretting. Absent = derived by the fingering algorithm.
- **Tab rests.** `Staff.showRests: true` (optional, additive, tab staves only) draws the rests on that tab staff; absent = hidden, as in most guitar tablature (`setTabRests`).
- **Fingering.** `fingering.ts` (pure, MIDI numbers in, `{ string, fret }` out) chooses a string and a fret for every note and chord of a voice: Viterbi over the few cheapest candidates of each event, minimising hand movement (the hand position is the lowest fretted fret; open strings do not move it and the position carries over them), preferring open strings and low positions, one note per string, at most 4 frets between the fretted notes of a chord (5 with a penalty), few skipped strings in a chord, no special case for re-entrant tunings (strings are looked up by pitch). A pitch no string can play gets no fretting. `fretting.ts` applies it to staves: `refretStaffNotes(part, staff, keep)` recomputes the frettings of a staff, keeping all valid ones (`valid`), only the valid manual ones (`manual`) or none, reusing untouched objects; `unplayableEvents(score)` lists notes of tab staves that no string can play (drawn as `?`, listed in the inspector). Cost: 2.5 µs per note, 4.5 µs per chord note (tests assert < 1 ms).
- **Stability.** Editing a "standard + TAB" part rebuilds the other staff, but a note whose pitch did not change keeps the fretting it had (position by position), manual or derived; only new or changed notes are fingered, from their neighbours. A tuning or capo change recomputes the derived frettings and keeps manual ones that are still valid. `ensureFretting` (run by the editor after every edit) fills the frettings a tab staff is missing.
- **Changing instrument.** `changeInstrument` moves every written pitch by `oldTransposition - newTransposition` (spelling from the key of each measure; ties re-checked), keeps allowed clefs and replaces others with the instrument's default, adds an empty bass staff for piano, drops extra staves only when empty (`not-empty`), resets tuning and capo and recomputes frets. A tab staff repeating a standard staff of the same part is not played (playback and the mixer skip it).
- **Tuning presets.** `tuningPresets(instrumentId)` (guitar: standard, drop D, DADGAD, open G, open D, half and whole step down; ukulele: GCEA, low G, baritone, D tuning), `matchTuningPreset`, `assignFretting` (a lone note: preferred string kept, else open strings and the lowest fret; in `fretting.ts`) and `partRange` (catalog range extended down to the lowest string of a custom tuning) are in `tuning.ts`.
- **Range.** `isInRange(instrument, pitch)` and `rangeWarnings(score)` report notes outside the sounding range as warnings, never errors.

## Ties, slurs

- **Tie**: `tieToNext: true` on a pitch of a note. It is valid only when the next event of the same voice (continuing in the next measure of the same voice index) is a note containing the same spelled pitch. Commands clear ties that become invalid.
- **Slur**: a span `{ id, startEventId, endEventId }` at score level. Both events must exist on the same staff, the start strictly before the end. A slur may cross barlines. Deleting an event removes its slurs.

## Chord symbols

Chord symbols and fretboard diagrams were added to version 1 as **optional, additive fields** (a score without them is unchanged, and an older reader that rejects unknown properties only rejects scores that use them). Code: `web/src/score/chords.ts` (parser, spelling, transposition, chord tones), `diagrams.ts` (which chords show a diagram), `commands/chords.ts`.

```
StaffMeasure { clef?, voices[], chords? }
  ChordSymbol { id, tick, root, quality, bass?, diagram?, frame? }
    root, bass   { step: 'A'..'G', alter: -2..2 }          spelled, no octave
    quality      "" | "m7" | "maj7" | "7#9" | "m7b5" | "sus4" | "6/9" | ...   normalized suffix
    tick         offset from the start of the measure, 0 <= tick < measure length, unique per measure, list sorted by tick
    diagram      true: always show the diagram, false: never (absent: follow the part)
    frame        { frets[], base, barre? }  custom fingering (see below)
Part { ..., chordDiagrams?: 'first' | 'all', chordCapoShapes?: true }
```

- **Where.** On a staff measure, at a tick: usually the first staff of a part (the standard staff of a "standard + TAB" part). Chord symbols are **not** voices and have no duration: they are not part of the notes that a "standard + TAB" part keeps in sync, and a measure that gets shorter (time signature, pickup length) drops the symbols that no longer fit.
- **Concert pitch.** A symbol names the sounding chord, whatever the part's `transposition` or `capo` (`D` with a capo on fret 2 is a D chord played with a C shape). Transposing notes, changing the instrument or the capo never changes a symbol; `transposeChords` is explicit.
- **Spelled, normalized.** `root` and `bass` keep their spelling (`Gb` is not `F#`). `quality` is the canonical text of the parsed quality: `parseQuality(text)` gives a structure (minor, diminished, augmented, power chord, suspension, seventh, extension 9/11/13, sixth or six-nine, alterations in the order `b5 #5 b9 #9 #11 b13`, added tones), `formatQuality` writes it back: `CM7`, `C^7`, `CΔ7` and `Cmaj7` are all `maj7`; `Co7` is `dim7`; `Cø` is `m7b5`; `C69` is `6/9`; `C7(#9)` is `7#9`; minor-major is `m(maj7)`. The text uses `A-Z a-z 0-9 # / + ( ) -` only (at most 24 characters). The validator requires a quality the parser reads, which is what playback, diagrams and MusicXML rely on.
- **Parsing.** `parseChord(text)` accepts letters (any case), `#` `b` `♯` `♭` `x`, French names (`Do Ré Mi Fa Sol La Si`, any case), the quality spellings above and `/bass`; it returns `null` for anything else (`H`, `C2`, `Csus5`, `Cmm`, empty). A reading must parse completely, so `Faug` is F augmented, not French "Fa" then "ug". `formatChord(chord, 'letters' | 'solfege')` writes `F#m7b5/A` or `Fa#m7b5/La`.
- **Chord tones.** `chordTones(chord)` gives the pitch classes a voicing must contain (root, third or suspension, seventh, top extension, alterations, added tones, the bass) and the optional ones (the fifth unless altered, lower extensions): diagrams and playback use it.
- **Transposition and spelling** (`transposeChord(chord, semitones, { fifths })`, command `transposeChords`). Whole octaves keep the spelling. Otherwise a black key is spelled from the key signature of the measure when it has accidentals (sharps in sharp keys, flats in flat keys), else the usual chord names: major roots Db, Eb, F#, Ab, Bb; minor roots C#m, Ebm, F#m, G#m, Bbm. The bass follows the family of the new root. A custom `frame` is dropped (it no longer fits).
- **Diagram options.** `Part.chordDiagrams` shows the diagram of the first occurrence of each chord (same root, quality and bass) or of every chord, on parts with strings (a tuning, from the catalog or `Part.tuning`); `ChordSymbol.diagram` overrides it for one chord. `Part.chordCapoShapes` writes the shape played with a capo next to the symbol, `D (C)`. Diagrams count frets from the capo.
- **Custom fingering.** `frame`: `frets` has one entry per string of the part, highest string first (like `Fretting.string`, 1 = highest): -1 muted, 0 open, otherwise the fret from the nut; `base` is the first fret of the window (1 = at the nut); `barre` is `{ fret, from, to }` (1-based strings, `from <= to`). Written by the MusicXML import for a diagram that is not the library's shape; the validator checks the number of strings against the tuning.
- **Commands** (`commands/chords.ts`, all through `History`): `setChord({ staffId, measure, tick, chord })` (replaces the symbol at the tick and keeps its id, `diagram` flag and frame only if the chord is unchanged), `removeChord`, `setChordDiagram` (`true`, `false` or `null`), `setChordDiagramMode` (`'first'`, `'all'`, `null`), `setChordCapoShapes`, `transposeChords({ semitones, staffIds?, keyFifths? })`. `staffChords(score, staffId)` lists the symbols of a staff in order; `chordStaffId(part)` is the staff that carries them.
- **Validation codes.** `chord-position` (tick outside the measure), `chord-order` (not sorted, or two symbols on the same tick), `chord-quality` (unknown quality), `chord-frame` (a frame with another number of strings than the part, or a barre outside the strings), , `tick` an integer from 0, a frame of 1 to 12 strings with frets from -1 to 36. The API validates all of it with the schema (structure and limits); the semantic rules above are checked by the client model, like the other semantic rules.

## Commands, undo and redo

Every edit is a command (`commands/`): `interface Command { name; apply(score): Score; invert(before): Command }`. `apply` is pure and deterministic (ids included) and returns the **same reference** when nothing changes. `invert(before)` returns the command that restores `before` exactly (a snapshot jump; structural sharing makes the snapshot nearly free). `History` keeps unlimited undo and redo stacks; a command that throws a `CommandError` leaves it untouched.

**Structural sharing.** A command copies only the path from the root to the change (score, part, staff, measure array, staff measure, voice). Everything else keeps its reference identity, so renderers and React can skip unchanged measures with `===`, and the autosave diffs two scores in time proportional to what changed and sends only the changed measures ([library.md](library.md#incremental-saves)).

| Command                                                              | Behavior                                                                                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setPitch`, `setAccidental`                                          | change a pitch (chords stay sorted); duplicates in a chord are refused; tie and fretting of that pitch are dropped                                             |
| `addPitch`, `removePitch`                                            | edit a chord; the last pitch cannot be removed (use `deleteEvent`)                                                                                             |
| `setFretting`                                                        | sets string and fret (flagged `manual`) and derives the written pitch; a string already used by the chord is refused                                           |
| `moveToString`, `autoFinger`                                         | tab: move a pitch to the adjacent string keeping its pitch (manual); hand notes back to automatic fingering                                                    |
| `ensureFretting`, `setTabRests`                                      | tab: fill the missing frettings of the tab staves of a part; show or hide the rests of a tab staff                                                             |
| `putEvent`                                                           | writes a note, chord or rest at a tick of a voice (overwrite rule)                                                                                             |
| `deleteEvent`                                                        | replaces by a rest of the same duration (same id); slurs on it are removed                                                                                     |
| `changeDuration`, `toggleDot`                                        | resize an event (overflow rule)                                                                                                                                |
| `toggleTie`, `addSlur`, `removeSlur`                                 | ties and slurs                                                                                                                                                 |
| `createTriplet`                                                      | turns an undotted event into a 3:2 triplet (first slot keeps the note, two rests)                                                                              |
| `transpose`                                                          | by semitones (12 = octave), all or nothing; fretting is dropped                                                                                                |
| `insertMeasure`, `deleteMeasure`                                     | structure                                                                                                                                                      |
| `setTempo`                                                           | tempo change (20 to 400) from a measure, `null` removes it                                                                                                     |
| `addPart`, `removePart`, `movePart`, `renamePart`                    | parts (the last part cannot be removed: `last-part`)                                                                                                           |
| `changeInstrument`                                                   | new instrument: notes keep their sounding pitch, clef, staves, tuning and frets follow (see below)                                                             |
| `setStaffLayout`                                                     | fretted parts: `standard`, `tab` or `standard+tab`                                                                                                             |
| `syncCompanionStaff`                                                 | "standard + tab" parts: rebuilds the other staff from the one being edited when their notes differ (the editor runs it after each edit, in the same undo step) |
| `setTuning`, `setCapo`                                               | tuning override (`null` = catalog) and capo; frets are recomputed                                                                                              |
| `setTimeSignature`, `setKeySignature`, `setMeasureLength`, `setClef` | attributes from a measure on                                                                                                                                   |

**Filling and overflow rules (MuseScore-like).**

- A measure is always full: every voice sums exactly to the measure length, gaps are rests.
- Writing an event overwrites what it covers. Events fully covered are removed; an event that starts before the new one is cut (split in tied notes if its length is not one duration); the part of an event that sticks out after it becomes rests; any gap is filled with rests.
- Rest fills follow the beat grid: each piece is the largest value aligned on its own length, then merged into a dotted value when possible (half + quarter at the start of a bar is a dotted half rest).
- An event that would pass the barline is **refused** (`CommandError` `exceeds-measure`); there are no automatic ties across the barline in V1.
- Tuplet members cannot be partly overwritten (`tuplet-conflict`). Writing an event of the same nominal duration on a tuplet member replaces it in place.
- `setTimeSignature` and `setMeasureLength` pad measures with rests or truncate them (a cut note becomes tied notes, later events are dropped; cutting a tuplet is refused). `setTimeSignature` clears a pickup length on that measure.
- `deleteMeasure` moves time, key, tempo and clef changes to the next measure when it has none, and refuses to delete the last measure.
- `transpose` by whole octaves keeps the spelling; other intervals use the key signature in force at the measure (sharps in sharp keys, flats in flat keys, sharps or flats by direction in C major).

## Validation

`validateScore(score): Issue[]` returns every problem (`{ code, path, message }`, path as a JSON pointer). Codes: `duplicate-id`, `first-measure-attributes`, `bad-measure-length`, `measure-count`, `voice-missing`, `voice-length` (voice does not fill the measure), `non-integer-ticks`, `empty-chord`, `duplicate-pitch`, `tie-target`, `tuplet-ratio`, `tuplet-ref`, `tuplet-contiguous`, `tuplet-overlap`, `tuplet-size`, `slur-ref`, `slur-staff`, `slur-order`, `fretting-no-tuning`, `fretting-string`, `fretting-fret`, `fretting-mismatch`. An empty array means valid.

## Serialization and versioning

`serialize(score)` gives compact JSON. `deserialize(text)` parses, runs `migrate`, decodes the structure (unknown properties, wrong types, out-of-range values and size limits are rejected), then runs `validateScore`. It throws a typed `ScoreFormatError` carrying `issues` and never returns an invalid score. `fromJson(value)` does the same for an already parsed value.

- `schemaVersion` is `1`. `migrate(json)` upgrades older versions step by step through a table of migrations (empty today, a no-op for version 1) and refuses unknown or newer versions with the code `unsupported-version`.
- To change the format: add a version, a migration from the previous one, a new `schema/score.vN.schema.json` and keep the old one while stored documents use it.

## JSON Schema and limits

`schema/score.v1.schema.json` covers the structure and the size limits the server uses to reject abuse. A test validates all fixtures against it and checks that `deserialize` and the schema agree on a list of invalid samples. The schema cannot express the semantic rules (voices filling measures, unique ids, valid ties, slurs, tuplets and frettings): the server runs the same `validateScore` rules.

| Limit                                 | Value                 |
| ------------------------------------- | --------------------- |
| parts / staves per part               | 32 / 4                |
| measures                              | 2000                  |
| voices per measure / events per voice | 4 / 512               |
| pitches per chord                     | 12                    |
| tuplets per voice / events per tuplet | 128 / 16              |
| slurs                                 | 20000                 |
| tuning strings / frets                | 12 / 36               |
| title, composer                       | 200 characters        |
| part name / instrument id             | 100 / 64 characters   |
| id                                    | 64 characters         |
| JSON text (`deserialize`)             | 16 000 000 characters |

## Performance

Measured by `npm run bench` on a 500-measure, 4-staff score (about 8000 events, 0.96 MB of JSON): apply + undo of a note edit below 0.2 ms (budget 1 ms), serialize below 4 ms (budget 20 ms). The bench fails above the budgets.
