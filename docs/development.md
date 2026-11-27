# Development guide

**English** · [Français](development.fr.md)

## Front end

The front end lives in [`web/`](../web): Vite, React and TypeScript (`strict`).

### Prerequisites

- Node.js 24 LTS (see `web/.nvmrc`; Node 22 or newer works).
- npm (shipped with Node).

### Commands

Run them from `web/`.

| Command                                       | What it does                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm ci`                                      | Install the exact locked dependencies                                                             |
| `npm run dev`                                 | Start the dev server                                                                              |
| `npm run lint`                                | ESLint and Prettier check                                                                         |
| `npm run format`                              | Format the code with Prettier                                                                     |
| `npm run typecheck`                           | TypeScript type check                                                                             |
| `npm test`                                    | Unit tests (Vitest and Testing Library)                                                           |
| `npm run build`                               | Type check and production build into `dist/`                                                      |
| `npm run size`                                | Check the bundle budget (run after `build`)                                                       |
| `npm run build:report`, `npm run size:report` | Build with the bundle visualizer, then list the biggest modules of the initial chunks             |
| `npm run bench`                               | Score model benchmarks (Vitest bench, fails over budget)                                          |
| `npm run test:e2e`, `npm run test:perf`       | Functional Playwright tests (Chromium, builds and serves the app, parallel)                       |
| `npm run test:perf`                           | Performance Playwright tests (`@perf`): one worker, no retry                                      |
| `npm run test:visual:update`                  | Regenerate the visual baselines in the Playwright Docker image (see [engraving.md](engraving.md)) |
| `npm run test:visual:docker`                  | Check the visual baselines in that same image                                                     |

First run of the end-to-end tests: `npx playwright install chromium`.

### Performance budget

Initial JavaScript, what `index.html` loads before any screen, must stay at or below **110 KB gzip** (it is about 75 KB: React, the session check, the sign-in screen and the active language). `npm run size` reads `dist/index.html`, sums the gzipped scripts it loads on first paint, and exits with an error above the budget; it also prints, for information, what each screen downloads (initial plus its own chunks). Heavy libraries (VexFlow, Tone.js, samples) must be lazy-loaded with dynamic `import()` so they never count towards the first screen.

How the bundle is split (#50):

- **One chunk per screen**, in `web/src/route/chunks.ts`: library, stored score, scratch editor, shared viewer and privacy page. The library never loads editor code and the editor never loads library code; the library dialogs that need the score model or import/export (new score, share) and the command palette are chunks of their own, fetched in idle time after the first paint. Add a screen or a heavy dialog there, with `preloadable()` (a `React.lazy` that renders without suspending once its chunk was preloaded: React otherwise keeps a Suspense fallback on screen for at least 300 ms).
- **No waterfall**: the build writes `dist/route-preload.js` (`web/vite-plugins/routePreload.ts`), loaded first by `index.html`, which adds `modulepreload` links for the chunks of the screen in the address bar and of the active language, so they download while `index.js` runs. `main.tsx` also starts the screen chunk and the catalog before the session check answers. From the library, opening a score is instant: the editor chunks and the engraver are prefetched when the browser is idle.
- **Languages**: `en.ts` and `fr.ts` are two lazy chunks. Only the active language is downloaded before the first render (`loadCatalog`); the other one when the user switches (and as soon as the pointer or focus reaches its button), or when the command palette opens (it searches the labels in every language).
- **Shortcuts** are registered by the screen that owns them (`useShortcuts`), so a lazy screen registers its commands when it mounts; the palette lists the registry of the current screen. The "no duplicate key combo" tests are unchanged.
- `vite.config.ts` pins two groups, `react` and `shell` (session, sign-in, API client, route, language switch), so the first load is a handful of files instead of one per shared module.

Reading the bundle report: `npm run build:report` builds with the visualizer (`rollup-plugin-visualizer`, dev dependency, `dist/stats.json`), then `npm run size:report` lists the biggest modules of the initial chunks (`npm run size:report -- Library --top=15` for another chunk, matched by file name). The per-module gzip sizes are estimates (each module is compressed alone, so the sum is larger than the real chunk): use them to rank modules, then confirm with `npm run size`. A module that shows up in the initial chunks and belongs to one screen is imported statically from the shell: make that import dynamic.

### Performance tests

Every timing assertion lives in a test tagged `@perf` (`{ tag: '@perf' }`) and uses `web/e2e/perf-stats.ts`. Playwright has two projects: `chromium` (functional, parallel, `@perf` excluded, one retry on CI) and `perf` (only `@perf`, depends on `chromium`, no retry). `npm run test:perf` runs the `perf` project alone with `--workers=1`; in CI it runs after `npm run test:e2e` in the `web` job, so nothing else uses the machine while it measures. A retry would hide a regression, so there is none: a perf test must be stable instead.

Each measurement discards warm-up iterations, takes 5 to 400 samples, prints a line such as `PERF engraving one edit: 60 samples, median 5.1 ms (budget 16), p95 8.0 ms (budget 32), max 9.3 ms` (also an annotation of the test), and asserts:

- the **median** against the strict budget, the same everywhere;
- the **p95** against twice the budget (`P95_FACTOR`, on every machine: a laptop also runs an IDE and a browser, and shared CI runners are about twice as slow as the reference laptop, see [engraving.md](engraving.md)).

The keystroke median budget is the one exception to "same everywhere": 16 ms locally, 24 ms on CI (medians of 9 to 15 ms measured over 20 CI runners). A one-sample measurement (cold start) gets the CI factor (`CI_FACTOR`: 2 when `CI` is set) on its own budget. Reading a failure: a median over budget is a real regression; a p95 over budget alone points to a noisy tail, so rerun `npm run test:perf` locally before touching a budget. Nothing else should run during a measurement: use `PLAYWRIGHT_PORT` if another preview server holds port 4173.

### Design tokens and themes

Colors are CSS custom properties defined in `web/src/styles/tokens.css` (`--bg`, `--panel`, `--ink`, `--accent`, ...). Never hard-code a color in a component: use a token. The theme follows `prefers-color-scheme` until the user picks one with the theme switch; the choice is stored in `localStorage` (failures are ignored). `web/public/theme-init.js` sets `data-theme` on `<html>` before first paint to avoid a flash of the wrong theme. It is a same-origin file, so a strict Content Security Policy needs no `unsafe-inline` for scripts.

### Fonts

Inter (UI) and IBM Plex Mono (shortcuts, status bar) are self-hosted through `@fontsource`, Latin subset only, with `font-display: swap`. Only the weights in use are imported in `web/src/main.tsx` (Inter 400 and 600, Plex Mono 400): import a new weight only when a component needs it. No third-party font service is used.

### Internationalization

French and English, in `web/src/i18n/` (`en.ts` is the source of truth, `fr.ts` must define the same keys, checked by the compiler and by a test). The language is detected from the stored choice, then `navigator.languages`, then English, and can be switched at runtime. Never hard-code a UI string: add a key to both catalogs and use `t('key')` from `useI18n()`. The layer is a small typed module with no runtime dependency, to keep the bundle small. Each language is a lazy chunk: only the active one is loaded before the first render (see "Performance budget"); in tests the catalogs are loaded up front by `test-setup.ts`.

## Back end

The back end lives in `api/` (.NET 10, ASP.NET Core, EF Core, PostgreSQL). It serves the API under `/api` and the built front end from `wwwroot`, on a single origin (no CORS needed).

| Project                   | Role                                               |
| ------------------------- | -------------------------------------------------- |
| `Polymnia.Api`            | Hosting, endpoints, security headers, static files |
| `Polymnia.Core`           | Domain, no dependencies                            |
| `Polymnia.Infrastructure` | EF Core + Npgsql (`PolymniaDbContext`, migrations) |
| `Polymnia.Tests`          | xUnit v3 tests                                     |

### Prerequisites

- .NET 10 SDK (see `global.json`)
- Docker, only to run PostgreSQL locally and the PostgreSQL integration tests

### Run the back end

1. Start PostgreSQL: copy `.env.example` to `.env`, set `POSTGRES_PASSWORD`, then `docker compose -f docker-compose.dev.yml up -d`. The database listens on `127.0.0.1` only.
2. Give the API its connection string (never commit it):
   `dotnet user-secrets set "ConnectionStrings:Polymnia" "Host=localhost;Port=5432;Database=polymnia;Username=polymnia;Password=<POSTGRES_PASSWORD>" --project api/Polymnia.Api`
   In a deployment, use the environment variable `ConnectionStrings__Polymnia`.
3. Apply the migrations: `dotnet tool restore`, then `ConnectionStrings__Polymnia=<same value> dotnet ef database update --project api/Polymnia.Infrastructure --startup-project api/Polymnia.Infrastructure`.
4. Run: `dotnet run --project api/Polymnia.Api` (listens on `http://localhost:5080`).

Add a migration after changing the model: `dotnet ef migrations add <Name> --project api/Polymnia.Infrastructure --startup-project api/Polymnia.Infrastructure --output-dir Migrations`.

### Serve the front end from the API

Build the front end, then copy its output (`index.html`, `assets/`, ...) into `api/Polymnia.Api/wwwroot/` (contents are git-ignored). The API then serves it on the same origin. Conventions the server relies on:

- Files under `/assets/` have content-hashed names (Vite default) and get `Cache-Control: public, max-age=31536000, immutable`.
- `index.html` and every other file get `Cache-Control: no-cache`.
- A `GET`/`HEAD` that matches nothing and has no file extension returns `index.html` (client-side routes). Unknown `/api/*` routes return a 404 ProblemDetails, never the SPA. Missing files (`/assets/x.js`) are 404.

For front-end development with hot reload, run `npm run dev` in `web/`: the Vite dev server (`http://localhost:5173`) proxies `/api` to `http://localhost:5080`, so the browser sees one origin, as in production. Google sign-in needs a Google OAuth client: see [Authentication](authentication.md) ("Local setup"). Without one the API still starts in Development, with sign-in disabled (`503` on `/api/auth/login`).

### Endpoints

- `GET /api/health`: liveness, `200 Healthy`, no dependency check.
- `GET /api/health/ready`: readiness, checks the database. Body is only `Healthy` or `Unhealthy` (`503`); details stay in the server logs. The result is cached for 5 seconds so the public endpoint cannot exhaust the connection pool. Both health endpoints are exempt from HTTPS redirection (orchestrator probes use plain HTTP).
- `GET /api/me` (`401` when anonymous), `GET /api/auth/login`, `GET /api/auth/antiforgery`, `POST /api/auth/logout`: see [Authentication](authentication.md). Every unsafe method under `/api` needs the `X-XSRF-TOKEN` header.
- Score API (`/api/scores`): see [api.md](api.md).
- Client-side route segments must not contain a dot (a path with an extension is treated as a missing file and returns 404). Responses under `/api` are `Cache-Control: no-store` unless an endpoint overrides it.
- In production, use `SSL Mode=VerifyFull` in the connection string when the database is not on the same host.

### Security baseline

- HTTPS redirection and HSTS (1 year, no subdomains, no preload) outside Development.
- Headers on every response, errors included: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, geolocation, microphone... denied; `midi=(self)` allowed for Web MIDI), `Cross-Origin-Opener-Policy: same-origin`. The `Server` header is removed.
- Errors are ProblemDetails; stack traces only in Development.
- Request bodies are limited to 1 MiB by default; an endpoint that needs more must opt in explicitly.
- Set `AllowedHosts` to your real host name in production (the default is `*`).

#### Content Security Policy

The default is `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`. If a feature needs a relaxation (for example `style-src 'unsafe-inline'` for a library that writes inline styles, or `worker-src blob:`), override `Security:ContentSecurityPolicy` in configuration, keep it as narrow as possible, and document the reason here.

### Behind a reverse proxy

Forwarded headers are **off** by default. When a proxy terminates TLS, enable them and list the proxies you trust, otherwise clients could spoof their address and scheme:

```json
"ForwardedHeaders": { "Enabled": true, "KnownProxies": ["10.0.0.5"], "KnownNetworks": ["172.18.0.0/16"], "ForwardLimit": 1 }
```

(or `ForwardedHeaders__Enabled=true` etc. as environment variables). Only `X-Forwarded-For` and `X-Forwarded-Proto` are honored. With no list, only loopback proxies are trusted.

### Performance

Responses are compressed with Brotli or gzip (fastest level). Compression is also enabled over HTTPS, under a BREACH mitigation rule: **a response that contains a secret or a token (antiforgery token, share token, anything user-secret) must never be compressed.** Mark such an endpoint with `.DisableResponseCompression()` (minimal API) or `[DisableResponseCompression]` (controller or action); the compression provider then skips it (covered by `CompressionPolicyTests`). Antiforgery uses the cookie + header pattern, never tokens in response bodies. Handlers use asynchronous I/O only; read queries use `AsNoTracking()`.

### Checks

```
dotnet build api/Polymnia.slnx -warnaserror
dotnet test --solution api/Polymnia.slnx
```

The PostgreSQL integration tests use Testcontainers and need Docker. Without Docker they are skipped with an explicit reason, except when the `CI` environment variable is `true`, where a missing Docker fails the run.

## Continuous integration

Every pull request and every push to `main` runs [`ci.yml`](../.github/workflows/ci.yml) (jobs `web` and `api`), and [`codeql.yml`](../.github/workflows/codeql.yml) (static analysis, also weekly). Dependabot proposes weekly, grouped updates for npm, NuGet, GitHub Actions and Docker.

| Job      | What it runs                                                                                                                           | Same thing locally                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web`    | lint, type check, unit tests, build, bundle budget, `npm audit` (runtime dependencies), Playwright (functional, then performance)      | from `web/`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run size`, `npm audit --audit-level=high --omit=dev`, `npm run test:e2e`                                                         |
| `api`    | restore, build with warnings as errors, tests, NuGet vulnerability audit                                                               | from the repository root: `dotnet build api/Polymnia.slnx -warnaserror`, `dotnet test --solution api/Polymnia.slnx` (integration tests need Docker), `dotnet list api/Polymnia.slnx package --vulnerable --include-transitive` |
| `docker` | builds the production image (amd64), starts `docker-compose.yml` on it and probes the app, Trivy scan (fails on fixable CRITICAL/HIGH) | the "Test procedure" of [`self-hosting.md`](self-hosting.md)                                                                                                                                                                   |

The `api` job installs the SDK from `global.json` and runs with `CI=true`, so the PostgreSQL integration tests must run (a missing Docker fails the job instead of skipping). Workflows use pinned action versions (full commit SHA), read-only permissions, and upload no artifact unless the end-to-end tests fail.
