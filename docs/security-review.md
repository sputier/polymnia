# Pre-release security review (#20)

Independent review of the whole application before the first public deployment. Method: read the code, then try
to break it with failing tests (documentation was not taken as proof). Every finding below is **fixed** in the pull
request that closes #20, with a regression test. Nothing is left as an accepted risk.

[Version française](security-review.fr.md)

## Threat model (summary)

| Asset                                    | Threat                                                         | Main defences                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A person's scores and profile            | Another signed-in user (IDOR), another website (CSRF), theft of the session | Owner-scoped queries (404, never 403), server-side session, `__Host-` cookie, antiforgery header on every unsafe `/api` call |
| The session                              | Fixation, replay, over-long life, forged OIDC callback         | Authorization code + PKCE, state, nonce, issuer and audience checks, hashed session keys, idle and absolute expiry, recent sign-in for deletion |
| Share links                              | Guessing, leaking through logs or `Referer`, use for writing   | 256-bit token in a header, SHA-256 only stored, GET only, `no-referrer`, per-address limits           |
| The server (CPU, memory, disk, database) | Oversized or decompressed bodies, slow clients, request floods, abusive documents | Body caps, JSON depth cap, schema validation, parameterized SQL, per-user and per-address budgets, concurrency caps, deadlines |
| Other people's browsers (shared viewer)  | Stored XSS or SVG injection through a score someone shares     | No HTML sink in the front end, CSP `script-src 'self'` without inline code, text-only SVG, hex-encoded PDF strings |
| The operator's secrets                   | Leaks in the repository, images, logs or backups               | Docker secrets, Data Protection keys encrypted with a certificate, no secret in history, placeholders only in `.env.example` |
| The supply chain                         | Vulnerable or tampered dependencies, actions or images         | `npm audit`, NuGet audit as build errors, actions pinned by SHA, digest-pinned images, attested releases |

Trust boundaries: browser to API (everything is untrusted, including the score JSON), API to PostgreSQL (parameters
only), API to Google (validated ID token only) and API to SMTP (TLS mandatory).

## What was checked

- **Authentication and session**: OpenID Connect flow (state, nonce, PKCE, redirect URI from configuration, issuer,
  audience, signature, expiry), session store (hash-only keys, revocation, idle and absolute expiry, `auth_time`
  for account deletion), cookie flags, logout, open redirects (`returnUrl`), account confusion on re-authentication.
- **CSRF**: global antiforgery on unsafe `/api` methods in every spelling of the path, the single exemption
  (`POST /api/contact`) and its JSON content-type guard, no CORS, no state-changing GET.
- **Access control**: every endpoint (scores, patch, share links, `me`, export, deletion, contact, legal, health),
  owner checks, the public share endpoint.
- **Input validation and injection**: JSON validator and schema patterns (linear, with a timeout), patch planner and
  its SQL (no string concatenation of values), jsonpath, contact form (header injection, Unicode), file names in
  downloads, log injection.
- **Client**: no `innerHTML`, `dangerouslySetInnerHTML`, `eval` or `postMessage`; MusicXML import (entities, zip bomb, path
  traversal, lying headers); SVG, PDF and PNG export; hash routes; `localStorage` and `sessionStorage` content; the
  `route-preload.js` generator.
- **Denial of service**: body, decompression, patch and export limits; rate limits and concurrency caps; deadlines;
  regular expressions.
- **Headers and transport**: CSP, HSTS, COOP, Referrer-Policy, Permissions-Policy, `nosniff`, `Cache-Control`,
  `X-Robots-Tag`, response compression (BREACH rule), `AllowedHosts` and forwarded headers.
- **Secrets and configuration**: `git log -p` scan of the whole history for keys, tokens and passwords (only
  dummy test values found), fail-fast settings, `.env.example`, personal data in the repository.
- **Supply chain**: `npm audit` (including dev dependencies) and `dotnet list package --vulnerable --include-transitive`:
  no known vulnerability. Workflows, Dockerfile, compose file, release pipeline, Dependabot.
- **Privacy**: logs (user id only), export content, deletion (every foreign key cascades, tested).

## Findings

| #  | Severity | Area                  | Finding                                                                                                                                                                                                                                  | Status | Regression test |
| -- | -------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------- |
| 1  | Medium   | Denial of service     | Request decompression was applied to every route, but only the score content routes bound the decompressed size. A small gzip or Brotli body sent to a route that binds JSON itself (rename) was inflated to tens of megabytes in memory. | Fixed  | `SecurityReviewScoreTests.A_compressed_body_is_refused_where_nothing_bounds_the_decompressed_size` |
| 2  | Low      | Session / CSRF        | The OpenID Connect handler listens on `/signout-oidc` (front-channel logout) and ended the current session on a plain cross-site `GET`: any website could sign people out.                                                                 | Fixed  | `SecurityReviewOidcTests.The_remote_sign_out_paths_of_the_oidc_handler_cannot_end_a_session` |
| 3  | Low      | Headers               | No `X-Frame-Options` (browsers without CSP `frame-ancestors`) and no `Cross-Origin-Resource-Policy`.                                                                                                                                     | Fixed  | `SecurityReviewHeaderTests.Every_response_forbids_framing_and_cross_origin_embedding` |
| 4  | Low      | Client                | A crafted link `#/scores/%` made `decodeURIComponent` throw while routing and blanked the whole application until the address was edited.                                                                                                 | Fixed  | `web/src/route/useRoute.test.ts` |
| 5  | Low      | Secrets hygiene       | `.gitignore` covered `*.pfx` only: a PEM, key or `.p12` file next to the compose secrets could be committed by accident.                                                                                                                  | Fixed  | `SecurityReviewRepositoryTests.Key_material_and_local_configuration_are_git_ignored` |
| 6  | Low      | Supply chain          | NuGet audit relied on the SDK defaults (not written down, so not protected from a change).                                                                                                                                                | Fixed  | `SecurityReviewRepositoryTests.Vulnerable_packages_fail_the_build` |
| 7  | Low      | Release pipeline      | A tag on `main` built and published the image without checking that CI had passed on that commit.                                                                                                                                         | Fixed  | `SecurityReviewRepositoryTests.The_release_refuses_a_commit_whose_ci_has_not_passed` |
| 8  | Low      | Container             | The PostgreSQL service in `docker-compose.yml` kept every Linux capability and could gain privileges.                                                                                                                                     | Fixed  | `SecurityReviewRepositoryTests.Container_base_images_are_pinned_by_digest_and_the_runtime_is_not_root` |
| 9  | Medium   | Storage abuse         | Each account could store 200 scores of 4 MiB and accounts were unbounded: a script with many Google accounts could fill the disk. Fixed: per-user storage quota (100 MiB, `413` `quota-exceeded`, shown in the UI), new-account limits (100 per day on the instance, 10 per day per address; over the limit a new person is sent to a "registrations temporarily closed" notice, existing users are unaffected), and an operator warning log when the database exceeds a threshold (5 GiB by default, start-up and hourly). | Fixed  | `AbuseLimitsTests`, `web/src/library/quota.test.ts` |
| 10 | Low      | Configuration         | The database password could be the `.env.example` placeholder or a short one. Fixed: outside Development the application (and so the `migrate` service) refuses to start with the placeholder or a password under 16 characters. | Fixed  | `ConnectionStringGuardTests` |

Checked and found sound (a test pins each of them, new ones in `SecurityReview*Tests`):

- Antiforgery cannot be skipped by `//api/...`, `/api//...`, `/API/...`, an encoded segment or a path parameter
  (`SecurityReviewPathTests`).
- A request for a host that is not in `AllowedHosts` is refused before any redirect is built from it
  (`SecurityReviewHostTests`).
- Actions are pinned to full SHAs, workflows are read-only at the top level, base images are digest-pinned, the
  runtime is chiseled and non-root, Dependabot watches the four ecosystems (`SecurityReviewRepositoryTests`).
- The score SQL contains only numbers and constants; every value, path and fragment is a parameter.
- The share token is 256 bits, travels in a header, is stored as a SHA-256 hash and is looked up by hash (no
  secret comparison in application code).
- `npm audit` (including dev): 0 vulnerabilities. NuGet (including transitive): 0 vulnerabilities.

## Trusted Types (feasibility)

Not enabled, by design. The application code has no HTML sink (no `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
`document.write`, `eval` or `new Function`; SVG is built with DOM calls and text nodes), and `script-src 'self'`
with no inline code already blocks injected scripts. React 19 itself uses `innerHTML` in a few internal places (script
element creation, `dangerouslySetInnerHTML`), so `require-trusted-types-for 'script'` would need a default policy
for React before it could be enforced. Recommended path if wanted later: ship it first as `Content-Security-Policy-Report-Only`
and add a reporting endpoint. It is a hardening option, not an open vulnerability.

## Operator reminders

Documented in [self-hosting](self-hosting.md): enable forwarded headers behind a reverse proxy (otherwise all clients
share one rate-limit key; the application detects the missing setting and logs a warning once) and keep the key
certificate and its password out of the repository. Watch the logs for `DatabaseSizeExceeded`.
