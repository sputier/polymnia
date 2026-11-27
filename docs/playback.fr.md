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

Une partie en tablature seule est jouée depuis sa tablature, la hauteur écrite étant déduite de corde + case + capodastre + transposition à la saisie de la case (le capodastre n est donc jamais ajouté deux fois) ; des tests couvrent un capodastre, une partie en tablature seule et une partie « portée + tablature » saisie sur la tablature.

Les échantillons sont de courts extraits Ogg Opus, quelques hauteurs par instrument ; le `Sampler` de Tone transpose le plus proche. Seuls les jeux utilisés par les portées de la partition sont téléchargés, et seulement quand on joue ou qu'on saisit une note.

| Instrument                  | Jeu            | Téléchargement (Ogg Opus / AAC) | Source (CC0 1.0 sauf mention)                                                 |
| --------------------------- | -------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| Guitare classique           | `guitar-nylon` | 172 / 214 Ko                    | FreePats, guitare classique espagnole                                         |
| Guitare folk                | `guitar-steel` | 244 / 301 Ko                    | Meta Open Sound, _Meta Steel Guitar_ (couche médium)                          |
| Ukulélé (toutes tailles)    | `ukulele`      | 85 / 107 Ko                     | FreePats, ukulélé ténor                                                       |
| Violoncelle                 | `cello`        | 206 / 254 Ko                    | Karoryfer x bigcat cello, soliste, tenu mf                                    |
| Piano, instruments inconnus | `piano`        | 180 / 223 Ko                    | FreePats, Upright Piano KW                                                    |
| Voix                        | `voice`        | 128 / 158 Ko                    | epic-choir, « ah » d'altos et de sopranos (**CC BY 4.0**, crédit obligatoire) |
| Flûte                       | `flute`        | 182 / 225 Ko                    | VSCO 2 CE                                                                     |
| Violon                      | `violin`       | 208 / 257 Ko                    | VSCO 2 CE, violon solo                                                        |
| Clarinette                  | `clarinet`     | 164 / 203 Ko                    | FreePats                                                                      |
| Contrebasse                 | `double-bass`  | 145 / 179 Ko                    | VSCO 2 CE, contrebasse solo                                                   |

Auteurs, URL et textes de licence sont dans [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). Les fichiers Ogg Opus pèsent 1,71 Mo dans le dépôt (92 fichiers) et leurs jumeaux AAC 2,12 Mo ; un navigateur télécharge l'un des deux formats.

- **Chaque instrument du catalogue a un enregistrement.** La guitare folk et la voix étaient des remplaçants (guitare nylon, flûte) jusqu'à #62. Les ukulélés baryton et sol grave descendent sous l'étendue enregistrée (do4), l'échantillonneur transpose vers le bas ; c'est aussi le cas d'une partie de voix écrite sous l'étendue du chœur (la#3 à fa#5). Les instruments inconnus jouent le piano, et la console le signale.
- **Les crédits sont affichés dans l'application.** La licence CC BY 4.0 (la voix) exige un crédit, un lien vers la licence et la mention des modifications. Le bouton « À propos et crédits » (barre d'outils de l'éditeur et bibliothèque) et la commande de la palette ouvrent une boîte de dialogue (`web/src/credits/`, chunk à la demande, français et anglais) qui liste chaque jeu avec son enregistrement, son auteur, sa licence et son lien source. `credits.test.tsx` vérifie que chaque jeu y figure et que la liste correspond à `THIRD_PARTY_NOTICES.md`.
- **La licence est une barrière stricte.** Ne jamais ajouter un échantillon qui n'est pas CC0, CC-BY (3.0 ou 4.0), MIT, BSD, de type OFL ou équivalent, avec la licence vérifiée à la source et notée dans `THIRD_PARTY_NOTICES.md`. Jamais de CC-BY-SA, CC-BY-NC, GPL (la guitare folk de FreePats est en GPL-3.0 avec exception et n'a pas été utilisée), « usage personnel » ou licence floue. Les soundfonts General MIDI (FluidR3, MuseScore General, les builds « midi-js-soundfonts ») n'ont pas été utilisées : leurs conditions dépendent des enregistrements d'origine et le risque n'en valait pas la peine.
- **Format.** Ogg Opus, mono, 40 kbit/s, 3,5 à 5 s par hauteur avec un fondu de sortie. Chromium et Firefox décodent l'Ogg Opus ; Safari est géré par le repli ci-dessous.
- **Safari et le repli AAC.** Ce que disent les sources : la session WWDC25 d'Apple « What's new in Safari and WebKit » indique « in Safari 19, we've added Ogg Opus and Ogg Vorbis to the list of media we support » ([vidéo](https://developer.apple.com/videos/play/wwdc2025/233/) ; la version qui a suivi WWDC25 est Safari 26, voir l'[annonce WebKit](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)) ; caniuse donne l'Ogg Vorbis comme pris en charge depuis Safari 18.4 et l'Opus comme pris en charge sur iOS depuis 18.4 mais seulement « partiel » sur Safari de bureau, dans les deux cas pour l'élément `<audio>` uniquement ([Ogg Vorbis](https://caniuse.com/ogg-vorbis), [Opus](https://caniuse.com/opus)) ; les notes WebKit de Safari 27.0 corrigent « MP4 files containing Opus audio tracks could not be decoded with `decodeAudioData` » ([notes](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)). **Aucune source n'affirme que `decodeAudioData` de Web Audio décode l'Ogg Opus dans Safari**, et cela n'a pas été testé sur un appareil : l'application ne devine donc pas. `sampleFormat.ts` décode une fois par chargement de page un extrait Ogg Opus de 123 octets (`OfflineAudioContext.decodeAudioData`) et, s'il échoue, charge à la place le jumeau AAC-LC `.m4a` de chaque fichier (`sampleUrls(set, 'm4a')`). Un seul format est téléchargé ; Chromium et Firefox ne demandent jamais de `.m4a`.
- **Fabriquer les jumeaux AAC.** `node scripts/samples/build-fallback.mjs [id de jeu...]` (Windows uniquement) décode chaque `.ogg` livré dans Chromium, écrit des WAV 16 bits dans un dossier temporaire et les encode avec l'encodeur AAC de Windows Media Foundation (`scripts/samples/aac-encode.ps1`, mono, environ 48 kbit/s) en `<Note>.m4a` à côté du `.ogg`. Le WebCodecs de Chromium ne sait pas encoder l'AAC (vérifié dans le Chromium de Playwright, Chrome et Edge) et aucun autre encodeur AAC n'est disponible pour le projet. Le jumeau est donc une seconde génération avec perte, dérivée du fichier Opus, et `build-samples.mjs` (qui efface le dossier du jeu) doit être suivi de `build-fallback.mjs` pour le même jeu. `samples.test.ts` échoue quand un `.ogg` n'a pas de jumeau `.m4a` sur la même hauteur et quand un jeu dépasse son budget (250 Ko en Ogg Opus, 310 Ko en AAC ; la guitare folk fait 301 Ko en AAC).
- **Même origine, immuable.** `import.meta.glob('./samples/*/*.{ogg,m4a}', { query: '?url' })` fait émettre à Vite chaque fichier en `/assets/<Note>-<hash>.ogg` (ou `.m4a` ; jamais en ligne, voir `assetsInlineLimit` dans `vite.config.ts`), que l'API sert avec `Cache-Control: immutable`. La Content-Security-Policy (`default-src 'self'`, `connect-src 'self'`) l'autorise. Rien n'est chargé depuis un CDN. Tone.js lance un Web Worker blob pour son horloge au chargement, ce que `script-src 'self'` interdit : `index.ts` masque `Worker` le temps que le module de Tone s'évalue pour qu'il utilise un minuteur, et le contexte Tone est créé avec `clockSource: 'timeout'` (le planificateur n'utilise pas l'horloge de Tone). Un test navigateur exécute le vrai moteur sous la politique de l'API et échoue à la moindre violation autre que les styles.

### Ajouter un instrument

1. Trouver un enregistrement dont la licence est vérifiable à la source (CC0, CC-BY, MIT, de type OFL). Noter l'URL, l'auteur et la licence dans `THIRD_PARTY_NOTICES.md`.
2. Télécharger les originaux (WAV ou FLAC, un fichier par hauteur, une hauteur tous les 3 à 5 demi-tons) dans un dossier temporaire.
3. Ajouter une entrée à `web/scripts/samples/sets.mjs` (identifiant du jeu, quel fichier est quelle note, `seconds`, `fadeOut`, `octaveShift` si la source numérote les octaves autrement, comme VSCO).
4. Depuis `web/` : `SAMPLES_SRC=<dossier> node scripts/samples/build-samples.mjs <id du jeu>`. L'outil décode, coupe, normalise et encode avec le Chromium de Playwright (WebCodecs), écrit `src/playback/samples/<jeu>/<Note>.ogg` (`s` pour un dièse) et affiche la hauteur mesurée de chaque fichier face à son étiquette. Une ligne `CHECK PITCH` signale le plus souvent un harmonique pris pour le fondamental, mais un écart d'environ 1200 cents sur tous les fichiers signale une mauvaise étiquette d'octave.
5. Ajouter l'identifiant du jeu à `instrumentSets.ts` (`SampleSetId`, `SAMPLE_SET_IDS`) et y rattacher les identifiants du catalogue ; ajouter son temps de relâchement dans `toneBackend.ts` ; ajouter l'instrument à `web/src/score/instruments.ts` s'il n'est pas dans le catalogue.
6. `node scripts/samples/build-fallback.mjs <id du jeu>` pour les jumeaux AAC (Windows), puis ajouter le jeu à `web/src/credits/content.ts` (boîte de dialogue des crédits).
7. `npm test` (`samples.test.ts` vérifie que chaque jeu couvre son étendue sans grand trou, a un jumeau `.m4a` pour chaque `.ogg` et respecte son budget ; `credits.test.tsx` vérifie les crédits face à `THIRD_PARTY_NOTICES.md`), mettre à jour le tableau ci-dessus et `THIRD_PARTY_NOTICES.md`.

## Lecture des accords

Les accords (voir [editor.fr.md](editor.fr.md#accords)) peuvent s'écouter. C'est une option du mixeur (mode Avancé, « Accords ») : **Muets** (par défaut), **Accords plaqués** (toutes les notes ensemble) ou **Arpégés (strum)** (les cordes l'une après l'autre, de la grave à l'aiguë, à 36 ticks d'écart, environ 19 ms à 120 bpm). Code : `web/src/playback/chordVoicing.ts` (pur) et `timeline.ts` (`buildTimeline(score, { chords, lookup })`) ; `PlaybackController.setChordPlayback(mode)`.

- **Sur l'instrument de la partie.** Les notes d'accord appartiennent à la portée qui porte les accords : elles sont donc jouées par l'échantillonneur de cette portée (un accord de guitare avec les échantillons de guitare, un accord d'ukulélé avec ceux de l'ukulélé) et suivent sa sourdine et son solo.
- **Réalisation.** Sur une partie à cordes, les notes sont la **forme du diagramme** : corde par corde, hauteur de la corde à vide plus capodastre plus case (la hauteur qui sonne est celle de l'accord, quel que soit le capodastre), donc ce qu'on entend est ce que montre le diagramme ; un doigté personnalisé (`frame`) est joué tel qu'il est dessiné. Sinon (piano, voix...) une réalisation serrée : la basse (la basse de l'accord, sinon la fondamentale) dans l'octave sous le do central, les notes de l'accord au-dessus, dans une octave à partir du do central, cinq au plus (la quinte saute en premier dans un accord de 9e, 11e ou 13e). La bibliothèque d'accords est chargée la première fois que l'option est activée, jamais autrement.
- **Durée.** Un accord résonne jusqu'à l'accord suivant de sa mesure, ou jusqu'à la fin de la mesure ; un accord ne passe pas la barre de mesure (réécrivez l'accord à la mesure suivante, comme sur une grille).
- **Muets par défaut, sans surbrillance.** Option désactivée, la timeline n'a aucune note d'accord ; les notes d'accord n'ont pas d'identifiant d'événement : elles n'allument aucune note ni ne déplacent le curseur, et elles ne sont pas dans l'export MIDI (qui est celui des notes de la partition).
- **Changer l'option** arrête la lecture, reconstruit la timeline et garde la tête de lecture. La timeline est reconstruite comme après une édition : paresseusement.

## Performance

Mesuré dans Chromium (portable Windows 11, build de production, serveur local, sans limitation réseau ; le chiffre est dominé par le décodage et la planification, le téléchargement représente environ 60 Ko gzip de Tone plus le jeu).

| Quoi                                                              | Budget                            | Mesuré                                                           |
| ----------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| Délai avant la première note, à froid (moteur + piano + décodage) | < 3 s                             | 120 à 330 ms (local)                                             |
| Délai avant la première note, en cache                            | < 1 s                             | 55 à 100 ms                                                      |
| Chunk de lecture (Tone.js + moteur)                               | ≤ 80 Ko gzip, chargé à la demande | 57,7 Ko gzip, hors du bundle initial                             |
| Jeux d'échantillons                                               | ≤ 3 Mo au total                   | 1,71 Mo en Ogg Opus (2,12 Mo en AAC), 85 à 244 Ko par instrument |
| JS initial                                                        | ≤ 150 Ko gzip                     | 94,7 Ko (le contrôleur n'en représente que quelques Ko)          |
| Frappe en saisie (100 mesures)                                    | < 16 ms                           | environ 9 ms (l'aperçu ne reconstruit pas la timeline)           |

Sur un vrai réseau, la première note ajoute le téléchargement du chunk Tone et de l'instrument (environ 250 à 270 Ko), une seconde environ à 2 Mbit/s, rien une fois en cache (fichiers hachés, `immutable`).

## Tests

- Accords : `chordPlayback.test.ts` (réalisations à la guitare, à l'ukulélé et au clavier, capodastre, doigté personnalisé, timelines plaquée et arpégée, ordre, option du contrôleur, tête de lecture conservée), `e2e/chords.spec.ts` (l'option du mixeur, muette par défaut).
- Unitaires : `timeline.test.ts` (tempo et changements de tempo, points, liaisons y compris sur une barre de mesure et par hauteur d'accord, triolets, silences, accords, voix, plusieurs parties et portées, transposition, capodastre, levée, temps), `clock.test.ts` (bouclage, mute/solo), `controller.test.ts` (instants programmés, anticipation, pause/reprise, arrêt, déplacement, jouer depuis la sélection, tempo, boucle, métronome, mute/solo, images, modifications de la partition, aperçu, échec audio), `samples.test.ts` (couverture, jumeaux AAC, budgets), `sampleFormat.test.ts` (choix Ogg Opus ou AAC, sonde, une seule décision par chargement de page), `credits/credits.test.tsx` (chaque jeu crédité, en phase avec `THIRD_PARTY_NOTICES.md`, crédit CC BY, français).
- Navigateur, audio simulé (`e2e/playback.spec.ts`, `window.__polymniaAudio = 'mock'` ; le moteur enregistre ses appels dans `window.__polymniaAudioLog`) : lecture/arrêt, curseur et surbrillance, `Espace`/`Origine`, `Espace` ignoré dans un champ texte, jouer depuis la sélection et boucle, aperçu à la saisie, tempo et métronome, mute/solo, défilement de la page, guitare folk / voix / violoncelle chargeant chacun leur jeu.
- Navigateur, vrai moteur (`e2e/playback-audio.spec.ts`) : décodage des vrais échantillons, délai avant la première note à froid et en cache, fichiers hachés de même origine, aucune violation de politique, guitare folk, voix et violoncelle décodés pour de vrai (Ogg Opus, aucun `.m4a` demandé). `e2e/credits.spec.ts` : la boîte des crédits depuis la barre d'outils et la palette, en anglais et en français.
- `npm run size` budgète le chunk de lecture et les fichiers d'échantillons (3 Mo par format, Ogg Opus et AAC séparément).
