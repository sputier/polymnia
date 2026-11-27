# Score library and autosave

**English** · [Français](library.fr.md)

The library is the signed-in home (`#/`). A stored score opens at `#/scores/<id>`. `#/editor` is still a scratch editor that is never saved (previews, fixtures and tests use it). The router is the same tiny hash router (`web/src/route/useRoute.ts`).

Code: `web/src/library/` (screen), `web/src/persistence/` (autosave), `web/src/api/scores.ts` (API client).

## Library

| Feature      | Behavior                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List         | Cards, most recently changed first (the server order). Paged by 50: scrolling near the end loads the next page, and a "Load more" button does the same for the keyboard.                                                                       |
| Card         | Title, one chip per instrument, number of measures, "Modified 2 hours ago" (full date in the tooltip) and a static staff. No engraving in the list.                                                                                            |
| Preview data | `GET /api/scores` returns `measureCount` and `instruments` for each item (see [api.md](api.md)). The server computes them for the rows of the page only, from `content`, with a few `jsonb` functions.                                         |
| Search       | Title search on the server (`?q=`), debounced by 250 ms, answers that arrive late are dropped. `/` focuses the field, `Esc` clears it, then leaves it.                                                                                         |
| Menu         | Per card: Open, Rename, Duplicate, Share, Delete. `ArrowUp`/`ArrowDown`/`Home`/`End` move in the menu, `Esc` closes it and gives the focus back to its button.                                                                                 |
| New score    | `N` or the button. The dialog asks for the title, the instruments (guitars, ukuleles, cello and piano first, then the rest of the catalog), the key, the time signature and the tempo, creates the score with `POST /api/scores` and opens it. |
| Rename       | A dialog, then `PATCH` with `If-Match`. If the score changed meanwhile (409) the list is read again.                                                                                                                                           |
| Duplicate    | `POST /api/scores/{id}/duplicate`; the copy appears first.                                                                                                                                                                                     |
| Share        | Opens the share dialog: create, copy, regenerate or revoke the read-only link, and download a copy. See [sharing.md](sharing.md). |
| Empty state  | A message and a "New score" button; a different message when a search finds nothing.                                                                                                                                                           |

### Keyboard

`ArrowLeft`/`ArrowRight` move to the previous or next card, `ArrowUp`/`ArrowDown` to the card above or below (by position, so it follows the grid), `Home`/`End` to the first or last card, `Enter` opens. Only one card is in the tab order (roving tabindex), so `Tab` does not walk through 200 cards. `Ctrl+K` opens the command palette, which lists the library commands (New score, Search scores) with the others.

### Delete with undo

The API deletes for good and has no restore. Re-creating the score on undo would give it another id, so any share link would break. The deletion is therefore **deferred**: the card disappears and a toast offers "Undo" for 8 seconds; the `DELETE` request is only sent when the window ends. Undo cancels it, so the server never saw anything. If the tab is closed during the window, the pending requests are sent with `keepalive` on `pagehide`; if that does not work the score is simply still there next time (the safe failure). If the request fails the card comes back with an error message. Code: `web/src/library/deferredDelete.ts`.

### Errors

| Case                | What the user sees                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`               | The sign-in screen. The current `#/...` screen is kept in `sessionStorage` and restored after signing in (the part after `#` never reaches the server). |
| `429`               | "Too many requests. Try again in N s", from `Retry-After`.                                                                                              |
| `409` (score limit) | "You reached the limit of 200 scores."                                                                                                                  |
| Offline             | "You are offline."                                                                                                                                      |

## Autosave

The editor loads the score (`GET`, version from the `ETag`), deserializes it with the score model, and watches the editor state. Every change of the score (including undo and redo) tells the **save queue** (`web/src/persistence/saveQueue.ts`, no React inside, unit-tested with fake timers).

| Rule                  | Detail                                                                                                                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Debounce              | Save 1 s after the last edit, and at most 10 s after the first unsaved edit, so long typing still saves. `Ctrl+S` saves at once. A hidden tab saves too.                                                                                                                                                  |
| One request at a time | A save never starts while another is in flight (two concurrent `PUT`s would conflict with each other). Edits made during a save are sent by the next one.                                                                                                                                                 |
| Latest content        | The document is serialized when the request starts, not when the edit happened.                                                                                                                                                                                                                           |
| Compression           | A full document is gzip-compressed with `CompressionStream` (`Content-Encoding: gzip`, accepted by the API) when the browser has it and the document is over 1 KB; plain JSON otherwise. A patch is small and is sent as plain JSON.                                                             |
| Incremental saves     | A save sends **what changed since the last save** with `PATCH /api/scores/{id}/content`, not the whole document (see below). The full `PUT` is used for the first save after a conflict, when the changes are too many or too big, and when the server answers `400` or `413` to a patch.            |
| Versions              | Each write carries `If-Match: "<version>"`; the answer gives the next version.                                                                                                                                                                                                                            |
| Rename                | Editing the title saves with `PATCH` (no document sent) when nothing else changed, and with the `PUT` (which carries `meta.title`) when both changed. A blank title is saved as "Untitled score" because the server refuses an empty one.                                                                 |
| Network error         | Status `Offline`, retries with backoff (2, 4, 8, 16 then 30 s), and at once on the browser's `online` event. Edits are kept.                                                                                                                                                                              |
| `5xx`                 | Status `Not saved`, same backoff.                                                                                                                                                                                                                                                                         |
| `429`                 | Waits for `Retry-After` (at most 2 minutes), then retries.                                                                                                                                                                                                                                                |
| `413`                 | "This score is too large to save (limit 4 MiB)". No retry until the next edit (the user may have removed content).                                                                                                                                                                                        |
| `409`                 | Status `Conflict` and a dialog: **Load the server version** (drops the local edits) or **Keep mine (overwrite)** (reads the server version, then saves over it). Saving stops until the user chooses; edits are kept.                                                                                     |
| `401`                 | Status `Sign-in needed` and a dialog with a sign-in link that opens in a **new tab**, so this tab keeps the edits in memory. "I signed in: save now" retries (it also retries when the tab gets the focus back).                                                                                          |
| Leaving               | Closing the tab with unsaved work shows the browser's warning (`beforeunload`). Going back to the library saves first: the queue outlives the editor until it is idle, and the library waits for it before reading the list. Leaving while a conflict or a refused save is pending asks for confirmation. |

### Incremental saves

The queue keeps the score the server holds (the *base*: the last loaded or successfully saved score, `web/src/persistence/scoreSync.ts`). When a save starts it takes a snapshot of the editor's score and diffs it against the base (`scoreDiff.ts`, pure, unit-tested). The score model is immutable with structural sharing, so an unchanged measure is the same object on both sides: the diff compares references (`===`) and only walks into what differs, a cost that follows the number of changed measures, not the size of the score (a 500-measure, 4-staff score diffs in a few tens of microseconds).

- **Unit of a change: a measure.** A changed staff measure becomes `setStaffMeasure`, a changed measure attribute `setMeasureInfo`, the metadata `setMeta`, the slur list `setSlurs`; inserted and deleted measures and parts become `insertMeasure`, `deleteMeasure`, `insertPart`, `deletePart`; a part whose header (name, instrument, transposition, tuning, capo) or staves (clef, type, rests) changed is replaced whole (`replacePart`). Each operation names ids, never positions (the operations are listed in [api.md](api.md#incremental-updates)).
- **Falls back to the whole document** (always correct) when the diff cannot say the change simply or it is not worth sending: more than 32 operations, a patch over 128 KB, a part that moved, ids that are not unique, measures inserted or deleted while parts change shape at the same time, or a different `id` or `schemaVersion`.
- **Nothing to send.** If the editor's score equals the base (an edit and its undo within the same debounce window), no request is made.
- **The base moves only when the server confirms.** A network error, a `429` or a `5xx` keeps the base: the retry computes a new diff from the same base and the then-current document. A `400` or `413` answer to a patch (the server cannot apply it, or the result would be too large) sends the same snapshot as a full `PUT` at once, without bothering the user; if that is refused too, the usual message is shown.
- **Conflicts.** A `409` is the usual conflict dialog. Whatever the user chooses, the base can no longer be trusted: "Keep mine" sends the whole document, and "Load the server version" replaces the base with the document it just loaded (the next saves are patches again).
- **Renames** are unchanged (`PATCH /api/scores/{id}` alone when only the title changed) and update the base's title.

Measured server side on a 500-measure score: see [api.md](api.md#storage-and-performance).

Edits are never dropped from memory by an error. Edits are lost only if the user closes the tab after the warning, or chooses "Load the server version".

### Save status

The top bar and the status bar show `Saved`, `Saving…`, `Offline`, `Conflict`, `Not saved` or `Sign-in needed`. Between the first edit and the end of the save the status stays `Saving…`, so a burst of typing is announced once (the status bar is a polite live region), not on every keystroke. Messages for the unusual cases (offline, too large, rate limited) appear above the status bar.

## Measured

Mocked API, headless Chromium on the development machine (Windows 11), `web/e2e`:

| What                                                                    | Result        | Budget |
| ----------------------------------------------------------------------- | ------------- | ------ |
| 200 scores: from the answer of the list to the 200th card in the DOM    | about 60 ms   | 100 ms |
| Open a 500-measure, 4-staff score (about 940 KB): fetch and deserialize | about 40 ms   |        |
| Same, until the first system is in the DOM                              | about 160 ms  |        |
| Initial JavaScript                                                      | 110.8 KB gzip | 150 KB |

The real network adds the transfer: about 26 ms server side for the `GET` (see [api.md](api.md)). The first system is engraved on its own; the rest of the score is engraved in idle time ([engraving.md](engraving.md)).

## Tests

- Vitest: save queue (debounce, max wait, serialization, backoff, offline, 429, 413, 401, 409 and its two resolutions, pending saves), incremental saves in the queue (patch path, nothing to send, fallback to `PUT` on `400` and `413`, the base only moves on success, a conflict forces a full save), the diff (`scoreDiff.test.ts`: every operation, the fallback thresholds, and seeded random command sequences checking that applying the operations to the base gives the edited score), API client (ETag, gzip, If-Match, errors, `patchScore`), deferred delete.
- Playwright (`web/e2e/library.spec.ts`, `autosave.spec.ts`, API mocked by `fake-api.ts`, whose `PATCH .../content` applies the operations like the server): create, rename, duplicate, delete with and without undo, search, keyboard, French, palette, autosave as a patch and reload (the stored document equals the editor's), later saves send only what changed, fallback to a gzip `PUT`, conflict (both choices), offline then online, 429, 413, 401, leaving right after an edit, performance.
- API: the list preview (`ScoreApiTests`); incremental updates (`ScorePatchTests`, `ScorePatchPlannerTests`, see [api.md](api.md#incremental-updates)).
