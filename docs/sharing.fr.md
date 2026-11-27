# Liens de partage en lecture seule

[English](sharing.md) · **Français**

Le propriétaire d'une partition peut la partager avec un lien. Toute personne qui a le lien peut voir et écouter la partition, sans compte. Elle ne peut ni la modifier ni atteindre une autre partition.

Code : `api/Polymnia.Api/Sharing/` (endpoints, limitation de débit), `api/Polymnia.Core/Sharing/` (jeton), `api/Polymnia.Infrastructure/Sharing/` (accès aux données), `web/src/sharing/` (dialogue et visionneuse), `web/src/api/shares.ts` (client).

## Fonctionnement

| Étape            | Ce qui se passe                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Création         | Le propriétaire ouvre **Partager** (barre du haut, menu d'une carte de la bibliothèque, ou palette de commandes : `Ctrl+Maj+L`, « Partager cette partition… ») et clique **Créer un lien**.       |
| Lien             | `https://<hôte>/#/s/<jeton>`. Le dialogue l'affiche une seule fois, sélectionné, avec un bouton **Copier le lien** (API Clipboard, avec repli par sélection).                                     |
| Ouverture        | Le visiteur voit la partition et la barre de lecture, sans être connecté. Pas d'écran de connexion, pas de requête de session, pas d'interface d'édition.                                         |
| Régénération     | **Nouveau lien** révoque le lien actuel et en crée un autre. Une partition a au plus un lien actif.                                                                                               |
| Arrêt du partage | **Arrêter le partage** révoque le lien immédiatement. La visionneuse affiche alors « Ce lien n'est plus valide. »                                                                                 |
| Export           | Le dialogue contient aussi les boutons d'export (MusicXML, MXL, MIDI, PDF, PNG), les mêmes actions que le menu Exporter de l'éditeur. Depuis la bibliothèque, la partition est chargée pour cela. |

La visionneuse montre toujours la version **actuelle** de la partition : les modifications du propriétaire apparaissent au chargement suivant.

## Le jeton

- 32 octets aléatoires (**256 bits**) du générateur cryptographique du système (`RandomNumberGenerator`), écrits en base64url : 43 caractères, sans remplissage. La forme est publique ; le contenu ne se devine pas (2^256 possibilités).
- Le serveur ne stocke que son **hash SHA-256** (`share_links.token_hash`, `bytea`, unique). Le jeton en clair est renvoyé **une seule fois**, dans la réponse de la création, et n'est ni stocké ni journalisé.

### Décision : hash seul, pas de chiffrement

L'alternative était de stocker le jeton chiffré avec Data Protection pour que le propriétaire puisse revoir le lien. Nous avons choisi le **hash seul** :

- Une fuite de la base (sauvegarde, injection SQL, réplique volée) donne à un attaquant des hashs de valeurs aléatoires de 256 bits : rien d'exploitable. Des jetons chiffrés seraient récupérables par quiconque obtient aussi les clés Data Protection (stockées dans la même base, protégées par un seul certificat) : une seule fuite combinée exposerait tous les liens.
- Un lien de partage est un secret d'accès. Un secret qu'on ne peut pas relire est le choix sûr par défaut ; le propriétaire qui a perdu un lien en régénère un en un clic.
- Le coût ne touche que l'usage : le dialogue montre le lien complet juste après la création ; ensuite il indique que le lien est actif et depuis quand, et propose **Nouveau lien**.

Un hash rapide convient ici car l'entrée est de l'aléa sur 256 bits, pas un mot de passe : il n'y a rien à deviner par force brute, donc pas besoin d'une fonction de dérivation lente.

## Endpoint public

`GET /api/shared` avec le jeton dans l'**en-tête de requête `X-Share-Token`**, sans authentification. Le jeton est le seul secret. Il n'est jamais dans l'URL (chemin ou requête) : aucun journal d'accès, scope de journal ni `Referer` ne peut le porter ; `/api/shared/<n'importe quoi>` et `?token=` sont de simples `404`.

| Cas                                         | Réponse                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Lien actif                                  | `200`, le document de la partition (JSON, `meta.title` est le titre), lu en flux depuis PostgreSQL comme `GET /api/scores/{id}`. |
| Jeton absent, révoqué, inconnu ou mal formé | `404` ProblemDetails, **identique** dans tous les cas (statut, titre, en-têtes).                                                 |
| Trop de requêtes                            | `429` avec `Retry-After`.                                                                                                        |
| Toute autre méthode                         | Jamais un succès. `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `TRACE` reçoivent `400` (antiforgery, sans jeton) ou `404`/`405`. |

En-têtes de chaque réponse, `404` compris : `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`. Aucun cookie n'est posé.

Propriétés de sécurité :

- **Lecture seule par construction.** La route n'accepte que `GET` et ne lit que la partition derrière le jeton. Le jeton n'est accepté nulle part ailleurs (`/api/scores/*` exige toujours une session ; un test vérifie un jeton dans la chaîne de requête et dans un en-tête `Authorization`).
- **Pas d'oracle temporel sur le secret.** La recherche se fait par le hash sur un index unique : l'application ne compare jamais un secret octet par octet. Un jeton de mauvaise forme est refusé sans accès à la base ; la forme est publique, cela ne révèle rien.
- **Limitation par adresse client** : 60 requêtes par minute et par adresse IPv4 ou par `/64` IPv6 (même clé que la limite de connexion), plus au plus 4 lectures publiques simultanées par adresse et 32 en tout (les plafonds de concurrence sont vérifiés d'abord, une requête refusée ne consomme donc pas le budget). Une adresse inconnue partage une clé au lieu d'être illimitée. Réglages `RateLimiting:Shared:PermitLimit`, `WindowSeconds`, `MaxConcurrentReads` et `MaxConcurrentReadsPerClient`. Derrière un proxy inverse, activez les en-têtes transférés (`POLYMNIA_FORWARDED_HEADERS=true`, voir [self-hosting.fr.md](self-hosting.fr.md)), sinon tous les visiteurs partagent le budget du proxy. Si les en-têtes transférés sont désactivés et qu'une requête arrive avec `X-Forwarded-For` ou `Forwarded`, l'application journalise un avertissement par processus (`ForwardedHeadersDisabled`).
- **La compression reste active** pour cet endpoint. La règle BREACH (« une réponse qui porte un secret n'est jamais compressée », voir [authentication.fr.md](authentication.fr.md)) concerne le _corps_ : le corps de cette réponse est la partition, qui n'est pas secrète, et ne contient jamais le jeton. La réponse de création, qui porte le jeton, est en `DisableResponseCompression()`.
- **Aucun jeton dans les journaux, par construction.** Le jeton est dans un en-tête, qu'aucun journal du framework, scope de journal (`RequestPath`) ou journal d'accès par défaut d'un proxy inverse n'enregistre. L'application ne journalise que les événements d'audit `ShareLinkCreated` / `ShareLinkRevoked` (identifiant utilisateur et partition). Un test lance l'hôte avec tous les niveaux à `Trace` et les scopes capturés, et vérifie qu'aucune entrée ni aucun scope ne contient le jeton ni son hash. Ne configurez pas un proxy pour journaliser les en-têtes de requête.

### Pourquoi une route par fragment (`#/s/<jeton>`)

Le lien partagé contient le jeton dans le **fragment**. Un navigateur n'envoie jamais le fragment : le chargement de la page (`GET /`) ne porte pas le jeton, qui reste donc hors des journaux d'accès du serveur et du proxy pour la page, et hors de l'en-tête `Referer` de tout ce que la page charge ou pointe. La visionneuse lit ensuite le jeton en JavaScript et appelle `GET /api/shared` avec le jeton dans l'en-tête `X-Share-Token`, avec `credentials: 'omit'`, `cache: 'no-store'` et `referrerPolicy: 'no-referrer'` ; la page pose aussi `<meta name="referrer" content="no-referrer">`. Le jeton n'arrive au serveur que comme en-tête de requête, jamais dans une URL. Même origine uniquement : aucun CORS n'est configuré, un autre site ne peut pas appeler l'endpoint depuis un navigateur.

Un robot d'indexation ne voit pas non plus le fragment, et la visionneuse ajoute `<meta name="robots" content="noindex, nofollow">` tant qu'elle est affichée.

### Signaler cette page

Le pied de page de la visionneuse publique a un lien **Signaler cette page** vers le [formulaire de contact](contact.fr.md) (`#/contact?topic=report&page=<jeton>`), pour que quiconque trouve une partition partagée qui ne devrait pas être publique puisse le dire à l'exploitant sans qu'une adresse soit publiée. Le formulaire s'ouvre sur le sujet « Signaler une page partagée » avec le lien de la page écrit dans le message : l'expéditeur le voit et peut le modifier ou le retirer, et il est enregistré et transmis comme le reste du message (le lien ouvre la partition : il est aussi sensible que le message). Seul un jeton bien formé devient un lien. Le propriétaire révoque un lien signalé comme n'importe quel autre (**Arrêter le partage**).

## Endpoints du propriétaire

Sous `/api/scores/{id}/share`. Ils exigent la session et, pour les méthodes non sûres, l'en-tête antiforgery. Une partition d'un autre utilisateur répond `404`, comme une partition inexistante. Limites : les budgets de lecture et d'écriture par utilisateur de [api.fr.md](api.fr.md).

| Méthode et chemin               | Rôle                                                                                                     | Succès                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `GET /api/scores/{id}/share`    | État : `{ active, createdAt }`. Jamais le jeton.                                                         | `200`                        |
| `POST /api/scores/{id}/share`   | Crée le lien, en révoquant l'actif s'il existe. Sans corps. Jamais compressé, `Cache-Control: no-store`. | `201` `{ token, createdAt }` |
| `DELETE /api/scores/{id}/share` | Révoque le lien actif. Idempotent.                                                                       | `204`                        |

Un `409` à la création signifie que deux créations se sont croisées pour la même partition ; réessayez.

## Stockage

Table `share_links` : `id` (UUID), `score_id` (clé étrangère vers `scores.id`, `ON DELETE CASCADE`), `token_hash` (`bytea`, 32 octets, unique, vérifié), `created_at`, `revoked_at` (nul tant que le lien est actif). Un index unique partiel sur `score_id WHERE revoked_at IS NULL` fait garantir par la base **au plus un lien actif par partition**, même pour deux créations concurrentes. Créer un lien supprime les anciennes lignes révoquées de cette partition : une partition porte au plus deux lignes.

Supprimer une partition supprime ses liens ; supprimer un utilisateur supprime ses partitions, donc ses liens (les deux sont testés).

## Tests

- API (`ShareLinkTests`, Testcontainers) : entropie et format du jeton ; seul le hash est stocké ; le jeton est renvoyé une fois et jamais par l'état ; gestion réservée au propriétaire (autre utilisateur : `404`) ; session et antiforgery exigés ; jeton valide `200` avec les en-têtes de confidentialité ; jetons inconnus, mal formés et révoqués : même `404` ; la régénération révoque l'ancien lien ; des créations concurrentes laissent un seul lien actif ; toute méthode non sûre est refusée ; la révocation est immédiate ; limite `429` par adresse et par `/64` IPv6 ; suppression en cascade avec la partition et l'utilisateur ; aucun jeton dans les journaux.
- Vitest (`web/src/sharing/sharing.test.tsx`) : la route, l'URL (jeton dans le fragment), les options de la requête, le dialogue (créer, copier, repli, révoquer, n'affiche jamais un jeton existant, dialogue modal accessible), la visionneuse (sans connexion, lecture seule, aucune requête de session, `noindex`, lien invalide, nouvel essai).
- Playwright (`web/e2e/share.spec.ts`) : partager depuis la barre du haut et copier ; ouvrir dans un contexte de navigateur déconnecté et voir la partition ; lire (audio simulé) ; révoquer et voir « Ce lien n'est plus valide. » ; régénérer ; la commande de la palette. La requête publique ne porte ni cookie ni référent.
