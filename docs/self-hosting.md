# Self-hosting

**English** · [Français](self-hosting.fr.md)

Run your own Polymnia with Docker Compose: the application and PostgreSQL 17, configured only through environment variables.

## Requirements

- Docker Engine 24 or newer with the Compose plugin (`docker compose`).
- A host name that points to your server and a reverse proxy that terminates TLS (Caddy, nginx, Traefik...). The app itself speaks plain HTTP on port 8080.
- `linux/amd64` or `linux/arm64`.

## Quick start

1. Get the compose file and the example configuration: clone the repository, or download `docker-compose.yml` and `.env.example`.
2. `cp .env.example .env`
3. Edit `.env`: set `POSTGRES_PASSWORD` (long, random, no `;`, `"` or spaces: `openssl rand -hex 24`), `POLYMNIA_ALLOWED_HOSTS` (your host name), the three Google sign-in values (`POLYMNIA_PUBLIC_BASE_URL`, `POLYMNIA_GOOGLE_CLIENT_ID`, `POLYMNIA_GOOGLE_CLIENT_SECRET`, see [Authentication](authentication.md)) and `POLYMNIA_VERSION` (an exact version such as `1.0.0`, see the [releases](https://github.com/sputier/polymnia/releases)). Also create the key-encryption certificate (`secrets/polymnia-keys.pfx`, see [Authentication](authentication.md), "Encrypt the Data Protection keys") and the password file (`secrets/polymnia-keys.password`).
4. `docker compose up -d --wait`
5. Check: `curl -H "Host: <your host name>" http://127.0.0.1:8080/api/health` answers `Healthy`.

`docker compose up` starts, in order: the database (wait until healthy), the `migrate` one-shot service (applies the database migrations and exits), then the app.

The image is `ghcr.io/sputier/polymnia`, published for each `vX.Y.Z` release with the tags `X.Y.Z`, `X.Y` and `latest`. Pin `X.Y.Z` in production.

To run an image you built yourself: `docker build -t polymnia .` then set `POLYMNIA_IMAGE=polymnia` and `POLYMNIA_VERSION=latest` in `.env`.

## Configuration

Everything is an environment variable, set in `.env` for the compose file.

| Variable                                                                                 | Default                                                           | Role                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                                                      | none, required                                                    | Database password                                                                                                                                                                                                                                                                                                                                                                             |
| `POSTGRES_USER`, `POSTGRES_DB`                                                           | `polymnia`                                                        | Database user and name                                                                                                                                                                                                                                                                                                                                                                        |
| `POLYMNIA_ALLOWED_HOSTS`                                                                 | none, required                                                    | Host names the app answers to, separated by `;` (maps to `AllowedHosts`)                                                                                                                                                                                                                                                                                                                      |
| `POLYMNIA_PUBLIC_BASE_URL`, `POLYMNIA_GOOGLE_CLIENT_ID`, `POLYMNIA_GOOGLE_CLIENT_SECRET` | none, required                                                    | Google sign-in: public `https` origin of the app and the OAuth client, see [Authentication](authentication.md). The app refuses to start without them                                                                                                                                                                                                                                         |
| `POLYMNIA_KEYS_CERT_FILE`, `POLYMNIA_KEYS_CERT_PASSWORD_FILE`                            | `./secrets/polymnia-keys.pfx`, `./secrets/polymnia-keys.password` | Certificate (PKCS#12) that encrypts the Data Protection keys stored in the database, and the text file holding its password; both are mounted as Docker secrets (give the host files to UID 1654, mode 0400: see Authentication). Create them with the commands in [Authentication](authentication.md) ("Encrypt the Data Protection keys"). Keep them: without them users must sign in again |
| `POLYMNIA_IMAGE`, `POLYMNIA_VERSION`                                                     | `ghcr.io/sputier/polymnia`, `latest`                              | Image to run                                                                                                                                                                                                                                                                                                                                                                                  |
| `POLYMNIA_BIND`, `POLYMNIA_PORT`                                                         | `127.0.0.1`, `8080`                                               | Where the app listens on the host                                                                                                                                                                                                                                                                                                                                                             |
| `POLYMNIA_FORWARDED_HEADERS`                                                             | `false`                                                           | Trust `X-Forwarded-For` and `X-Forwarded-Proto` from the reverse proxy                                                                                                                                                                                                                                                                                                                        |
| `POLYMNIA_SUBNET`                                                                        | `172.31.250.0/24`                                                 | Subnet of the compose network; the only source trusted for forwarded headers                                                                                                                                                                                                                                                                                                                  |

Any other ASP.NET Core setting can be added to the `environment` of the `app` service (`__` replaces `:`), for example `Security__ContentSecurityPolicy`.

**`AllowedHosts` must be set.** It is the list of `Host` headers the app accepts; any other host gets `400`. The compose file refuses to start without it, so a forgotten value never turns into an open `*`.

## Reverse proxy and TLS

The app listens on `127.0.0.1:8080` only. Put a reverse proxy in front, terminating TLS and forwarding to that port, and keep the `Host` header (most proxies do by default). Caddy example:

```
polymnia.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Then set `POLYMNIA_FORWARDED_HEADERS=true`. The app then honors `X-Forwarded-For` and `X-Forwarded-Proto` (never `X-Forwarded-Host`), but only from the compose network (`POLYMNIA_SUBNET`): a proxy on the host reaches the container through the network gateway, which is in that subnet. If your proxy runs as another container on a different network, join it to the compose network, or list its address with `ForwardedHeaders__KnownProxies__0` in the `app` environment. HTTPS redirection and HSTS are on; the health endpoints are exempt.

## What the compose file does for you

- The database has no published port and lives on a named volume (`polymnia-db`).
- Health checks on the database (`pg_isready`) and on the app. The runtime image is chiseled (no shell, no `curl`, no `HEALTHCHECK`), so the app binary probes itself: `dotnet Polymnia.Api.dll --healthcheck` calls `GET /api/health` with the first non-wildcard `AllowedHosts` entry as `Host`.
- The app container runs as a non-root user (UID 1654), with a read-only filesystem, `/tmp` in memory, all Linux capabilities dropped and `no-new-privileges`.
- `app` starts only when the database is healthy and `migrate` has succeeded.

## Migrations

Migrations are an explicit step, never run silently inside the app: a failed migration stops the deployment and the previous version keeps serving. They are applied by `Polymnia.Api --migrate`, run as the `migrate` service on every `docker compose up` (it is a no-op when the database is up to date). Run it alone with:

```
docker compose run --rm migrate
```

On a first run, the log shows a `Failed executing DbCommand` entry for `__EFMigrationsHistory`: it is the expected check for a table that does not exist yet.

## Backup and restore

Back up with `pg_dump` (custom format, compressed):

```
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > polymnia-$(date +%F).dump
```

Test your restores. To restore into the running stack (this replaces the existing data):

```
docker compose stop app
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < polymnia-2026-01-01.dump
docker compose up -d --wait
```

Keep the dumps off the server (they contain every user's data), encrypt them at rest, and run the backup on a schedule (cron or a systemd timer). Back up your `.env` separately.

## Upgrades

1. Read the [CHANGELOG](../CHANGELOG.md) for the target version.
2. Back up the database (above).
3. Set `POLYMNIA_VERSION` to the new version in `.env`.
4. `docker compose pull && docker compose up -d --wait`: the new image is pulled, `migrate` runs, then the app restarts.

Rollback: restore the backup taken in step 2 and set the previous `POLYMNIA_VERSION`. A migration is not reversed by running an older image.

To verify an image came from this repository's release workflow: `gh attestation verify oci://ghcr.io/sputier/polymnia:<version> --repo sputier/polymnia`.

## Test procedure (clean clone)

```
git clone https://github.com/sputier/polymnia.git && cd polymnia
docker build -t polymnia .
mkdir -p secrets && openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -subj /CN=local -days 2 && openssl pkcs12 -export -inkey k.pem -in c.pem -out secrets/polymnia-keys.pfx -passout pass:dummy && printf dummy > secrets/polymnia-keys.password && sudo chown 1654:1654 secrets/polymnia-keys.* && sudo chmod 0400 secrets/polymnia-keys.*
printf 'POSTGRES_PASSWORD=%s\nPOLYMNIA_ALLOWED_HOSTS=localhost\nPOLYMNIA_PUBLIC_BASE_URL=https://localhost\nPOLYMNIA_GOOGLE_CLIENT_ID=dummy.apps.googleusercontent.com\nPOLYMNIA_GOOGLE_CLIENT_SECRET=dummy\nPOLYMNIA_IMAGE=polymnia\nPOLYMNIA_VERSION=latest\n' "$(openssl rand -hex 16)" > .env
docker compose up -d --wait
curl -i http://localhost:8080/api/health     # 200 Healthy
curl -i http://localhost:8080/                # the web app, with security headers
docker compose down -v && rm .env
```

CI runs the same sequence on every pull request (`docker` job).
