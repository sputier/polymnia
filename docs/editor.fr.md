# Éditeur

[English](editor.md) · **Français**

Une partition enregistrée s'ouvre sur `#/scores/<id>` depuis la [bibliothèque](library.fr.md), l'accueil de l'utilisateur connecté ; elle est chargée et enregistrée au fil de la saisie (voir [library.fr.md](library.fr.md)). `#/editor` est un éditeur de brouillon jamais enregistré, utilisé par les aperçus, fixtures et tests (routage par hash, sans dépendance de routeur).

## Disposition

| Zone           | Rôle                                                                                                                                                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barre du haut  | Lien de retour, bascule des instruments, titre modifiable, état d'enregistrement (`Enregistré`, `Enregistrement…`, `Hors ligne`, `Conflit`, `Non enregistré`, `Connexion requise`), bascule Simple/Avancé, Importer, Partager (dialogue : lien en lecture seule et boutons d'export, `Ctrl+Maj+L`, voir [sharing.fr.md](sharing.fr.md)) et menu Exporter (MusicXML, MXL, MIDI, PDF, PNG ; voir [musicxml.fr.md](musicxml.fr.md) et [export.fr.md](export.fr.md)), thème et langue, bascule de l'inspecteur (mode Avancé uniquement) |
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

## Parties, instruments et mesures

Chaque modification ci-dessous est une commande du modèle de partition exécutée via `History` (annuler et rétablir exacts, une étape par action). L'interface est dans `web/src/editor/InstrumentsPanel.tsx` (panneau gauche), `Inspector.tsx` (panneau droit, mode Avancé) et `entry/structureShortcuts.ts` (commandes de la palette).

### Panneau des instruments (gauche)

- **Parties.** Une ligne par partie : nom et instrument (en français ou en anglais selon la langue de l'interface). Cliquer une ligne édite cette partie (sa première portée devient la portée de saisie, la sélection est effacée). Réordonner avec les boutons fléchés, avec `Alt+↑` / `Alt+↓` sur une ligne ayant le focus, ou par glisser-déposer. Le bouton de suppression demande une confirmation dans la ligne ; la dernière partie ne peut pas être supprimée.
- **Ajouter un instrument.** Un sélecteur avec recherche, groupé par famille (guitares et ukulélés, cordes frottées, clavier, voix, bois). La recherche porte sur les noms français et anglais, accents ignorés (« violoncelle » trouve le cello). La palette de commandes propose aussi « Ajouter un instrument… ».
- **Réglages de la partie sélectionnée.** Renommer ; changer d'instrument ; pour les guitares et ukulélés, la notation (`Portée + tablature`, `Tablature seule`, `Portée seule`), l'accordage et le capodastre.
- **Changer d'instrument** conserve la **hauteur réelle** de chaque note : les notes stockent la hauteur écrite, elles se déplacent donc de la différence des deux transpositions (guitare vers ukulélé : une octave plus bas sur la portée). La clé devient celle par défaut du nouvel instrument si l'ancienne n'est pas permise (les changements de clé non listés sont retirés). Passer au piano ajoute une portée de basse vide ; quitter le piano exige une seconde portée vide (sinon refus avec un message). L'accordage et le capodastre reviennent aux valeurs par défaut du nouvel instrument et les cases sont recalculées. Le nom de la partie suit l'instrument sauf si vous l'avez renommée.
- **Accordages prédéfinis.** Guitare : standard, drop D, DADGAD, sol ouvert, ré ouvert, demi-ton plus bas, ton plus bas. Ukulélé : standard re-entrant GCEA, sol grave, baryton DGBE, accordage en ré. **Personnalisé…** permet de saisir un nom de note par corde (`E2`, `F#3`, `Bb3`). Les notes gardent leur hauteur ; les cases sont recalculées. La tessiture de l'instrument descend jusqu'à la corde la plus grave d'un accordage personnalisé (le drop D autorise un ré 2).
- **Capodastre.** Case 1 à 12 (sous le nombre de cases). Les cases sont recalculées pour que la hauteur réelle ne change pas.
- **Notation des instruments à frettes.** `Portée + tablature` ajoute une portée de tablature construite à partir de la portée (cases déduites : case la plus basse, corde conservée si possible). La tablature **suit les notes** de la portée éditée : après chaque modification, l'autre portée de la partie est reconstruite à partir d'elle (même étape d'annulation, identifiants d'événements réutilisés position par position) ; elle n'est pas jouée deux fois (la lecture et la table de mixage l'ignorent). `Tablature seule` convertit la portée sur place et déduit les cases ; une note saisie sur une tablature reçoit une case déduite. L'édition de la tablature elle-même (choix des cordes et des cases) viendra avec l'éditeur de tablature (#24).

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
- **Touches allumées** : les notes sélectionnées (ou, en saisie, la note qui vient d'être saisie) sont allumées à la couleur d'accent, les notes qui sonnent pendant la lecture à la couleur de lecture. Les deux se font par basculement de classes hors de React (les boutons ne sont rendus qu'une fois, et de nouveau seulement si l'armure ou la langue change) : la lecture ne redessine donc pas le piano ; un test Playwright vérifie que le DOM des touches ne voit que des changements de classe. Fermé, le piano ne fait aucun travail.
- **Clavier MIDI** : le bouton « Connecter un clavier MIDI » de l'en-tête du piano est le seul endroit qui appelle `navigator.requestMIDIAccess` (jamais au chargement), avec `sysex: false`. Une fois connecté, les note-on saisissent des notes à la durée courante en saisie de notes, ou changent les notes sélectionnées en sélection. Les notes jouées dans les 50 ms de la première d'un groupe sont ajoutées à son accord (la première note est saisie tout de suite, sans délai). Plusieurs appareils : un sélecteur (« Tous les appareils » par défaut). Le branchement à chaud est géré : les appareils qui apparaissent ou disparaissent mettent la liste à jour, et un appareil choisi qui disparaît renvoie à tous les appareils. L'entrée MIDI reste active quand le piano est masqué. **La pédale de sustain, la vélocité, le pitch bend et les note-off sont ignorés en V1** (un note-on de vélocité 0 compte comme un note-off) ; le running status et les octets temps réel sont lus.
- **Repli** : sans Web MIDI (Safari n'en a pas ; Firefox demande son module d'autorisation de site), le bouton est remplacé par une explication, et une autorisation refusée ou un échec affiche un message avec un bouton pour réessayer. Le piano à l'écran fonctionne dans tous les cas. L'API envoie `Permissions-Policy: midi=(self)` : le Web MIDI est donc autorisé pour l'origine de l'application.
- **Accessibilité** : touches = boutons nommés avec un anneau de focus visible, contraste AA dans les deux thèmes (les touches blanches gardent un aspect de piano ; les touches allumées utilisent les jetons d'accent et de lecture), transitions seulement si le mouvement est autorisé, messages de connexion dans une zone live polie.

## Accessibilité

Repères (`header`, `aside`, `main`, barre d'état), focus visible, `aria-label` sur les boutons-icônes, `aria-expanded` sur les bascules de panneaux, `aria-pressed` sur les bascules, annonces polies pour le mode de saisie, l'enregistrement et la note saisie ou sélectionnée (via la région live de la partition), et `prefers-reduced-motion` respecté.
