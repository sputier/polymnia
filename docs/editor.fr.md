# Éditeur

[English](editor.md) · **Français**

L'éditeur est à l'adresse `#/editor` (routage par hash, sans dépendance de routeur). La page d'accueil y mène.

## Disposition

| Zone           | Rôle                                                                                                                                                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barre du haut  | Lien de retour, bascule des instruments, titre modifiable, état d'enregistrement (`Enregistré`, `Enregistrement…`, `Hors ligne`), bascule Simple/Avancé, Importer, Partager (maquette) et menu Exporter (MusicXML, MXL, MIDI, PDF, PNG ; voir [musicxml.fr.md](musicxml.fr.md) et [export.fr.md](export.fr.md)), thème et langue, bascule de l'inspecteur (mode Avancé uniquement) |
| Panneau gauche | Instruments, repliable. En mode Simple, il indique comment accéder au mode Avancé                                                                                                                                                                                                                                                  |
| Centre         | La palette de saisie, la partition sur une surface « papier » et la bande de rappel des raccourcis                                                                                                                                                                                                                                 |
| Panneau droit  | Inspecteur, repliable, **mode Avancé uniquement**                                                                                                                                                                                                                                                                                  |
| Barre d'état   | Mode de saisie (`SAISIE` / `SÉLECTION`), durée courante, mesure et temps, niveau d'interface, état d'enregistrement                                                                                                                                                                                                                |

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
| `Alt+A` (`Option+A` sur macOS) | Basculer entre Simple et Avancé                                                                 |
| `Espace`                       | Lecture ou pause (comportement de MuseScore ; un bouton qui a le focus le garde)                |
| `Origine` (`Home`)             | Retour au début de la partition                                                                 |
| `Ctrl+K` (`Cmd+K` sur macOS)   | Ouvrir la palette de commandes (fonctionne aussi dans un champ texte)                           |
| `Alt+F` (`Option+F` sur macOS) | Mode focus                                                                                      |
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

## Accessibilité

Repères (`header`, `aside`, `main`, barre d'état), focus visible, `aria-label` sur les boutons-icônes, `aria-expanded` sur les bascules de panneaux, `aria-pressed` sur les bascules, annonces polies pour le mode de saisie, l'enregistrement et la note saisie ou sélectionnée (via la région live de la partition), et `prefers-reduced-motion` respecté.
