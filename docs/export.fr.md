# Export : MIDI, PDF et PNG

[English](export.md) · **Français**

Trois façons de sortir une partition de Polymnia sous forme de fichier, en plus du [MusicXML](musicxml.fr.md). Le code est dans [`web/src/export/`](../web/src/export), chargé à la première utilisation par `import('../export')` (un chunk séparé d'environ 49 Ko gzip : le bundle initial ne change pas ; le chunk du moteur de gravure qu'il réutilise est déjà chargé par l'éditeur).

## Utilisation

| Action                | Comment                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exporter un fichier   | Menu **Exporter** de la barre du haut : MIDI (`.mid`), PDF, images PNG. Aussi la palette de commandes (groupe « Fichier ») et `Ctrl/Cmd+Maj+U` (MIDI), `Ctrl/Cmd+Maj+F` (PDF), `Ctrl/Cmd+Maj+G` (PNG) |
| Choisir le papier     | Même menu, **Papier : A4** ou **Papier : Letter** (élément coché). Valeur par défaut selon la langue du navigateur : Letter pour en-US, en-CA, es-MX et quelques autres, A4 ailleurs. Mémorisé dans `localStorage` (`polymnia.paper`) |
| Suivre la progression | Un petit panneau (en bas à droite, `role="status"`) affiche « Page 3 sur 11 » pour le PDF et le PNG ; la région live annonce le début et le nom du fichier                              |

Les noms de fichier viennent du titre de la partition (`Long-piece.pdf`, `score.mid` sans titre). Un export PNG d'une seule page donne un `.png` ; plusieurs pages donnent un `.zip` de `page-01.png`, `page-02.png`… (un seul téléchargement au lieu d'une rafale que les navigateurs bloquent, et les pages restent ensemble). Si le format ne peut pas contenir un élément, la boîte **rapport d'export** de l'export MusicXML le liste avec des compteurs (portées au-delà des 15 canaux MIDI, hauteurs hors de 0 à 127, glyphes sans contour).

## MIDI

`midi.ts` écrit un fichier MIDI standard **format 1**, 960 ticks par noire (la résolution de la partition elle-même : les triolets, quintolets et toutes les durées du modèle sont exacts, rien n'est quantifié).

- **Le temps vient de la lecture.** Les notes sont celles de `buildTimeline` ([playback.fr.md](playback.fr.md)) : hauteur sonore (hauteur écrite plus transposition de la partie, capodastre déjà inclus), liaisons fusionnées en une seule note (aussi entre mesures et par hauteur d'accord), durées des n-olets, mesures d'anacrouse à leur vraie longueur, toutes les voix de toutes les portées. Lecture et fichier ne peuvent pas diverger.
- **Piste 0 (chef d'orchestre) :** titre comme nom de piste, un événement de tempo à chaque changement (`60 000 000 / bpm` microsecondes par noire), un événement de métrique au début et à chaque changement, un événement d'armure (dièses/bémols, majeur) au début et à chaque changement, fin de piste à la fin de la musique.
- **Une piste par portée**, nommée d'après la partie (`Piano 1`, `Piano 2` pour les deux portées d'un piano), un changement de programme vers le programme General MIDI de l'instrument (`gmProgram` du [catalogue](score-format.fr.md)), puis note on / note off à vélocité 80. À ticks égaux, un note off passe avant un note on : les notes répétées sont rejouées.
- **Canaux.** Chaque portée a son canal. Le canal 10 (indice 9) est la percussion General MIDI et n'est **jamais** utilisé, ce qui laisse 15 canaux : un fichier contient au plus 15 portées ; les autres sont omises et comptées dans le rapport (`midi-staff-over-15-channels`). Les hauteurs hors de 0 à 127 sont omises (`midi-pitch-out-of-range`).
- Aucune dépendance : l'encodeur fait environ 150 lignes (VLQ, chunks, méta-événements).

## PDF

`pages.ts` + `svgItems.ts` + `pdf.ts`. A4 (595,28 x 841,89 pt) ou Letter (612 x 792 pt), marges de 48 pt, titre centré et compositeur aligné à droite sur la première page, `n / N` en bas de chaque page.

**Approche retenue et pourquoi.** Trois options évaluées : (a) jsPDF 4.2.1 + svg2pdf.js 2.9.0 (tous deux MIT), (b) `window.print()` avec une feuille de style d'impression, (c) notre propre petit écrivain PDF. Nous avons retenu **(c)**, alimenté par le même SVG que produit le moteur de gravure :

|                       | (a) jsPDF + svg2pdf.js | (b) feuille de style d'impression | (c) écrivain maison (retenu) |
| --------------------- | ---------------------- | --------------------------------- | ---------------------------- |
| Taille                | jsPDF pèse 30 Mo décompressé sur npm et son build navigateur est de l'ordre de 100 Ko gzip ou plus (non mesuré ici), svg2pdf.js s'y ajoute | aucune | 6 Ko de code, `fflate` (déjà une dépendance) pour Flate |
| Glyphes Bravura       | VexFlow 5 dessine les notes en `<text>` Bravura. jsPDF n'embarque que du **TrueType** ; nous servons du `woff2` (et le paquet contient un `.otf` CFF) : il faudrait une conversion de police et le téléchargement d'un fichier de police | le navigateur imprime la police web | les contours des glyphes sont dessinés en chemins vectoriels (voir plus bas), aucune police à embarquer |
| Contrôle              | pages, marges, en-tête, numéros, A4/Letter à la demande | sauts de page et en-têtes dépendent du navigateur, pas de nombre de pages, pas de contrôle du bloc titre, variables de thème à neutraliser | total |
| Toujours noir sur blanc | demande de l'attention | demande de l'attention et une boîte d'impression | par construction : les couleurs sont ignorées |
| Où ça tourne          | thread principal | boîte d'impression, l'utilisateur choisit « Enregistrer en PDF » (aucun fichier produit par nous, impossible à tester sans interface) | thread principal |

(a) ne satisfait donc pas « embarquer Bravura correctement » sans mécanique supplémentaire, et (b) ne produit pas de fichier et ne se teste pas. (c) donne un rendu exact pour le sous-ensemble de SVG que VexFlow utilise.

- **Contenu des pages.** La partition est gravée **une fois** à la largeur de la page (`printGeometry` : un interligne de 10 px devient 1,75 mm, soit environ 4,96 pt, `DEFAULT_STAFF_SPACE_MM`, la taille usuelle des partitions imprimées en A4 ; `exportPdf` et `exportPng` acceptent un argument optionnel `staffSpaceMm` ; si un système est plus haut qu'une page, l'échelle diminue jusqu'à ce qu'il tienne) par le même `Engraver` et la même mise en page qu'à l'écran, dans un conteneur hors écran. `planPages` remplit les pages avec des systèmes entiers (un système ne se coupe jamais ; la première page garde la place du bloc titre). Une page qui n'est pas la dernière répartit ensuite sa hauteur restante à parts égales entre ses systèmes (`systemSpread`, 24 pt au plus par intervalle) : les pages pleines paraissent remplies, avec la même distance entre systèmes ; la dernière page garde la distance naturelle. Les noms de parties sont abrégés après le premier système (voir [engraving.fr.md](engraving.fr.md)). Une partition de piano de 100 mesures à 4/4 (noires sur blanches) tient en 4 à 5 mesures par système et 3 pages A4 (7 avant #46). Chaque page est ensuite relue depuis le SVG.
- **SVG vers éléments de dessin** (`svgItems.ts`, `paths.ts`). `path`, `rect`, `line`, `g` (avec `translate`/`scale`/`matrix`) et `text` deviennent une liste plate d'éléments : chemins remplis/tracés (déplacement, ligne, cubique, fermeture absolus ; quadratiques et arcs deviennent des cubiques) et texte. Remplissage et trait ne sont conservés que comme indicateurs : l'encre est noire quel que soit le thème, les classes CSS (`pm-selected`, `pm-playing`) sont ignorées, les rectangles de détection (`opacity="0"`) et les calques sont ignorés.
- **Glyphes Bravura en contours vectoriels.** Un `text` fait de caractères de la zone d'usage privé (SMuFL) devient le contour du glyphe, mis à l'échelle et positionné comme l'aurait été le texte. Les contours (164 glyphes : accolade et crochets, clés, chiffres de métrique, têtes de notes, points, crochets, altérations, silences, chiffres de n-olets) sont dans `web/src/export/bravura-outlines.json` (124 Ko, 41 Ko gzip), générés depuis le `.otf` de Bravura par `node scripts/export/build-glyphs.mjs` (dépendance de développement `opentype.js`, MIT). Un glyphe absent de la table est **signalé** (`glyph-U+XXXX`), jamais dessiné comme un carré en silence ; un test unitaire grave toutes les fixtures et échoue s'il en manque un. Quand le moteur saura dessiner de nouveaux symboles (articulations, nuances), ajoutez leur plage dans le script et relancez-le.
- **Autres textes** (noms de parties, numéros de case de tablature, titre, compositeur, numéro de page) en Helvetica, l'une des 14 polices standard du PDF (rien à embarquer), encodée WinAnsi. Les caractères que l'Helvetica ne sait pas afficher (CJK, cyrillique, grec) s'impriment `?`. Le centrage et la troncature utilisent la table des largeurs Helvetica. C'est la principale limite de l'approche : un titre dans une autre écriture demanderait une police embarquée.
- **Fichier.** PDF 1.4, un flux de contenu compressé Flate par page, un rectangle blanc d'abord puis de l'encre noire (`0 g 0 G`, aucun autre opérateur de couleur : un lecteur en mode sombre montre quand même une feuille blanche), `Title`, `Author` (compositeur), `Creator` et `Producer` dans le dictionnaire d'informations. La sortie est vectorielle : on peut zoomer autant qu'on veut.

## PNG

`png.ts`. Chaque page est dessinée sur un `<canvas>` à partir des **mêmes éléments** avec `Path2D` (papier blanc, encre noire) et encodée par `canvas.toBlob`. La résolution est **2x** la taille en pixels CSS de la page (96 dpi x 2 = 192 dpi) : Letter fait 1632 x 2112 px, A4 1587 x 2245 px. Comme les glyphes sont des chemins, aucune police n'est à charger, et il n'y a pas d'aller-retour SVG vers image (qui ne dessinerait pas la police musicale de toute façon : un SVG utilisé comme image ne peut pas charger de polices web, et la Content-Security-Policy n'autorise pas les images `blob:`). Même mise en page que le PDF.

Une page donne un `.png` ; plusieurs pages donnent un `.zip` (`fflate`, stocké sans recompression puisque le PNG est déjà compressé) de `page-NN.png`, numérotés avec des zéros pour qu'ils se trient.

## Sécurité et CSP

Rien n'est chargé depuis un tiers et aucun worker n'est créé : l'export tourne dans le thread principal, en rendant la main entre les pages (`setTimeout`) pour que le panneau de progression se redessine. Les téléchargements suivent le même chemin `Blob` + `<a download>` que le MusicXML. Le texte de la partition (titre, compositeur, noms de parties) n'est jamais écrit que comme chaîne hexadécimale PDF ou texte de canvas, jamais comme balisage.

## Performances

Chromium, build de production, portable Windows 11, partition de piano de 100 mesures (système de piano, 3 pages A4), mesurées avec User Timing dans `e2e/export.spec.ts` (meilleur de trois après chargement du chunk paresseux) :

| Quoi                              | Budget                              | Mesuré                                          |
| --------------------------------- | ----------------------------------- | ----------------------------------------------- |
| MIDI                              | < 50 ms                             | 0,4 à 1,6 ms                                    |
| PDF (gravure, pages, écriture)    | < 3 s                               | 100 à 120 ms                                    |
| PNG (3 pages en 2x, zippées)      | < 2 s                               | 155 à 175 ms                                    |
| Chunk d'export                    | budget gzip 70 Ko (`npm run size`)  | 48,6 Ko (dont 41 Ko de contours de glyphes)     |
| JS initial                        | <= 150 Ko gzip                      | non modifié par le code d'export (les entrées de menu et la préférence de papier pèsent quelques centaines d'octets) |

## Tests

- Unitaires `midi.test.ts` : un petit lecteur MIDI indépendant relit la sortie et compare pistes, noms de pistes, programmes, canaux (jamais 9), carte des tempos, métriques et armures, ticks des note on/off, liaisons (entre mesures, par hauteur d'accord), triolets et quintolets, transposition (clarinette, contrebasse), anacrouse, ordre des événements, la limite de 15 portées et son rapport, et le budget de 50 ms.
- Unitaires `pdf.test.ts` : lecteur de chemins (relatif, implicite, quadratique, arc), conversion SVG (couleurs ignorées, zones de détection ignorées, contours de glyphes, glyphe inconnu signalé), structure PDF (en-tête, offsets xref pointant sur les objets, nombre de pages, flux décompressé, WinAnsi), pagination et export complet d'une partition de 100 mesures. `paperPref.test.ts` : A4/Letter selon la langue.
- Playwright `e2e/export.spec.ts` (connecté via `mockSignedIn`) : chaque export télécharge un fichier non vide du bon type (`MThd`, `%PDF-`, signature PNG, ZIP de PNG), le nombre de pages PDF d'une partition de 100 mesures et sa taille de page pour Letter et A4, les raccourcis et commandes de palette, les budgets de performance, et en **thème sombre** le PNG est blanc avec de l'encre noire seulement (pixels échantillonnés, aucun pixel coloré) et le PDF commence par une page blanche sans opérateur de couleur.

## Limites connues

- Les titres et noms de parties dans une écriture non latine s'impriment `?` dans le PDF (le PNG utilise les polices de repli du navigateur).
- La notation que le moteur ne dessine pas encore (nuances, articulations) demandera l'ajout de ses glyphes à la table des contours.
- Reprises, paroles et options de page (marges, espacement des systèmes) ne sont pas encore exportées ; l'interligne imprimé est de 1,75 mm sauf si l'argument `staffSpaceMm` dit autrement (pas encore d'entrée de menu).
- Le MIDI n'a ni nuances, ni pédale, ni articulations (le modèle n'en a pas encore).
