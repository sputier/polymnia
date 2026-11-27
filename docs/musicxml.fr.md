# Import et export MusicXML

[English](musicxml.md) · **Français**

Polymnia lit et écrit des partitions MusicXML 4.0 **partwise**, non compressées (`.musicxml`, `.xml`) et compressées (`.mxl`). Le code est dans [`web/src/musicxml/`](../web/src/musicxml) : des fonctions pures sur le [modèle de partition](score-format.fr.md), chargées à la première utilisation (un chunk séparé d'environ 16 Ko gzip, le bundle initial ne change donc pas).

```ts
import {
  exportMusicXml,
  importMusicXml,
  scoreToMusicXml,
  parseMusicXml,
} from "./musicxml";

const file = exportMusicXml(score, "mxl"); // { bytes, mime, extension }
const { score, report } = importMusicXml(bytes); // .musicxml, .xml ou .mxl, lève MusicXmlError
```

## Dans l'éditeur

- **Exporter** (barre du haut) ouvre un menu : MusicXML (`.musicxml`) ou MusicXML compressé (`.mxl`). Le fichier porte le titre de la partition.
- **Importer** (bouton de la barre du haut, ou dépôt d'un fichier sur l'éditeur) lit le fichier, demande confirmation (la partition actuelle est remplacée et son historique perdu), puis affiche le **rapport d'import** quand quelque chose a été ignoré ou adapté.
- Le menu, les dialogues et la zone live sont accessibles au clavier et annoncés aux lecteurs d'écran ; les textes existent en français et en anglais.

## Correspondances

| Modèle                                    | MusicXML                                                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ticks (960 par noire)                     | `<divisions>960</divisions>` à l'export ; n'importe quelles `<divisions>` à l'import, converties en ticks                                                                                    |
| partie, portées d'une partie              | `<part>` avec `<staves>` et `<staff>` ; `backup` entre portées et voix                                                                                                                       |
| voix _v_ de la portée _s_                 | `<voice>` `4s+v+1` ; à l'import, par portée, les voix sont classées par numéro (la voix 1 ou le plus petit numéro est la voix 0)                                                             |
| hauteur épelée (écrite)                   | `<pitch>` step, alter, octave ; `<accidental>` n'est pas nécessaire                                                                                                                          |
| `Part.transposition`                      | `<transpose>` (chromatic et octave-change, de l'écrit au sonore)                                                                                                                             |
| clé, changement de clé en début de mesure | `<clef>` (Sol 2, Fa 4, Ut 3 alto, Ut 4 ténor, Sol 2 avec octave -1, percussion)                                                                                                              |
| `time`, `keyFifths`                       | `<time>`, `<key><fifths>` (épars : seulement aux changements)                                                                                                                                |
| `tempoBpm`                                | `<direction>` avec `<metronome>` et `<sound tempo>` ; à l'import `<sound tempo>` d'abord, sinon le métronome (unités pointées converties en noires par minute)                               |
| levée (`length`)                          | `implicit="yes"` à l'export ; à l'import toute mesure dont le contenu est plus court que la signature reçoit un `length`                                                                     |
| accord                                    | notes `<chord/>`                                                                                                                                                                             |
| durée, points                             | `<type>`, `<dot/>`, `<duration>` ; une durée non représentable devient, à l'import, des notes liées ou plusieurs silences                                                                    |
| nolet                                     | `<time-modification>` et `<tuplet type>` ; à l'import 3:2 et les autres rapports de 2 à 9, avec ou sans marques de nolet                                                                     |
| `tieToNext`                               | `<tie>` et `<tied>` start/stop                                                                                                                                                               |
| liaison de phrasé                         | `<slur type number>` (numéros 1 à 16 par partie)                                                                                                                                             |
| portée de tablature                       | clé `TAB`, `<staff-details>` (`<staff-lines>`, `<staff-tuning line>`, `<capo>`)                                                                                                              |
| `fretting`                                | `<technical><string><fret>`                                                                                                                                                                  |
| accord, diagramme                         | `<harmony>` (`root`, `kind`, `bass`, `degree`), `<frame>`, voir « Accords » plus bas                                                                                |
| instrument                                | `<instrument-sound>` et un champ divers `polymnia-instrument-Pn` (identifiant exact du catalogue, pour les allers-retours) ; à l'import l'id de son, puis le nom de la partie, puis `custom` |

Un doigté choisi par l'utilisateur (`manual`) est écrit avec un `<other-technical>polymnia-manual-fingering</other-technical>` supplémentaire dans `<technical>` (l'élément d'extension standard, ignoré par les autres logiciels) ; à l'import il rétablit l'indicateur : les doigtés de l'utilisateur survivent à un aller-retour et les doigtés déduits restent déduits. Les doigtés venus d'autres logiciels sont importés comme déduits mais valides (ils sont conservés pendant qu'on modifie les notes voisines).

Aller-retour : chaque fixture s'exporte puis se réimporte en la même partition (les ids sont régénérés), avec un rapport vide. Une portée de tablature exportée perd sa clé (inutilisée) : elle revient avec celle par défaut de l'instrument.

## Accords

Les accords sont écrits et lus en `<harmony>` (code dans `web/src/musicxml/harmony.ts`), les diagrammes en `<frame>`. Modèle : [score-format.fr.md](score-format.fr.md#accords).

**Export.** Avant les notes de chaque mesure, un `<harmony>` par accord, dans l'ordre du schéma : `<root>` (`root-step`, `root-alter` s'il n'est pas 0), `<kind text="m7">minor-seventh</kind>`, `<bass>`, éléments `<degree>`, `<frame>`, `<offset>` (en divisions, qui sont ici des ticks, écrit quand l'accord n'est pas au début de la mesure), `<staff>` (quand la partie a plusieurs portées). Le curseur est au début de la mesure, la position est donc le décalage : les autres logiciels la placent correctement, et un `<harmony>` n'a pas besoin d'une note dessous.

| Qualité                                            | `<kind>`                                                                                                      | `<degree>`                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| majeur (vide), `m`, `aug`, `dim`                   | `major` `minor` `augmented` `diminished`                                                                      |                                                 |
| `6` `m6` `6/9`                                     | `major-sixth` `minor-sixth` `major-sixth`                                                                     | `6/9` : la neuvième, type `add`                 |
| `7` `maj7` `m7` `dim7` `aug7` `m7b5` `m(maj7)`     | `dominant` `major-seventh` `minor-seventh` `diminished-seventh` `augmented-seventh` `half-diminished` `major-minor` |                                           |
| `9` `11` `13`, `maj9`..., `m9`...                  | `dominant-ninth`, `major-ninth`, `minor-ninth`, `...-11th`, `...-13th`                                        |                                                 |
| `sus2` `sus4` `5`                                  | `suspended-second` `suspended-fourth` `power`                                                                 |                                                 |
| `b5 #5 b9 #9 #11 b13`                              | (inchangé)                                                                                                    | `<degree-type>alter</degree-type>` avec l'altération |
| `add9` `add11` `add13` `add2` `add4`               | (inchangé)                                                                                                    | `<degree-type>add</degree-type>`                |
| tout le reste (`7sus4`, `maj7#5`, `dim7add9`...)   | `other`                                                                                                       | aucun : la qualité est dans `text`              |

`kind@text` contient toujours la qualité normalisée : un fichier Polymnia revient donc à l'identique. Chaque qualité de l'analyseur est testée via `.musicxml`.

**Import.** La structure passe en premier : le `kind` donne la qualité (le tableau ci-dessus, plus `none`, ignoré comme « pas d'accord »), les `<degree>` la complètent (`alter` ou `add` avec un `degree-alter` non nul est une altération ; `add` de 9, 11 ou 13 une note ajoutée ; `add` de 6 ou 7 une sixte ou une septième ; `subtract` et le reste sont ignorés), une sixte avec une neuvième ajoutée est un six-neuf. Pour `kind="other"`, l'attribut `text` est analysé (`text="7sus4"` fonctionne, `text="alt"` non). La position est le curseur plus `<offset>` (en divisions), et la portée est `<staff>` (la première quand il est absent ou n'existe pas). Deux harmonies à la même position : la première est gardée ; une après la fin de la mesure est ignorée. Une altération de fondamentale est arrondie et limitée à -2..2.

**Non importé, et compté dans le rapport** (`dropped`) : les harmonies avec un `<numeral>` ou `<function>` au lieu d'une fondamentale (`harmony (numeral or function)`), le kind `none` (`harmony (no chord)`), les kinds qui ne sont pas des accords du modèle (`harmony (kind Neapolitan)`), une qualité que l'analyseur ne sait pas lire (`harmony (quality)`), un degré qu'il ne sait pas appliquer (`harmony degree`), une deuxième harmonie à la même position et une hors de la mesure (`harmony (same position)`, `harmony (outside measure)`). Seul le premier `<harmony-chord>` d'un polyaccord est lu. `<inversion>`, `<bass-separator>` et les attributs d'impression sont ignorés.

**Diagrammes.** À l'export, `<frame>` est écrit pour chaque accord qui montre un diagramme, avec la forme de la bibliothèque (ou la personnalisée) : `frame-strings`, `frame-frets` 4, `first-fret` quand la fenêtre n'est pas au sillet, un `frame-note` par corde jouée, la plus grave d'abord (`string` 1 est la plus aiguë, comme partout dans MusicXML ; les cordes à vide ont `fret` 0, les cordes étouffées pas de note), `<barre type="start">` sur la corde la plus grave du barré et `type="stop"` sur la plus aiguë. Les cases sont comptées depuis le capodastre, comme dans l'éditeur. À l'import, un frame dont le nombre de cordes correspond à l'accordage de la partie est lu (`frets`, `base`, `barre`) ; un frame avec un autre nombre de cordes est ignoré (`frame` dans le rapport). Un frame **égal à la forme que dessinerait la bibliothèque** n'est pas personnalisé et est supprimé ; l'accord reçoit `diagram: true` quand le mode de la partie ne l'aurait pas montré, de sorte qu'un diagramme venu avec un fichier reste visible et qu'un fichier Polymnia fait l'aller-retour exactement. Un frame différent est gardé comme doigté personnalisé de l'accord et joué tel qu'il est dessiné.

**Champs Polymnia.** Le modèle a des options pour lesquelles MusicXML n'a pas de place (le mode de diagramme d'une partie, l'option de forme avec capodastre, l'indicateur de diagramme propre à un accord). Elles sont écrites en `<miscellaneous-field>` du fichier (même mécanisme que `polymnia-instrument-Pn`) : `polymnia-chord-diagrams-Pn` (`first` ou `all`), `polymnia-chord-capo-shapes-Pn` (`1`) et `polymnia-chord-flags-Pn` (`mesure.portée.tick=1|0` séparés par `;`). Les autres logiciels les ignorent ; à l'import elles restaurent les options, de sorte que chaque fixture avec accords refait l'aller-retour vers la même partition.

## Ce qui n'est pas importé

Les éléments non pris en charge sont ignorés et **comptés par type d'élément** dans le rapport (`dropped`), par exemple `dynamics`, `words`, `wedge`, `lyric`, `fermata`, `trill-mark`, `staccato`, `grace`, `repeat`, `ending`, `credit`, `part-group`, `up-bow`, `fingering`, `clef (mid-measure)`, `tempo (mid-measure)`, `voice` (cinquième voix et suivantes), `staff` (au-delà de quatre). Ce qui est conservé de façon approchée est compté dans `adjusted` : `alter (microtone)`, `duration (quantized)` (à la triple croche), `overfull measure`, `unreadable measure` (remplacée par des silences), `tuplet` (gardé en notes simples quand ce ne peut pas être un nolet), `clef` (une clé inhabituelle ramenée à la plus proche prise en charge).

Autres règles : les notes non pitchées deviennent des silences ; `forward` devient un silence ; la signature et la tonalité viennent de la première partie, le tempo de n'importe laquelle ; les partitions `score-timewise` sont refusées ; les signatures additives sont sommées (`3+2` sur 8 donne 5/8) ; une note hors des octaves du modèle est ignorée ; les frettings en désaccord avec l'accord sont ignorés (`fretting`).

## Sécurité

Le fichier n'est pas fiable. Dans l'ordre :

1. **Taille** : 20 Mo au plus tel que reçu, et 20 Mo de texte XML.
2. **Entités** : le texte est examiné avant l'analyse. Tout `<!ENTITY` et tout DOCTYPE avec sous-ensemble interne (`[ ... ]`) est rejeté (expansion d'entités, « billion laughs », entités externes). Un DOCTYPE qui nomme seulement la DTD publique de MusicXML est accepté : l'analyseur du navigateur ne la charge jamais.
3. **Nombre d'éléments** : plus de 1,5 million de balises est rejeté avant de construire un DOM.
4. **Analyseur** : le `DOMParser` du navigateur (`application/xml`), qui ne charge aucune ressource externe. Les erreurs d'analyse sont rejetées.
5. **MXL (ZIP)** : 100 entrées au plus, aucun chemin absolu, lettre de lecteur, antislash, caractère de contrôle ou segment `..` dans un nom d'entrée, tailles décompressées déclarées de 20 Mo au total, le tout vérifié **avant de décompresser** ; seuls le conteneur et l'entrée de la partition sont décompressés, dans des tampons dimensionnés d'après les déclarations vérifiées (un en-tête mensonger ne peut pas faire dépasser ces tailles), puis le résultat est revérifié.
6. **Résultat** : la partition passe par `validateScore` et le décodeur strict (`fromJson` : formes, plages et limites de taille de [score-format.fr.md](score-format.fr.md)). Une partition invalide n'est jamais renvoyée.
7. **Affichage** : rien du fichier n'est jamais inséré comme HTML. Les textes (titre, compositeur, noms de parties, entrées du rapport) sont de simples chaînes, sans caractères de contrôle et tronquées, affichées par React comme du texte.

## Limites

Fichier de 20 Mo, XML de 20 Mo, 100 entrées d'archive, 1,5 M de balises, 2000 mesures, 32 parties, 4 portées par partie, 4 voix par mesure, 12 hauteurs par accord, 512 événements par voix (les limites du modèle). Les octaves MusicXML vont de 0 à 9, le modèle contient aussi l'octave -1 (MIDI 0 à 11). À l'export ces hauteurs sont **omises** (jamais déplacées vers une autre octave) : une note dont toutes les hauteurs sont sous le do 0 devient un silence, et le rapport d'export (dialogue après le téléchargement, `dropped` dans `exportMusicXml`) les compte sous `pitch (below octave 0)`.

Les commandes sont aussi dans la palette de commandes (`Ctrl+K`, groupe Fichier) : import (`Ctrl+O`), export MusicXML (`Ctrl+Shift+E`), export MXL (`Ctrl+Shift+M`).

## Performance

Budget : import et export d'une partition de 500 mesures en moins de 500 ms chacun. Mesuré dans Chromium par `e2e/musicxml-perf.spec.ts` (500 mesures, 2 portées) avec des marques User Timing autour du code MusicXML : import environ 23 ms, export environ 4 ms (environ 325 ms et 110 ms en temps réel, transfert du fichier, dialogue et téléchargement compris). Les tests unitaires (jsdom, un analyseur XML en JavaScript plusieurs fois plus lent qu'un navigateur) mesurent sur 500 mesures et 4 portées (1 Mo de XML) un export de 7 ms, un export `.mxl` de 18 ms, un import d'environ 260 ms, et ne servent qu'à détecter les régressions (2 s).

## Tests

`web/src/musicxml/*.test.ts` (`harmony.test.ts` : chaque kind, degrés, décalages et positions, portées, frames et barrés, ce qui est ignoré, et un aller-retour de 49 qualités, fondamentales, basses, indicateurs de diagramme et doigtés personnalisés) : aller-retour sur chaque fixture (`.musicxml` et `.mxl`), fixtures d'import écrites à la main dans `web/src/musicxml/fixtures/` (mélodies du domaine public : l'Ode à la joie dans le style des logiciels de notation courants avec `backup`/`forward`, plusieurs voix et `divisions` 2 ; une tablature de guitare en drop D avec capodastre ; une levée avec changements de tonalité, de signature, de tempo et de clé et un triolet sans marques ; un fichier plein d'éléments non pris en charge pour le rapport), tests de sécurité (entités, taille, zip bomb, en-tête mensonger, traversée de chemin, nombre d'éléments) et performance. `web/e2e/musicxml.spec.ts` couvre les téléchargements, le menu au clavier, l'import avec confirmation et rapport, et un fichier refusé.
