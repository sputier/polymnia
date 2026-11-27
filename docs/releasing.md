# Releasing

**English** · [Français](releasing.fr.md)

A release is a `vX.Y.Z` tag on `main`. Pushing the tag builds and publishes the image and creates the GitHub Release. **Only the maintainer tags**: contributors and automated agents never push a release tag.

## Cut a release

1. Make sure `main` is green (`web`, `api`, CodeQL, and the `docker` job).
2. In a pull request, turn `## [Unreleased]` of [`CHANGELOG.md`](../CHANGELOG.md) into `## [X.Y.Z] - YYYY-MM-DD` and add a fresh empty `## [Unreleased]` above it. The section text becomes the release notes. Merge it.
3. Update your local `main`, then tag the merge commit and push the tag:
   ```
   git switch main && git pull --ff-only
   git tag -s vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
4. Watch the [Release workflow](https://github.com/sputier/polymnia/actions/workflows/release.yml).

Versioning follows [Semantic Versioning](https://semver.org/). Only plain `vX.Y.Z` tags are released (no pre-release suffix).

## What the workflow does

1. **Verify tag**: the tag is a strict `vX.Y.Z`, the tagged commit is on `main`, and `CHANGELOG.md` has a `## [X.Y.Z]` section. Otherwise it stops before building anything.
2. **Build and push image**: multi-arch (`linux/amd64`, `linux/arm64`) to `ghcr.io/sputier/polymnia` with the tags `X.Y.Z`, `X.Y` and `latest`, OCI labels (source, version, license, revision), an SBOM and maximum-detail provenance attached to the image, and a signed build-provenance attestation (`actions/attest-build-provenance`, keyless, stored in the registry).
3. **GitHub Release**: created from the tag with the notes taken from the CHANGELOG section. Only this job has `contents: write`.

All actions are pinned by full commit SHA, the workflow uploads no artifact, and the build cache is the GitHub Actions cache.

## Verify a published image

```
gh attestation verify oci://ghcr.io/sputier/polymnia:X.Y.Z --repo sputier/polymnia
docker buildx imagetools inspect ghcr.io/sputier/polymnia:X.Y.Z
```

## If something fails

- **Verify tag failed**: delete the tag (`git push origin :refs/tags/vX.Y.Z` and `git tag -d vX.Y.Z`), fix the cause, tag again.
- **Image published but Release not created**: re-run the failed job from the Actions page.
- **Bad release**: never move or reuse a published tag. Fix forward with the next patch version.

## One-time repository setup

- Packages: after the first release, set the `polymnia` package visibility to public (GitHub package settings) and link it to the repository.
- The `docker` job of `ci.yml` is not a required check by default: add it to the branch protection once it has proven stable.
- Consider a tag ruleset restricting who can create `v*` tags to the maintainer.
