# Lecture

[English](playback.md) · **Français**

Entendre la partition pendant qu'un curseur la suit. Code dans [`web/src/playback/`](../web/src/playback), interface de transport dans `web/src/editor/TransportBar.tsx` et `Mixer.tsx`.

## Utilisation

| Action                      | Comment                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lecture / pause             | `Espace` ou le bouton Lecture (comportement de MuseScore). Un bouton ou un champ texte qui a le focus garde `Espace` pour lui                                      |
| Retour au début             | `Origine` (`Home`) ou le premier bouton du transport                                                                                                               |
| Arrêt (et retour au début)  | Bouton Arrêt                                                                                                                                                       |
| Jouer à partir d'une note   | La sélectionner (la tête de lecture s'y place), puis lancer la lecture                                                                                             |
| Boucle                      | Bouton Boucle : boucle sur les notes sélectionnées, ou sur toute la partition sans sélection                                                                       |
| Tempo                       | Curseur de 25 % à 200 % du tempo écrit ; `♩ = n` donne le tempo effectif                                                                                           |
| Métronome                   | Bouton Métronome : un clic à chaque temps, accentué sur le premier temps de la mesure (temps pointé en 6/8, 9/8, 12/8 ; la levée compte comme la fin d'une mesure) |
| Couper / isoler une portée  | Console dans l'inspecteur (mode Avancé). Un solo coupe toutes les autres portées et l'emporte sur « couper »                                                       |
| Entendre chaque note saisie | Automatique : la saisie appelle `previewNote`                                                                                                                      |

Le son démarre après un geste de l'utilisateur (politiques de lecture automatique des navigateurs) : le moteur est téléchargé au premier clic ou à la première touche dans l'éditeur, et le contexte audio démarre quand on lance la lecture.

## Architecture

```
partition ──buildTimeline──▶ Timeline (notes, spans, tempo, temps)    timeline.ts   pur
                                  │
        PlaybackController ◀──────┘  transport, planificateur à      controller.ts TS simple
              │                      anticipation, tête, boucle, mute/solo
              ├── onFrame ──▶ followPlayback ──▶ Engraver             follow.ts     pas de React par image
              └── AudioBackend (chargé à la demande)                  backend.ts
                     ├── ToneBackend  échantillonneurs Tone.js, 1 par portée   toneBackend.ts (chunk à part)
                     └── MockBackend  silencieux, pour les tests navigateur    mockBackend.ts
```

- **Partition vers événements** (`timeline.ts`, pur et testé). Les ticks restent l'unité (960 par noire). Une note porte son numéro MIDI _sonnant_ : hauteur écrite plus la transposition de la partie (`soundingMidi`). Un capodastre est déjà inclus dans la hauteur écrite (le validateur vérifie `corde + capo + case = écrit + transposition`) : il n'est **pas** ajouté une seconde fois. Les notes liées (sur un temps, une barre de mesure, accords hauteur par hauteur) deviennent **une seule** note sonnante ; chaque événement lié garde sa propre durée pour sa surbrillance. Les nolets utilisent leurs durées réduites, les mesures de levée leur `length` réel, toutes les voix de toutes les portées sont jouées. La table des tempos suit les changements de `tempoBpm`.
- **Calculs de temps** (`clock.ts`, pur). Table de tempo ticks ⇄ secondes, bouclage (`scoreSecondsAt`, `legsBetween`), mute/solo (`audibleStaves`).
- **Planification** (`controller.ts`). Un minuteur de 100 ms programme toutes les notes qui commencent dans les **1,2 s** suivantes de l'horloge audio (`LOOKAHEAD_SECONDS`) avec des instants audio absolus, et le contexte Tone utilise `latencyHint: 'playback'` avec 0,2 s d'anticipation : si le fil de l'interface est occupé (un re-gravage, une tâche longue), les notes ne saccadent pas, le son est déjà dans le graphe audio. Changer le tempo, la boucle ou se déplacer relance la planification depuis la tête de lecture.
- **Curseur et surbrillance** (`follow.ts`). `requestAnimationFrame` lit l'horloge audio (moins la latence de sortie), trouve les notes sous la tête de lecture et, seulement quand elles changent, appelle `engraver.setPlaying(ids)` (classe CSS `pm-playing`, couleur `--play`) et `engraver.setPlayCursor(ids)` (un seul `<rect class="pm-cursor">` déplacé). Aucun état React ne change par image, aucun re-gravage. La page défile (`.score-area`) seulement quand le curseur sort de la zone visible, en respectant `prefers-reduced-motion`.
- **Modifier la partition arrête la lecture** ; la tête garde son tick. La timeline est reconstruite à la demande, pas à chaque frappe.
- **Aperçu** (`previewNote(partId, pitch)`, exporté par `web/src/playback/index.ts`). Joue une note de 0,7 s sur l'instrument de la partie, hauteur écrite en entrée, transposition appliquée. L'éditeur la branche sur `EditorStore.onNoteEntered`.

## Instruments et échantillons

L'instrument d'une partie vient de `Part.instrument` : le changer dans le panneau des instruments (#15) change donc le son immédiatement. Une tablature qui répète une portée standard de la même partie (« portée + tablature ») est ignorée par la timeline et la table de mixage : la partie n'est entendue qu'une fois.

Les échantillons sont de courts extraits Ogg Opus, quelques hauteurs par instrument ; le `Sampler` de Tone transpose le plus proche. Seuls les jeux utilisés par les portées de la partition sont téléchargés, et seulement quand on joue ou qu'on saisit une note.

| Instrument                  | Jeu                             | Téléchargement | Source (tout en CC0 1.0)                                               |
| --------------------------- | ------------------------------- | -------------- | ---------------------------------------------------------------------- |
| Guitare classique           | `guitar-nylon`                  | 172 Ko         | FreePats, guitare classique espagnole                                  |
| Guitare folk                | `guitar-nylon` (**remplaçant**) | idem           | aucun enregistrement permissif trouvé, voir plus bas                   |
| Ukulélé (toutes tailles)    | `ukulele`                       | 85 Ko          | FreePats, ukulélé ténor                                                |
| Violoncelle                 | `cello`                         | 208 Ko         | VSCO 2 CE, _Cello Section_ (pas de violoncelle solo dans les jeux CC0) |
| Piano, instruments inconnus | `piano`                         | 180 Ko         | FreePats, Upright Piano KW                                             |
| Voix                        | `flute` (**remplaçant**)        | idem           | aucun enregistrement permissif trouvé, voir plus bas                   |
| Flûte                       | `flute`                         | 182 Ko         | VSCO 2 CE                                                              |
| Violon                      | `violin`                        | 208 Ko         | VSCO 2 CE, violon solo                                                 |
| Clarinette                  | `clarinet`                      | 164 Ko         | FreePats                                                               |
| Contrebasse                 | `double-bass`                   | 145 Ko         | VSCO 2 CE, contrebasse solo                                            |

Auteurs, URL et textes de licence sont dans [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). L'ensemble pèse 1,34 Mo dans le dépôt.

- **Remplaçants.** La seule guitare folk trouvée dans la collection FreePats est en GPL-3.0 avec exception, ce qui ne convient pas à une application MIT : elle joue donc la guitare nylon. Aucun jeu de voix soliste ou de chœur « aah » sous licence permissive n'a été trouvé : la voix joue donc la flûte. Les ukulélés baryton et sol grave descendent sous l'étendue enregistrée (do4), l'échantillonneur transpose vers le bas. Les instruments inconnus jouent le piano. La console indique quand un remplaçant est utilisé.
- **La licence est une barrière stricte.** Ne jamais ajouter un échantillon qui n'est pas CC0, CC-BY, MIT, de type OFL ou équivalent, avec la licence vérifiée à la source et notée dans `THIRD_PARTY_NOTICES.md`. Les soundfonts General MIDI (FluidR3, MuseScore General, les builds « midi-js-soundfonts ») n'ont pas été utilisées : leurs conditions dépendent des enregistrements d'origine et le risque n'en valait pas la peine alors que des jeux CC0 couvrent les instruments prioritaires.
- **Format.** Ogg Opus, mono, 40 kbit/s, 3,5 à 5 s par hauteur avec un fondu de sortie. Chromium et Firefox décodent l'Ogg Opus. Le support de Safari est récent et **n'a pas été testé sur un appareil** ; là où il ne peut pas le décoder, la lecture affiche « Le son n'a pas pu démarrer ». Il n'y a pas encore de repli MP3/AAC (il faudrait un encodeur dans l'outil d'échantillons).
- **Même origine, immuable.** `import.meta.glob('./samples/*/*.ogg', { query: '?url' })` fait émettre à Vite chaque fichier en `/assets/<Note>-<hash>.ogg` (jamais en ligne, voir `assetsInlineLimit` dans `vite.config.ts`), que l'API sert avec `Cache-Control: immutable`. La Content-Security-Policy (`default-src 'self'`, `connect-src 'self'`) l'autorise. Rien n'est chargé depuis un CDN. Tone.js lance un Web Worker blob pour son horloge au chargement, ce que `script-src 'self'` interdit : `index.ts` masque `Worker` le temps que le module de Tone s'évalue pour qu'il utilise un minuteur, et le contexte Tone est créé avec `clockSource: 'timeout'` (le planificateur n'utilise pas l'horloge de Tone). Un test navigateur exécute le vrai moteur sous la politique de l'API et échoue à la moindre violation autre que les styles.

### Ajouter un instrument

1. Trouver un enregistrement dont la licence est vérifiable à la source (CC0, CC-BY, MIT, de type OFL). Noter l'URL, l'auteur et la licence dans `THIRD_PARTY_NOTICES.md`.
2. Télécharger les originaux (WAV ou FLAC, un fichier par hauteur, une hauteur tous les 3 à 5 demi-tons) dans un dossier temporaire.
3. Ajouter une entrée à `web/scripts/samples/sets.mjs` (identifiant du jeu, quel fichier est quelle note, `seconds`, `fadeOut`, `octaveShift` si la source numérote les octaves autrement, comme VSCO).
4. Depuis `web/` : `SAMPLES_SRC=<dossier> node scripts/samples/build-samples.mjs <id du jeu>`. L'outil décode, coupe, normalise et encode avec le Chromium de Playwright (WebCodecs), écrit `src/playback/samples/<jeu>/<Note>.ogg` (`s` pour un dièse) et affiche la hauteur mesurée de chaque fichier face à son étiquette. Une ligne `CHECK PITCH` signale le plus souvent un harmonique pris pour le fondamental, mais un écart d'environ 1200 cents sur tous les fichiers signale une mauvaise étiquette d'octave.
5. Ajouter l'identifiant du jeu à `instrumentSets.ts` (`SampleSetId`, `SAMPLE_SET_IDS`) et y rattacher les identifiants du catalogue ; ajouter son temps de relâchement dans `toneBackend.ts` ; ajouter l'instrument à `web/src/score/instruments.ts` s'il n'est pas dans le catalogue.
6. `npm test` (`samples.test.ts` vérifie que chaque jeu couvre son étendue sans grand trou), mettre à jour le tableau ci-dessus et `THIRD_PARTY_NOTICES.md`.

## Performance

Mesuré dans Chromium (portable Windows 11, build de production, serveur local, sans limitation réseau ; le chiffre est dominé par le décodage et la planification, le téléchargement représente environ 60 Ko gzip de Tone plus le jeu).

| Quoi                                                              | Budget                            | Mesuré                                                  |
| ----------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| Délai avant la première note, à froid (moteur + piano + décodage) | < 3 s                             | 120 à 330 ms (local)                                    |
| Délai avant la première note, en cache                            | < 1 s                             | 55 à 100 ms                                             |
| Chunk de lecture (Tone.js + moteur)                               | ≤ 80 Ko gzip, chargé à la demande | 57,7 Ko gzip, hors du bundle initial                    |
| Jeux d'échantillons                                               | ≤ 3 Mo au total                   | 1,34 Mo au total, 85 à 208 Ko par instrument            |
| JS initial                                                        | ≤ 150 Ko gzip                     | 94,7 Ko (le contrôleur n'en représente que quelques Ko) |
| Frappe en saisie (100 mesures)                                    | < 16 ms                           | environ 9 ms (l'aperçu ne reconstruit pas la timeline)  |

Sur un vrai réseau, la première note ajoute le téléchargement du chunk Tone et de l'instrument (environ 250 à 270 Ko), une seconde environ à 2 Mbit/s, rien une fois en cache (fichiers hachés, `immutable`).

## Tests

- Unitaires : `timeline.test.ts` (tempo et changements de tempo, points, liaisons y compris sur une barre de mesure et par hauteur d'accord, triolets, silences, accords, voix, plusieurs parties et portées, transposition, capodastre, levée, temps), `clock.test.ts` (bouclage, mute/solo), `controller.test.ts` (instants programmés, anticipation, pause/reprise, arrêt, déplacement, jouer depuis la sélection, tempo, boucle, métronome, mute/solo, images, modifications de la partition, aperçu, échec audio), `samples.test.ts`.
- Navigateur, audio simulé (`e2e/playback.spec.ts`, `window.__polymniaAudio = 'mock'` ; le moteur enregistre ses appels dans `window.__polymniaAudioLog`) : lecture/arrêt, curseur et surbrillance, `Espace`/`Origine`, `Espace` ignoré dans un champ texte, jouer depuis la sélection et boucle, aperçu à la saisie, tempo et métronome, mute/solo, défilement de la page.
- Navigateur, vrai moteur (`e2e/playback-audio.spec.ts`) : décodage des vrais échantillons, délai avant la première note à froid et en cache, fichiers hachés de même origine, aucune violation de politique.
- `npm run size` budgète le chunk de lecture et les fichiers d'échantillons.
