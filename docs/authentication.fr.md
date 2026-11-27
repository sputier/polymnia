# Authentification

[English](authentication.md) · **Français**

Google est la seule méthode de connexion. C'est le serveur (et non le navigateur) qui dialogue avec Google et garde la session : aucun jeton n'atteint JavaScript, `localStorage` ou la page. C'est le patron « backend for frontend » (BFF).

## Déroulement

1. La page appelle `GET /api/me`. `401` signifie anonyme : l'écran de connexion s'affiche.
2. Le lien « Se connecter avec Google » mène à `GET /api/auth/login?returnUrl=/chemin`. C'est une redirection pleine page, pas une popup (compatible avec `Cross-Origin-Opener-Policy: same-origin`). `returnUrl` doit être un chemin local ; tout le reste (`https://…`, `//hôte`, `/\hôte`, caractères de contrôle, `/api/…`) est remplacé par `/`.
3. Le serveur redirige vers Google avec le flux « authorization code », **PKCE (S256)**, `state` et `nonce`. L'URI de redirection est construite à partir de `Auth:PublicBaseUrl`, jamais à partir de l'en-tête `Host` de la requête.
4. Google redirige vers `GET /api/auth/callback`. Le serveur échange le code, valide le jeton d'identité signé (émetteur, audience, signature, expiration, `nonce`) et ne lit que `sub`, `name` et `picture`. `SaveTokens` est désactivé : aucun jeton Google n'est conservé.
5. L'utilisateur est créé ou mis à jour dans la table `users`, une **session côté serveur** est enregistrée dans PostgreSQL et le navigateur reçoit un cookie de session opaque. Le serveur redirige vers `returnUrl`.
6. `POST /api/auth/logout` supprime la session sur le serveur et efface les cookies.

`AddOpenIdConnect` est utilisé plutôt que `AddGoogle` : il valide le jeton d'identité avec les clés publiées par Google, contrôle `nonce` et n'a pas besoin d'appel supplémentaire à l'endpoint user-info.

Si Google signale une erreur ou si l'utilisateur annule, le serveur journalise le type d'échec (jamais son contenu) et redirige vers `/?signin=failed` ; l'écran de connexion affiche un message générique.

## Données stockées

| Table | Contenu |
| --- | --- |
| `users` | identifiant interne (UUID), `sub` Google (unique), nom affiché, URL de l'avatar, langue préférée, dates de création et de dernière visite |
| `user_sessions` | hash SHA-256 de la clé de session, identifiant utilisateur, ticket chiffré, dates d'expiration |
| `data_protection_keys` | clés Data Protection d'ASP.NET Core |

**Aucune adresse e-mail n'est demandée ni stockée** (le scope est `openid profile`). L'URL de l'avatar n'est conservée que si c'est une URL `https` d'un hôte `*.googleusercontent.com` (la Content Security Policy n'autorise les images que depuis cet hôte).

## Cookies

| Cookie | Rôle | Attributs |
| --- | --- | --- |
| `__Host-Polymnia.Session` | clé de session opaque (aléatoire, 256 bits) | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, pas de `Domain` |
| `__Host-Polymnia.Correlation.*`, `__Host-Polymnia.Nonce.*` | contrôles `state` et `nonce` de la connexion, courte durée | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` |
| `__Host-Polymnia.Antiforgery` | jeton antiforgery côté cookie | `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` |
| `__Host-XSRF-TOKEN` | jeton antiforgery de requête, lisible par la page | `Secure`, `SameSite=Strict`, `Path=/` (pas `HttpOnly`, volontairement) |

Le navigateur refuse un cookie `__Host-` qui n'est pas `Secure`, sans `Path=/` ou avec un `Domain`. `SameSite=Lax` (et non `Strict`) sur le cookie de session est nécessaire : le navigateur doit l'envoyer sur la redirection de retour de Google.

### Session côté serveur

Le cookie ne contient qu'une clé aléatoire. Le ticket (l'identifiant interne de l'utilisateur) est chiffré avec Data Protection et stocké dans `user_sessions`, retrouvé par le hash SHA-256 de la clé. Conséquences :

- La déconnexion supprime la ligne : une copie du cookie faite avant ne fonctionne plus immédiatement.
- Supprimer un utilisateur supprime ses sessions (cascade) ; à chaque requête l'utilisateur doit toujours exister, sinon la session est rejetée.
- La session est glissante : elle se termine après 7 jours sans usage (`Auth:IdleTimeout`) et ne dure jamais plus de 30 jours (`Auth:AbsoluteTimeout`), même si elle est utilisée en continu. Les lignes expirées sont purgées toutes les heures.

### Clés Data Protection

Les clés sont stockées dans PostgreSQL (`data_protection_keys`) et le nom d'application est `Polymnia` : les redémarrages et plusieurs conteneurs partagent les mêmes clés, donc cookies et jetons restent valides. **Elles sont chiffrées au repos avec un certificat, obligatoire hors Development** (l'application refuse de démarrer sans `DataProtection:CertificatePath`) : un dump ou une sauvegarde de la base ne les expose donc pas. Voir « Chiffrer les clés Data Protection » ci-dessous. Les clés de session sont aléatoires, stockées hachées, et ne dépendent pas de ces clés.

## Protection CSRF (antiforgery)

Motif cookie + en-tête. Toute requête `POST`, `PUT`, `PATCH` et `DELETE` (et toute méthode autre que `GET`, `HEAD`, `OPTIONS`, `TRACE`) sous `/api` doit porter l'en-tête `X-XSRF-TOKEN`, vérifié par un middleware global avant le routage : aucun endpoint ne peut l'oublier. L'échec est un `400` avec un corps problem dont le `code` vaut `antiforgery`. Rien n'est lu dans le corps de la requête.

1. La page appelle `GET /api/auth/antiforgery`. La réponse n'a pas de corps : le serveur pose le cookie `HttpOnly` du jeton cookie et le cookie lisible du jeton de requête. L'endpoint n'est jamais compressé ni mis en cache (règle BREACH : une réponse qui porte un jeton n'est pas compressée).
2. Le client d'API recopie le cookie du jeton de requête dans `X-XSRF-TOKEN` sur les méthodes non sûres. Un jeton est lié à l'identité courante : la page en récupère un nouveau une fois l'utilisateur connu ; un jeton rejeté est remplacé une fois et la requête est rejouée.

Un appel d'API sans session valide renvoie `401`, jamais une redirection vers Google.

## Configuration

| Clé | Variable d'environnement | Signification |
| --- | --- | --- |
| `Auth:PublicBaseUrl` | `Auth__PublicBaseUrl` | Origine publique, par exemple `https://polymnia.example` (schéma, hôte, port éventuel ; pas de chemin). `https` obligatoire, sauf `http://localhost…` en Development. |
| `Auth:Google:ClientId` | `Auth__Google__ClientId` | Identifiant du client OAuth |
| `Auth:Google:ClientSecret` | `Auth__Google__ClientSecret` | Secret du client OAuth. Ne jamais le commiter. |
| `Auth:IdleTimeout` | `Auth__IdleTimeout` | Expiration glissante, `7.00:00:00` par défaut |
| `Auth:AbsoluteTimeout` | `Auth__AbsoluteTimeout` | Durée de vie absolue, `30.00:00:00` par défaut |
| `DataProtection:CertificatePath` | `DataProtection__CertificatePath` | Fichier PKCS#12 (`.pfx`) qui chiffre les clés Data Protection. Obligatoire hors Development. |
| `DataProtection:CertificatePassword` | `DataProtection__CertificatePassword` | Mot de passe de ce fichier |
| `Auth:RateLimit:PermitLimit`, `Auth:RateLimit:Window` | `Auth__RateLimit__PermitLimit`, `Auth__RateLimit__Window` | Requêtes par IP cliente sur `/api/auth/*` par fenêtre, `60` par `00:01:00` par défaut. Au-delà : `429` avec `Retry-After`. |

- **Tout environnement autre que Development refuse de démarrer** s'il manque l'identifiant client, le secret ou une `Auth:PublicBaseUrl` valide (le message nomme la clé, jamais sa valeur).
- En Development et dans les tests l'application démarre sans ces valeurs : l'authentification est désactivée, une tentative de connexion renvoie `503` et `/api/me` renvoie `401`.
- **`AllowedHosts` doit lister les vrais noms d'hôte** (ni vide, ni `*`) hors Development, sinon l'application refuse de démarrer. L'URI de redirection n'en dépend pas, mais les en-têtes `Host` inattendus doivent être refusés.
- **`DataProtection:CertificatePath` est obligatoire** hors Development (voir « Chiffrer les clés Data Protection »).
- Derrière un reverse proxy, transmettez le schéma d'origine (voir « Derrière un reverse proxy » dans le [guide de développement](development.fr.md)) : les cookies sont `Secure` et la redirection HTTPS doit voir du HTTPS.

## Chiffrer les clés Data Protection

Créez une fois un certificat auto-signé (il ne sert qu'à chiffrer les clés, personne ne se connecte avec) et gardez le fichier et son mot de passe dans votre gestionnaire de secrets :

```
mkdir -p secrets
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -subj "/CN=polymnia-keys" -days 3650
openssl pkcs12 -export -inkey key.pem -in cert.pem -out secrets/polymnia-keys.pfx -passout pass:<choisir un mot de passe>
shred -u key.pem cert.pem; chmod 644 secrets/polymnia-keys.pfx
```

Avec `docker-compose.yml` : le fichier est monté comme secret Docker sur `/run/secrets/polymnia_keys` (chemin défini par `POLYMNIA_KEYS_CERT_FILE`, `./secrets/polymnia-keys.pfx` par défaut) et le mot de passe vient de `POLYMNIA_KEYS_CERT_PASSWORD` dans `.env`. Sans compose, renseignez `DataProtection__CertificatePath` et `DataProtection__CertificatePassword`. Le fichier est protégé par mot de passe : `chmod 644` permet à l'utilisateur du conteneur de le lire. **Conservez ce fichier : sans lui, les clés stockées sont illisibles, toutes les sessions et tous les jetons deviennent invalides et les utilisateurs doivent se reconnecter.** Le fichier doit contenir la clé privée et être dans sa période de validité, sinon l'application refuse de démarrer. **Activer le chiffrement sur une base qui contient déjà des clés :** les clés existantes restent lisibles mais non chiffrées jusqu'à leur expiration (90 jours) ; pour tout chiffrer d'un coup, exécutez `DELETE FROM data_protection_keys;` une fois le certificat configuré (toutes les sessions et tous les jetons deviennent invalides, les utilisateurs se reconnectent). Modèle de menace : cela protège une base ou une sauvegarde divulguée ; qui peut lire l'hôte (le `.pfx`, `.env`, `docker inspect`) peut encore déchiffrer, comme l'application elle-même. Pour changer de certificat, générez un nouveau fichier et remplacez-le, en acceptant que les utilisateurs se reconnectent.

## Limitation de débit et journal d'audit

`/api/auth/*` est limité par IP cliente (`Auth:RateLimit`, 60 requêtes par minute par défaut) : au-delà, la réponse est `429` avec `Retry-After`. La clé est l'adresse IPv4, ou le préfixe /64 en IPv6. **Derrière un reverse proxy, mettez `POLYMNIA_FORWARDED_HEADERS=true`** (voir le [guide de développement](development.fr.md)) : sinon tous les utilisateurs partagent l'adresse du proxy et un seul abuseur peut bloquer la connexion de tous. Avec un CDN devant le proxy, augmentez `ForwardedHeaders:ForwardLimit` en conséquence. Une requête sans adresse cliente (socket Unix) n'est pas limitée. Un appel limité à `/api/auth/callback` est redirigé vers `/?signin=failed` au lieu d'afficher une erreur ; les rejets sont journalisés au plus une fois toutes les 10 secondes, avec un compteur. Connexion et déconnexion sont journalisées en événements structurés de niveau `Information` (`AuthSignedIn` id 10, `AuthSignedOut` id 11, avec le seul identifiant interne de l'utilisateur : jamais de nom, d'e-mail, de sujet Google ni de jeton) ; une connexion échouée est `AuthSignInFailed` (id 4, `Warning`, type d'échec seulement) et une requête limitée `AuthRateLimited` (id 12). Les cookies de corrélation et de nonce d'une connexion vivent 10 minutes.

## Créer le client OAuth Google

1. Ouvrez la [console Google Cloud](https://console.cloud.google.com/), créez ou choisissez un projet.
2. « API et services » → « Écran de consentement OAuth » : choisissez « Externe », renseignez le nom de l'application et votre e-mail d'assistance, ajoutez votre domaine. Scopes : ceux par défaut (`openid`, `profile`) ; inutile d'ajouter un scope sensible. Publiez l'application quand vous êtes prêt à accepter des utilisateurs hors liste de test.
3. « Identifiants » → « Créer des identifiants » → « ID client OAuth » → type d'application « Application Web ».
4. « URI de redirection autorisés » : ajoutez `<Auth:PublicBaseUrl>/api/auth/callback` (par exemple `https://polymnia.example/api/auth/callback`). Pour le développement local, ajoutez aussi `http://localhost:5173/api/auth/callback`. Laissez « Origines JavaScript autorisées » vide : le navigateur n'appelle jamais Google.
5. Copiez l'identifiant et le secret dans votre gestionnaire de secrets (voir ci-dessous), jamais dans le dépôt.

## Installation locale

1. Démarrez PostgreSQL et appliquez les migrations (voir le [guide de développement](development.fr.md)).
2. Donnez à l'API ses réglages Google (user-secrets, jamais commités) :

   ```
   dotnet user-secrets set "Auth:Google:ClientId" "<identifiant client>" --project api/Polymnia.Api
   dotnet user-secrets set "Auth:Google:ClientSecret" "<secret client>" --project api/Polymnia.Api
   ```

   En Development, `Auth:PublicBaseUrl` vaut `http://localhost:5173` par défaut (le serveur de dev Vite).
3. Lancez l'API (`dotnet run --project api/Polymnia.Api`) et le front end (`npm run dev` dans `web/`). Ouvrez `http://localhost:5173` : le proxy Vite transmet `/api` à l'API, le navigateur ne voit donc qu'une origine et les cookies fonctionnent. Les navigateurs acceptent les cookies `Secure` sur `localhost` en HTTP, sauf Safari : utilisez Chrome ou Firefox pour la connexion locale.

Sans réglages Google, l'application fonctionne mais ne peut connecter personne.

## Tests

Les tests n'appellent jamais Google. Un faux handler distant remplace le schéma Google et renvoie des claims configurables ; tout ce qui suit est le vrai code (cookie de corrélation, création de l'utilisateur, session côté serveur). Un test pilote aussi le vrai handler OpenID Connect jusqu'à la redirection vers Google, avec un document de découverte statique, pour vérifier l'URI de redirection, PKCE, `state`, `nonce` et les attributs des cookies. La connexion avec un vrai compte Google se vérifie à la main.
