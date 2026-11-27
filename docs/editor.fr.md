# Éditeur

[English](editor.md) · **Français**

Une partition enregistrée s'ouvre sur `#/scores/<id>` depuis la [bibliothèque](library.fr.md), l'accueil de l'utilisateur connecté ; elle est chargée et enregistrée au fil de la saisie (voir [library.fr.md](library.fr.md)). `#/editor` est un éditeur de brouillon jamais enregistré, utilisé par les aperçus, fixtures et tests (routage par hash, sans dépendance de routeur).

## Disposition

| Zone           | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barre du haut  | Lien de retour, bascule des instruments, titre modifiable, état d'enregistrement (`Enregistré`, `Enregistrement…`, `Hors ligne`, `Conflit`, `Non enregistré`, `Connexion requise`), bascule Simple/Avancé, Importer, Partager (dialogue : lien en lecture seule et boutons d'export, `Ctrl+Maj+L`, voir [sharing.fr.md](sharing.fr.md)) et menu Exporter (MusicXML, MXL, MIDI, PDF, PNG ; voir [musicxml.fr.md](musicxml.fr.md) et [export.fr.md](export.fr.md)), thème et langue, bascule de l'inspecteur (mode Avancé uniquement) |
| Panneau gauche | Instruments, repliable. En mode Simple, il indique comment accéder au mode Avancé                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Centre         | La palette de saisie, la partition sur une surface « papier » et la bande de rappel des raccourcis                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Panneau droit  | Inspecteur, repliable, **mode Avancé uniquement**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Barre d'état   | Mode de saisie (`SAISIE` / `SÉLECTION`), durée courante, mesure et temps, niveau d'interface, état d'enregistrement                                                                                                                                                                                                                                                                                                                                                                                                                 |

Le centre contient aussi une **barre de transport** au-dessus de la partition (lecture/pause, arrêt, retour au début, boucle, métronome, tempo) et, en mode Avancé, une console avec couper et isoler par portée dans l'inspecteur ; voir [lecture](playback.fr.md).

Les composants sont dans `web/src/editor/`. La barre d'état est alimentée par le store de l'éditeur (mode, durée, mesure et temps du curseur) et affiche le dernier message.

### Simple et Avancé

Le choix est stocké dans `localStorage` (`polymnia.uiMode` ; les erreurs sont ignorées). Il migrera vers le profil utilisateur avec les comptes. Le mode Simple masque l'inspecteur et les outils avancés.

### Responsive

- 1100 px et plus : les panneaux sont à côté de la partition.
- Sous 1100 px (jusqu'à 768 px) : les panneaux se superposent à la partition, démarrent fermés, ont un bouton de fermeture et se ferment avec `Échap` ou un clic à l'extérieur. En ouvrir un ferme l'autre.

## Raccourcis clavier

| Raccourci                      | Action                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `Ctrl+B` (`Cmd+B` sur macOS)   | Afficher ou masquer le panneau des instruments                                                  |
| `Ctrl+I` (`Cmd+I` sur macOS)   | Afficher ou masquer l'inspecteur (Avancé uniquement)                                            |
| `P`                            | Afficher ou masquer le piano à l'écran                                                          |
| `Alt+A` (`Option+A` sur macOS) | Basculer entre Simple et Avancé                                                                 |
| `Espace`                       | Lecture ou pause (comportement de MuseScore ; un bouton qui a le focus le garde)                |
| `Origine` (`Home`)             | Retour au début de la partition                                                                 |
| `Ctrl+K` (`Cmd+K` sur macOS)   | Ouvrir la palette de commandes (fonctionne aussi dans un champ texte)                           |
| `Alt+F` (`Option+F` sur macOS) | Mode focus                                                                                      |
| `Ctrl+S` (`Cmd+S` sur macOS)   | Enregistrer maintenant (partition enregistrée ; fonctionne aussi dans le titre)                 |
| `Alt+L` (`Option+L` sur macOS) | Retour à la bibliothèque                                                                        |
| `?`                            | Aide-mémoire des raccourcis clavier                                                             |
| `Échap`                        | Quitter le mode focus, sinon fermer le panneau ouvert (écrans étroits), sinon quitter la saisie |

Les raccourcis ne se déclenchent pas pendant la saisie dans un champ texte. Les touches de saisie de notes sont listées dans la section suivante.

### Registre de raccourcis

`web/src/shortcuts/` est l'unique endroit où déclarer les raccourcis, partagé avec la saisie de notes et la palette de commandes.

```ts
useShortcuts([
  {
    id: "editor.toggleInstruments",
    keys: "Mod+B",
    labelKey: "shortcut.toggleInstruments",
    handler,
  },
]);
```

- `keys` : `Mod` vaut `Cmd` sur macOS et `Ctrl` ailleurs ; aussi `Alt`, `Shift` et une touche (`B`, `Escape`, ...). Les lettres suivent la touche physique, donc `Alt+A` fonctionne sur macOS.
- `handler` peut renvoyer `false` pour ne pas toucher à l'événement (pas de `preventDefault`).
- `allowInInput: true` autorise le déclenchement pendant la saisie dans un champ.
- `shortcuts.list()` renvoie tous les raccourcis (pour la palette de commandes et l'aide-mémoire) ; `formatKeys` et `<Kbd>` affichent des libellés adaptés à la plateforme. `shortcuts.run(id)` en exécute un par son id.
- `group` (`input`, `edit`, `navigation`, `view`, `playback`, `file`, `help`) fixe la section dans la palette et l'aide-mémoire ; sans groupe, le raccourci tombe dans « Autres ». Les raccourcis de lecture et de fichier doivent indiquer leur groupe en s'enregistrant.
- `paletteLabelKey` donne un libellé distinct dans la palette quand plusieurs raccourcis partagent un `labelKey` (les cinq durées). `palette: false` / `sheet: false` écartent un raccourci de la palette / de l'aide-mémoire (les 14 touches de notes forment une ligne « A–G » de l'aide-mémoire et aucune commande de palette). `enabled()` fait afficher la commande grisée dans la palette (Annuler sans rien à annuler) ; la touche, elle, atteint toujours le gestionnaire.
- Les touches symboles nommées (`Plus`, `Minus`, `Equal`, `Period`, `Question`) correspondent au caractère produit et ignorent Maj, donc `?` fonctionne en QWERTY (Maj+/) comme en AZERTY (Maj+,).
- Tant qu'un dialogue modal est ouvert (`aria-modal="true"`), le registre ignore le clavier : les touches de notes ne fuient pas derrière la palette.
- Plusieurs raccourcis de même groupe et même libellé forment une seule commande (`Suppr` et `Retour arrière` ; `Ctrl+Y` et `Ctrl+Maj+Z`). Un test vérifie que deux raccourcis ne partagent jamais la même combinaison ; `Ctrl+K` est la palette (MuseScore l'utilise pour les chiffrages d'accords, pas Polymnia).

## Palette de commandes, mode focus, aide-mémoire

Code dans `web/src/editor/commands/` (dialogues) et `web/src/shortcuts/` (`commands.ts`, `search.ts`, `recent.ts`). Un seul chunk chargé à la demande (environ 3 Ko gzip), récupéré en temps d'inactivité après le montage de l'éditeur pour que la première ouverture soit immédiate ; la recherche et les dialogues restent hors du bundle initial.

- **Palette** (`Ctrl+K` / `Cmd+K`, ou le bouton « Commandes… » de la barre du haut). Liste toutes les commandes enregistrées dans le registre, avec leurs touches, sous des titres de groupes ; les commandes récemment utilisées viennent en premier (`localStorage`, clé `polymnia.recentCommands`, 8 entrées, erreurs ignorées). La saisie filtre : sans accents ni casse, tous les mots doivent correspondre, sur les libellés **français et anglais** quelle que soit la langue de l'interface (`silence` et `rest` trouvent tous deux « Saisir un silence »), avec un repli sur une sous-séquence serrée (`rst` trouve `rest`). `↑`/`↓` (et `Début`/`Fin`) déplacent, `Entrée` exécute, `Échap` ou `Ctrl+K` ferme, et le focus revient où il était. Les commandes sans effet dans le contexte courant sont grisées, annoncées comme indisponibles, ignorées par les flèches et non exécutées.
- **Mode focus** (`Alt+F`, ou le bouton de la barre du haut) : masque la barre du haut, les panneaux, la palette de saisie, la bande de raccourcis et la barre d'état ; une petite pastille « Mode focus · Échap pour quitter » reste. `Échap` le quitte (avant toute autre action d'`Échap`). Non persisté.
- **Aide-mémoire** (`?`) : tous les raccourcis du registre par groupe, dans un dialogue ; le bouton Imprimer imprime l'aide-mémoire seul (feuille de style d'impression). `Ctrl+K` depuis l'aide-mémoire ouvre la palette.
- **Accessibilité** : la palette est un combobox ARIA 1.2 (`role="combobox"`, `aria-controls`, `aria-activedescendant`) sur une `listbox` d'`option` dans des `group` nommés, avec un décompte poli des résultats ; les deux dialogues sont `role="dialog"` avec `aria-modal`, un nom, un piège à focus et la restauration du focus ; l'animation est désactivée sous `prefers-reduced-motion` ; tout est disponible en français et en anglais.
- **Performance** (`e2e/command-palette.spec.ts`) : ouverture sous 50 ms et frappe sous 5 ms avec le registre complet (environ 5 ms et 0,4 ms mesurées dans Chromium).

## Saisie de notes

Les touches sont celles par défaut de MuseScore 4 (`Cmd` remplace `Ctrl` sur macOS). Elles sont déclarées une seule fois dans `web/src/editor/entry/entryShortcuts.ts` et enregistrées dans le registre de raccourcis ; la palette au-dessus de la partition les reprend, avec la touche dans chaque infobulle.

| Action                                                          | Touche                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Activer ou quitter la saisie de notes (`Échap` la quitte aussi) | `N`                                                                                                    |
| Durée double croche / croche / noire / blanche / ronde          | `3` / `4` / `5` / `6` / `7` (`1`, `2`, `8`, `9` sont réservées : elles affichent seulement un message) |
| Point de prolongation                                           | `.`                                                                                                    |
| Silence                                                         | `0`                                                                                                    |
| Saisir une note                                                 | `A`–`G`                                                                                                |
| Ajouter une note à l'accord                                     | `Shift+A`–`Shift+G`                                                                                    |
| Dièse / bémol / bécarre                                         | `+` / `-` / `=`                                                                                        |
| Hauteur d'un demi-ton vers le haut / bas                        | `↑` / `↓`                                                                                              |
| Hauteur d'une octave vers le haut / bas                         | `Ctrl+↑` / `Ctrl+↓`                                                                                    |
| Liaison de prolongation                                         | `T`                                                                                                    |
| Liaison de phrasé                                               | `S`                                                                                                    |
| Triolet                                                         | `Ctrl+3`                                                                                               |
| Déplacer le curseur ou la sélection                             | `←` / `→`                                                                                              |
| Étendre la sélection                                            | `Shift+←` / `Shift+→`                                                                                  |
| Supprimer (devient des silences)                                | `Suppr` ou `Retour arrière`                                                                            |
| Copier / coller                                                 | `Ctrl+C` / `Ctrl+V`                                                                                    |
| Annuler / rétablir                                              | `Ctrl+Z` / `Ctrl+Y` ou `Ctrl+Shift+Z`                                                                  |

### Comportement

- **L'état** vit dans `EditorStore` (`web/src/editor/entry/editorStore.ts`, une classe simple lue avec `useSyncExternalStore`) : partition via `History`, sélection, mode de saisie, durée courante, voix et portée, curseur de saisie. L'éditeur s'ouvre sur une nouvelle partition de piano (4/4, do majeur, 8 mesures) ; `#/editor?new=<n>` fixe le nombre de mesures et `#/editor?fixture=<nom>` affiche une fixture de gravure.
- **Chaque modification est une commande du modèle** exécutée via `History` : annuler et rétablir sont exacts (le curseur et la sélection reviennent aussi). Une modification en plusieurs étapes (une note qui franchit une barre de mesure, un collage) est une seule étape d'annulation.
- **Saisir une note** écrit au curseur en écrasant ce qui s'y trouve (le temps restant devient des silences), puis le curseur avance. Quand la dernière mesure est pleine, une mesure est ajoutée. Une note plus longue que la place restante est coupée en notes liées de part et d'autre de la barre.
- **Hauteur** : la lettre choisit l'octave la plus proche de la note précédente, selon la position sur la portée (une quarte vers le haut l'emporte sur une quinte vers le bas) ; la première note est proche de la ligne centrale de la clef. L'altération vient de l'armure et des altérations déjà écrites plus tôt dans la mesure. `+`, `-`, `=` arment une altération pour la note suivante (une seconde pression l'annule) ; en sélection, elles modifient les notes sélectionnées. En sélection, une lettre déplace les notes sélectionnées sur cette lettre.
- **Flèches haut/bas** transposent la sélection (ou, en saisie, la note qui vient d'être saisie). **`T`** lie les notes sélectionnées à la note suivante de même hauteur ; en saisie, elle lie la note qui vient d'être saisie à la suivante si elle a la même hauteur. **`S`** ajoute une liaison de phrasé entre la première et la dernière note de la sélection (une seule note : jusqu'à la suivante) ; en saisie, elle démarre une liaison qui finit sur la prochaine note saisie. **`Ctrl+3`** transforme l'événement sous le curseur (ou la sélection) en triolet 3:2 ; la durée devient la valeur du triolet.
- **Souris** : cliquer une note la sélectionne (`Shift` étend une plage). En saisie, cliquer sur une ligne ou un interligne de la portée saisit une note à cette hauteur et à cette position (le `hitTest` de la gravure renvoie la hauteur naturelle et le tick de la colonne la plus proche ; l'armure est appliquée par le code de saisie).
- **Sélection** : une plage est une suite d'événements d'une portée et d'une voix. `Ctrl+C` la copie dans un presse-papiers interne (rien n'est écrit dans le presse-papiers système ; les triolets ne sont pas encore copiables) ; `Ctrl+V` colle au curseur en écrasant, continue dans les mesures suivantes et ajoute des mesures si besoin. Un événement qui franchirait une barre de mesure est refusé.
- **Point d'accroche du son** : `store.onNoteEntered?.(pitch)` est appelé pour chaque note saisie (le retour sonore est une fonctionnalité à part).
- **Accessibilité** : la note saisie ou sélectionnée est annoncée par la région live de la partition (« do5 noire, mesure 3 temps 2 »), et les courts messages (« Pas assez de place dans la mesure. ») apparaissent aussi dans la barre d'état.

### Crochet de test

`window.__polymnia` contient `{ engraver, score, width, store }` (posé une fois les systèmes dessinés ; `store.getState()` est l'état courant). Les tests Playwright l'utilisent.

## Accords

Les accords (`C`, `Am7`, `G/B`, `F#m7b5`...) se placent au-dessus de la portée, et les parties de guitare et d'ukulélé peuvent afficher avec eux un **diagramme de manche**. Le modèle est dans [score-format.fr.md](score-format.fr.md#accords), le dessin dans [engraving.fr.md](engraving.fr.md#accords-et-diagrammes-de-manche), MusicXML dans [musicxml.fr.md](musicxml.fr.md#accords), le son dans [playback.fr.md](playback.fr.md#lecture-des-accords). Code : `web/src/editor/ChordEntry.tsx` (le champ), `EditorStore` (`openChordEntry`, `commitChord`, `moveChordEntry`...), `web/src/score/chords.ts` (l'analyseur).

| Touche (dans le champ) | Action                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| `Alt+K` (`Option+K`)   | Ouvre le champ au curseur (un accord déjà présent est modifié)            |
| `Espace`, `Maj+Espace` | Écrit, puis passe au temps suivant, précédent (comportement de MuseScore) |
| `Tab`, `Maj+Tab`       | Écrit, puis passe au premier temps de la mesure suivante, précédente      |
| `Entrée`               | Écrit et ferme                                                            |
| `Échap`                | Ferme sans écrire                                                         |
| clic sur un accord     | Ouvre le champ dessus                                                     |
| champ vide             | Supprime l'accord (à `Entrée`, `Espace` ou `Tab`)                         |

`Ctrl+K` est la palette de commandes ici : la saisie d'accords est donc sur **`Alt+K`** (K comme la touche d'accords de MuseScore ; `Alt+K` est libre dans le registre de raccourcis et fonctionne même si une case à cocher du panneau des instruments a le focus). Le champ apparaît sur la partition à l'endroit où l'accord sera dessiné ; le focus revient à la partition quand il se ferme.

- **Ce qu'on peut taper.** Les lettres `A` à `G` (majuscules ou minuscules), `#` et `b` ou `♯` et `♭`, les doubles altérations (`##`, `bb`, `x`), et les écritures usuelles des qualités : `m`, `min`, `-`, `maj7`, `M7`, `Δ7`, `^7`, `7`, `6`, `69` ou `6/9`, `9`, `11`, `13`, `dim`, `°`, `o7`, `ø`, `m7b5`, `aug`, `+`, `sus`, `sus2`, `sus4`, `7sus4`, `add9`, `5`, les altérations `b5 #5 b9 #9 #11 b13` (avec ou sans parenthèses), et une basse après `/` (`G/B`, `Am7/G`). Tout est **normalisé** : `CM7`, `C^7` et `Cmaj7` sont enregistrés et affichés `Cmaj7`. Un texte qui n'est pas un accord garde le champ ouvert (bordure rouge, annoncé) et rien n'est écrit.
- **Noms de notes français** acceptés en saisie : `Do`, `Ré` (ou `Re`), `Mi`, `Fa`, `Sol`, `La`, `Si`, avec `#` et `b` (`Sib`, `Fa#m7b5`, `Rém7`, `Sol/Si`), en majuscules ou minuscules. `Do` est toujours lu comme la note do (tapez `Ddim` pour ré diminué). La saisie ne dépend jamais du réglage d'affichage : les deux écritures sont toujours lues.
- **Affichage des noms d'accords (#63).** Lettres anglaises (`C D E`, par défaut) ou noms français (`Do Ré Mi`) : `Dm7` s'affiche `Rém7`, `G/B` `Sol/Si`, `F#m` `Fa♯m` (dièses et bémols restent des glyphes Bravura). C'est une préférence de l'utilisateur, pas de la partition : l'inspecteur (mode Avancé) a un champ « Noms d'accords » à deux boutons, et la commande de palette « Basculer les noms d'accords entre C D E et Do Ré Mi » (sans touche) marche aussi en mode Simple. Elle est conservée dans le navigateur (`localStorage`, clé `polymnia.chordNaming`, comme le format de papier et le mode Simple/Avancé ; elle passera dans le profil avec les autres préférences d'interface) et vaut partout où un accord est dessiné : l'éditeur, la vue partagée, l'export PDF et PNG, le texte du champ de saisie (son aide montre comment le texte a été compris, par exemple « Affiché Rém7 » pour `Dm7`), les annonces et l'attribut `data-chord`. **MusicXML n'est pas touché** : `<harmony>` a toujours des fondamentales anglaises (`root-step` `D`). Le changement redessine une partition de 100 mesures et 240 accords en 65 à 125 ms environ, de la touche de palette aux nouveaux symboles (`web/e2e/chords.spec.ts`).
- **Où.** Un accord appartient à la première portée de la partie (la portée standard d'une partie « standard + TAB ») à une position de la mesure, en ticks. `Espace` avance du temps de la signature rythmique (une noire pointée en 6/8, 9/8, 12/8) ; un accord peut se trouver n'importe où, pas seulement sur une note : un accord entre deux notes a sa propre colonne.
- **Annuler.** Chaque accord écrit, remplacé ou supprimé est une étape d'annulation.
- **Transposition.** La palette propose « Accords : transposer les symboles d'un demi-ton vers le haut / le bas », qui transposent tous les accords de la partie courante avec la bonne orthographe : `C` +3 demi-tons donne `Eb`, `Am` +1 donne `Bbm`, `F#m7b5` +1 donne `Gm7b5` ; dièses ou bémols suivent l'armure de la mesure quand elle a des altérations (`C` +1 en ré majeur donne `C#`), sinon les noms d'accords usuels (Db, Eb, F#, Ab, Bb ; C#m, F#m, G#m mais Bbm, Ebm) ; une basse suit sa fondamentale. Les notes ne sont **pas** modifiées : les accords nomment des hauteurs réelles (sonores), donc transposer des notes, changer d'instrument ou sa transposition ne les change jamais, et une modification de note ne change jamais un accord.
- **Diagrammes et capodastre** (panneau des instruments, parties à cordes). « Diagrammes de manche » : aucun, à la première apparition de chaque accord, ou pour chaque accord (choix de la partie) ; la commande de palette « Accords : afficher ou masquer le diagramme de l'accord au curseur » en force ou en masque un. Avec un **capodastre**, l'accord est celui qui sonne et le diagramme est la forme à jouer, comptée depuis le capodastre : capo en case 2, `D` montre la forme de `C`. « Avec un capodastre, afficher aussi la forme à jouer » l'écrit à côté de l'accord : `D (C)`. Les deux sont des choix de la partie, enregistrés dans la partition.
- **Autres commandes.** « Accords : supprimer l'accord au curseur » (palette).
- **La lecture** des accords est une option du mixeur (mode Avancé), muette par défaut : voir [playback.fr.md](playback.fr.md#lecture-des-accords).

Accessibilité : le champ est une saisie de texte étiquetée (« Accord, mesure 3, temps 2 ») décrite par ses touches, `aria-invalid` sur un texte qui n'est pas un accord, anneau de focus visible dans les deux thèmes, et les notifications (« Accord Am7. », « Accord supprimé. ») passent par la région live polie. Le texte de l'accord est aussi dans `data-chord` sur chaque symbole du SVG, pour les tests (les accords ne sont pas encore lus un à un par les lecteurs d'écran : la partition est une image avec un résumé, comme pour les notes).

L'état du champ est `store.getState().chordEntry` (`{ staffId, measure, tick }` ou `null`), utilisé aussi par les tests Playwright (`e2e/chords.spec.ts`).

### Vue grille d'accords (#60)

Une vue compacte, façon lead sheet, pour les musiciens qui n'ont besoin que des accords : le papier montre une grille de mesures avec leurs symboles d'accords à la place de la partition gravée. Code : `web/src/chords/` (`sheet.ts` le modèle, `ChordSheet.tsx` la vue, `sheetDiagram.ts` la géométrie des diagrammes), `web/src/export/sheetPages.ts` (impression). C'est un chunk paresseux, chargé la première fois que la vue est choisie (bundle initial inchangé).

- **Basculer.** Les boutons **Partition / Grille d'accords** de la barre du haut (un groupe nommé « Affichage »), la touche `Alt+V`, ou la commande de palette « Basculer entre la partition et la grille d'accords » (groupe « Affichage »). Le visualiseur partagé a les mêmes boutons (lecture seule). La vue n'est pas mémorisée : une page s'ouvre sur la partition. Tant que la grille est affichée, la palette de notes, la bande de raccourcis et le champ de saisie d'accord sont masqués (la partition gravée n'est pas dessinée) ; le panneau des instruments, l'inspecteur, la lecture et le piano restent.
- **La grille.** Un vrai tableau : **quatre mesures par ligne**, un en-tête de ligne avec le numéro de la première mesure, chaque mesure est une cellule avec son numéro dans le coin. Les accords viennent de toutes les parties et portées (un symbole par position ; la première partie l'emporte en cas d'égalité). Une mesure avec **plusieurs accords** montre chacun avec son **temps** dessous (`1`, `3`, `2.5` pour un contretemps ; le temps est le dénominateur de la signature rythmique, donc `3/8` compte des croches). Une mesure sans accord est une cellule vide (qui reste cliquable).
- **Signe de répétition `%`.** Une mesure affiche `%` quand elle contient exactement les mêmes accords aux mêmes temps que la précédente, **ou** quand c'est un seul accord au temps 1 qui est déjà en train de sonner (le dernier accord avant elle, même après des mesures vides). La première mesure n'est jamais un `%`. L'étiquette lue par un lecteur d'écran le dit : « Mesure 2 : comme la mesure précédente, C ».
- **Diagrammes.** Sous la grille, le diagramme de chaque accord utilisé (une fois chacun, dans l'ordre d'apparition) pour **une partie à cordes** : un sélecteur « Instrument » apparaît quand la partition en a plusieurs (guitare et ukulélé, par exemple), une seule partie est simplement nommée. Les formes viennent de la même bibliothèque d'accords que la partition (`lookupShape`) avec l'**accordage et le capodastre** de la partie (un `<frame>` importé de MusicXML l'emporte) ; avec « afficher aussi la forme à jouer » sur une partie à capodastre, la légende est `D (C)`. Une partition sans partie à cordes (piano...) n'a pas de section de diagrammes. La bibliothèque est un chunk paresseux à part, chargé avec la section.
- **Noms.** La grille suit l'option de nom des accords (`C D E` ou `Do Ré Mi`, voir plus haut), en direct. Le texte est simple (`F#m7b5`, pas de glyphes Bravura).
- **Clic.** Choisir une mesure ramène à la partition à cette mesure : la première note ou le premier silence de la mesure sur la portée courante est sélectionné (une mesure vide reçoit le curseur) et la partition défile jusqu'à son système. Dans le visualiseur partagé, elle ne fait que défiler.
- **Export.** Tant que la grille est affichée, le menu Exporter commence par **Grille d'accords (PDF)** et **Grille d'accords (PNG)** (aussi des commandes de palette, sans touche ; actives dans cette vue seulement). Les autres éléments exportent toujours la partition. Le PDF et le PNG impriment la grille et les diagrammes de la partie choisie dans le sélecteur : voir [export.fr.md](export.fr.md#grille-daccords).
- **Accessibilité.** La grille est un `<table>` avec une légende masquée (« Grille d'accords, 12 mesures. Choisissez une mesure pour l'ouvrir dans la partition. »), un en-tête par ligne et un bouton par cellule étiqueté « Mesure 3 : Am7 au temps 1, G au temps 3 ». Les diagrammes sont des images étiquetées « C, cases 0 1 0 2 3 x » (corde aiguë d'abord, `x` pour muette). Anneau de focus visible et deux thèmes (les couleurs viennent des jetons du papier). Les textes français et anglais sont dans `web/src/i18n/chords.*.ts`.
- **Tests.** Unitaires : `sheet.test.ts` (grille, répétitions, plusieurs accords, temps, lignes, diagrammes, capodastre), `ChordSheet.test.tsx` (tableau, étiquettes, clic, noms, sélecteur de partie), `EditorLayout.test.tsx` (bascule, `Alt+V`, menu d'export, clic), `editorStore.test.ts` (`goToMeasure`), `export/sheetPages.test.ts`. Playwright `e2e/chord-sheet.spec.ts` (bascule, clic et défilement, PDF et PNG de la grille, noms français, visualiseur partagé) et les références visuelles `e2e/visual/chord-sheet.visual.spec.ts`.

## Parties, instruments et mesures

Chaque modification ci-dessous est une commande du modèle de partition exécutée via `History` (annuler et rétablir exacts, une étape par action). L'interface est dans `web/src/editor/InstrumentsPanel.tsx` (panneau gauche), `Inspector.tsx` (panneau droit, mode Avancé) et `entry/structureShortcuts.ts` (commandes de la palette).

### Panneau des instruments (gauche)

- **Parties.** Une ligne par partie : nom et instrument (en français ou en anglais selon la langue de l'interface). Cliquer une ligne édite cette partie (sa première portée devient la portée de saisie, la sélection est effacée). Réordonner avec les boutons fléchés, avec `Alt+↑` / `Alt+↓` sur une ligne ayant le focus, ou par glisser-déposer. Le bouton de suppression demande une confirmation dans la ligne ; la dernière partie ne peut pas être supprimée.
- **Ajouter un instrument.** Un sélecteur avec recherche, groupé par famille (guitares et ukulélés, cordes frottées, clavier, voix, bois). La recherche porte sur les noms français et anglais, accents ignorés (« violoncelle » trouve le cello). La palette de commandes propose aussi « Ajouter un instrument… ».
- **Réglages de la partie sélectionnée.** Renommer ; changer d'instrument ; pour les guitares et ukulélés, la notation (`Portée + tablature`, `Tablature seule`, `Portée seule`), l'accordage et le capodastre.
- **Changer d'instrument** conserve la **hauteur réelle** de chaque note : les notes stockent la hauteur écrite, elles se déplacent donc de la différence des deux transpositions (guitare vers ukulélé : une octave plus bas sur la portée). La clé devient celle par défaut du nouvel instrument si l'ancienne n'est pas permise (les changements de clé non listés sont retirés). Passer au piano ajoute une portée de basse vide ; quitter le piano exige une seconde portée vide (sinon refus avec un message). L'accordage et le capodastre reviennent aux valeurs par défaut du nouvel instrument et les cases sont recalculées. Le nom de la partie suit l'instrument sauf si vous l'avez renommée.
- **Accordages prédéfinis.** Guitare : standard, drop D, DADGAD, sol ouvert, ré ouvert, demi-ton plus bas, ton plus bas. Ukulélé : standard re-entrant GCEA, sol grave, baryton DGBE, accordage en ré. **Personnalisé…** permet de saisir un nom de note par corde (`E2`, `F#3`, `Bb3`). Les notes gardent leur hauteur ; les cases sont recalculées. La tessiture de l'instrument descend jusqu'à la corde la plus grave d'un accordage personnalisé (le drop D autorise un ré 2).
- **Capodastre.** Case 1 à 12 (sous le nombre de cases). Les cases sont recalculées pour que la hauteur réelle ne change pas.
- **Notation des instruments à frettes.** `Portée + tablature` ajoute une portée de tablature construite à partir de la portée (cases déduites : case la plus basse, corde conservée si possible). La tablature **suit les notes** de la portée éditée : après chaque modification, l'autre portée de la partie est reconstruite à partir d'elle (même étape d'annulation, identifiants d'événements réutilisés position par position) ; elle n'est pas jouée deux fois (la lecture et la table de mixage l'ignorent). `Tablature seule` convertit la portée sur place et déduit les cases. Les cases sont choisies par l'algorithme de doigté (voir plus bas) et ne bougent pas quand on modifie d'autres notes ; la case à cocher « Afficher les silences sur la tablature » dessine les silences de la tablature (masqués par défaut). L'édition de la tablature elle-même est décrite dans « Saisie en tablature ».

### Saisie en tablature

Sélectionnez une portée de tablature (clic dessus) et passez en saisie de notes (`N`). Le curseur a maintenant une **corde** (annoncée par « Corde n. » ; la souris la fixe : cliquez sur une position de corde).

| Touche                           | Sur une tablature                                                                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`–`9`                          | la **case** sur la corde courante : écrit une note de la durée courante et avance. `0` est la corde à vide. Un second chiffre en moins de 500 ms fait une seule case (`1` puis `2` = case 12 ; `5` puis `3` restent deux notes, la case 53 n'existe pas) |
| `↑` / `↓`                        | déplacent la corde de saisie (`↑` = vers la première corde, la plus aiguë). En mode sélection elles montent ou descendent toujours la sélection d'un demi-ton (la case est redéduite)                                                                    |
| `Alt+↑` / `Alt+↓`                | passent la note sélectionnée (ou la dernière saisie) sur la corde voisine en gardant sa hauteur (la case change) ; le nouveau doigté est le vôtre                                                                                                        |
| `Shift+3` … `Shift+7`            | durées (double croche à ronde), car les chiffres seuls sont des cases ici ; `Shift+0` saisit un silence (`0` est la corde à vide). Sur les autres portées `3`–`7` et `0` gardent leur sens habituel                                                      |
| `Suppr`, `T`, `S`, `.`, `Ctrl+Z` | comme partout (une liaison est dessinée comme un arc sur la tablature)                                                                                                                                                                                   |

En mode sélection un chiffre fixe la case de la note sélectionnée sur sa propre corde. La portée standard d'une partie `Portée + tablature` suit aussitôt (hauteur écrite déduite de corde + case + capodastre + transposition, même étape d'annulation) ; une note saisie sur une portée standard reçoit une case déduite sur la tablature. Commandes de palette : corde de saisie plus haut / plus bas, doigté automatique de la sélection (rend les cases manuelles à l'algorithme), afficher ou masquer les silences de cette portée, passer sur la corde du dessus / du dessous. Une case que vous tapez ou changez de corde est un **doigté manuel** : le doigté automatique ne la change jamais (un changement d'accordage ou de capodastre la garde tant qu'elle sonne la bonne note). Sur clavier AZERTY, utilisez les touches de chiffres sans Maj pour les cases (les touches sont reconnues par position) et `Maj` + chiffre pour les durées.

Une note qu'aucune corde ne peut jouer (sous la corde la plus grave, au-delà de la dernière case, sous un capodastre) montre `?` sur la tablature avec la couleur et la marque d'avertissement des notes hors tessiture, une infobulle (« Aucune corde ne peut jouer cette note sur ... ») et une ligne dans l'inspecteur.

### Inspecteur (droite, mode Avancé)

Il agit sur la mesure sous le curseur (le curseur suit la sélection et la saisie) :

| Contrôle                                                     | Effet                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Armure                                                       | `setKeySignature` à partir de cette mesure (hauteurs inchangées)                                                                     |
| Chiffrage + « Mesure d'anacrouse »                           | `setTimeSignature` ; une anacrouse est une mesure plus courte que la mesure complète (`MeasureInfo.length`, en temps)                |
| Tempo                                                        | `setTempo` (20 à 400, noires par minute) à partir de cette mesure, « Retirer le changement » l'annule                                |
| Clé à partir de cette mesure                                 | `setClef` sur la portée éditée, limité aux clés de son instrument : violoncelle fa / ut ténor / sol, guitare sol 8vb, piano sol / fa |
| Insérer avant / après, Ajouter à la fin, Supprimer la mesure | `insertMeasure` / `deleteMeasure` sur toutes les portées                                                                             |
| Hors tessiture                                               | la liste des notes hors tessiture avec un message en texte                                                                           |

Les changements de clé s'appliquent au **début d'une mesure** ; les changements de clé en milieu de mesure ne sont pas encore dans le modèle.

### Commandes de palette et touches

Les commandes sans touche sont réservées à la palette (`shortcut.keys` vide) : elles apparaissent dans `Ctrl+K` et pas dans l'aide-mémoire. Touches : `Insert` insère une mesure avant la mesure courante, `Ctrl+Insert` ajoute une mesure à la fin, `Ctrl+Suppr` supprime la mesure courante (`Ctrl+B` reste le panneau des instruments). Commandes de palette : insérer après, armure (un dièse de plus, un bémol de plus, aucune), chiffrage (2/4, 3/4, 4/4, 6/8), changement de tempo ici (10 de plus, 10 de moins, retirer), clé à partir de cette mesure (sol, fa, ut ténor, ut alto, sol 8vb ; grisée si déjà en vigueur ou sur une tablature), ajouter un instrument.

### Notes hors tessiture

Une note hors de la tessiture de l'instrument de sa partie (tessiture réelle, étendue par un accordage personnalisé) est dessinée en couleur d'avertissement (`--warn`), avec un **triangle** au-dessus (pas seulement de la couleur) dont l'infobulle indique « Hors tessiture pour <instrument> (<bas> à <haut>) », et listée dans l'inspecteur. C'est un avertissement : rien n'est bloqué. Les couleurs de sélection et de lecture l'emportent sur celle de l'avertissement.

## Piano à l'écran et clavier MIDI

Code dans `web/src/editor/piano/` (`Piano.tsx`, `midi.ts`), un chunk chargé à la demande la première fois que le piano s'ouvre (il n'est pas dans le bundle initial). `P` (ou la commande « Afficher ou masquer le piano à l'écran » de la palette) l'affiche ou le masque ; le choix est gardé dans `localStorage` (`polymnia.piano`, échecs ignorés). Il se place sous la partition et disparaît en mode focus.

- **Touches** : 88 touches (La0 à Do8) dans un défilement horizontal, ouvertes autour de la ligne du milieu de la clé de la portée courante (sol : si4, fa : ré3, ...) et recentrées quand on change de portée. Chaque touche est un bouton nommé d'après la note dans la langue de l'interface (« Do4 » / « C4 », « Do dièse 4 » / « C sharp 4 ») ; `←` / `→` / `Début` / `Fin` passent d'une touche à l'autre (un seul arrêt de tabulation), `Entrée` ou `Espace` joue la touche.
- **Clic, toucher ou `Entrée`** : en saisie de notes, la note est saisie à la durée courante, comme avec `A`–`G` ; `Maj` l'ajoute à l'accord de la note qui vient d'être saisie. En sélection, les notes sélectionnées prennent cette hauteur (`Maj` : la hauteur leur est ajoutée). S'il n'y a rien à changer, la touche joue seulement la note. Chaque note saisie est entendue via `onNoteEntered`.
- **Enharmonie** : la hauteur est écrite d'après l'armure à la position du curseur (`midiToPitch`) : les notes de la tonalité gardent leur écriture (si bémol en fa majeur), les autres touches noires sont des dièses en do majeur et dans les tonalités à dièses, des bémols dans les tonalités à bémols (ré bémol en si bémol majeur). Les notes saisies ainsi n'utilisent pas l'altération armée (`+`, `-`, `=`).
- **Parties transpositrices (hauteur réelle)** : le piano est un clavier de hauteurs **réelles** (sonores). Cliquer une touche, ou jouer une note MIDI, saisit la hauteur écrite qui sonne comme cette touche (`midi - transposition de la partie`, épelée d'après l'armure) : à la guitare classique, Do4 saisit un Do5 écrit ; à la clarinette en Si bémol, Do4 saisit un Ré4 écrit. Les touches allumées montrent aussi la hauteur réelle (un Do5 écrit à la guitare allume Do4, en sélection, en saisie et en lecture). Les parties qui ne transposent pas (piano) ne changent pas.
- **Touches allumées** : les notes sélectionnées (ou, en saisie, la note qui vient d'être saisie) sont allumées à la couleur d'accent, les notes qui sonnent pendant la lecture à la couleur de lecture. Les deux se font par basculement de classes hors de React (les boutons ne sont rendus qu'une fois, et de nouveau seulement si l'armure ou la langue change) : la lecture ne redessine donc pas le piano ; un test Playwright vérifie que le DOM des touches ne voit que des changements de classe. Fermé, le piano ne fait aucun travail.
- **Clavier MIDI** : le bouton « Connecter un clavier MIDI » de l'en-tête du piano est le seul endroit qui appelle `navigator.requestMIDIAccess` (jamais au chargement), avec `sysex: false`. Une fois connecté, les note-on saisissent des notes à la durée courante en saisie de notes, ou changent les notes sélectionnées en sélection. Les notes jouées dans les 50 ms de la première d'un groupe sont ajoutées à son accord (la première note est saisie tout de suite, sans délai). Plusieurs appareils : un sélecteur (« Tous les appareils » par défaut). Le branchement à chaud est géré : les appareils qui apparaissent ou disparaissent mettent la liste à jour, et un appareil choisi qui disparaît renvoie à tous les appareils. L'entrée MIDI reste active quand le piano est masqué. **La pédale de sustain, la vélocité, le pitch bend et les note-off sont ignorés en V1** (un note-on de vélocité 0 compte comme un note-off) ; le running status et les octets temps réel sont lus.
- **Repli** : sans Web MIDI (Safari n'en a pas ; Firefox demande son module d'autorisation de site), le bouton est remplacé par une explication, et une autorisation refusée ou un échec affiche un message avec un bouton pour réessayer. Le piano à l'écran fonctionne dans tous les cas. L'API envoie `Permissions-Policy: midi=(self)` : le Web MIDI est donc autorisé pour l'origine de l'application.
- **Accessibilité** : touches = boutons nommés avec un anneau de focus visible, contraste AA dans les deux thèmes (les touches blanches gardent un aspect de piano ; les touches allumées utilisent les jetons d'accent et de lecture), transitions seulement si le mouvement est autorisé, messages de connexion dans une zone live polie.

## Accessibilité

Repères (`header`, `aside`, `main`, barre d'état), focus visible, `aria-label` sur les boutons-icônes, `aria-expanded` sur les bascules de panneaux, `aria-pressed` sur les bascules, annonces polies pour le mode de saisie, l'enregistrement et la note saisie ou sélectionnée (via la région live de la partition), et `prefers-reduced-motion` respecté.
