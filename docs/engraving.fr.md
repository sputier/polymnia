# Gravure

[English](engraving.md) · **Français**

Le graveur transforme une partition (voir [score-format.fr.md](score-format.fr.md)) en SVG. Il se trouve dans [`web/src/engraving/`](../web/src/engraving). Le dessin est fait par [VexFlow](https://www.vexflow.com/) 5.11.0 (MIT, version fixée exactement dans `package.json`) ; **la mise en page est la nôtre** : VexFlow ne fait que dessiner notes, portées et symboles là où notre layout le demande.

## Modules

| Fichier           | Rôle                                                                                                  | VexFlow              |
| ----------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| `notation.ts`     | Géométrie de la portée (clé vers y), état des altérations, groupes de ligatures, utilitaires de ticks | non                  |
| `layout.ts`       | Largeurs de mesures, découpage en systèmes, justification, positions x des événements                 | non                  |
| `hitTest.ts`      | Point vers `{partId, staffId, measureIndex, eventId, pitch}`, boîtes englobantes des événements       | non                  |
| `draw.ts`         | Dessine un système (portées, notes, ligatures, tuplets, liaisons, accolades, noms)                    | oui                  |
| `vexflowSetup.ts` | Configure VexFlow (polices) et charge Bravura                                                         | oui                  |
| `fonts.ts`        | URL du fichier Bravura haché, `<link rel="preload">`                                                  | non (bundle initial) |
| `engraver.ts`     | Possède le SVG, re-rendu incrémental, surbrillance                                                    | oui                  |
| `ScoreView.tsx`   | Composant React : chargement différé, redimensionnement, props vers le graveur                        | non (différé)        |

Tout ce qui n'a pas besoin de VexFlow est du TypeScript pur, testé sous jsdom. `ScoreView` charge `engraver.ts` (donc VexFlow) par un `import()` dynamique après le premier affichage : **VexFlow n'est pas dans le bundle initial**. VexFlow est sous licence MIT (voir [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)). Le point d'entrée `vexflow/core` est utilisé : il ne contient **aucune police**. Il ne se tree-shake pas en pratique (la bibliothèque enregistre ses classes globalement) : le chunk de l'éditeur reste à environ 180 Ko gzip (voir « Chiffres »).

## Polices

- **Bravura** (police musicale SMuFL, SIL OFL 1.1) est un fichier séparé `bravura-<hash>.woff2` (247 Ko), pris dans le paquet `@vexflow-fonts/bravura` et émis par Vite dans `/assets` : l'API le sert donc avec l'en-tête de cache immuable. Il est de même origine, ce qu'exige la CSP (`font-src 'self'`) : rien n'est embarqué en URL `data:`.
- `ScoreView` ajoute `<link rel="preload" as="font" crossorigin>` dès que l'éditeur est monté (`fonts.ts`, bundle initial), en parallèle du téléchargement du chunk du graveur.
- `vexflowSetup.ts` appelle `VexFlow.setFonts('Bravura')` et `Font.load(...)`. Les métriques des glyphes sont fournies par VexFlow : **le fichier de police ne change jamais la mise en page**, il ne fournit que les pixels (`font-display: block`).
- Le premier rendu attend la police 2,5 s au plus. Passé ce délai, la partition est gravée quand même et les glyphes apparaissent à l'arrivée de la police ; un téléchargement en échec ne lève pas d'erreur.
- **Academico est supprimée.** Le texte dessiné par VexFlow (numéros de tablature, annotations) utilise la police de l'interface (Inter, déjà auto-hébergée), comme les noms d'instruments.
- Seule Bravura est nécessaire : aucune autre police de notation ou de texte n'est chargée.

## Algorithme de mise en page

Toutes les tailles sont en px ; un interligne vaut 10 px (13 px sur les tablatures).

1. **Forme d'une mesure** (en cache par mesure). Toutes les portées d'une mesure sont analysées ensemble pour que les notes de portées différentes soient alignées. Les événements sont regroupés en _colonnes_, une par départ distinct (tick). Chaque colonne reçoit :
   - `lead` : place avant la tête de note pour les altérations (3 + 10 px par altération empilée, jusqu'à 3),
   - `glyph` : tête de note, points (7 px chacun), seconde décalée d'un accord, crochet,
   - `stretch` : espace proportionnel après la colonne, `1 + 8 x log2(écart / 120 + 1)` où `écart` est le temps (en ticks) jusqu'à la colonne suivante ou la fin de la mesure. Une noire reçoit environ 26 px (plus 13 px de tête de note), une blanche environ 34 px, une double-croche environ 14 px : la largeur croît avec la durée, mais moins vite qu'elle (courbe logarithmique de type Gourlay : doubler une durée ne double jamais son espace). La largeur de la tête de note (13 px = 1,18 interligne de Bravura plus un petit jeu) est la distance minimale entre deux colonnes ; altérations, points, crochets et secondes décalées ajoutent la largeur de leurs glyphes, et un test vérifie qu'une altération ne touche jamais la note précédente. La référence de la courbe est fixe (et non la durée la plus courte du système), ce qui garde la forme d'une mesure calculable et cachable mesure par mesure.
     La zone de notes minimale d'une mesure est `padLeft + somme(lead + glyph + stretch) + padRight`. Les altérations suivent l'armure et l'état local à la mesure (toutes voix, dans l'ordre du temps ; une note liée depuis la mesure précédente ne répète pas son altération).
2. **Éléments de début.** La première mesure d'un système reçoit une clé pleine, l'armure (si ce n'est pas do majeur) et, au début de la partition ou quand il change, le chiffrage. Une mesure en milieu de système n'affiche que ce qui change : petite clé, armure avec bécarres annulant l'ancienne, chiffrage.
3. **Remplissage.** Les systèmes sont remplis de façon gloutonne : une mesure rejoint le système tant que la somme des largeurs (éléments de début inclus) tient dans la largeur disponible. Si la mesure suivante annonce un changement d'armure, de chiffrage ou de clé, la fin du système doit contenir les signes de **précaution** ; on retire des mesures jusqu'à ce que cela tienne.
4. **Justification.** L'espace libre d'un système est réparti entre ses mesures proportionnellement à leur zone de notes, puis dans chaque mesure sur le `stretch` de chaque colonne : l'espacement reste proportionnel. La justification ne fait qu'étirer. Un **dernier système rempli à moins de 60 %** de la ligne garde sa largeur naturelle ; un système plus plein est justifié comme les autres. Une mesure seule plus large que la page garde la place de ses glyphes et abandonne l'espace proportionnel.
5. **Positions.** Chaque colonne reçoit un x. Une fois que VexFlow a préparé les notes (altérations, hampes, points), chaque contexte de tick est déplacé à ce x. Une mesure qui ne contient qu'un silence est centrée. Les mêmes x alimentent le hit test : aucune mesure dans le DOM n'est nécessaire.
6. **Empilement vertical.** Les portées d'une partie sont espacées de 48 px, les parties de 56 px, avec 36 px au-dessus et 32 px en dessous de chaque système. Les tablatures ont autant de lignes que l'instrument a de cordes (`Part.tuning` ou le catalogue).

Autres règles : une levée utilise sa propre `length` (elle reçoit moins de largeur) ; l'accolade relie les portées d'une partie à deux portées standard (un crochet pour standard + tablature), un crochet relie les parties ; le premier système porte les noms complets des parties et les suivants les **noms abrégés** (`InstrumentDef.short`, français et anglais, dans le catalogue : `Pno.`, `Vln.`, `Vc.`...; une partie renommée par l'utilisateur garde son nom, coupé à 8 caractères avec un point s'il est plus long), dans un retrait plus étroit ; la dernière mesure reçoit la barre finale ; `treble-8vb` est une clé de sol avec un petit 8 dessous (la position écrite est celle de la clé de sol) ; les ligatures suivent le temps (une noire pointée en mesure composée), jamais à travers un silence ou un temps ; les membres d'un tuplet sont liés selon leur durée réelle ; la deuxième voix d'une portée a les hampes vers le bas ; liaisons et ligatures de prolongation peuvent traverser les systèmes.

**Tablature** (VexFlow `TabStave` / `TabNote`, notes triées par corde) : les accords sont empilés sur leurs cordes ; les **silences** sont masqués (une note fantôme garde l'espace rythmique) sauf si la portée a `showRests`, ils sont alors dessinés comme sur une portée standard ; les **liaisons de prolongation et de phrase** sont des arcs entre les cases (`TabTie` sans la lettre h/p ; une liaison à travers une barre de mesure ou un saut de système est un demi-arc ; une liaison de phrase d'une partie « portée + tablature » est dessinée sur les deux portées, retrouvée par position à partir des événements de la portée standard) ; une note qu'aucune corde ne peut jouer est un `?` au milieu de la portée, avec la couleur d'avertissement hors tessiture, le triangle et l'infobulle (la marque n'est donc pas qu'une couleur). Les cases liées ne sont pas mises entre parenthèses. `hitTest` ajoute `string` (1 = la plus aiguë) sur les tablatures ; cliquer sur une position de corde fixe la corde de saisie de l'éditeur. La clé de cache d'un système inclut `showRests`.

## Hit test et boîtes

`hitTest(layout, x, y)` (ou `engraver.hitTest`) travaille en coordonnées SVG (`clientX - svg.left`). Il renvoie `null` hors des systèmes, sinon `{systemIndex, partId, staffId, measureIndex, eventId?, pitch?, string?}` :

- la portée est la plus proche de `y` (entre deux portées, la plus proche gagne) ;
- `eventId` est renseigné quand le point est sur une tête de note, un silence ou un numéro de tablature (petite tolérance) ;
- `pitch` est la hauteur naturelle dessinée à cette hauteur pour la clé en vigueur à cette mesure, jusqu'à 3,5 interlignes de la portée (lignes supplémentaires), sur les portées standard uniquement. L'armure n'est pas appliquée : c'est à la saisie de décider.

- `string` est la corde sous le point (1 = la plus aiguë), sur les tablatures seulement.

`eventBox(layout, id)` et `eventBoxes(layout)` donnent la boîte englobante des événements (pour la sélection et la surbrillance de lecture). Un test Playwright vérifie que les boîtes correspondent à l'endroit où VexFlow a réellement dessiné les têtes de notes.

## Thème et surbrillance

Le SVG définit `color: var(--score-ink)` et VexFlow dessine en `currentColor` ; quelques couleurs codées en dur par VexFlow (hampes, lignes supplémentaires) sont surchargées dans `engraving.css`. Chaque événement est un `<g class="pm-event" data-event-id="...">`. `setSelection(ids)` ajoute `pm-selected` (couleur `--accent`, plus un rectangle doux `--accent-soft` dans un groupe de recouvrement séparé) ; `setPlaying(ids)` ajoute `pm-playing` (couleur `--play`) ; `setPlayCursor(ids)` déplace un seul `<rect class="pm-cursor">` (couleur `--play`) sur les événements donnés et renvoie sa boîte, pour la lecture ([docs/playback.fr.md](playback.fr.md)). Ce sont des bascules de classe sur des nœuds existants : jamais de nouvelle gravure, et le thème sombre fonctionne.

## Rendu incrémental

Le modèle partage les objets inchangés entre versions : les références détectent les changements.

- Les formes de mesures sont en cache par indice de mesure et invalidées quand les mesures de portée (ou la précédente, pour les liaisons) ou le contexte clé/armure/chiffrage changent par référence ou par valeur.
- Chaque système est dessiné dans son propre `<g>`, en coordonnées locales au système, et positionné par `transform`. Un système garde son nœud DOM quand sa _signature_ est inchangée : le placement (chaque x, largeur et élément de début), les références des mesures de portée qu'il utilise (et celle d'avant), les liaisons qui le touchent et les noms de parties. Une édition ne regrave donc que le ou les systèmes touchés ; les systèmes suivants sont seulement translatés si la hauteur au-dessus a changé. Un changement de largeur (redimensionnement) regrave tout, avec un anti-rebond de 120 ms dans `ScoreView`.
- `engraver.render(score, width)` renvoie `{ms, systems, drawn, reused, overflow}`. `overflow` compte les systèmes dont les éléments de début dépassaient la place réservée par le layout : doit rester 0 (vérifié sur chaque fixture par les tests navigateur).

## Rendu progressif

`engraver.render(score, width, { progressive: true })` (ce qu'utilise `ScoreView`) calcule tout le layout d'un coup (il est pur et prend quelques ms), fixe la taille finale du SVG, puis grave de façon synchrone les systèmes qui croisent la zone visible (avec une petite marge) : le premier système s'affiche vite. Les autres sont gravés par tranches d'au plus 20 ms dans `requestIdleCallback` (`setTimeout` s'il n'existe pas), dans l'ordre de la partition, et insérés dans le DOM à leur place. `engraver.stats.complete` vaut `false` tant que la file n'est pas vide, et `await engraver.settled()` se résout quand tout est dessiné.

- Le hit test et les boîtes n'utilisent que le layout : ils fonctionnent sur des systèmes pas encore dessinés ; les surbrillances (sélection, lecture) sont appliquées à un système dès qu'il est dessiné.
- Les avertissements de tessiture (#15) sont des bascules de classe comme la sélection : `Engraver.setWarnings(liste)` ajoute `pm-warn` (couleur d'avertissement) aux événements et dessine un triangle avec infobulle au-dessus de chacun dans une couche séparée, à partir des boîtes du layout (donc sans regravure) ; un système gravé plus tard reçoit la classe à son dessin. Le triangle évite que l'avertissement ne repose que sur la couleur.
- Un nouvel appel à `render` annule les tranches en attente. Les systèmes déjà dessinés et inchangés sont réutilisés comme avant : une édition reste incrémentale, et `render(score, width)` sans option reste entièrement synchrone (ce qu'utilisent les benchmarks).
- `RenderStats` gagne `firstSystemMs` (délai jusqu'au premier système gravé) et `complete`.

## Accessibilité

Le SVG a `role="img"` et un résumé `aria-label` (titre, nombre d'instruments et de mesures, dans la langue courante). `ScoreView` affiche aussi une région `role="status"` / `aria-live="polite"` masquée visuellement, alimentée par la prop `liveMessage` : la description de l'événement sélectionné ira là (#19). Le recouvrement est `aria-hidden`.

## Utiliser `ScoreView`

```tsx
<ScoreView
  score={score} // optionnel : par défaut la fixture « Au clair de la lune »
  selection={["e12"]} // identifiants d'événements, bascule de classe
  playing={["e13"]} // identifiants d'événements, bascule de classe
  onHit={(hit, event) => {}} // pointer down : ce qui est sous le pointeur
  liveMessage="Do 4, noire"
/>
```

### Crochet d'aperçu (tests)

`#/editor?fixture=<nom>&width=<px>` affiche une fixture de `web/src/score/fixtures` (ou `accidentals`, `benchmark100`) à largeur fixe et expose `window.__polymnia = { engraver, score, width }`. Les tests navigateur l'utilisent ; cela n'ajoute rien au bundle initial.

### Re-flow pendant la frappe

Une édition qui déplace des sauts de ligne (une mesure s'élargit, une note s'ajoute dans une mesure pleine) modifie tous les systèmes suivants, dont plusieurs sont à l'écran. Une frappe doit rester sous une image à 60 fps : la partie synchrone est donc bornée en temps.

1. Le layout est calculé en entier (environ 1 ms avec le cache de formes) et la taille du SVG est définitive : hit test, boîtes d'événements et fond de sélection sont corrects tout de suite, même pour les systèmes pas encore gravés.
2. Les systèmes à graver sont ceux de l'écran, celui qui contient la sélection en premier. Ils sont gravés tant que l'appel a dépensé moins de 6 ms (layout compris) et que le suivant ne devrait pas dépasser (le coût d'un système est une moyenne mobile des mesures, 3 à 5 ms pour une portée double). Le premier est toujours gravé : il contient l'édition.
3. Les systèmes visibles restants sont gravés un par tâche juste après l'appel (`setTimeout`, pas en temps libre), pour qu'une touche pressée entre-temps n'attende pas ; les autres suivent par tranches en temps libre. Pendant quelques millisecondes, un système qui attend son tour est blanc.
4. Les surbrillances ne sont plus ré-appliquées à toute la partition à chaque rendu (environ 4 ms sur 100 mesures) : seuls les systèmes gravés par l'appel le sont, et `setSelection` bascule la différence entre l'ancienne et la nouvelle sélection.

L'hystérésis des sauts de ligne pendant la saisie n'a pas été nécessaire pour tenir le budget et n'est pas implémentée : une mesure ne dépasse jamais la largeur de page et les sauts suivent toujours le layout pur.

## Tests

- Unitaires (Vitest) : `notation.test.ts`, `layout.test.ts` (découpage, largeurs, justification, précautions, cache, densité, espacement, altérations, dernier système court), `../web/src/export/density.test.ts` (mesures par système et nombre de pages A4 de la partition de 100 mesures), `hitTest.test.ts`, `ScoreView.test.tsx`.
- Navigateur (Playwright, `e2e/engraving.spec.ts`) : chaque fixture se grave sans erreur ni dépassement, le layout concorde avec VexFlow, hit test sur un vrai clic, bascules de surbrillance, thème sombre, redimensionnement, **budgets de performance**.
- Navigateur, re-flow (`e2e/engraving.spec.ts`) : après un re-flow, l'appel ne grave qu'une partie des systèmes, le hit test répond pour le dernier (non dessiné), puis tous les systèmes sont dessinés, dans l'ordre.
- Navigateur, budget de frappe (`e2e/note-entry.spec.ts`, « performance ») : vrais événements clavier sur une partition de 100 mesures, temps de la touche à la fin du rendu synchrone, médiane < 16 ms et p95 < 32 ms pour une partition remplie, pour un re-flow en haut d'une partition remplie et en remplissant une partition vide. `PLAYWRIGHT_PORT` change le port de prévisualisation quand un autre run utilise 4173.
- Navigateur, polices et rendu progressif (`e2e/engraving-fonts.spec.ts`) : aucune police embarquée dans une réponse JavaScript, un seul fichier Bravura haché et un lien de préchargement, la partition s'affiche quand Bravura arrive en retard (requête retardée de 3,5 s), rendu progressif (hauteur complète d'emblée, dessin partiel puis complet, premier système sous 100 ms).
- `npm run size` (après `npm run build`) échoue si le JS initial, le chunk de l'éditeur ou le fichier Bravura dépassent leur budget, ou si une police est embarquée dans un chunk JS.
- Visuels (`e2e/visual/`) : captures de portée simple, système à deux portées, accords, altérations et changements d'armure, liaisons, triolets, guitare standard + tablature, changements de clé au violoncelle, levée, thème sombre avec surbrillance.

## Mettre à jour les références visuelles

Les pixels diffèrent d'un système à l'autre : les références de `web/e2e/__screenshots__/` sont donc générées sous Linux dans l'image Docker officielle de Playwright (même version que `@playwright/test`), ce qu'exécute la CI. Sous Windows et macOS les tests visuels sont ignorés. Docker démarré, depuis `web/` :

```
npm run test:visual:update   # régénère les références, puis relire le diff des PNG
npm run test:visual:docker   # vérifie les références versionnées dans la même image
```

Versionnez les PNG modifiés avec le code qui a changé le rendu, et expliquez pourquoi dans la pull request.

## Chiffres

Mesurés dans Chromium (portable Windows 11, build de production), `benchmark100` : 100 mesures, deux portées, 23 systèmes à 1100 px (34 avant #46), surtout des croches avec altérations et liaisons.

| Quoi                                                                           | Budget            | Mesuré                                                                                                |
| ------------------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------- |
| Premier système affiché (après chargement du chunk)                            | < 100 ms          | environ 27 ms                                                          |
| Rendu complet, tout premier (JIT froid), tous les systèmes                     | n/a               | environ 207 ms (le dessin s'exécute par tranches en temps libre) |
| Rendu complet, à chaud (médiane de 7)                                          | < 200 ms          | environ 83 ms                                                                                        |
| Une édition, médiane / max de 25                                               | < 16 ms           | environ 4,9 ms / 9 ms                                                                                  |
| Frappe, partition remplie, médiane / p95 / max de 40                           | p95 < 16 ms       | 9,6 / 14,1 / 15,2 ms (édition à l'écran ; les systèmes contiennent plus de mesures, chacun coûte donc plus)                                                              |
| Frappe avec re-flow en haut d'une partition remplie, médiane / p95 / max de 40 | p95 < 16 ms       | 9,3 / 13,7 / 14,0 ms, 1 système au plus                               |
| Frappe en remplissant une partition vide, médiane / p95 / max de 400           | p95 < 16 ms       | 3,7 / 7,1 / 12,6 ms                                                     |
| Surbrillance (sélection + lecture)                                             | bascule de classe | < 1 ms                                                                                                |
| Layout seul (jsdom)                                                            | n/a               | quelques ms                                                                                           |
| JS initial                                                                     | <= 150 Ko gzip    | 72,7 Ko                                                                                               |
| Chunk de l'éditeur (VexFlow + gravure, sans police)                            | <= 200 Ko gzip    | 180 Ko (468 Ko avec les polices avant)                                                                |
| Fichier de police Bravura                                                      | <= 250 Ko woff2   | 247 Ko, fichier séparé, cache immuable                                                                |

Les tests navigateur (`@perf`, projet `perf`, voir [development.fr.md](development.fr.md)) chauffent, prennent de nombreux échantillons, vérifient la médiane contre le budget strict et le p95 contre le double du budget. Ils vérifient : rendu complet à chaud < 200 ms, à froid < 600 ms (JIT, workers parallèles, CI plus lente), médiane d'édition < 16 ms, médiane de frappe < 16 ms et p95 < 32 ms dans les trois scénarios ci-dessus (les runners CI sont environ deux fois plus lents que le portable de référence).
