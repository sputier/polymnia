# Contribuer à Polymnia

[English](CONTRIBUTING.md) · **Français**

Merci de votre intérêt pour Polymnia. Ce guide explique comment proposer une modification.

## Avant de commencer

- Lisez le [code de conduite](CODE_OF_CONDUCT.md).
- Cherchez une [issue](https://github.com/sputier/polymnia/issues) existante. S'il n'y en a pas, ouvrez-en une avant une grosse modification, pour se mettre d'accord sur l'approche.
- Les failles de sécurité ne se signalent jamais dans une issue publique : voir [SECURITY.md](SECURITY.md).

## Déroulement

1. Forkez le dépôt et créez une branche depuis `main` : `feat/<numero-issue>-nom-court` ou `fix/<numero-issue>-nom-court`.
2. Une pull request traite une seule issue.
3. Ajoutez ou mettez à jour les tests automatisés. Une modification sans tests n'est pas terminée.
4. Mettez à jour la documentation (README, `docs/`) dans la même pull request quand le comportement change, **en anglais et en français**.
5. Lancez les vérifications en local (voir [Vérifications](#vérifications)).
6. Ouvrez une pull request vers `main` et remplissez le modèle.

## Priorités du projet : sécurité et performance d'abord

La sécurité et la performance passent avant les nouvelles fonctionnalités. Une modification qui affaiblit la sécurité (secrets, injection, CORS ou CSP permissifs, entrées non validées) ou qui dépasse le budget de performance (JavaScript initial au-dessus de 150 Ko gzip, bibliothèques lourdes non chargées à la demande) n'est pas fusionnée tant qu'elle n'est pas corrigée.

## Vérifications

Front end, depuis `web/` (détails dans [docs/development.fr.md](docs/development.fr.md)) :

```
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run size
npm run test:e2e
```

Back end, depuis la racine du dépôt (Docker est nécessaire pour les tests d'intégration PostgreSQL) :

```
dotnet build api/Polymnia.slnx -warnaserror
dotnet test --solution api/Polymnia.slnx
```

## Messages de commit

Nous utilisons les [Conventional Commits](https://www.conventionalcommits.org/fr/) :

```
feat(editor): add dotted note entry
fix(playback): stop cursor at the last measure
docs: explain MusicXML export
```

Les messages de commit sont en anglais. Référencez l'issue dans le corps ou le pied : `Closes #12`.

## Style de code

- Les règles de formatage sont dans [`.editorconfig`](.editorconfig).
- TypeScript : mode strict, pas de `any` sans commentaire qui explique pourquoi.
- C# : types référence nullables activés, avertissements traités comme des erreurs.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous [licence MIT](LICENSE). Ne copiez pas de code issu de projets sous licence incompatible (par exemple des logiciels de notation sous GPL).

## Intégration continue

Les pull requests lancent les jobs CI `web` et `api` ainsi que CodeQL, qui doivent être verts avant la fusion. Ils exécutent les commandes ci-dessus, plus `npm audit --audit-level=high --omit=dev` dans `web/` et, dans `api/`, `dotnet build -warnaserror`, `dotnet test` et `dotnet list package --vulnerable --include-transitive`. Détails : [docs/development.fr.md](docs/development.fr.md#intégration-continue).
