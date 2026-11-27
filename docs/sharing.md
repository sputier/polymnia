# Read-only share links

**English** · [Français](sharing.fr.md)

An owner can share a score with a link. Anyone with the link can view and play the score, without an account. They cannot change it and cannot reach any other score.

Code: `api/Polymnia.Api/Sharing/` (endpoints, rate limit), `api/Polymnia.Core/Sharing/` (token), `api/Polymnia.Infrastructure/Sharing/` (store), `web/src/sharing/` (dialog and viewer), `web/src/api/shares.ts` (client).

## How it works

| Step                | What happens                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create              | The owner opens **Share** (top bar, library card menu, or the command palette: `Ctrl+Shift+L`, "Share this score…") and clicks **Create link**.                       |
| Link                | `https://<host>/#/s/<token>`. The dialog shows it once, selected, with a **Copy link** button (Clipboard API, with a selection fallback).                             |
| Open                | The visitor sees the score and the playback bar, signed out. No sign-in screen, no session request, no editing interface.                                             |
| Regenerate          | **New link** revokes the current link and creates another. A score has at most one active link.                                                                      |
| Stop sharing        | **Stop sharing** revokes the link at once. The viewer then says "This link is no longer valid."                                                                      |
| Export              | The dialog also has the export buttons (MusicXML, MXL, MIDI, PDF, PNG), the same actions as the editor's Export menu. From the library the score is fetched for them. |

The viewer always shows the **current** version of the score: edits by the owner appear on the next load.

## The token

- 32 random bytes (**256 bits**) from the operating system's CSPRNG (`RandomNumberGenerator`), written as base64url: 43 characters, no padding. The shape is public; the content is not guessable (2^256 possibilities).
- The server stores only its **SHA-256 hash** (`share_links.token_hash`, `bytea`, unique). The raw token is returned **once**, in the answer of the creation, and is never stored or logged.

### Decision: hash only, not encrypted

The alternative was to store the token encrypted with Data Protection, so the owner could see the link again. We chose **hash only**:

- A database leak (backup, SQL injection, a stolen replica) gives an attacker hashes of 256-bit random values: nothing they can use. Encrypted tokens would be recoverable by anyone who also gets the Data Protection keys (stored in the same database, protected by one certificate): a single combined leak would expose every link.
- Share links are credentials. Credentials that cannot be read back are the safe default; the owner who lost a link regenerates one in one click.
- The cost is usability only: the dialog shows the full link right after creation; later it says the link is active and since when, and offers **New link**.

A fast hash is fine here because the input is 256 bits of randomness, not a password: there is nothing to brute force, so no need for a slow KDF.

## Public endpoint

`GET /api/shared` with the token in the **`X-Share-Token` request header**, no authentication. The token is the only credential. It is never in the URL (path or query), so no access log, log scope or `Referer` can carry it; `/api/shared/<anything>` and `?token=` are plain `404`s.

| Case                                | Answer                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Active link                         | `200`, the score document (JSON, `meta.title` is the title), streamed from PostgreSQL like `GET /api/scores/{id}`.        |
| Missing, revoked, unknown or malformed token | `404` ProblemDetails, **identical** in all cases (status, title, headers).                                          |
| Too many requests                   | `429` with `Retry-After`.                                                                                               |
| Any other method                    | Never a success. `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `TRACE` get `400` (antiforgery, no token) or `404`/`405`.   |

Headers on every answer, `404` included: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`. No cookie is set.

Security properties:

- **Read-only by construction.** The route is `GET` only and reads the one score behind the token. The token is accepted nowhere else (`/api/scores/*` still needs a session; a test checks a token in the query string and in an `Authorization` header).
- **No timing oracle on the secret.** The lookup is by the hash on a unique index: the application never compares a secret byte by byte. A token with the wrong shape is refused without a database round trip; the shape is public, so that reveals nothing.
- **Rate limit per client address**: 60 requests per minute and per IPv4 address or IPv6 `/64` (the same key as the sign-in limiter), plus at most 4 public reads streaming at once per address and 32 in all (the concurrency caps are checked first, so a refused request does not spend the budget). An unknown address shares one key instead of being unlimited. Settings `RateLimiting:Shared:PermitLimit`, `WindowSeconds`, `MaxConcurrentReads` and `MaxConcurrentReadsPerClient`. Behind a reverse proxy, enable forwarded headers (`POLYMNIA_FORWARDED_HEADERS=true`, see [self-hosting.md](self-hosting.md)) or every visitor shares the proxy's budget. If forwarded headers are disabled and a request arrives with `X-Forwarded-For` or `Forwarded`, the app logs one warning per process (`ForwardedHeadersDisabled`) saying so.
- **Compression stays on** for this endpoint. The BREACH rule ("a response that carries a secret is never compressed", see [authentication.md](authentication.md)) is about the *body*: the body of this answer is the score, which is not secret, and never contains the token. The creation answer, which does carry the token, is `DisableResponseCompression()`.
- **No token in logs, by construction.** The token is in a header, which no framework log, log scope (`RequestPath`) or default access log of a reverse proxy records. The application logs only the audit events `ShareLinkCreated` / `ShareLinkRevoked` (user id and score id). A test runs the host with every level at `Trace` and scopes captured, and checks that no log entry or scope contains the token or its hash. Do not configure a proxy to log request headers.

### Why a hash route (`#/s/<token>`)

The link the user shares has the token in the **fragment**. A browser never sends the fragment: the page load (`GET /`) carries no token, so it stays out of server and proxy access logs for the page, and out of the `Referer` header of anything the page loads or links to. The viewer then reads the token in JavaScript and calls `GET /api/shared` with it in the `X-Share-Token` header, with `credentials: 'omit'`, `cache: 'no-store'` and `referrerPolicy: 'no-referrer'`; the page also sets `<meta name="referrer" content="no-referrer">`. The token reaches the server only as a request header, never in a URL. Same origin only: no CORS is configured, so another site cannot call the endpoint from a browser.

A crawler never sees the fragment either, and the viewer adds `<meta name="robots" content="noindex, nofollow">` while it is shown.

## Owner endpoints

Under `/api/scores/{id}/share`. They need the session and, for unsafe methods, the antiforgery header. A score owned by someone else answers `404`, like a missing score. Limits: the per-user read and write budgets of [api.md](api.md).

| Method and path                         | What it does                                                                                              | Success                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `GET /api/scores/{id}/share`            | Status: `{ active, createdAt }`. Never the token.                                                         | `200`                                          |
| `POST /api/scores/{id}/share`           | Create the link, revoking the active one if any. Body: none. Never compressed, `Cache-Control: no-store`. | `201` `{ token, createdAt }`                   |
| `DELETE /api/scores/{id}/share`         | Revoke the active link. Idempotent.                                                                       | `204`                                          |

A `409` on creation means two creations raced for the same score; retry.

## Storage

Table `share_links`: `id` (UUID), `score_id` (foreign key to `scores.id`, `ON DELETE CASCADE`), `token_hash` (`bytea`, 32 bytes, unique, checked), `created_at`, `revoked_at` (null while active). A partial unique index on `score_id WHERE revoked_at IS NULL` lets the database enforce **at most one active link per score**, even for two concurrent creations. Creating a new link deletes the older revoked rows of that score, so a score holds at most two rows.

Deleting a score deletes its links; deleting a user deletes their scores, so their links too (both tested).

## Tests

- API (`ShareLinkTests`, Testcontainers): token entropy and format; only the hash is stored; the token is returned once and never by the status; owner-only management (other user: `404`); antiforgery and session required; valid token `200` with the privacy headers; unknown, malformed and revoked tokens give the same `404`; regenerate revokes the old link; concurrent creations leave one active link; every unsafe method is refused; revocation takes effect at once; rate limit `429` per address and per IPv6 `/64`; cascade on score and user deletion; no token in logs.
- Vitest (`web/src/sharing/sharing.test.tsx`): the route, the URL (token in the fragment), the request flags, the dialog (create, copy, fallback, revoke, never shows an existing token, accessible modal), the viewer (signed out, read only, no session request, `noindex`, invalid link, retry).
- Playwright (`web/e2e/share.spec.ts`): share from the top bar and copy; open in a signed-out browser context and see the score; play (audio mocked); revoke and see "This link is no longer valid."; regenerate; the palette command. The public request carries no cookie and no referrer.
