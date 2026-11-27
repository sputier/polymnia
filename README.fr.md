# Polymnia

[English](README.md) · **Français**

[![CI](https://github.com/sputier/polymnia/actions/workflows/ci.yml/badge.svg)](https://github.com/sputier/polymnia/actions/workflows/ci.yml) [![CodeQL](https://github.com/sputier/polymnia/actions/workflows/codeql.yml/badge.svg)](https://github.com/sputier/polymnia/actions/workflows/codeql.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> J'écris, j'écoute, je partage. Directement dans le navigateur.

Polymnia est une application web libre et gratuite pour composer de la musique en notation classique et écouter ce qu'on écrit. Son nom vient de Polymnie (Πολύμνια), muse grecque du chant et des hymnes.

> **État : début du développement.** Rien n'est encore utilisable. Suivez les [issues](https://github.com/sputier/polymnia/issues) pour voir ce qui se construit.

## Objectifs

- **Simple d'abord, puissant ensuite.** Un musicien qui lit la musique doit écrire sa première mélodie en moins de deux minutes. Les outils avancés restent disponibles, sans gêner.
- **Clavier d'abord, souris bienvenue.** Saisie rapide au clavier inspirée des logiciels de gravure, avec la souris et un piano à l'écran.
- **Tout s'entend.** Chaque note saisie est jouée. La lecture suit la partition avec un curseur.
- **Votre musique vous appartient.** Import et export MusicXML, export MIDI, PDF et PNG.

## Fonctionnalités prévues (V1)

- Partitions à plusieurs portées, clés de sol et de fa, armures et chiffrages.
- Durées de la ronde à la double croche, points, silences, altérations, accords, liaisons et triolets.
- Saisie au clavier d'ordinateur, à la souris, au piano à l'écran ou avec un clavier MIDI.
- Lecture avec sons d'instruments, tempo, métronome, boucle, mute et solo.
- Connexion Google, bibliothèque personnelle avec sauvegarde automatique, liens de partage en lecture seule.
- Interface en français et en anglais.

## Technologies

| Partie | Technologie |
| --- | --- |
| Front | React, TypeScript, Vite |
| Gravure | [VexFlow](https://github.com/0xfe/vexflow) |
| Audio | [Tone.js](https://github.com/Tonejs/Tone.js) avec instruments échantillonnés |
| Back | ASP.NET Core (.NET 10), EF Core |
| Base de données | PostgreSQL |
| Déploiement | Docker / Docker Compose (auto-hébergeable) |

## Contribuer

Les contributions sont bienvenues. Lisez d'abord [CONTRIBUTING.fr.md](CONTRIBUTING.fr.md) et le [code de conduite](CODE_OF_CONDUCT.md). Pour signaler une faille de sécurité, suivez [SECURITY.md](SECURITY.md) ; n'ouvrez pas d'issue publique.

## Licence

[MIT](LICENSE) © Les contributeurs de Polymnia.

Polymnia s'inspire des idées de logiciels de notation existants mais ne contient aucun code issu de projets sous licence GPL.
