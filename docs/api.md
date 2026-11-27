# Score API

**English** · [Français](api.fr.md)

REST API to store and manage scores, under `/api/scores`. Every endpoint requires a signed-in user and only ever sees that user's scores. The score document is the JSON described in [score-format.md](score-format.md) and validated against [`schema/score.v1.schema.json`](../schema/score.v1.schema.json).

In Development, the OpenAPI document is served at `/openapi/v1.json`. It is not served in other environments.

## Endpoints

| Method and path                      | What it does                                                                                                                                                               | Success                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/scores?q=&page=&pageSize=` | List your scores, most recently changed first. `q` is a case-insensitive title search. `page` starts at 1, `pageSize` is 1 to 100 (default 20). Never returns the content, but each item has a cheap preview computed from it: `measureCount` and `instruments` (the instrument id of each part), for the rows of the page only. | `200` `{ items, page, pageSize, total }`                             |
| `GET /api/scores/{id}`               | The score document, with its `ETag`. Honors `If-None-Match`.                                                                                                               | `200` document, or `304`                                             |
| `POST /api/scores`                   | Create a score from a score document (the request body is the document). The title is `meta.title`.                                                                        | `201` summary, `Location`, `ETag`                                    |
| `PUT /api/scores/{id}`               | Replace the document. Requires `If-Match`.                                                                                                                                 | `200` `{ id, title, schemaVersion, version, updatedAt }`, new `ETag` |
| `PATCH /api/scores/{id}`             | Rename: body `{ "title": "..." }`. Also rewrites `meta.title` in the stored document. Requires `If-Match`.                                                                 | `200` same shape as `PUT`, new `ETag`                                |
| `POST /api/scores/{id}/duplicate`    | Copy the score, titled "<title> (copy)".                                                                                                                                   | `201` summary, `Location`, `ETag`                                    |
| `DELETE /api/scores/{id}`            | Delete the score.                                                                                                                                                          | `204`                                                                |

A summary is `{ id, title, schemaVersion, version, createdAt, updatedAt }`. A list item is a summary plus `measureCount` and `instruments`.

## Access control

Every query is filtered by the owner id taken from the session, never from the request. A score that belongs to someone else answers **404**, exactly like a score that does not exist (never 403), for every endpoint, conditional requests included.

## Concurrency: ETag, If-Match, If-None-Match

Each score has a `version`, a counter that starts at 1 and increases on every change (content or title). It is the `ETag` (`"3"`).

- `PUT` and `PATCH` require `If-Match` with the `ETag` you last received. Missing: `428`. Not an `ETag` (`*`, text): `400`. A version that is not the current one: `409` (the problem `type` is `urn:polymnia:problem:version-conflict`). Reload the score with `GET`, merge, retry.
- `GET` with `If-None-Match` equal to the current `ETag` returns `304` without reading the document (a version-only query).
- Updates are one atomic SQL statement conditioned on the version: two concurrent updates with the same version cannot both succeed.

## Validation

- Body: `Content-Type: application/json` (`415` otherwise), at most **4 MiB** (`413` beyond). A 500-measure, 4-staff score is about 1 MB and the schema's own limits (2000 measures) give about 4 MB, so 4 MiB covers it while bounding memory, validation time and storage. The limit is enforced on `Content-Length` and while reading (chunked bodies).
- `Content-Encoding: gzip` or `br` request bodies are accepted. The 4 MiB cap applies to the **decompressed** size (a bomb gets `413`); a corrupt stream gets `400`, any other `Content-Encoding` gets `415`.
- Invalid JSON, a document that does not match the schema, or nesting deeper than 32 levels: `400`.
- `schemaVersion` must be a supported version (only `1` today): `400` otherwise.
- Title (`meta.title`, rename): trimmed, at most 200 characters (Unicode code points), no control characters, no bidirectional override characters. An empty title is refused everywhere. The trimmed title is the one stored, in the column and in `meta.title` of the document.
- Characters PostgreSQL `jsonb` cannot store (`\u0000`, lone surrogates): `400`.
- The server checks the structure and the size limits (the schema). The semantic rules (a voice fills its measure, ties, slurs, tuplets, frettings) are enforced by the client score model: a score is only ever read back by its owner.

### How the schema is evaluated

The schema file is embedded in the API assembly. Generic JSON Schema libraries took 150 to 300 ms to validate a 1 MB score (measured with two of them), which alone breaks the 50 ms budget of the update endpoint. The server therefore uses a small compiled evaluator (`CompiledSchema`) for the keywords the schema uses. It refuses to load a schema that uses a keyword it does not implement, and a test compares it with an independent, complete implementation (LateApexEarlySpeed.Json.Schema, BSD-3-Clause) on valid and invalid documents. One deliberate difference: ids ending with a line break are refused (the reference implementation lets them through).

## Limits

| Limit                                              | Value                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Score body                                         | 4 MiB                                                                                                              |
| Writes (create, update, rename, duplicate, delete) | 120 per minute and per user (`RateLimiting:ScoreWrites:PermitLimit`, `WindowSeconds`)                              |
| Scores per user                                    | 200 (`Scores:MaxScoresPerUser`), `409` beyond for create and duplicate (`type` `urn:polymnia:problem:score-limit`) |
| Page size                                          | 100                                                                                                                |
| Search text `q`                                    | 100 characters                                                                                                     |

Reads (list, get): 600 per minute and per user (`RateLimiting:ScoreWrites:ReadPermitLimit`). Over a budget: `429` with `Retry-After` (seconds). At most 16 writes run at the same time, all users together (`MaxConcurrentWrites`), and one user has at most 2 writes and 4 reads in flight. A body not received within 15 s gets `408`; a response not read within 20 s is cut.

## Errors

Errors are `application/problem+json` (RFC 9457) without stack traces: `400` invalid input, `401` not signed in, `404` unknown or not yours, `409` version conflict or score limit, `413` body too large, `415` not JSON, `428` missing `If-Match`, `429` too many writes.

## Storage and performance

- Table `scores`: `id` (UUID), `owner_id` (UUID), `title`, `content` (`jsonb`), `schema_version`, `version`, `created_at`, `updated_at` (UTC).
- Indexes: `(owner_id, updated_at desc)` for the list, and a trigram GIN index on `title` (extension `pg_trgm`, created by the migration; it is a trusted extension, so the database owner can create it) for the `ILIKE '%text%'` search, which a B-tree cannot serve.
- A `CHECK` constraint guarantees `content` is a JSON object and `version > 0`.
- `GET` streams the document from PostgreSQL to the response as bytes (no large .NET string).
- The list is a projection: it never loads `content`. Reads use `AsNoTracking()`. Responses are compressed (no secret in them). `GET` sets `Cache-Control: private, no-cache` so clients revalidate with the `ETag`.
- Measured on a 500-measure score (935 KB), p95 over 200 requests, in process against PostgreSQL 17 in Docker Desktop on Windows (`POLYMNIA_PERF=true dotnet test --solution api/Polymnia.slnx --filter-class "*ScorePerformanceTests"`):

| Operation                        | p95          |
| -------------------------------- | ------------ |
| `GET` score                      | about 26 ms  |
| `GET` with `If-None-Match` (304) | about 3 ms   |
| `GET` list (20 scores)           | about 8 ms   |
| `PUT` score                      | about 128 ms |
| `PUT` score, gzip body (61 KB)   | about 132 ms |

The 50 ms budget is met for get and list. It is not met for a full-document `PUT` of 1 MB on this setup: about 55 ms is the transfer of 1 MB to the database through the Docker Desktop port proxy alone (a bare `SELECT length($1)`), about 30 ms is PostgreSQL parsing the document as `jsonb`, and about 27 ms is validation. Sending the body gzip-compressed does not change it (the wire to the API is not the bottleneck here). A Linux host with a local database removes the first part. Reducing the rest means not sending the whole document on each save (incremental updates), which is a design change for the editor.

## Authentication and CSRF

The endpoints require the session cookie of [Authentication](authentication.md); the user id is its `NameIdentifier` claim (a GUID). Every unsafe method (`POST`, `PUT`, `PATCH`, `DELETE`) must carry the antiforgery token in the `X-XSRF-TOKEN` header, `duplicate` and `DELETE` included (`400` otherwise, before anything is read); this is covered by a test. `scores.owner_id` is a foreign key to `users.id` with `ON DELETE CASCADE`: deleting a user deletes their scores.
