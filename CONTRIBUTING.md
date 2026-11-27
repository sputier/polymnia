# Contributing to Polymnia

**English** · [Français](CONTRIBUTING.fr.md)

Thank you for your interest in Polymnia. This guide explains how to propose a change.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- Look for an existing [issue](https://github.com/sputier/polymnia/issues). If none exists, open one before writing a large change, so we can agree on the approach.
- Security issues are never reported in public issues: see [SECURITY.md](SECURITY.md).

## Workflow

1. Fork the repository and create a branch from `main`: `feat/<issue-number>-short-name` or `fix/<issue-number>-short-name`.
2. Keep each pull request focused on one issue.
3. Add or update automated tests. A change without tests is not finished.
4. Update the documentation (README, `docs/`) in the same pull request when behavior changes, in **both English and French**.
5. Run the checks locally (see [Checks](#checks)).
6. Open a pull request against `main` and fill in the template.

## Project priorities: security and performance first

Security and performance come before new features. A change that weakens security (secrets, injection, permissive CORS or CSP, unvalidated input) or that blows the performance budget (initial JavaScript above 150 KB gzip, heavy libraries not lazy-loaded) is not merged until fixed.

## Checks

Front end, from `web/` (details in [docs/development.md](docs/development.md)):

```
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run size
npm run test:e2e
```

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(editor): add dotted note entry
fix(playback): stop cursor at the last measure
docs: explain MusicXML export
```

Reference the issue in the body or footer: `Closes #12`.

## Code style

- Formatting rules live in [`.editorconfig`](.editorconfig).
- TypeScript: strict mode, no `any` without a comment explaining why.
- C#: nullable reference types enabled, warnings treated as errors.

## Licensing

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE). Do not copy code from projects under incompatible licenses (for example GPL-licensed notation software).
