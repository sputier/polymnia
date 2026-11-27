# Development guide

**English** · [Français](development.fr.md)

## Front end

The front end lives in [`web/`](../web): Vite, React and TypeScript (`strict`).

### Prerequisites

- Node.js 24 LTS (see `web/.nvmrc`; Node 22 or newer works).
- npm (shipped with Node).

### Commands

Run them from `web/`.

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `npm ci`               | Install the exact locked dependencies                     |
| `npm run dev`          | Start the dev server                                      |
| `npm run lint`         | ESLint and Prettier check                                 |
| `npm run format`       | Format the code with Prettier                             |
| `npm run typecheck`    | TypeScript type check                                     |
| `npm test`             | Unit tests (Vitest and Testing Library)                   |
| `npm run build`        | Type check and production build into `dist/`              |
| `npm run size`         | Check the bundle budget (run after `build`)               |
| `npm run test:e2e`     | Playwright smoke tests (Chromium, builds and serves the app) |

First run of the end-to-end tests: `npx playwright install chromium`.

### Performance budget

Initial JavaScript for the first screen must stay at or below **150 KB gzip**. `npm run size` reads `dist/index.html`, sums the gzipped scripts it loads on first paint, and exits with an error above the budget. Heavy libraries (VexFlow, Tone.js, samples) must be lazy-loaded with dynamic `import()` so they never count towards the first screen.

### Design tokens and themes

Colors are CSS custom properties defined in `web/src/styles/tokens.css` (`--bg`, `--panel`, `--ink`, `--accent`, ...). Never hard-code a color in a component: use a token. The theme follows `prefers-color-scheme` until the user picks one with the theme switch; the choice is stored in `localStorage` (failures are ignored). `web/public/theme-init.js` sets `data-theme` on `<html>` before first paint to avoid a flash of the wrong theme. It is a same-origin file, so a strict Content Security Policy needs no `unsafe-inline` for scripts.

### Fonts

Inter (UI) and IBM Plex Mono (shortcuts, status bar) are self-hosted through `@fontsource`, Latin subset only, with `font-display: swap`. Only the weights in use are imported in `web/src/main.tsx` (Inter 400 and 600, Plex Mono 400): import a new weight only when a component needs it. No third-party font service is used.

### Internationalization

French and English, in `web/src/i18n/` (`en.ts` is the source of truth, `fr.ts` must define the same keys, checked by the compiler and by a test). The language is detected from the stored choice, then `navigator.languages`, then English, and can be switched at runtime. Never hard-code a UI string: add a key to both catalogs and use `t('key')` from `useI18n()`. The layer is a small typed module with no runtime dependency, to keep the bundle small.
