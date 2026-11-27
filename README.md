# Polymnia

**English** · [Français](README.fr.md)

[![CI](https://github.com/sputier/polymnia/actions/workflows/ci.yml/badge.svg)](https://github.com/sputier/polymnia/actions/workflows/ci.yml) [![CodeQL](https://github.com/sputier/polymnia/actions/workflows/codeql.yml/badge.svg)](https://github.com/sputier/polymnia/actions/workflows/codeql.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> Write music. Hear it. Share it. Right in your browser.

Polymnia is a free and open-source web application for composing music in standard notation and listening to what you write. It is named after Polyhymnia (Πολύμνια), the Greek muse of song and hymns.

> **Status: early development.** Nothing is usable yet. Follow the [issues](https://github.com/sputier/polymnia/issues) to see what is being built.

## Goals

- **Simple first, powerful later.** A musician who reads music should write a first melody within two minutes. Advanced tools stay available, but out of the way.
- **Keyboard first, mouse friendly.** Fast keyboard note entry inspired by desktop notation software, with full mouse and on-screen piano support.
- **Hear everything.** Every note you enter is played. Playback follows the score with a cursor.
- **Your music stays yours.** MusicXML import and export, plus MIDI, PDF and PNG export.

## Planned features (V1)

- Multi-staff scores with treble and bass clefs, key and time signatures.
- Durations from whole to sixteenth notes, dots, rests, accidentals, chords, ties, slurs and triplets.
- Note entry with the computer keyboard, the mouse, an on-screen piano or a MIDI keyboard.
- Playback with instrument sounds, tempo control, metronome, loop, mute and solo.
- Google sign-in, a personal score library with autosave, and read-only share links.
- Interface in English and French.

## Tech stack

| Part | Technology |
| --- | --- |
| Front end | React, TypeScript, Vite |
| Engraving | [VexFlow](https://github.com/0xfe/vexflow) |
| Audio | [Tone.js](https://github.com/Tonejs/Tone.js) with sampled instruments |
| Back end | ASP.NET Core (.NET 10), EF Core |
| Database | PostgreSQL |
| Deployment | Docker / Docker Compose (self-hostable) |

## Self-hosting

Run your own instance with Docker Compose (the app and PostgreSQL) from the image `ghcr.io/sputier/polymnia`. See the [self-hosting guide](docs/self-hosting.md). Operators must set the privacy settings: see [Privacy](docs/privacy.md). Maintainers: [how to cut a release](docs/releasing.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first. To report a security issue, follow [SECURITY.md](SECURITY.md); do not open a public issue.

## License

[MIT](LICENSE) © The Polymnia contributors.

Polymnia takes inspiration from the ideas of existing notation software but contains no code from GPL-licensed projects.
