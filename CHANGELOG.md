# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Editor shell (`#/editor`): top bar (editable title, save status, Share/Export placeholders, theme and language), collapsible instruments panel (`Ctrl+B`) and inspector (`Ctrl+I`, Advanced only), "paper" score area, status bar, shortcut reminder strip, persisted Simple/Advanced mode (`Alt+A`), overlay panels at 768 px, and a shared keyboard shortcut registry (`web/src/shortcuts/`) with macOS mapping. Documented in `docs/editor.md` and `docs/editor.fr.md`.
- Continuous integration: `ci.yml` (jobs `web` and `api`: lint, type check, tests, build, bundle budget, Playwright, dependency audits), CodeQL analysis (JavaScript/TypeScript and C#), Dependabot (npm, NuGet, GitHub Actions, Docker), README badges and a "Continuous integration" section in the development and contributing guides (English and French).
- Front-end skeleton in `web/`: Vite, React, TypeScript (strict), ESLint, Prettier, Vitest, Playwright, light and dark design tokens, self-hosted fonts, French and English i18n, and a bundle size budget check (initial JS at most 150 KB gzip). Development guide in `docs/development.md` and `docs/development.fr.md`.
- Project governance: README (English and French), MIT license, contributing guide, code of conduct, security policy, issue and pull request templates.
- Back-end skeleton (`api/`): ASP.NET Core on .NET 10, EF Core with PostgreSQL, `GET /api/health` and `/api/health/ready`, front-end hosting with SPA fallback and cache headers, Brotli/gzip compression, security baseline (HTTPS redirection, HSTS, CSP and other security headers, ProblemDetails without stack traces), optional forwarded headers, `docker-compose.dev.yml`, tests including Testcontainers PostgreSQL integration tests.
