# Import et export MusicXML

[English](musicxml.md) · **Français**

Polymnia lit et écrit des partitions MusicXML 4.0 **partwise**, non compressées (`.musicxml`, `.xml`) et compressées (`.mxl`). Le code est dans [`web/src/musicxml/`](../web/src/musicxml) : des fonctions pures sur le [modèle de partition](score-format.fr.md), chargées à la première utilisation (un chunk séparé d'environ 16 Ko gzip, le bundle initial ne change donc pas).

```ts
import { exportMusicXml, importMusicXml, scoreToMusicXml, parseMusicXml } from './musicxml';

const file = exportMusicXml(score, 'mxl'); // { bytes, mime, extension }
const { score, report } = importMusicXml(bytes); // .musicxml, .xml ou .mxl, lève MusicXmlError
```

## Dans l'éditeur

- **Exporter** (barre du haut) ouvre un menu : MusicXML (`.musicxml`) ou MusicXML compressé (`.mxl`). Le fichier porte le titre de la partition.
- **Importer** (bouton de la barre du haut, ou dépôt d'un fichier sur l'éditeur) lit le fichier, demande confirmation (la partition actuelle est remplacée et son historique perdu), puis affiche le **rapport d'import** quand quelque chose a été ignoré ou adapté.
- Le menu, les dialogues et la zone live sont accessibles au clavier et annoncés aux lecteurs d'écran ; les textes existent en français et en anglais.

## Correspondances

| Modèle | MusicXML |
| ------ | -------- |
| ticks (960 par noire) | `<divisions>960</divisions>` à l'export ; n'importe quelles `<divisions>` à l'import, converties en ticks |
| partie, portées d'une partie | `<part>` avec `<staves>` et `<staff>` ; `backup` entre portées et voix |
| voix _v_ de la portée _s_ | `<voice>` `4s+v+1` ; à l'import, par portée, les voix sont classées par numéro (la voix 1 ou le plus petit numéro est la voix 0) |
| hauteur épelée (écrite) | `<pitch>` step, alter, octave ; `<accidental>` n'est pas nécessaire |
| `Part.transposition` | `<transpose>` (chromatic et octave-change, de l'écrit au sonore) |
| clé, changement de clé en début de mesure | `<clef>` (Sol 2, Fa 4, Ut 3 alto, Ut 4 ténor, Sol 2 avec octave -1, percussion) |
| `time`, `keyFifths` | `<time>`, `<key><fifths>` (épars : seulement aux changements) |
| `tempoBpm` | `<direction>` avec `<metronome>` et `<sound tempo>` ; à l'import `<sound tempo>` d'abord, sinon le métronome (unités pointées converties en noires par minute) |
| levée (`length`) | `implicit="yes"` à l'export ; à l'import toute mesure dont le contenu est plus court que la signature reçoit un `length` |
| accord | notes `<chord/>` |
| durée, points | `<type>`, `<dot/>`, `<duration>` ; une durée non représentable devient, à l'import, des notes liées ou plusieurs silences |
| nolet | `<time-modification>` et `<tuplet type>` ; à l'import 3:2 et les autres rapports de 2 à 9, avec ou sans marques de nolet |
| `tieToNext` | `<tie>` et `<tied>` start/stop |
| liaison de phrasé | `<slur type number>` (numéros 1 à 16 par partie) |
| portée de tablature | clé `TAB`, `<staff-details>` (`<staff-lines>`, `<staff-tuning line>`, `<capo>`) |
| `fretting` | `<technical><string><fret>` |
| instrument | `<instrument-sound>` et un champ divers `polymnia-instrument-Pn` (identifiant exact du catalogue, pour les allers-retours) ; à l'import l'id de son, puis le nom de la partie, puis `custom` |

Aller-retour : chaque fixture s'exporte puis se réimporte en la même partition (les ids sont régénérés), avec un rapport vide. Une portée de tablature exportée perd sa clé (inutilisée) : elle revient avec celle par défaut de l'instrument.

## Ce qui n'est pas importé

Les éléments non pris en charge sont ignorés et **comptés par type d'élément** dans le rapport (`dropped`), par exemple `dynamics`, `words`, `wedge`, `lyric`, `harmony`, `fermata`, `trill-mark`, `staccato`, `grace`, `repeat`, `ending`, `credit`, `part-group`, `up-bow`, `fingering`, `clef (mid-measure)`, `tempo (mid-measure)`, `voice` (cinquième voix et suivantes), `staff` (au-delà de quatre). Ce qui est conservé de façon approchée est compté dans `adjusted` : `alter (microtone)`, `duration (quantized)` (à la triple croche), `overfull measure`, `unreadable measure` (remplacée par des silences), `tuplet` (gardé en notes simples quand ce ne peut pas être un nolet), `clef` (une clé inhabituelle ramenée à la plus proche prise en charge).

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

Fichier de 20 Mo, XML de 20 Mo, 100 entrées d'archive, 1,5 M de balises, 2000 mesures, 32 parties, 4 portées par partie, 4 voix par mesure, 12 hauteurs par accord, 512 événements par voix (les limites du modèle). Les hauteurs de l'octave -1 sont écrites telles quelles (hors de la plage 0 à 9 de MusicXML).

## Performance

Une partition de 500 mesures et 4 portées (environ 8000 événements, 1 Mo de XML), meilleur de trois essais dans l'environnement de test (jsdom, un DOM lent ; les navigateurs analysent plus vite) : export 7 ms, export `.mxl` 18 ms, import environ 260 ms, import `.mxl` environ 280 ms. Les tests échouent au-delà de 500 ms.

## Tests

`web/src/musicxml/*.test.ts` : aller-retour sur chaque fixture (`.musicxml` et `.mxl`), fixtures d'import écrites à la main dans `web/src/musicxml/fixtures/` (mélodies du domaine public : l'Ode à la joie dans le style des logiciels de notation courants avec `backup`/`forward`, plusieurs voix et `divisions` 2 ; une tablature de guitare en drop D avec capodastre ; une levée avec changements de tonalité, de signature, de tempo et de clé et un triolet sans marques ; un fichier plein d'éléments non pris en charge pour le rapport), tests de sécurité (entités, taille, zip bomb, en-tête mensonger, traversée de chemin, nombre d'éléments) et performance. `web/e2e/musicxml.spec.ts` couvre les téléchargements, le menu au clavier, l'import avec confirmation et rapport, et un fichier refusé.
