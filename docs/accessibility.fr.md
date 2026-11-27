# Accessibilité

Cible : WCAG 2.2 niveau AA sur chaque écran, dans les deux thèmes et les deux langues. Cette page consigne ce qui est
vérifié automatiquement, ce qui a été relu à la main, les constats de l'audit (#19) et ce qui reste manuel.

## Vérifications automatiques

`web/e2e/a11y.spec.ts` lance axe (`@axe-core/playwright`, étiquettes `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`wcag22aa` et `best-practice`) et échoue sur **toute** violation, quel que soit son impact. `axe-core` et son
adaptateur Playwright sont sous MPL-2.0, utilisés en dépendances de développement uniquement (rien n'est embarqué).

États audités, chacun en clair + anglais et sombre + français (les deux diagonales de la matrice thème x langue : le
thème change les contrastes, la langue les noms et les longueurs) :

- connexion, confidentialité, contact (vierge et prérempli pour signaler une page) ;
- bibliothèque : vide, remplie, menu d'une carte, menu du compte, dialogue de suppression du compte, dialogue de
  nouvelle partition ;
- éditeur : Simple, Avancé avec l'inspecteur et le panneau des instruments, piano à l'écran, champ de saisie d'accord,
  mode focus, palette de commandes, aide-mémoire, crédits, menu Exporter, dialogue Partager (non partagé et
  partagé), grille d'accords ;
- le visualiseur public d'un lien de partage.

`web/e2e/a11y-behaviour.spec.ts` couvre ce qu'axe ne peut pas juger : liens d'évitement, focus qui entre dans un
dialogue, y reste et revient, annonces, `prefers-reduced-motion`, reflow à 320 px CSS, parcours au clavier seul. Les
tests unitaires (`describe.test.ts`) couvrent les générateurs de texte des annonces, en français et en anglais.

## Parcours au clavier seul

Testé par `a11y-behaviour.spec.ts` (« keyboard only walkthrough ») et relu dans le code :

| Tâche                    | Touches                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Passer la barre d'outils | premier arrêt de `Tab` : **Aller au contenu** (bibliothèque) ou **Aller à la partition** (éditeur), `Entrée` |
| Créer une partition      | bibliothèque : `N`, remplir le dialogue, `Entrée`                                                            |
| Saisir une mélodie       | `N` (saisie), `3` à `7` (durée), `A` à `G` (hauteur), flèches pour se déplacer, `Échap`                      |
| Ajouter un accord        | `Alt+K`, taper le symbole, `Entrée`, `Échap`                                                                 |
| Lire                     | `Espace` (lecture / pause), les boutons de transport sont dans l'ordre de tabulation                         |
| Partager                 | `Ctrl+Maj+L` (ou le bouton **Partager**), `Échap` ferme                                                      |
| Exporter                 | bouton **Exporter** : `Entrée` ouvre le menu, flèches, `Échap` ferme et rend le focus au bouton              |
| Supprimer le compte      | menu du compte dans la bibliothèque, dernier élément, puis dialogue de confirmation                          |

Règles valables partout : tout dialogue prend le focus, garde `Tab` à l'intérieur, se ferme sur `Échap` et rend le
focus à ce qui l'a ouvert ; tout menu se ferme sur `Échap` et rend le focus à son bouton ; les raccourcis
fonctionnent quand la zone de la partition a le focus (le modèle clavier est global, la partition n'est pas un arrêt
de tabulation).

## Sémantique pour lecteur d'écran (relue dans le code, pas testée avec NVDA)

- Repères et titres : un `main` et un `h1` par écran ; les dialogues ont un `h2` comme nom (`aria-labelledby`) ; les
  cartes de la bibliothèque sont des `h2` sous le `h1` ; le corps de l'aide-mémoire est une région focalisable et
  nommée (elle défile).
- Noms : les boutons à icône seule ont un `aria-label` ; un bouton à texte visible a un nom accessible qui **contient**
  ce texte (WCAG 2.5.3, `label-content-name-mismatch`) : le bouton de thème s'appelle « Clair : Passer au thème
  sombre », celui de la palette « Commandes… Ctrl K », une ligne d'instrument « Modifier Nom Instrument ».
- États : bascules en `aria-pressed`, menus en `aria-expanded` / `aria-haspopup`, instrument courant en
  `aria-current`, dialogues en `aria-modal`.
- La partition gravée est un seul `role="img"` avec un résumé (titre, parties, mesures). Ce qu'il faut à l'intérieur
  passe par la zone live, ci-dessous.
- Les zones live sont rares et polies : celle de la partition (ci-dessous), la barre d'état (mode de saisie et état de
  sauvegarde seulement), l'état du transport (chargement, erreur, démarrage et arrêt de la lecture), le compteur de la
  bibliothèque, la progression d'export. Rien n'est annoncé pendant la lecture ni à chaque déplacement du curseur.

### Annonces de la partition

Toutes les chaînes existent en français et en anglais (`describe.*`, `notice.*`, `playback.*`).

- Sélectionner ou saisir une note, un accord ou un silence l'annonce : « do5 noire, mesure 3 temps 2 », « do4, mi4,
  sol4 blanche, ... », « silence croche, ... ». La même phrase deux fois de suite est dite deux fois (un élément par
  annonce).
- Aller à une mesure depuis la grille d'accords annonce l'événement sélectionné, ou « Mesure 4, vide ».
- **Décrire la mesure** (`Alt+M`, palette de commandes) : lit la mesure sous la sélection ou le curseur, sur la portée
  et la voix courantes : « Mesure 3 : do5 noire, silence croche, mi5 blanche ». Après 24 événements, elle finit par
  « et N de plus ». Les symboles d'accords n'en font pas partie (ils sont dans la grille d'accords, un tableau nommé).
- Lecture : « Lecture démarrée », « Lecture en pause », « Lecture arrêtée », une fois chacune, rien pendant la lecture.

## Couleur, mouvement, zoom

- Contraste : la règle `color-contrast` d'axe tourne sur tous les états ci-dessus dans les deux thèmes (texte et
  icônes avec texte). Les jetons de `web/src/styles/tokens.css` sont choisis pour AA ; une nouvelle couleur se vérifie
  dans les deux thèmes.
- Jamais par la couleur seule : une note hors tessiture a une marque et une infobulle en plus de la couleur
  d'avertissement ; l'état de sauvegarde a un libellé ; la sélection a une forme de surbrillance, pas seulement une
  teinte. Les anneaux de focus utilisent `--accent` (3:1 ou plus contre la page dans les deux thèmes).
- `prefers-reduced-motion: reduce` : transitions et animations durent 0,01 ms (`app.css`), `scroll-behavior` est forcé
  à `auto`, et le suivi de la lecture défile avec `behavior: 'auto'` (`playback/follow.ts`).
- Zoom à 200 % et reflow à 320 px CSS (WCAG 1.4.10) : la bibliothèque, les dialogues, la confidentialité, le contact
  et le visualiseur partagé n'ont pas de défilement horizontal (testé). **L'éditeur peut défiler horizontalement** à
  cette largeur : la partition gravée et la palette de notes gardent leur taille, et la lecture fait défiler la
  partition à votre place.

## Constats de l'audit (#19)

| Constat                                                                                               | Correction                                                  |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Le nom du bouton de thème ne contenait pas son texte visible                                          | le nom est « Clair : Passer au thème sombre »               |
| Le nom du bouton de palette ne contenait pas « Commandes… »                                           | le nom est son texte visible, l'infobulle dit ce qu'il fait |
| Cartes de la bibliothèque : `aria-label` masquait le texte visible, `h3` après `h1` sautait un niveau | le nom vient du contenu, titres en `h2`                     |
| Le nom d'une ligne d'instrument ne contenait pas l'instrument affiché                                 | le nom finit par l'instrument                               |
| Le bouton Triolet montrait un « 3 » absent de son nom                                                 | le « 3 » est un glyphe dessiné                              |
| La zone défilante de l'aide-mémoire n'était pas atteignable au clavier                                | région focalisable et nommée                                |
| Focus perdu après fermeture du dialogue de suppression du compte (son déclencheur disparaît)          | le focus revient au bouton du compte                        |
| Barres du haut de la bibliothèque, confidentialité, contact, visualiseur débordaient à 320 px         | les barres passent à la ligne                               |
| Aucun moyen de passer la barre d'outils                                                               | liens d'évitement (bibliothèque, éditeur)                   |
| Une annonce identique n'était pas répétée                                                             | un nœud live par annonce                                    |
| Pas d'alternative textuelle pour une mesure                                                           | **Décrire la mesure** (`Alt+M`)                             |
| État de la lecture non annoncé                                                                        | démarrage, pause, arrêt annoncés                            |

## Ce qui reste manuel

Aucun lecteur d'écran n'a été lancé : un passage NVDA, VoiceOver et TalkBack reste utile avant une version, surtout
pour la formulation de la zone live et le champ de saisie des symboles d'accords. Le contraste non textuel de chaque
graphique (WCAG 1.4.11) et la surcharge de l'espacement du texte (1.4.12) ne sont pas automatisés.
