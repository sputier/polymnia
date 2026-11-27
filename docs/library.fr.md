# Bibliothèque de partitions et enregistrement automatique

[English](library.md) · **Français**

La bibliothèque est l'accueil de l'utilisateur connecté (`#/`). Une partition enregistrée s'ouvre sur `#/scores/<id>`. `#/editor` reste un éditeur de brouillon, jamais enregistré (aperçus, fixtures et tests). Le routeur est le même petit routeur à hash (`web/src/route/useRoute.ts`).

Code : `web/src/library/` (écran), `web/src/persistence/` (enregistrement automatique), `web/src/api/scores.ts` (client d'API).

## Bibliothèque

| Fonction           | Comportement                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Liste              | Des cartes, la plus récemment modifiée d'abord (ordre du serveur). Pagination par 50 : défiler près de la fin charge la page suivante, et un bouton « Charger la suite » fait de même au clavier.                                        |
| Carte              | Titre, une pastille par instrument, nombre de mesures, « Modifiée il y a 2 heures » (date complète en infobulle) et une portée statique. Aucune gravure dans la liste.                                                                   |
| Données d'aperçu   | `GET /api/scores` renvoie `measureCount` et `instruments` pour chaque élément (voir [api.fr.md](api.fr.md)). Le serveur les calcule pour les lignes de la page seulement, depuis `content`, avec quelques fonctions `jsonb`.             |
| Recherche          | Recherche de titre côté serveur (`?q=`), temporisée de 250 ms, les réponses tardives sont ignorées. `/` donne le focus au champ, `Échap` l'efface puis le quitte.                                                                        |
| Menu               | Par carte : Ouvrir, Renommer, Dupliquer, Partager, Supprimer. `↑`/`↓`/`Début`/`Fin` se déplacent dans le menu, `Échap` le ferme et rend le focus à son bouton.                                                                           |
| Nouvelle partition | `N` ou le bouton. La boîte demande le titre, les instruments (guitares, ukulélés, violoncelle et piano d'abord, puis le reste du catalogue), la tonalité, la métrique et le tempo, crée la partition avec `POST /api/scores` et l'ouvre. |
| Renommer           | Une boîte, puis `PATCH` avec `If-Match`. Si la partition a changé entre-temps (409), la liste est relue.                                                                                                                                 |
| Dupliquer          | `POST /api/scores/{id}/duplicate` ; la copie apparaît en premier.                                                                                                                                                                        |
| Partager           | Ouvre le dialogue de partage : créer, copier, régénérer ou révoquer le lien en lecture seule, et télécharger une copie. Voir [sharing.fr.md](sharing.fr.md).                                                                             |
| État vide          | Un message et un bouton « Nouvelle partition » ; un autre message quand la recherche ne trouve rien.                                                                                                                                     |

### Clavier

`←`/`→` vont à la carte précédente ou suivante, `↑`/`↓` à la carte au-dessus ou en dessous (par position, donc selon la grille), `Début`/`Fin` à la première ou dernière carte, `Entrée` ouvre. Une seule carte est dans l'ordre de tabulation (tabindex itinérant) : `Tab` ne parcourt pas 200 cartes. `Ctrl+K` ouvre la palette de commandes, qui liste les commandes de la bibliothèque (Nouvelle partition, Rechercher une partition) avec les autres.

### Suppression avec annulation

L'API supprime définitivement et ne sait pas restaurer. Recréer la partition à l'annulation lui donnerait un autre identifiant, donc un lien de partage serait cassé. La suppression est donc **différée** : la carte disparaît et une notification propose « Annuler » pendant 8 secondes ; la requête `DELETE` n'est envoyée qu'à la fin de ce délai. Annuler la supprime de la file, le serveur n'a rien vu. Si l'onglet est fermé pendant le délai, les requêtes en attente sont envoyées avec `keepalive` sur `pagehide` ; si cela échoue, la partition est simplement encore là la fois suivante (l'échec sans danger). Si la requête échoue, la carte revient avec un message. Code : `web/src/library/deferredDelete.ts`.

### Erreurs

| Cas            | Ce que voit l'utilisateur                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`          | L'écran de connexion. L'écran `#/...` en cours est gardé dans `sessionStorage` et restauré après la connexion (la partie après `#` n'atteint jamais le serveur). |
| `429`          | « Trop de requêtes. Réessayez dans N s », d'après `Retry-After`.                                                                                                 |
| `409` (limite) | « Vous avez atteint la limite de 200 partitions. »                                                                                                               |
| Hors ligne     | « Vous êtes hors ligne. »                                                                                                                                        |

## Enregistrement automatique

L'éditeur charge la partition (`GET`, version lue dans l'`ETag`), la désérialise avec le modèle de partition et surveille l'état de l'éditeur. Chaque changement de la partition (annuler et rétablir compris) prévient la **file d'enregistrement** (`web/src/persistence/saveQueue.ts`, sans React, testée avec des minuteurs simulés).

| Règle                      | Détail                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporisation              | Enregistre 1 s après la dernière modification, et au plus 10 s après la première modification non enregistrée : une longue saisie enregistre quand même. `Ctrl+S` enregistre tout de suite. Un onglet masqué enregistre aussi.                                                                                                                           |
| Une requête à la fois      | Un enregistrement ne démarre jamais pendant qu'un autre est en cours (deux `PUT` simultanés se mettraient en conflit entre eux). Les modifications faites pendant un enregistrement partent avec le suivant.                                                                                                                                             |
| Dernier contenu            | Le document est sérialisé au départ de la requête, pas au moment de la modification.                                                                                                                                                                                                                                                                     |
| Compression                | Un document complet est compressé en gzip avec `CompressionStream` (`Content-Encoding: gzip`, accepté par l'API) quand le navigateur l'a et que le document dépasse 1 Ko ; JSON brut sinon. Un patch est petit et part en JSON brut.                                                                                                                     |
| Enregistrement incrémental | Un enregistrement envoie **ce qui a changé depuis le dernier** avec `PATCH /api/scores/{id}/content`, pas le document entier (voir plus bas). Le `PUT` complet sert au premier enregistrement après un conflit, quand les changements sont trop nombreux ou trop gros, et quand le serveur répond `400` ou `413` à un patch.                             |
| Versions                   | Chaque écriture porte `If-Match: "<version>"` ; la réponse donne la version suivante.                                                                                                                                                                                                                                                                    |
| Renommer                   | Modifier le titre enregistre par `PATCH` (aucun document envoyé) quand rien d'autre n'a changé, et par le `PUT` (qui porte `meta.title`) quand les deux ont changé. Un titre vide est enregistré « Partition sans titre », car le serveur refuse un titre vide.                                                                                          |
| Erreur réseau              | État `Hors ligne`, nouvelles tentatives avec attente croissante (2, 4, 8, 16 puis 30 s), et tout de suite à l'événement `online` du navigateur. Les modifications sont conservées.                                                                                                                                                                       |
| `5xx`                      | État `Non enregistré`, même attente.                                                                                                                                                                                                                                                                                                                     |
| `429`                      | Attend `Retry-After` (2 minutes au plus), puis réessaie.                                                                                                                                                                                                                                                                                                 |
| `413`                      | « Cette partition est trop volumineuse pour être enregistrée (limite : 4 Mio) ». Pas de nouvel essai avant la modification suivante (l'utilisateur a pu retirer du contenu).                                                                                                                                                                             |
| `409`                      | État `Conflit` et une boîte : **Charger la version du serveur** (abandonne les modifications locales) ou **Garder la mienne (écraser)** (lit la version du serveur, puis enregistre par-dessus). L'enregistrement s'arrête jusqu'au choix ; les modifications sont conservées.                                                                           |
| `401`                      | État `Connexion requise` et une boîte avec un lien de connexion qui s'ouvre dans un **nouvel onglet**, pour que cet onglet garde les modifications en mémoire. « Je suis connecté : enregistrer » réessaie (il réessaie aussi quand l'onglet reprend le focus).                                                                                          |
| Quitter                    | Fermer l'onglet avec du travail non enregistré affiche l'avertissement du navigateur (`beforeunload`). Revenir à la bibliothèque enregistre d'abord : la file survit à l'éditeur jusqu'à être au repos, et la bibliothèque l'attend avant de lire la liste. Quitter alors qu'un conflit ou un enregistrement refusé est en attente demande confirmation. |

### Enregistrement incrémental

La file garde la partition que détient le serveur (la _base_ : la dernière partition chargée ou enregistrée avec succès, `web/src/persistence/scoreSync.ts`). Quand un enregistrement démarre, elle prend un instantané de la partition de l'éditeur et le compare à la base (`scoreDiff.ts`, pur, testé). Le modèle de partition est immuable avec partage structurel : une mesure inchangée est le même objet des deux côtés, la comparaison porte donc sur les références (`===`) et n'entre que dans ce qui diffère, pour un coût qui suit le nombre de mesures modifiées et non la taille de la partition (une partition de 500 mesures, 4 portées, se compare en quelques dizaines de microsecondes).

- **Unité d'un changement : la mesure.** Une mesure de portée modifiée devient `setStaffMeasure`, un attribut de mesure `setMeasureInfo`, les métadonnées `setMeta`, la liste de liaisons `setSlurs` ; les mesures et parties insérées ou supprimées deviennent `insertMeasure`, `deleteMeasure`, `insertPart`, `deletePart` ; une partie dont l'en-tête (nom, instrument, transposition, accordage, capodastre) ou les portées (clé, type, silences) ont changé est remplacée entière (`replacePart`). Chaque opération nomme des identifiants, jamais des positions (les opérations sont listées dans [api.fr.md](api.fr.md#mises-à-jour-incrémentales)).
- **Repli sur le document entier** (toujours correct) quand la comparaison ne peut pas dire le changement simplement ou qu'il ne vaut pas l'envoi : plus de 32 opérations, un patch de plus de 128 Ko, une partie déplacée, des identifiants non uniques, des mesures insérées ou supprimées pendant que des parties changent de forme, ou un `id` ou `schemaVersion` différent.
- **Rien à envoyer.** Si la partition de l'éditeur égale la base (une modification et son annulation dans la même fenêtre de temporisation), aucune requête n'est faite.
- **La base ne bouge que sur confirmation du serveur.** Une erreur réseau, un `429` ou un `5xx` garde la base : la nouvelle tentative calcule une nouvelle comparaison depuis la même base et le document d'alors. Une réponse `400` ou `413` à un patch (le serveur ne peut pas l'appliquer, ou le résultat serait trop gros) envoie tout de suite le même instantané en `PUT` complet, sans déranger l'utilisateur ; si celui-ci est refusé aussi, le message habituel s'affiche.
- **Conflits.** Un `409` est la boîte de conflit habituelle. Quel que soit le choix, la base n'est plus fiable : « Garder la mienne » envoie le document entier, et « Charger la version du serveur » remplace la base par le document qu'il vient de charger (les enregistrements suivants sont de nouveau des patchs).
- **Les renommages** sont inchangés (`PATCH /api/scores/{id}` seul quand seul le titre a changé) et mettent à jour le titre de la base.

Mesures côté serveur sur une partition de 500 mesures : voir [api.fr.md](api.fr.md#stockage-et-performance).

Une erreur ne retire jamais les modifications de la mémoire. On ne les perd que si l'utilisateur ferme l'onglet après l'avertissement, ou choisit « Charger la version du serveur ».

### État de l'enregistrement

La barre du haut et la barre d'état affichent `Enregistré`, `Enregistrement…`, `Hors ligne`, `Conflit`, `Non enregistré` ou `Connexion requise`. Entre la première modification et la fin de l'enregistrement, l'état reste `Enregistrement…` : une rafale de saisie est annoncée une fois (la barre d'état est une région `aria-live` polie), pas à chaque frappe. Les messages des cas inhabituels (hors ligne, trop volumineux, limite de débit) apparaissent au-dessus de la barre d'état.

## Mesures

API simulée, Chromium sans interface sur la machine de développement (Windows 11), `web/e2e` :

| Quoi                                                                                              | Résultat       | Budget |
| ------------------------------------------------------------------------------------------------- | -------------- | ------ |
| 200 partitions : de la réponse de la liste à la 200e carte dans le DOM                            | environ 60 ms  | 100 ms |
| Ouvrir une partition de 500 mesures, 4 portées (environ 940 Ko) : récupération et désérialisation | environ 40 ms  |        |
| Idem, jusqu'au premier système dans le DOM                                                        | environ 160 ms |        |
| JavaScript initial                                                                                | 110,8 Ko gzip  | 150 Ko |

Le réseau réel ajoute le transfert : environ 26 ms côté serveur pour le `GET` (voir [api.fr.md](api.fr.md)). Le premier système est gravé seul ; le reste de la partition l'est en temps libre ([engraving.fr.md](engraving.fr.md)).

## Tests

- Vitest : file d'enregistrement (temporisation, attente maximale, sérialisation, attente croissante, hors ligne, 429, 413, 401, 409 et ses deux issues, enregistrements en attente), enregistrement incrémental dans la file (chemin du patch, rien à envoyer, repli sur `PUT` pour `400` et `413`, la base ne bouge qu'en cas de succès, un conflit force un enregistrement complet), la comparaison (`scoreDiff.test.ts` : chaque opération, les seuils de repli, et des suites aléatoires de commandes à graine fixe vérifiant qu'appliquer les opérations à la base donne la partition modifiée), client d'API (ETag, gzip, If-Match, erreurs, `patchScore`), suppression différée.
- Playwright (`web/e2e/library.spec.ts`, `autosave.spec.ts`, API simulée par `fake-api.ts`, dont le `PATCH .../content` applique les opérations comme le serveur) : créer, renommer, dupliquer, supprimer avec et sans annulation, recherche, clavier, français, palette, enregistrement en patch et rechargement (le document stocké égale celui de l'éditeur), les enregistrements suivants n'envoient que ce qui a changé, repli sur un `PUT` gzip, conflit (les deux choix), hors ligne puis en ligne, 429, 413, 401, quitter juste après une modification, performances.
- API : l'aperçu de la liste (`ScoreApiTests`) ; les mises à jour incrémentales (`ScorePatchTests`, `ScorePatchPlannerTests`, voir [api.fr.md](api.fr.md#mises-à-jour-incrémentales)).
