# Format de partition

[English](score-format.md) · **Français**

Le modèle de partition est la source de vérité unique partagée par la gravure, l'éditeur, la lecture audio, l'import/export MusicXML et l'API. Il vit dans [`web/src/score/`](../web/src/score) (TypeScript pur, aucune dépendance à l'exécution, ni React ni VexFlow). Le format JSON est décrit par [`schema/score.v1.schema.json`](../schema/score.v1.schema.json) (JSON Schema draft 2020-12), que l'API réutilise pour valider les envois et stocker les partitions en `jsonb` PostgreSQL.

## Forme

```
Score { schemaVersion: 1, id?, meta, measures[], parts[], slurs[] }
  meta     { title, composer, tempoBpm }
  measures MeasureInfo[]            communes à toutes les portées : { id, time?, keyFifths?, tempoBpm?, length? }
  parts    Part[]                   { id, name, instrument, transposition, tuning?, capo?, staves[] }
    Staff  { id, clef, type, showRests?, measures[] }     measures[i] appartient à score.measures[i]
      StaffMeasure { clef?, voices[] }
        Voice { id, events[], tuplets[] }
          Note { kind: 'note', id, duration, pitches[] }     un accord a plusieurs hauteurs
          Rest { kind: 'rest', id, duration }
  slurs    Slur[]                   { id, startEventId, endEventId }
```

- **Attributs de mesure clairsemés.** `time`, `keyFifths` et `tempoBpm` ne sont écrits que là où ils changent ; la première mesure doit définir `time` et `keyFifths`. Aides : `timeSignatureAt`, `keyFifthsAt`, `tempoAt`, `measureLength`.
- **Mesure d'anacrouse.** `MeasureInfo.length` est la longueur réelle en ticks d'une mesure plus courte (anacrouse, dernière mesure tronquée). Multiple de 120, au plus la longueur de la métrique.
- **Voix.** Une mesure de portée contient de 1 à 4 voix ; chaque voix remplit la mesure à elle seule.
- **Ordre des parties.** `parts[i].staves[j]` est dessiné de haut en bas. Un piano est une partie à deux portées.

## Le temps : des ticks entiers

`TICKS_PER_QUARTER = 960`, divisible par 2^n, 3 et 5 : les triolets et quintolets sont exacts. Aucun nombre flottant dans le modèle.

| Durée                | Ticks |
| -------------------- | ----- |
| ronde                | 3840  |
| blanche              | 1920  |
| noire                | 960   |
| croche               | 480   |
| double croche (16th) | 240   |
| triple croche (32nd) | 120   |

Une durée est `{ base, dots }` (`dots` de 0 à 2) : ticks = base x (2 - 1/2^dots). L'interface V1 propose de la ronde à la double croche ; le modèle accepte la triple croche. Les positions dans une mesure et les longueurs de mesure sont des multiples de 120 (une triple croche). Une triple croche pointée ou doublement pointée (180 et 210 ticks) sort de cette grille : les commandes la refusent (`invalid-argument`).

Les **nolets** sont des groupes `{ id, actual, normal, eventIds }` stockés dans la voix (un triolet vaut `actual: 3, normal: 2`). Les membres sont des événements consécutifs ; chacun dure `nominal x normal / actual` ticks, un entier. `createTriplet` fabrique un triolet 3:2.

## Identifiants

Chaque objet (mesure, partie, portée, voix, événement, nolet, liaison de phrase) a un **identifiant texte stable** conforme à `^[A-Za-z0-9_.-]{1,64}$`. Ils sont uniques dans toute la partition et servent à la sélection, au hit-testing et au rendu incrémental. Un id ne change jamais quand on modifie un événement (`setPitch`, `changeDuration`, `deleteEvent` le conservent). Les nouveaux ids viennent de `newId()` (aléatoire) ou sont dérivés d'une graine stockée dans la commande, pour que le « rétablir » produise les mêmes ids.

## Hauteur, transposition et instruments

Une hauteur est **épelée**, pas un numéro MIDI : `{ step: 'C'..'B', alter: -2..2, octave: -1..9 }`, donc `C#4` et `Db4` restent distincts (nécessaire à la gravure et aux aller-retours MusicXML). `pitchToMidi` et `midiToPitch(midi, keyFifths)` convertissent.

**On stocke la hauteur écrite**, comme MusicXML : les notes portent la hauteur **écrite** sur la portée, et la partie porte `transposition` (demi-tons, écrit vers sonore ; la guitare classique vaut `-12`, écrite une octave au-dessus du son). La lecture audio appelle `soundingPitch(pitch, part.transposition)` ou `soundingMidi`. La gravure, l'éditeur et l'export MusicXML restent simples ; seule la lecture convertit.

`instruments.ts` est un catalogue : id, noms français et anglais, clés par défaut, transposition, tessiture sonore, programme General MIDI et, pour les instruments à frettes, les cordes à vide `strings` (hauteurs sonores, de la corde aiguë à la grave) et `frets`. Instruments fournis : piano, voix, flûte, clarinette (si♭, transposition -2), violon, violoncelle (clés de fa, d'ut quatrième et de sol), contrebasse (transposition -12), guitare classique et folk, ukulélé soprano / concert / ténor / ténor sol grave / baryton. Une partie stocke l'id de l'instrument et copie `transposition` : la partition reste valide si le catalogue change ou si l'id est inconnu (les instruments personnalisés sont permis).

- **Accordage et capodastre.** `Part.tuning` (hauteurs sonores, de l'aigu au grave) remplace l'accordage du catalogue (drop D, ...) ; `Part.capo` monte chaque corde d'autant de demi-tons.
- **Clés.** `treble`, `bass`, `alto`, `tenor`, `treble-8vb` (guitare), `percussion` (réservée). `Staff.clef` est la clé initiale ; `StaffMeasure.clef` est un changement de clé au début de la mesure (`clefAt(staff, measure)`, `setClef`). Les changements de clé en milieu de mesure ne sont pas modélisés.
- **Type de portée.** `standard` ou `tab`. Une partie à frettes s'écrit `standard`, `tab` ou les deux (deux portées ; `setStaffLayout` construit la seconde à partir de la première et `syncCompanionStaff` les garde synchronisées pendant l'édition) ; `putEvent` sur une tablature déduit la case.
- **Doigté (frettes).** Une hauteur de note peut porter `fretting: { string, fret, manual? }` (`string` 1 = corde la plus aiguë ; `fret` se compte depuis le capodastre). `validateScore` vérifie que la corde existe, que la case ne dépasse pas le nombre de frettes, et que corde + capodastre + case sonne la même note MIDI que la hauteur écrite plus la transposition. `manual: true` (optionnel, additif) signifie que l'utilisateur l'a choisi : le doigté automatique ne change jamais un doigté manuel encore valide. Absent = déduit par l'algorithme de doigté.
- **Silences en tablature.** `Staff.showRests: true` (optionnel, additif, portées de tablature seulement) dessine les silences de cette tablature ; absent = masqués, comme dans la plupart des tablatures de guitare (`setTabRests`).
- **Algorithme de doigté.** `fingering.ts` (pur, numéros MIDI en entrée, `{ string, fret }` en sortie) choisit une corde et une case pour chaque note et accord d'une voix : Viterbi sur les quelques candidats les moins coûteux de chaque événement, qui minimise le déplacement de la main (la position de la main est la case jouée la plus basse ; les cordes à vide ne la déplacent pas et la position se conserve par-dessus), préfère les cordes à vide et les positions basses, une note par corde, 4 cases au plus entre les notes appuyées d'un accord (5 avec pénalité), peu de cordes sautées dans un accord, aucun cas particulier pour les accordages re-entrants (les cordes sont cherchées par hauteur). Une hauteur qu'aucune corde ne peut jouer n'a pas de doigté. `fretting.ts` l'applique aux portées : `refretStaffNotes(part, staff, keep)` recalcule les doigtés d'une portée en gardant tous les doigtés valides (`valid`), seulement les manuels valides (`manual`) ou aucun, en réutilisant les objets inchangés ; `unplayableEvents(score)` liste les notes des tablatures qu'aucune corde ne peut jouer (dessinées `?`, listées dans l'inspecteur). Coût : 2,5 µs par note, 4,5 µs par note d'accord (les tests exigent < 1 ms).
- **Stabilité.** Modifier une partie « portée + tablature » reconstruit l'autre portée, mais une note dont la hauteur n'a pas changé garde son doigté (position par position), manuel ou déduit ; seules les notes nouvelles ou modifiées sont doigtées, d'après leurs voisines. Un changement d'accordage ou de capodastre recalcule les doigtés déduits et garde les manuels encore valides. `ensureFretting` (exécuté par l'éditeur après chaque modification) complète les doigtés manquants d'une tablature.
- **Changer d'instrument.** `changeInstrument` déplace chaque hauteur écrite de `ancienneTransposition - nouvelleTransposition` (orthographe selon l'armure de chaque mesure ; liaisons revérifiées), garde les clés permises et remplace les autres par celle de l'instrument, ajoute une portée de basse vide pour le piano, ne supprime les portées en trop que si elles sont vides (`not-empty`), réinitialise accordage et capodastre et recalcule les cases. Une tablature qui répète une portée standard de la même partie n'est pas jouée (la lecture et la table de mixage l'ignorent).
- **Accordages prédéfinis.** `tuningPresets(instrumentId)` (guitare : standard, drop D, DADGAD, sol ouvert, ré ouvert, demi-ton et ton plus bas ; ukulélé : GCEA, sol grave, baryton, accordage en ré), `matchTuningPreset`, `assignFretting` (une note seule : corde préférée conservée, sinon cordes à vide puis case la plus basse ; dans `fretting.ts`) et `partRange` (tessiture du catalogue étendue vers le bas jusqu'à la corde la plus grave d'un accordage personnalisé) sont dans `tuning.ts`.
- **Tessiture.** `isInRange(instrument, pitch)` et `rangeWarnings(score)` signalent les notes hors tessiture sonore comme avertissements, jamais comme erreurs.

## Liaisons de prolongation et de phrase

- **Liaison de prolongation** : `tieToNext: true` sur une hauteur d'une note. Valide seulement si l'événement suivant de la même voix (en continuant dans la mesure suivante, même indice de voix) est une note contenant la même hauteur épelée. Les commandes effacent les liaisons devenues invalides.
- **Liaison de phrase** : un intervalle `{ id, startEventId, endEventId }` au niveau de la partition. Les deux événements existent sur la même portée, le début strictement avant la fin. Elle peut traverser les barres de mesure. Supprimer un événement supprime ses liaisons de phrase.

## Commandes, annuler et rétablir

Chaque modification est une commande (`commands/`) : `interface Command { name; apply(score): Score; invert(before): Command }`. `apply` est pure et déterministe (ids compris) et renvoie la **même référence** quand rien ne change. `invert(before)` renvoie la commande qui restaure `before` exactement (un saut vers un instantané ; le partage structurel le rend presque gratuit). `History` garde des piles d'annulation et de rétablissement illimitées ; une commande qui lève une `CommandError` laisse l'historique intact.

**Partage structurel.** Une commande ne copie que le chemin de la racine jusqu'au changement (partition, partie, portée, tableau de mesures, mesure de portée, voix). Tout le reste garde son identité de référence : le rendu et React peuvent ignorer les mesures inchangées avec `===`, et l'enregistrement automatique compare deux partitions en un temps proportionnel à ce qui a changé et n'envoie que les mesures modifiées ([library.fr.md](library.fr.md#enregistrement-incrémental)).

| Commande                                                             | Comportement                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setPitch`, `setAccidental`                                          | change une hauteur (accords triés) ; les doublons dans un accord sont refusés ; liaison et doigté de cette hauteur sont supprimés                                                                      |
| `addPitch`, `removePitch`                                            | modifie un accord ; la dernière hauteur ne peut pas être retirée (utiliser `deleteEvent`)                                                                                                              |
| `setTempo`                                                           | changement de tempo (20 à 400) à partir d'une mesure, `null` le retire                                                                                                                                 |
| `addPart`, `removePart`, `movePart`, `renamePart`                    | parties (la dernière partie ne peut pas être retirée : `last-part`)                                                                                                                                    |
| `changeInstrument`                                                   | nouvel instrument : les notes gardent leur hauteur réelle, la clé, les portées, l'accordage et les cases suivent (voir plus bas)                                                                       |
| `setStaffLayout`                                                     | parties à frettes : `standard`, `tab` ou `standard+tab`                                                                                                                                                |
| `syncCompanionStaff`                                                 | parties « portée + tablature » : reconstruit l'autre portée à partir de celle qu'on édite quand leurs notes diffèrent (l'éditeur l'exécute après chaque modification, dans la même étape d'annulation) |
| `setTuning`, `setCapo`                                               | accordage (`null` = catalogue) et capodastre ; les cases sont recalculées                                                                                                                              |
| `setFretting`                                                        | fixe corde et case (marqués `manual`) et déduit la hauteur écrite ; une corde déjà utilisée par l'accord est refusée                                                                                   |
| `moveToString`, `autoFinger`                                         | tablature : passe une hauteur sur la corde voisine en gardant sa hauteur (manuel) ; rend des notes au doigté automatique                                                                               |
| `ensureFretting`, `setTabRests`                                      | tablature : complète les doigtés manquants des tablatures d'une partie ; affiche ou masque les silences d'une tablature                                                                                |
| `putEvent`                                                           | écrit une note, un accord ou un silence à un tick d'une voix (règle d'écrasement)                                                                                                                      |
| `deleteEvent`                                                        | remplace par un silence de même durée (même id) ; les liaisons de phrase dessus sont supprimées                                                                                                        |
| `changeDuration`, `toggleDot`                                        | redimensionnent un événement (règle de débordement)                                                                                                                                                    |
| `toggleTie`, `addSlur`, `removeSlur`                                 | liaisons de prolongation et de phrase                                                                                                                                                                  |
| `createTriplet`                                                      | transforme un événement non pointé en triolet 3:2 (le premier emplacement garde la note, deux silences)                                                                                                |
| `transpose`                                                          | en demi-tons (12 = octave), tout ou rien ; le doigté est supprimé                                                                                                                                      |
| `insertMeasure`, `deleteMeasure`                                     | structure                                                                                                                                                                                              |
| `setTimeSignature`, `setKeySignature`, `setMeasureLength`, `setClef` | attributs à partir d'une mesure                                                                                                                                                                        |

**Règles de remplissage et de débordement (façon MuseScore).**

- Une mesure est toujours pleine : chaque voix totalise exactement la longueur de la mesure, les trous sont des silences.
- Écrire un événement écrase ce qu'il couvre. Les événements entièrement couverts disparaissent ; un événement qui commence avant le nouveau est coupé (en notes liées si sa longueur n'est pas une durée simple) ; la partie qui dépasse après devient des silences ; tout trou est comblé par des silences.
- Les silences de remplissage suivent la grille des temps : chaque morceau est la plus grande valeur alignée sur sa propre longueur, puis fusionné en valeur pointée si possible (blanche + noire au début d'une mesure donne une blanche pointée).
- Un événement qui dépasserait la barre de mesure est **refusé** (`CommandError` `exceeds-measure`) ; pas de liaison automatique à travers la barre en V1.
- Les membres d'un nolet ne peuvent pas être écrasés en partie (`tuplet-conflict`). Écrire sur un membre un événement de même durée nominale le remplace sur place.
- `setTimeSignature` et `setMeasureLength` complètent les mesures avec des silences ou les tronquent (une note coupée devient des notes liées, les événements suivants sont supprimés ; couper un nolet est refusé). `setTimeSignature` efface la longueur d'anacrouse de cette mesure.
- `deleteMeasure` reporte les changements de métrique, tonalité, tempo et clé sur la mesure suivante si elle n'en a pas, et refuse de supprimer la dernière mesure.
- `transpose` par octaves entières garde l'épellation ; les autres intervalles utilisent l'armure en vigueur à la mesure (dièses dans les tonalités à dièses, bémols dans celles à bémols, dièses ou bémols selon le sens en do majeur).

## Validation

`validateScore(score): Issue[]` renvoie tous les problèmes (`{ code, path, message }`, chemin en pointeur JSON). Codes : `duplicate-id`, `first-measure-attributes`, `bad-measure-length`, `measure-count`, `voice-missing`, `voice-length` (la voix ne remplit pas la mesure), `non-integer-ticks`, `empty-chord`, `duplicate-pitch`, `tie-target`, `tuplet-ratio`, `tuplet-ref`, `tuplet-contiguous`, `tuplet-overlap`, `tuplet-size`, `slur-ref`, `slur-staff`, `slur-order`, `fretting-no-tuning`, `fretting-string`, `fretting-fret`, `fretting-mismatch`. Un tableau vide signifie valide.

## Sérialisation et versions

`serialize(score)` donne du JSON compact. `deserialize(text)` analyse le texte, exécute `migrate`, décode la structure (propriétés inconnues, mauvais types, valeurs hors bornes et limites de taille sont rejetés), puis exécute `validateScore`. Il lève une `ScoreFormatError` typée qui porte `issues` et ne renvoie jamais une partition invalide. `fromJson(value)` fait de même pour une valeur déjà analysée.

- `schemaVersion` vaut `1`. `migrate(json)` met à niveau les versions plus anciennes pas à pas via une table de migrations (vide aujourd'hui, sans effet pour la version 1) et refuse les versions inconnues ou plus récentes avec le code `unsupported-version`.
- Pour faire évoluer le format : ajouter une version, une migration depuis la précédente, un nouveau `schema/score.vN.schema.json`, et garder l'ancien tant que des documents stockés l'utilisent.

## JSON Schema et limites

`schema/score.v1.schema.json` couvre la structure et les limites de taille que le serveur utilise pour rejeter les abus. Un test valide toutes les partitions d'exemple contre lui et vérifie que `deserialize` et le schéma s'accordent sur une liste d'échantillons invalides. Le schéma ne peut pas exprimer les règles sémantiques (voix qui remplissent les mesures, ids uniques, liaisons, nolets et doigtés valides) : le serveur applique les mêmes règles que `validateScore`.

| Limite                                 | Valeur                |
| -------------------------------------- | --------------------- |
| parties / portées par partie           | 32 / 4                |
| mesures                                | 2000                  |
| voix par mesure / événements par voix  | 4 / 512               |
| hauteurs par accord                    | 12                    |
| nolets par voix / événements par nolet | 128 / 16              |
| liaisons de phrase                     | 20000                 |
| cordes d'accordage / frettes           | 12 / 36               |
| titre, compositeur                     | 200 caractères        |
| nom de partie / id d'instrument        | 100 / 64 caractères   |
| id                                     | 64 caractères         |
| texte JSON (`deserialize`)             | 16 000 000 caractères |

## Performance

Mesuré par `npm run bench` sur une partition de 500 mesures et 4 portées (environ 8000 événements, 0,96 Mo de JSON) : application + annulation d'une modification de note sous 0,2 ms (budget 1 ms), sérialisation sous 4 ms (budget 20 ms). Le bench échoue au-delà des budgets.
