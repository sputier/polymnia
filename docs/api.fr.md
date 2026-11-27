# API des partitions

[English](api.md) · **Français**

API REST pour stocker et gérer les partitions, sous `/api/scores`. Chaque endpoint exige un utilisateur connecté et ne voit que les partitions de cet utilisateur. Le document est le JSON décrit dans [score-format.fr.md](score-format.fr.md) et validé contre [`schema/score.v1.schema.json`](../schema/score.v1.schema.json).

En développement, le document OpenAPI est servi sur `/openapi/v1.json`. Il n'est pas servi dans les autres environnements.

## Endpoints

| Méthode et chemin | Rôle | Succès |
| ----------------- | ---- | ------ |
| `GET /api/scores?q=&page=&pageSize=` | Liste vos partitions, la plus récemment modifiée d'abord. `q` est une recherche de titre insensible à la casse. `page` commence à 1, `pageSize` va de 1 à 100 (20 par défaut). Ne renvoie jamais le contenu. | `200` `{ items, page, pageSize, total }` |
| `GET /api/scores/{id}` | Le document, avec son `ETag`. Respecte `If-None-Match`. | `200` document, ou `304` |
| `POST /api/scores` | Crée une partition à partir d'un document (le corps de la requête est le document). Le titre est `meta.title`. | `201` résumé, `Location`, `ETag` |
| `PUT /api/scores/{id}` | Remplace le document. Exige `If-Match`. | `200` `{ id, title, schemaVersion, version, updatedAt }`, nouvel `ETag` |
| `PATCH /api/scores/{id}` | Renomme : corps `{ "title": "..." }`. Réécrit aussi `meta.title` dans le document stocké. Exige `If-Match`. | `200` même forme que `PUT`, nouvel `ETag` |
| `POST /api/scores/{id}/duplicate` | Copie la partition, intitulée « <titre> (copy) ». | `201` résumé, `Location`, `ETag` |
| `DELETE /api/scores/{id}` | Supprime la partition. | `204` |

Un résumé est `{ id, title, schemaVersion, version, createdAt, updatedAt }`.

## Contrôle d'accès

Chaque requête SQL est filtrée par l'identifiant du propriétaire pris dans la session, jamais dans la requête. Une partition qui appartient à quelqu'un d'autre répond **404**, exactement comme une partition inexistante (jamais 403), pour tous les endpoints, requêtes conditionnelles comprises.

## Concurrence : ETag, If-Match, If-None-Match

Chaque partition a une `version`, un compteur qui part de 1 et augmente à chaque modification (contenu ou titre). C'est l'`ETag` (`"3"`).

- `PUT` et `PATCH` exigent `If-Match` avec le dernier `ETag` reçu. Absent : `428`. Pas un `ETag` (`*`, texte) : `400`. Version qui n'est plus la version courante : `409` (le `type` du problème est `urn:polymnia:problem:version-conflict`). Rechargez avec `GET`, fusionnez, recommencez.
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

## Limites

| Limite | Valeur |
| ------ | ------ |
| Corps d'une partition | 4 Mio |
| Écritures (création, modification, renommage, duplication, suppression) | 120 par minute et par utilisateur (`RateLimiting:ScoreWrites:PermitLimit`, `WindowSeconds`) |
| Partitions par utilisateur | 200 (`Scores:MaxScoresPerUser`), `409` au-delà pour création et duplication (`type` `urn:polymnia:problem:score-limit`) |
| Taille de page | 100 |
| Texte de recherche `q` | 100 caractères |

Lectures (liste, get) : 600 par minute et par utilisateur (`RateLimiting:ScoreWrites:ReadPermitLimit`). Au-delà d'un budget : `429` avec `Retry-After` (secondes). Au plus 16 écritures simultanées, tous utilisateurs confondus (`MaxConcurrentWrites`).

## Erreurs

Les erreurs sont en `application/problem+json` (RFC 9457) sans trace de pile : `400` entrée invalide, `401` non connecté, `404` inconnue ou pas la vôtre, `409` conflit de version ou limite de partitions, `413` corps trop gros, `415` pas du JSON, `428` `If-Match` absent, `429` trop d'écritures.

## Stockage et performance

- Table `scores` : `id` (UUID), `owner_id` (UUID), `title`, `content` (`jsonb`), `schema_version`, `version`, `created_at`, `updated_at` (UTC).
- Index : `(owner_id, updated_at desc)` pour la liste, et un index GIN trigramme sur `title` (extension `pg_trgm`, créée par la migration ; extension « trusted », le propriétaire de la base peut la créer) pour la recherche `ILIKE '%texte%'`, qu'un B-tree ne sait pas servir.
- Une contrainte `CHECK` garantit que `content` est un objet JSON et que `version > 0`.
- `GET` diffuse le document de PostgreSQL vers la réponse en octets (pas de grosse chaîne .NET).
- La liste est une projection : elle ne charge jamais `content`. Les lectures utilisent `AsNoTracking()`. Les réponses sont compressées (aucun secret dedans). `GET` envoie `Cache-Control: private, no-cache` pour que les clients revalident avec l'`ETag`.
- Mesuré sur une partition de 500 mesures (935 Ko), p95 sur 200 requêtes, en processus contre PostgreSQL 17 dans Docker Desktop sous Windows (`POLYMNIA_PERF=true dotnet test --solution api/Polymnia.slnx --filter-class "*ScorePerformanceTests"`) :

| Opération | p95 |
| --------- | --- |
| `GET` partition | environ 26 ms |
| `GET` avec `If-None-Match` (304) | environ 3 ms |
| `GET` liste (20 partitions) | environ 8 ms |
| `PUT` partition | environ 128 ms |
| `PUT` partition, corps gzip (61 Ko) | environ 132 ms |

Le budget de 50 ms est tenu pour get et liste. Il n'est pas tenu pour un `PUT` du document complet de 1 Mo sur ce poste : environ 55 ms sont le simple transfert de 1 Mo vers la base via le proxy de ports de Docker Desktop (un `SELECT length($1)` nu), environ 30 ms sont l'analyse `jsonb` par PostgreSQL, et environ 27 ms la validation. Envoyer le corps compressé en gzip ne change rien (le lien vers l'API n'est pas le goulot ici). Un hôte Linux avec base locale supprime la première part. Réduire le reste suppose de ne pas renvoyer tout le document à chaque sauvegarde (mises à jour incrémentales), ce qui est un choix de conception pour l'éditeur.

## Authentification et CSRF

Les endpoints exigent le cookie de session décrit dans [Authentication](authentication.md) ; l'identifiant utilisateur est sa claim `NameIdentifier` (un GUID). Toute méthode non sûre (`POST`, `PUT`, `PATCH`, `DELETE`) doit porter le jeton antiforgery dans l'en-tête `X-XSRF-TOKEN`, `duplicate` et `DELETE` compris (`400` sinon, avant toute lecture) ; un test le vérifie. `scores.owner_id` est une clé étrangère vers `users.id` avec `ON DELETE CASCADE` : supprimer un utilisateur supprime ses partitions.
