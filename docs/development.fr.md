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

## Intégration continue

Chaque pull request et chaque push sur `main` lance [`ci.yml`](../.github/workflows/ci.yml) (jobs `web` et `api`) et [`codeql.yml`](../.github/workflows/codeql.yml) (analyse statique, aussi chaque semaine). Dependabot propose chaque semaine des mises à jour groupées pour npm, NuGet, GitHub Actions et Docker.

| Job   | Ce qu'il lance                                                                                              | En local                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `web` | lint, types, tests unitaires, build, budget de poids, `npm audit` (dépendances de production), Playwright | depuis `web/` : `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run size`, `npm audit --audit-level=high --omit=dev`, `npm run test:e2e` |
| `api` | restauration, build avec avertissements en erreurs, tests, audit des vulnérabilités NuGet                  | depuis `api/` : `dotnet build -warnaserror`, `dotnet test` (les tests d'intégration demandent Docker), `dotnet list package --vulnerable --include-transitive` |

Le job `api` ne fait rien (et passe) tant que `api/Polymnia.slnx` n'existe pas. Les workflows épinglent les actions par SHA de commit complet, n'ont que des droits en lecture et ne publient aucun artefact, sauf si les tests de bout en bout échouent.
