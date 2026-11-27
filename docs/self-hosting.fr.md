# Auto-hébergement

[English](self-hosting.md) · **Français**

Faire tourner sa propre instance de Polymnia avec Docker Compose : l'application et PostgreSQL 17, configurés uniquement par variables d'environnement.

## Prérequis

- Docker Engine 24 ou plus récent avec le plugin Compose (`docker compose`).
- Un nom d'hôte qui pointe vers votre serveur et un reverse proxy qui termine le TLS (Caddy, nginx, Traefik...). L'application elle-même parle en HTTP simple sur le port 8080.
- `linux/amd64` ou `linux/arm64`.

## Démarrage rapide

1. Récupérer le fichier compose et l'exemple de configuration : cloner le dépôt, ou télécharger `docker-compose.yml` et `.env.example`.
2. `cp .env.example .env`
3. Éditer `.env` : renseigner `POSTGRES_PASSWORD` (long, aléatoire, sans `;`, `"` ni espace : `openssl rand -hex 24`), `POLYMNIA_ALLOWED_HOSTS` (votre nom d'hôte), les trois valeurs de connexion Google (`POLYMNIA_PUBLIC_BASE_URL`, `POLYMNIA_GOOGLE_CLIENT_ID`, `POLYMNIA_GOOGLE_CLIENT_SECRET`, voir [Authentification](authentication.fr.md)) et `POLYMNIA_VERSION` (une version exacte comme `1.0.0`, voir les [releases](https://github.com/sputier/polymnia/releases)). Créez aussi le certificat de chiffrement des clés (`secrets/polymnia-keys.pfx`, voir [Authentification](authentication.fr.md), « Chiffrer les clés Data Protection ») et son fichier de mot de passe (`secrets/polymnia-keys.password`). Renseignez les trois valeurs d'exploitant (`POLYMNIA_LEGAL_OPERATOR_NAME`, `POLYMNIA_LEGAL_CONTACT`, `POLYMNIA_LEGAL_HOSTING_PROVIDER`) affichées sur la page de confidentialité, voir [Confidentialité](privacy.fr.md).
4. `docker compose up -d --wait`
5. Vérifier : `curl -H "Host: <votre nom d'hôte>" http://127.0.0.1:8080/api/health` répond `Healthy`.

`docker compose up` démarre dans l'ordre : la base (attente qu'elle soit saine), le service ponctuel `migrate` (applique les migrations et se termine), puis l'application.

L'image est `ghcr.io/sputier/polymnia`, publiée à chaque release `vX.Y.Z` avec les tags `X.Y.Z`, `X.Y` et `latest`. En production, fixer `X.Y.Z`.

Pour lancer une image construite localement : `docker build -t polymnia .` puis `POLYMNIA_IMAGE=polymnia` et `POLYMNIA_VERSION=latest` dans `.env`.

## Configuration

Tout passe par des variables d'environnement, renseignées dans `.env` pour le fichier compose.

| Variable                                                                                    | Défaut                                                            | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                                                         | aucun, obligatoire                                                | Mot de passe de la base                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POSTGRES_USER`, `POSTGRES_DB`                                                              | `polymnia`                                                        | Utilisateur et nom de la base                                                                                                                                                                                                                                                                                                                                                                                             |
| `POLYMNIA_ALLOWED_HOSTS`                                                                    | aucun, obligatoire                                                | Noms d'hôte acceptés par l'application, séparés par `;` (correspond à `AllowedHosts`)                                                                                                                                                                                                                                                                                                                                     |
| `POLYMNIA_PUBLIC_BASE_URL`, `POLYMNIA_GOOGLE_CLIENT_ID`, `POLYMNIA_GOOGLE_CLIENT_SECRET`    | aucun, obligatoire                                                | Connexion Google : origine publique `https` de l'application et client OAuth, voir [Authentification](authentication.fr.md). L'application refuse de démarrer sans eux                                                                                                                                                                                                                                                    |
| `POLYMNIA_LEGAL_OPERATOR_NAME`, `POLYMNIA_LEGAL_CONTACT`, `POLYMNIA_LEGAL_HOSTING_PROVIDER` | aucun, obligatoire                                                | Qui exploite cette instance, affiché sur la page publique de confidentialité : votre nom légal, une adresse e-mail ou une URL `https` pour les demandes relatives aux données, et votre hébergeur (correspond à `Legal:OperatorName`, `Legal:Contact`, `Legal:HostingProvider`). L'application refuse de démarrer sans eux. Voir [Confidentialité](privacy.fr.md)                                                         |
| `POLYMNIA_LEGAL_ADDRESS`, `POLYMNIA_LEGAL_HOSTING_COUNTRY`                                  | vide                                                              | Facultatif : votre adresse postale et le pays où les données sont stockées                                                                                                                                                                                                                                                                                                                                                |
| `POLYMNIA_CONTACT_FORWARD_TO`, `POLYMNIA_CONTACT_FROM`, `POLYMNIA_CONTACT_SMTP_HOST` | vide | Facultatif, les trois ensemble : transmettre par e-mail les messages du [formulaire de contact](contact.fr.md) (votre boîte, l'adresse d'expéditeur, votre serveur SMTP). Sans eux les messages sont seulement enregistrés en base et l'application journalise un avertissement au démarrage |
| `POLYMNIA_CONTACT_SMTP_PORT`, `POLYMNIA_CONTACT_SMTP_SECURITY` | `587`, `StartTls` | Port et sécurité SMTP : `StartTls` (obligatoire, jamais en clair) ou `Implicit` (port 465) |
| `POLYMNIA_CONTACT_SMTP_USER`, `POLYMNIA_CONTACT_SMTP_PASSWORD_FILE` | vide, `/dev/null` | Identifiant SMTP et fichier texte contenant son mot de passe (un secret Docker, par défaut : pas de mot de passe ; à donner à l'UID 1654, mode 0400, comme les fichiers de clés). Compose ne lit pas le mot de passe dans l'environnement |
| `POLYMNIA_CONTACT_RETENTION_DAYS` | `90` | Jours de conservation d'un message de contact avant que la purge horaire le supprime. Cité sur la page de confidentialité : indiquez la vraie valeur |
| `POLYMNIA_LOG_RETENTION_DAYS`                                                               | `30`                                                              | Nombre de jours pendant lesquels vous conservez les journaux de l'application. La page de confidentialité le cite : indiquez la vraie valeur et appliquez-la dans votre chaîne de journaux                                                                                                                                                                                                                                |
| `POLYMNIA_KEYS_CERT_FILE`, `POLYMNIA_KEYS_CERT_PASSWORD_FILE`                               | `./secrets/polymnia-keys.pfx`, `./secrets/polymnia-keys.password` | Certificat (PKCS#12) qui chiffre les clés Data Protection stockées en base, et fichier texte contenant son mot de passe ; tous deux montés comme secrets Docker (fichiers de l'hôte à l'UID 1654, mode 0400 : voir Authentification). Créez-les avec les commandes de [Authentification](authentication.fr.md) (« Chiffrer les clés Data Protection »). Conservez-les : sans eux, les utilisateurs doivent se reconnecter |
| `POLYMNIA_IMAGE`, `POLYMNIA_VERSION`                                                        | `ghcr.io/sputier/polymnia`, `latest`                              | Image à exécuter                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POLYMNIA_BIND`, `POLYMNIA_PORT`                                                            | `127.0.0.1`, `8080`                                               | Adresse d'écoute de l'application sur l'hôte                                                                                                                                                                                                                                                                                                                                                                              |
| `POLYMNIA_FORWARDED_HEADERS`                                                                | `false`                                                           | Faire confiance à `X-Forwarded-For` et `X-Forwarded-Proto` du reverse proxy                                                                                                                                                                                                                                                                                                                                               |
| `POLYMNIA_SUBNET`                                                                           | `172.31.250.0/24`                                                 | Sous-réseau du réseau compose ; seule source de confiance pour les en-têtes transférés                                                                                                                                                                                                                                                                                                                                    |

Tout autre paramètre ASP.NET Core peut être ajouté à l'`environment` du service `app` (`__` remplace `:`), par exemple `Security__ContentSecurityPolicy`.

**`AllowedHosts` doit être défini.** C'est la liste des en-têtes `Host` acceptés ; tout autre hôte reçoit `400`. Le fichier compose refuse de démarrer sans cette valeur : un oubli ne se transforme jamais en `*` ouvert.

## Reverse proxy et TLS

L'application n'écoute que sur `127.0.0.1:8080`. Placer devant elle un reverse proxy qui termine le TLS et relaie vers ce port, en conservant l'en-tête `Host` (la plupart le font par défaut). Exemple Caddy :

```
polymnia.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Puis `POLYMNIA_FORWARDED_HEADERS=true`. L'application prend alors en compte `X-Forwarded-For` et `X-Forwarded-Proto` (jamais `X-Forwarded-Host`), mais uniquement depuis le réseau compose (`POLYMNIA_SUBNET`) : un proxy sur l'hôte atteint le conteneur par la passerelle du réseau, qui est dans ce sous-réseau. Si votre proxy est un autre conteneur sur un autre réseau, le rattacher au réseau compose, ou lister son adresse avec `ForwardedHeaders__KnownProxies__0` dans l'environnement de `app`. La redirection HTTPS et HSTS sont actives ; les endpoints de santé en sont exemptés.

## Ce que fait le fichier compose

- La base n'expose aucun port et vit sur un volume nommé (`polymnia-db`).
- Health checks sur la base (`pg_isready`) et sur l'application. L'image d'exécution est « chiseled » (ni shell, ni `curl`, pas de `HEALTHCHECK`) : le binaire de l'application se sonde lui-même, `dotnet Polymnia.Api.dll --healthcheck` appelle `GET /api/health` avec la première entrée non générique d'`AllowedHosts` comme `Host`.
- Le conteneur tourne sans privilèges (UID 1654), système de fichiers en lecture seule, `/tmp` en mémoire, toutes les capabilities Linux retirées et `no-new-privileges`.
- `app` ne démarre que lorsque la base est saine et que `migrate` a réussi.

## Migrations

Les migrations sont une étape explicite, jamais exécutée silencieusement dans l'application : une migration en échec arrête le déploiement et la version précédente continue de servir. Elles sont appliquées par `Polymnia.Api --migrate`, lancé par le service `migrate` à chaque `docker compose up` (sans effet si la base est à jour). Pour le lancer seul :

```
docker compose run --rm migrate
```

Au premier lancement, le journal contient une entrée `Failed executing DbCommand` sur `__EFMigrationsHistory` : c'est la vérification attendue d'une table qui n'existe pas encore.

## Sauvegarde et restauration

Sauvegarder avec `pg_dump` (format custom, compressé) :

```
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > polymnia-$(date +%F).dump
```

Testez vos restaurations. Pour restaurer dans la pile en cours (remplace les données existantes) :

```
docker compose stop app
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < polymnia-2026-01-01.dump
docker compose up -d --wait
```

Conservez les sauvegardes hors du serveur (elles contiennent les données de tous les utilisateurs), chiffrées au repos, et planifiez-les (cron ou timer systemd). Sauvegardez `.env` séparément.

## Mises à jour

1. Lire le [CHANGELOG](../CHANGELOG.md) de la version visée.
2. Sauvegarder la base (ci-dessus).
3. Mettre la nouvelle version dans `POLYMNIA_VERSION` de `.env`.
4. `docker compose pull && docker compose up -d --wait` : la nouvelle image est récupérée, `migrate` s'exécute, puis l'application redémarre.

Retour arrière : restaurer la sauvegarde de l'étape 2 et remettre l'ancienne `POLYMNIA_VERSION`. Lancer une image plus ancienne n'annule pas une migration.

Pour vérifier qu'une image provient du workflow de release de ce dépôt : `gh attestation verify oci://ghcr.io/sputier/polymnia:<version> --repo sputier/polymnia`.

## Procédure de test (clone propre)

```
git clone https://github.com/sputier/polymnia.git && cd polymnia
docker build -t polymnia .
mkdir -p secrets && openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -subj /CN=local -days 2 && openssl pkcs12 -export -inkey k.pem -in c.pem -out secrets/polymnia-keys.pfx -passout pass:dummy && printf dummy > secrets/polymnia-keys.password && sudo chown 1654:1654 secrets/polymnia-keys.* && sudo chmod 0400 secrets/polymnia-keys.*
printf 'POSTGRES_PASSWORD=%s\nPOLYMNIA_ALLOWED_HOSTS=localhost\nPOLYMNIA_PUBLIC_BASE_URL=https://localhost\nPOLYMNIA_GOOGLE_CLIENT_ID=dummy.apps.googleusercontent.com\nPOLYMNIA_GOOGLE_CLIENT_SECRET=dummy\nPOLYMNIA_LEGAL_OPERATOR_NAME=Test\nPOLYMNIA_LEGAL_CONTACT=test@example.com\nPOLYMNIA_LEGAL_HOSTING_PROVIDER=Test\nPOLYMNIA_IMAGE=polymnia\nPOLYMNIA_VERSION=latest\n' "$(openssl rand -hex 16)" > .env
docker compose up -d --wait
curl -i http://localhost:8080/api/health     # 200 Healthy
curl -i http://localhost:8080/                # l'application web, avec les en-têtes de sécurité
docker compose down -v && rm .env
```

La CI exécute la même séquence à chaque pull request (job `docker`).
