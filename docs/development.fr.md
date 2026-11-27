# Guide de développement

[English](development.md) · **Français**

## Front end

Le front end se trouve dans [`web/`](../web) : Vite, React et TypeScript (`strict`).

### Prérequis

- Node.js 24 LTS (voir `web/.nvmrc` ; Node 22 ou plus récent fonctionne).
- npm (fourni avec Node).

### Commandes

À lancer depuis `web/`.

| Commande               | Rôle                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `npm ci`               | Installe exactement les dépendances verrouillées             |
| `npm run dev`          | Démarre le serveur de développement                          |
| `npm run lint`         | Vérifie ESLint et Prettier                                   |
| `npm run format`       | Formate le code avec Prettier                                |
| `npm run typecheck`    | Vérification des types TypeScript                            |
| `npm test`             | Tests unitaires (Vitest et Testing Library)                  |
| `npm run build`        | Vérifie les types et construit la version de production dans `dist/` |
| `npm run size`         | Vérifie le budget de poids (à lancer après `build`)          |
| `npm run bench`        | Benchmarks du modèle de partition (échoue au-delà du budget) |
| `npm run test:e2e`     | Tests de fumée Playwright (Chromium, construit et sert l'application) |

Première exécution des tests de bout en bout : `npx playwright install chromium`.

### Budget de performance

Le JavaScript initial du premier écran doit rester à **150 Ko gzip** ou moins. `npm run size` lit `dist/index.html`, additionne les scripts chargés au premier affichage (compressés en gzip) et échoue au-delà du budget. Les bibliothèques lourdes (VexFlow, Tone.js, échantillons) doivent être chargées à la demande avec `import()` dynamique, pour ne jamais compter dans le premier écran.

### Design tokens et thèmes

Les couleurs sont des propriétés CSS personnalisées définies dans `web/src/styles/tokens.css` (`--bg`, `--panel`, `--ink`, `--accent`, ...). Ne codez jamais une couleur en dur dans un composant : utilisez un token. Le thème suit `prefers-color-scheme` tant que l'utilisateur n'en a pas choisi un avec le sélecteur de thème ; le choix est stocké dans `localStorage` (les échecs sont ignorés). `web/public/theme-init.js` pose `data-theme` sur `<html>` avant le premier affichage pour éviter un flash du mauvais thème. C'est un fichier de même origine : une Content Security Policy stricte n'a pas besoin de `unsafe-inline` pour les scripts.

### Polices

Inter (interface) et IBM Plex Mono (raccourcis, barre d'état) sont auto-hébergées via `@fontsource`, sous-ensemble latin uniquement, avec `font-display: swap`. Seules les graisses utilisées sont importées dans `web/src/main.tsx` (Inter 400 et 600, Plex Mono 400) : n'importez une nouvelle graisse que si un composant en a besoin. Aucun service de polices tiers n'est utilisé.

### Internationalisation

Français et anglais, dans `web/src/i18n/` (`en.ts` fait référence, `fr.ts` doit définir les mêmes clés, vérifié par le compilateur et par un test). La langue est détectée depuis le choix mémorisé, puis `navigator.languages`, puis l'anglais, et peut être changée à l'exécution. Ne codez jamais un texte d'interface en dur : ajoutez une clé aux deux catalogues et utilisez `t('cle')` via `useI18n()`. La couche est un petit module typé sans dépendance d'exécution, pour garder un bundle léger.

## Back end

Le back end est dans `api/` (.NET 10, ASP.NET Core, EF Core, PostgreSQL). Il sert l'API sous `/api` et le front end compilé depuis `wwwroot`, sur une seule origine (pas de CORS).

| Projet | Rôle |
| --- | --- |
| `Polymnia.Api` | Hébergement, endpoints, en-têtes de sécurité, fichiers statiques |
| `Polymnia.Core` | Domaine, sans dépendance |
| `Polymnia.Infrastructure` | EF Core + Npgsql (`PolymniaDbContext`, migrations) |
| `Polymnia.Tests` | Tests xUnit v3 |

### Prérequis

- SDK .NET 10 (voir `global.json`)
- Docker, uniquement pour lancer PostgreSQL en local et les tests d'intégration PostgreSQL

### Lancer le back end

1. Démarrer PostgreSQL : copier `.env.example` vers `.env`, renseigner `POSTGRES_PASSWORD`, puis `docker compose -f docker-compose.dev.yml up -d`. La base écoute sur `127.0.0.1` uniquement.
2. Donner la chaîne de connexion à l'API (ne jamais la commiter) :
   `dotnet user-secrets set "ConnectionStrings:Polymnia" "Host=localhost;Port=5432;Database=polymnia;Username=polymnia;Password=<POSTGRES_PASSWORD>" --project api/Polymnia.Api`
   En déploiement, utiliser la variable d'environnement `ConnectionStrings__Polymnia`.
3. Appliquer les migrations : `dotnet tool restore`, puis `ConnectionStrings__Polymnia=<même valeur> dotnet ef database update --project api/Polymnia.Infrastructure --startup-project api/Polymnia.Infrastructure`.
4. Lancer : `dotnet run --project api/Polymnia.Api` (écoute sur `http://localhost:5080`).

Ajouter une migration après un changement du modèle : `dotnet ef migrations add <Nom> --project api/Polymnia.Infrastructure --startup-project api/Polymnia.Infrastructure --output-dir Migrations`.

### Servir le front end depuis l'API

Compiler le front end, puis copier sa sortie (`index.html`, `assets/`, ...) dans `api/Polymnia.Api/wwwroot/` (le contenu est ignoré par git). L'API le sert alors sur la même origine. Conventions utilisées par le serveur :

- Les fichiers sous `/assets/` ont un nom haché (défaut de Vite) et reçoivent `Cache-Control: public, max-age=31536000, immutable`.
- `index.html` et tous les autres fichiers reçoivent `Cache-Control: no-cache`.
- Un `GET`/`HEAD` qui ne correspond à rien et sans extension de fichier renvoie `index.html` (routes côté client). Les routes `/api/*` inconnues renvoient un ProblemDetails 404, jamais la SPA. Les fichiers absents (`/assets/x.js`) renvoient 404.

Pour développer le front avec rechargement à chaud, utiliser le serveur Vite et son proxy vers `http://localhost:5080` (voir la section Front end).

### Endpoints

- `GET /api/health` : liveness, `200 Healthy`, sans vérification de dépendance.
- `GET /api/health/ready` : readiness, vérifie la base. Le corps est uniquement `Healthy` ou `Unhealthy` (`503`) ; les détails restent dans les logs serveur. Le résultat est mis en cache 5 secondes pour qu'un endpoint public ne puisse pas épuiser le pool de connexions. Les deux endpoints de santé sont exemptés de la redirection HTTPS (les sondes d'orchestrateur utilisent HTTP simple).
- Les segments de route côté client ne doivent pas contenir de point (un chemin avec extension est traité comme un fichier absent et renvoie 404). Les réponses sous `/api` sont en `Cache-Control: no-store` sauf si un endpoint en décide autrement.
- En production, utiliser `SSL Mode=VerifyFull` dans la chaîne de connexion quand la base n'est pas sur la même machine.

### Base de sécurité

- Redirection HTTPS et HSTS (1 an, sans sous-domaines, sans preload) hors Development.
- En-têtes sur chaque réponse, erreurs comprises : `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (caméra, géolocalisation, micro... refusés ; `midi=(self)` autorisé pour Web MIDI), `Cross-Origin-Opener-Policy: same-origin`. L'en-tête `Server` est supprimé.
- Les erreurs sont des ProblemDetails ; les stack traces n'apparaissent qu'en Development.
- Les corps de requête sont limités à 1 Mio par défaut ; un endpoint qui a besoin de plus doit le demander explicitement.
- Renseigner `AllowedHosts` avec le vrai nom d'hôte en production (valeur par défaut : `*`).

#### Content Security Policy

La valeur par défaut est `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`. Si une fonctionnalité exige un assouplissement (par exemple `style-src 'unsafe-inline'` pour une bibliothèque qui écrit des styles en ligne, ou `worker-src blob:`), surcharger `Security:ContentSecurityPolicy` dans la configuration, rester aussi restrictif que possible et documenter la raison ici.

### Derrière un reverse proxy

Les en-têtes transférés sont **désactivés** par défaut. Quand un proxy termine le TLS, les activer et lister les proxies de confiance, sinon un client peut falsifier son adresse et son schéma :

```json
"ForwardedHeaders": { "Enabled": true, "KnownProxies": ["10.0.0.5"], "KnownNetworks": ["172.18.0.0/16"], "ForwardLimit": 1 }
```

(ou `ForwardedHeaders__Enabled=true` etc. en variables d'environnement). Seuls `X-Forwarded-For` et `X-Forwarded-Proto` sont pris en compte. Sans liste, seuls les proxies loopback sont de confiance.

### Performance

Les réponses sont compressées en Brotli ou gzip (niveau le plus rapide). La compression reste active en HTTPS, avec une règle de mitigation BREACH : **une réponse qui contient un secret ou un jeton (jeton antiforgery, jeton de partage, tout secret utilisateur) ne doit jamais être compressée.** Marquer un tel endpoint avec `.DisableResponseCompression()` (minimal API) ou `[DisableResponseCompression]` (contrôleur ou action) ; le fournisseur de compression l'ignore alors (couvert par `CompressionPolicyTests`). L'antiforgery utilise le motif cookie + en-tête, jamais de jeton dans un corps de réponse. Les handlers n'utilisent que des E/S asynchrones ; les requêtes en lecture utilisent `AsNoTracking()`.

### Vérifications

```
dotnet build api/Polymnia.slnx -warnaserror
dotnet test --solution api/Polymnia.slnx
```

Les tests d'intégration PostgreSQL utilisent Testcontainers et nécessitent Docker. Sans Docker ils sont ignorés avec une raison explicite, sauf si la variable d'environnement `CI` vaut `true` : un Docker absent fait alors échouer l'exécution.

## Intégration continue

Chaque pull request et chaque push sur `main` lance [`ci.yml`](../.github/workflows/ci.yml) (jobs `web` et `api`) et [`codeql.yml`](../.github/workflows/codeql.yml) (analyse statique, aussi chaque semaine). Dependabot propose chaque semaine des mises à jour groupées pour npm, NuGet, GitHub Actions et Docker.

| Job   | Ce qu'il lance                                                                                              | En local                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `web` | lint, types, tests unitaires, build, budget de poids, `npm audit` (dépendances de production), Playwright | depuis `web/` : `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run size`, `npm audit --audit-level=high --omit=dev`, `npm run test:e2e` |
| `docker` | construit l'image de production (amd64), démarre `docker-compose.yml` dessus et sonde l'application, scan Trivy (échoue sur CRITICAL/HIGH corrigeables) | la « Procédure de test » de [`self-hosting.fr.md`](self-hosting.fr.md) |
| `api` | restauration, build avec avertissements en erreurs, tests, audit des vulnérabilités NuGet                  | depuis la racine du dépôt : `dotnet build api/Polymnia.slnx -warnaserror`, `dotnet test --solution api/Polymnia.slnx` (les tests d'intégration demandent Docker), `dotnet list api/Polymnia.slnx package --vulnerable --include-transitive` |

Le job `api` installe le SDK depuis `global.json` et tourne avec `CI=true` : les tests d'intégration PostgreSQL doivent s'exécuter (un Docker absent fait échouer le job au lieu d'ignorer les tests). Les workflows épinglent les actions par SHA de commit complet, n'ont que des droits en lecture et ne publient aucun artefact, sauf si les tests de bout en bout échouent.
