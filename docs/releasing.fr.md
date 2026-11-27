# Publier une release

[English](releasing.md) · **Français**

Une release est un tag `vX.Y.Z` sur `main`. Pousser le tag construit et publie l'image, puis crée la GitHub Release. **Seul le mainteneur pose les tags** : les contributeurs et les agents automatisés ne poussent jamais de tag de release.

## Publier

1. Vérifier que `main` est vert (`web`, `api`, CodeQL et le job `docker`).
2. Dans une pull request, transformer `## [Unreleased]` de [`CHANGELOG.md`](../CHANGELOG.md) en `## [X.Y.Z] - AAAA-MM-JJ` et ajouter au-dessus un nouveau `## [Unreleased]` vide. Le texte de la section devient les notes de la release. Fusionner.
3. Mettre à jour `main` en local, taguer le commit de fusion et pousser le tag :
   ```
   git switch main && git pull --ff-only
   git tag -s vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
4. Suivre le [workflow Release](https://github.com/sputier/polymnia/actions/workflows/release.yml).

Le versionnement suit [Semantic Versioning](https://semver.org/lang/fr/). Seuls les tags `vX.Y.Z` simples sont publiés (pas de suffixe de pré-version).

## Ce que fait le workflow

1. **Verify tag** : le tag est un `vX.Y.Z` strict, le commit taggé est sur `main`, et `CHANGELOG.md` contient une section `## [X.Y.Z]`. Sinon il s'arrête avant de construire quoi que ce soit.
2. **Build and push image** : multi-architecture (`linux/amd64`, `linux/arm64`) vers `ghcr.io/sputier/polymnia` avec les tags `X.Y.Z`, `X.Y` et `latest`, des labels OCI (source, version, licence, révision), un SBOM et une provenance détaillée attachés à l'image, et une attestation de provenance signée (`actions/attest-build-provenance`, sans clé, stockée dans le registre).
3. **GitHub Release** : créée depuis le tag avec les notes tirées de la section du CHANGELOG. Seul ce job a `contents: write`.

Toutes les actions sont épinglées par SHA de commit complet, le workflow ne téléverse aucun artefact, et le cache de build est le cache GitHub Actions.

## Vérifier une image publiée

```
gh attestation verify oci://ghcr.io/sputier/polymnia:X.Y.Z --repo sputier/polymnia
docker buildx imagetools inspect ghcr.io/sputier/polymnia:X.Y.Z
```

## En cas de problème

- **Verify tag en échec** : supprimer le tag (`git push origin :refs/tags/vX.Y.Z` et `git tag -d vX.Y.Z`), corriger la cause, retaguer.
- **Image publiée mais Release non créée** : relancer le job en échec depuis la page Actions.
- **Mauvaise release** : ne jamais déplacer ni réutiliser un tag publié. Corriger avec la version de correctif suivante.

## Réglages uniques du dépôt

- Packages : après la première release, passer le package `polymnia` en visibilité publique (réglages du package GitHub) et le lier au dépôt.
- Le job `docker` de `ci.yml` n'est pas un check requis par défaut : l'ajouter à la protection de branche une fois qu'il a prouvé sa stabilité.
- Envisager une règle de tags limitant la création des tags `v*` au mainteneur.
