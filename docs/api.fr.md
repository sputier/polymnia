# API des partitions

[English](api.md) · **Français**

API REST pour stocker et gérer les partitions, sous `/api/scores`. Chaque endpoint exige un utilisateur connecté et ne voit que les partitions de cet utilisateur. Le document est le JSON décrit dans [score-format.fr.md](score-format.fr.md) et validé contre [`schema/score.v1.schema.json`](../schema/score.v1.schema.json).

En développement, le document OpenAPI est servi sur `/openapi/v1.json`. Il n'est pas servi dans les autres environnements.

## Endpoints

| Méthode et chemin                    | Rôle                                                                                                                                                                                                         | Succès                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `GET /api/scores?q=&page=&pageSize=` | Liste vos partitions, la plus récemment modifiée d'abord. `q` est une recherche de titre insensible à la casse. `page` commence à 1, `pageSize` va de 1 à 100 (20 par défaut). Ne renvoie jamais le contenu, mais chaque élément porte un aperçu peu coûteux calculé depuis celui-ci : `measureCount` et `instruments` (l'identifiant d'instrument de chaque partie), pour les lignes de la page seulement. | `200` `{ items, page, pageSize, total }`                                |
| `GET /api/scores/{id}`               | Le document, avec son `ETag`. Respecte `If-None-Match`.                                                                                                                                                      | `200` document, ou `304`                                                |
| `POST /api/scores`                   | Crée une partition à partir d'un document (le corps de la requête est le document). Le titre est `meta.title`.                                                                                               | `201` résumé, `Location`, `ETag`                                        |
| `PUT /api/scores/{id}`               | Remplace le document. Exige `If-Match`.                                                                                                                                                                      | `200` `{ id, title, schemaVersion, version, updatedAt }`, nouvel `ETag` |
| `PATCH /api/scores/{id}/content`     | Mise à jour incrémentale : corps `{ "ops": [...] }`, les mesures, parties et métadonnées modifiées au lieu du document entier (voir [Mises à jour incrémentales](#mises-à-jour-incrémentales)). Exige `If-Match`. | `200` même forme que `PUT`, nouvel `ETag` |
| `PATCH /api/scores/{id}`             | Renomme : corps `{ "title": "..." }`. Réécrit aussi `meta.title` dans le document stocké. Exige `If-Match`.                                                                                                  | `200` même forme que `PUT`, nouvel `ETag`                               |
| `POST /api/scores/{id}/duplicate`    | Copie la partition, intitulée « <titre> (copy) ».                                                                                                                                                            | `201` résumé, `Location`, `ETag`                                        |
| `DELETE /api/scores/{id}`            | Supprime la partition.                                                                                                                                                                                       | `204`                                                                   |

Un résumé est `{ id, title, schemaVersion, version, createdAt, updatedAt }`.

## Contrôle d'accès

Chaque requête SQL est filtrée par l'identifiant du propriétaire pris dans la session, jamais dans la requête. Une partition qui appartient à quelqu'un d'autre répond **404**, exactement comme une partition inexistante (jamais 403), pour tous les endpoints, requêtes conditionnelles comprises.

## Concurrence : ETag, If-Match, If-None-Match

Chaque partition a une `version`, un compteur qui part de 1 et augmente à chaque modification (contenu ou titre). C'est l'`ETag` (`"3"`).

- `PUT` et les deux `PATCH` exigent `If-Match` avec le dernier `ETag` reçu (pour une mise à jour incrémentale, c'est la version de base des opérations). Absent : `428`. Pas un `ETag` (`*`, texte) : `400`. Version qui n'est plus la version courante : `409` (le `type` du problème est `urn:polymnia:problem:version-conflict`). Rechargez avec `GET`, fusionnez, recommencez.
- `GET` avec `If-None-Match` égal à l'`ETag` courant renvoie `304` sans lire le document (requête de version seule).
- Une modification est une seule instruction SQL atomique conditionnée par la version : deux modifications concurrentes avec la même version ne peuvent pas réussir toutes les deux.

## Validation

- Corps : `Content-Type: application/json` (`415` sinon), **4 Mio** au plus (`413` au-delà). Une partition de 500 mesures sur 4 portées pèse environ 1 Mo et les limites du schéma (2000 mesures) donnent environ 4 Mo, donc 4 Mio suffit tout en bornant mémoire, temps de validation et stockage. La limite est appliquée sur `Content-Length` et pendant la lecture (corps en chunks).
- Les corps de requête `Content-Encoding: gzip` ou `br` sont acceptés. Le plafond de 4 Mio s'applique à la taille **décompressée** (une bombe reçoit `413`) ; un flux corrompu reçoit `400`, tout autre `Content-Encoding` reçoit `415`.
- JSON invalide, document non conforme au schéma, ou imbrication de plus de 32 niveaux : `400`.
- `schemaVersion` doit être une version prise en charge (seulement `1` aujourd'hui) : `400` sinon.
- Titre (`meta.title`, renommage) : sans espaces aux extrémités, 200 caractères au plus (points de code Unicode), sans caractère de contrôle ni caractère de surcharge bidirectionnelle. Un titre vide est refusé partout. Le titre sans espaces aux extrémités est celui qui est stocké, dans la colonne et dans `meta.title` du document.
- Caractères que `jsonb` de PostgreSQL ne peut pas stocker (`\u0000`, demi-paires de substitution) : `400`.
- Le serveur vérifie la structure et les limites de taille (le schéma). Les règles sémantiques (une voix remplit sa mesure, liaisons, tuplets, doigtés) sont appliquées par le modèle côté client : une partition n'est relue que par son propriétaire.

### Comment le schéma est évalué

Le fichier de schéma est embarqué dans l'assembly de l'API. Les bibliothèques JSON Schema génériques ont mis 150 à 300 ms à valider une partition de 1 Mo (mesuré avec deux d'entre elles), ce qui suffit à dépasser le budget de 50 ms de la mise à jour. Le serveur utilise donc un petit évaluateur compilé (`CompiledSchema`) pour les mots-clés du schéma. Il refuse de charger un schéma qui utilise un mot-clé qu'il n'implémente pas, et un test le compare à une implémentation indépendante et complète (LateApexEarlySpeed.Json.Schema, BSD-3-Clause) sur des documents valides et invalides. Une différence volontaire : les identifiants terminés par un saut de ligne sont refusés (l'implémentation de référence les laisse passer).

## Mises à jour incrémentales

`PATCH /api/scores/{id}/content` enregistre quelques mesures modifiées sans renvoyer, analyser ni stocker de nouveau le reste de la partition. Le corps est `{ "ops": [ ... ] }` ; chaque opération remplace, insère ou supprime une **unité entière désignée par son identifiant stable** (jamais par sa position, jamais champ par champ) : le serveur n'a jamais à deviner ce qu'une position voulait dire. La version de base est l'en-tête `If-Match` : les opérations s'appliquent à exactement cette version du document, sinon la réponse est `409` et rien n'a changé.

| `op`                                                  | Effet                                                                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setMeta` `{ meta }`                                  | Remplace `meta` (titre, compositeur, tempo). Le titre est nettoyé (espaces aux extrémités) et stocké aussi dans la colonne, comme une sauvegarde complète.                                |
| `setMeasureInfo` `{ measureId, value }`               | Remplace le `MeasureInfo` de cette mesure (`value.id` vaut `measureId`).                                                                                                                  |
| `setStaffMeasure` `{ staffId, measureId, value }`     | Remplace la mesure d'une portée à la position de cette mesure.                                                                                                                            |
| `insertMeasure` `{ index, info, staffMeasures }`      | Insère une mesure à `index` : son `MeasureInfo` et une mesure de portée `{ staffId, value }` pour chaque portée de la partition, chacune une fois. `index` est la position une fois les opérations précédentes appliquées. |
| `deleteMeasure` `{ measureId }`                       | Supprime la mesure de la partition et de chaque portée. La dernière mesure ne peut pas être supprimée.                                                                                    |
| `replacePart` `{ partId, value }`                     | Remplace une partie entière (en-tête, portées, mesures) ; `value.id` vaut `partId`.                                                                                                       |
| `insertPart` `{ index, value }` / `deletePart` `{ partId }` | Insère une partie à `index` / la supprime (pas la dernière).                                                                                                                       |
| `setSlurs` `{ slurs }`                                | Remplace toute la liste de liaisons.                                                                                                                                                      |

Les opérations s'appliquent dans l'ordre, dans une transaction : si l'une ne peut pas l'être, aucune ne l'est (`400`, rien n'a changé). Un **fragment** (`value`, `meta`, `slurs`, `info`) est validé par le même schéma compilé qu'un document complet, contre la définition de schéma correspondante : un patch ne peut donc rien stocker qu'une sauvegarde complète refuserait. Ce qu'un fragment seul ne dit pas est vérifié contre la forme du document stocké (ses identifiants et nombres de mesures, parties et portées, lus sans charger le document) :

- chaque identifiant nommé par une opération doit exister (`measureId`, `staffId`, `partId`), un nouvel identifiant de mesure, de partie ou de portée ne doit pas exister ;
- chaque portée garde exactement une mesure par mesure de la partition (une partie insérée ou remplacée doit avoir autant de mesures par portée que la partition), et `insertMeasure` porte une mesure pour chaque portée ;
- les limites de tableaux du schéma tiennent après chaque opération (2000 mesures, 32 parties, au moins une mesure et une partie) ;
- si le document stocké réutilise un identifiant pour plusieurs mesures, parties ou portées, ou a une portée qui n'a pas une mesure par mesure (une sauvegarde complète ne le vérifie pas), aucun patch ne peut l'adresser : la réponse est `400` et le client enregistre le document entier, ce qui pose une base cohérente.

Le corps est strict : seulement les propriétés documentées, aucune propriété en double, UTF-8 sans marque d'ordre des octets, imbrication de 32 niveaux au plus. Les erreurs sont `400` (corps, opération ou fragment invalide, identifiant inexistant, structure refusée), `409` (la version de base n'est pas la version courante), `413` (corps au-delà de la limite, ou document corrigé au-delà de la limite de taille stockée), `428` et `415` comme pour `PUT`. Comme pour `PUT`, un corps mal formé est refusé d'abord (`400`, il ne dit rien d'aucune partition) ; ensuite une partition qui appartient à quelqu'un d'autre, ou absente, répond `404` quels que soient les identifiants nommés par les opérations.

La mise à jour est une seule instruction SQL conditionnée par la version, comme `PUT` : le document est réécrit dans PostgreSQL (`jsonb_set`, `jsonb_insert` et `#-` sur des paramètres liés, jamais concaténés dans l'instruction) et ne passe jamais par l'API. Le client garde le `PUT` complet pour la première sauvegarde, pour un import, après un conflit, et dès que les changements sont trop nombreux ou trop gros pour valoir l'envoi (voir [library.fr.md](library.fr.md)) ; une réponse `400` ou `413` à un patch lui fait envoyer le document entier.

## Limites

| Limite                                                                  | Valeur                                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Corps d'une partition                                                   | 4 Mio                                                                                                                   |
| Corps d'une mise à jour incrémentale (après décompression)              | 1 Mio, 64 opérations au plus, qui se développent en 64 modifications du document au plus (une mesure insérée en coûte une par portée) |
| Document stocké après un patch                                          | 12 Mio de `jsonb` binaire (environ 3 fois ce qu'accepte une sauvegarde complète ; la forme binaire d'une partition fait environ 1,6 fois son JSON) |
| Écritures (création, modification, renommage, duplication, suppression) | 120 par minute et par utilisateur (`RateLimiting:ScoreWrites:PermitLimit`, `WindowSeconds`)                             |
| Partitions par utilisateur                                              | 200 (`Scores:MaxScoresPerUser`), `409` au-delà pour création et duplication (`type` `urn:polymnia:problem:score-limit`) |
| Taille de page                                                          | 100                                                                                                                     |
| Texte de recherche `q`                                                  | 100 caractères                                                                                                          |

Lectures (liste, get) : 600 par minute et par utilisateur (`RateLimiting:ScoreWrites:ReadPermitLimit`). Au-delà d'un budget : `429` avec `Retry-After` (secondes). Au plus 16 écritures simultanées, tous utilisateurs confondus (`MaxConcurrentWrites`), et un utilisateur a au plus 2 écritures et 4 lectures en cours. Un corps non reçu en 15 s reçoit `408` ; une réponse non lue en 20 s est coupée.

## Erreurs

Les erreurs sont en `application/problem+json` (RFC 9457) sans trace de pile : `400` entrée invalide, `401` non connecté, `404` inconnue ou pas la vôtre, `409` conflit de version ou limite de partitions, `413` corps trop gros, `415` pas du JSON, `428` `If-Match` absent, `429` trop d'écritures.

## Stockage et performance

- Table `scores` : `id` (UUID), `owner_id` (UUID), `title`, `content` (`jsonb`), `schema_version`, `version`, `created_at`, `updated_at` (UTC).
- Index : `(owner_id, updated_at desc)` pour la liste, et un index GIN trigramme sur `title` (extension `pg_trgm`, créée par la migration ; extension « trusted », le propriétaire de la base peut la créer) pour la recherche `ILIKE '%texte%'`, qu'un B-tree ne sait pas servir.
- Une contrainte `CHECK` garantit que `content` est un objet JSON et que `version > 0`.
- `GET` diffuse le document de PostgreSQL vers la réponse en octets (pas de grosse chaîne .NET).
- La liste est une projection : elle ne charge jamais `content`. Les lectures utilisent `AsNoTracking()`. Les réponses sont compressées (aucun secret dedans). `GET` envoie `Cache-Control: private, no-cache` pour que les clients revalident avec l'`ETag`.
- Mesuré sur une partition de 500 mesures (935 Ko), p95 sur 200 requêtes, en processus contre PostgreSQL 17 dans Docker Desktop sous Windows (`POLYMNIA_PERF=true dotnet test --solution api/Polymnia.slnx --filter-class "*ScorePerformanceTests"`) :

| Opération                           | p95            |
| ----------------------------------- | -------------- |
| `GET` partition                     | environ 26 ms  |
| `GET` avec `If-None-Match` (304)    | environ 3 ms   |
| `GET` liste (20 partitions)         | environ 8 ms   |
| `PUT` partition                     | environ 128 ms |
| `PUT` partition, corps gzip (61 Ko) | environ 132 ms |
| `PATCH` content, 1 mesure (580 o)    | environ 35 à 44 ms |
| `PATCH` content, 3 mesures sur 3 portées (1 Ko) | environ 65 à 72 ms |

Le budget de 50 ms est tenu pour get et liste. Il n'est pas tenu pour un `PUT` du document complet de 1 Mo sur ce poste : environ 55 ms sont le simple transfert de 1 Mo vers la base via le proxy de ports de Docker Desktop (un `SELECT length($1)` nu), environ 30 ms sont l'analyse `jsonb` par PostgreSQL, et environ 27 ms la validation. Envoyer le corps compressé en gzip ne change rien (le lien vers l'API n'est pas le goulot ici). Un hôte Linux avec base locale supprime la première part. Une mise à jour incrémentale n'envoie pas le document : PostgreSQL le réécrit sur place avec `jsonb_set` (environ 15 ms par mégaoctet et par réécriture, mesuré) ; une mesure modifiée tient donc le budget et chaque mesure de plus sur une autre portée ajoute environ 15 ms. Le `PUT` complet reste pour les premiers enregistrements et les conflits.

## Authentification et CSRF

Les endpoints exigent le cookie de session décrit dans [Authentication](authentication.fr.md) ; l'identifiant utilisateur est sa claim `NameIdentifier` (un GUID). Toute méthode non sûre (`POST`, `PUT`, `PATCH`, `DELETE`) doit porter le jeton antiforgery dans l'en-tête `X-XSRF-TOKEN`, `duplicate` et `DELETE` compris (`400` sinon, avant toute lecture) ; un test le vérifie. `scores.owner_id` est une clé étrangère vers `users.id` avec `ON DELETE CASCADE` : supprimer un utilisateur supprime ses partitions.

## Liens de partage

Liens en lecture seule vers une partition, décrits dans [sharing.fr.md](sharing.fr.md) :

| Méthode et chemin               | Rôle                                                                                                                                 | Succès                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `GET /api/scores/{id}/share`    | Propriétaire : état `{ active, createdAt }`. Jamais le jeton.                                                                        | `200`                        |
| `POST /api/scores/{id}/share`   | Propriétaire : crée le lien (révoque l'actif). Seule réponse qui porte le jeton en clair : jamais compressée, `no-store`.            | `201` `{ token, createdAt }` |
| `DELETE /api/scores/{id}/share` | Propriétaire : révoque le lien actif. Idempotent.                                                                                    | `204`                        |
| `GET /api/shared` + header `X-Share-Token` | Public, sans session : le document de la partition. Jeton inconnu, révoqué ou mal formé : le même `404`. `no-store`, `noindex`, `no-referrer`. | `200` document               |

Les endpoints du propriétaire suivent les règles ci-dessus (session, antiforgery, `404` par propriétaire, budgets par utilisateur). L'endpoint public est limité par adresse client (IPv4, ou `/64` IPv6) : 60 requêtes par minute (`RateLimiting:Shared:PermitLimit`, `WindowSeconds`) et 32 en flux simultanées (`MaxConcurrentReads`), `429` avec `Retry-After` au-delà. `share_links.score_id` est une clé étrangère vers `scores.id` avec `ON DELETE CASCADE`.
## Compte : export et suppression

Trois autres endpoints concernent les données de l'utilisateur connecté (RGPD, voir [Confidentialité](privacy.fr.md)). L'utilisateur vient toujours de la session, jamais de la requête.

| Méthode et chemin    | Ce qu'il fait                                                                                                                                                                                                                                                                                                  | Succès                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `GET /api/me/export` | Diffuse un ZIP : `profile.json` (données du compte, sessions actives et liens de partage sous forme de dates seulement, jamais le jeton ni son hachage, liste des fichiers de partitions) et `scores/<titre>-<id>.json`, un par partition, tel que stocké. Aucun secret dedans (ni clé ou hachage de session, ni ticket, ni jeton). Jamais recompressé, `Cache-Control: no-store`. | `200` `application/zip` (pièce jointe) |
| `GET /api/legal`     | Public. Les informations de l'exploitant et les durées de conservation affichées sur la page de confidentialité : `{ configured, operatorName, contact, contactKind, address, hostingProvider, hostingCountry, logRetentionDays, sessionIdleDays, sessionAbsoluteDays }`. `Cache-Control: public, max-age=300`.      | `200`                                  |
| `DELETE /api/me`     | Supprime le compte : l'utilisateur et, par `ON DELETE CASCADE`, toutes ses partitions, sessions et toute autre ligne qui le référence. Exige l'en-tête antiforgery et une connexion plus récente que `Auth:RecentSignInWindow` (sinon `403` avec `code: "reauth-required"`). Efface les cookies.                  | `204`                                  |

**L'export est diffusé et sa mémoire est bornée.** L'archive est écrite dans la réponse au fur et à mesure, une partition à la fois : chaque document est lu depuis PostgreSQL en octets et copié par un petit tampon (même chemin que `GET /api/scores/{id}`), rien n'est assemblé en mémoire. Si le flux se rompt en route, la connexion est coupée : le client voit un téléchargement échoué, jamais une archive tronquée qui a l'air complète. Mesuré par le test `Export_of_the_largest_library_streams_in_bounded_memory` (200 partitions d'environ 1 Mo, le quota) : 208 Mo de JSON deviennent un ZIP de 11 Mo en 4 s environ, le tas managé grandit d'environ 3 Mo. Les noms de fichiers sont le titre réduit à `A-Z a-z 0-9 - _` (60 caractères au plus) suivi de l'id de la partition : uniques, et impossibles à sortir de `scores/`.

**Limites.** Export : 3 par 10 minutes et par utilisateur, un à la fois par utilisateur, 4 à la fois au total (`429` avec `Retry-After` au-delà), 5 minutes pour toute l'archive et 20 s par partition. Suppression : 5 par 10 minutes et par utilisateur.

**Tout ce qu'une future table stocke sur un utilisateur doit cascader.** Le test `Every_foreign_key_to_users_cascades_on_delete` lit le catalogue PostgreSQL et échoue si une clé étrangère vers `users` n'est pas `ON DELETE CASCADE` ; le test de suppression vérifie ensuite qu'aucune table ne garde de ligne de l'utilisateur supprimé. Quand vous ajoutez une table qui contient des données utilisateur (les liens de partage, par exemple), ajoutez-la aussi à l'export dans `AccountEndpoints`.
