# Revue de sécurité avant publication (#20)

Revue indépendante de toute l'application avant le premier déploiement public. Méthode : lire le code, puis essayer
de le casser avec des tests qui échouent (la documentation n'a pas été prise comme preuve). Chaque constat ci-dessous
est **corrigé** dans la pull request qui ferme #20, avec un test de non-régression. Rien n'est laissé comme risque accepté.

[English version](security-review.md)

## Modèle de menaces (résumé)

| Actif                                    | Menace                                                         | Défenses principales                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Les partitions et le profil d'une personne | Un autre utilisateur connecté (IDOR), un autre site (CSRF), vol de session | Requêtes limitées au propriétaire (404, jamais 403), session côté serveur, cookie `__Host-`, en-tête antiforgery sur tout appel `/api` non sûr |
| La session                               | Fixation, rejeu, durée excessive, callback OIDC falsifié       | Code d'autorisation + PKCE, state, nonce, contrôle de l'émetteur et de l'audience, clés de session hachées, expiration inactive et absolue, connexion récente pour la suppression |
| Les liens de partage                     | Devinette, fuite par les journaux ou `Referer`, usage en écriture | Jeton de 256 bits dans un en-tête, seul le SHA-256 est stocké, GET uniquement, `no-referrer`, limites par adresse |
| Le serveur (CPU, mémoire, disque, base)  | Corps trop gros ou décompressés, clients lents, inondation de requêtes, documents abusifs | Plafonds de corps, profondeur JSON, validation par schéma, SQL paramétré, budgets par utilisateur et par adresse, plafonds de concurrence, délais |
| Les navigateurs des autres (visionneuse partagée) | XSS stockée ou injection SVG via une partition partagée | Aucun point d'entrée HTML côté front, CSP `script-src 'self'` sans code en ligne, SVG en texte seul, chaînes PDF en hexadécimal |
| Les secrets de l'opérateur               | Fuites dans le dépôt, les images, les journaux ou les sauvegardes | Secrets Docker, clés Data Protection chiffrées par certificat, aucun secret dans l'historique, valeurs factices dans `.env.example` |
| La chaîne d'approvisionnement            | Dépendances, actions ou images vulnérables ou altérées         | `npm audit`, audit NuGet en erreur de build, actions épinglées par SHA, images épinglées par digest, versions attestées |

Frontières de confiance : navigateur vers API (tout est non fiable, y compris le JSON de la partition), API vers
PostgreSQL (paramètres uniquement), API vers Google (jeton d'identité validé uniquement) et API vers SMTP (TLS obligatoire).

## Ce qui a été vérifié

- **Authentification et session** : flux OpenID Connect (state, nonce, PKCE, URI de redirection issue de la configuration,
  émetteur, audience, signature, expiration), magasin de sessions (clés hachées seules, révocation, expiration inactive et
  absolue, `auth_time` pour la suppression du compte), attributs des cookies, déconnexion, redirections ouvertes
  (`returnUrl`), confusion de comptes à la ré-authentification.
- **CSRF** : antiforgery global sur les méthodes non sûres de `/api` quelle que soit l'écriture du chemin, l'unique exemption
  (`POST /api/contact`) et sa garde de type de contenu JSON, pas de CORS, aucun GET à effet de bord.
- **Contrôle d'accès** : chaque endpoint (partitions, patch, liens de partage, `me`, export, suppression, contact,
  mentions légales, santé), vérifications de propriétaire, endpoint public de partage.
- **Validation et injection** : validateur JSON et motifs du schéma (linéaires, avec délai), planificateur de patch et son
  SQL (aucune concaténation de valeur), jsonpath, formulaire de contact (injection d'en-têtes, Unicode), noms de fichiers
  des téléchargements, injection dans les journaux.
- **Client** : pas de `innerHTML`, `dangerouslySetInnerHTML`, `eval` ni `postMessage` ; import MusicXML (entités, bombe zip,
  traversée de chemin, en-têtes mensongers) ; exports SVG, PDF et PNG ; routes par hash ; contenu de `localStorage` et
  `sessionStorage` ; le générateur de `route-preload.js`.
- **Déni de service** : plafonds de corps, de décompression, de patch et d'export ; limites de débit et de concurrence ;
  délais ; expressions régulières.
- **En-têtes et transport** : CSP, HSTS, COOP, Referrer-Policy, Permissions-Policy, `nosniff`, `Cache-Control`,
  `X-Robots-Tag`, compression des réponses (règle BREACH), `AllowedHosts` et en-têtes transmis.
- **Secrets et configuration** : analyse `git log -p` de tout l'historique (clés, jetons, mots de passe : seules des
  valeurs factices de test), paramètres qui échouent au démarrage, `.env.example`, données personnelles dans le dépôt.
- **Chaîne d'approvisionnement** : `npm audit` (dépendances de développement comprises) et
  `dotnet list package --vulnerable --include-transitive` : aucune vulnérabilité connue. Workflows, Dockerfile, fichier
  compose, pipeline de version, Dependabot.
- **Vie privée** : journaux (identifiant utilisateur seul), contenu de l'export, suppression (toutes les clés étrangères
  cascadent, testé).

## Constats

| #  | Sévérité | Domaine                  | Constat                                                                                                                                                                                                                                       | Statut  | Test de non-régression |
| -- | -------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------- |
| 1  | Moyenne  | Déni de service          | La décompression des requêtes s'appliquait à toutes les routes, mais seules celles du contenu de partition bornaient la taille décompressée. Un petit corps gzip ou Brotli envoyé à une route qui lie le JSON elle-même (renommage) était gonflé en dizaines de mégaoctets en mémoire. | Corrigé | `SecurityReviewScoreTests.A_compressed_body_is_refused_where_nothing_bounds_the_decompressed_size` |
| 2  | Basse    | Session / CSRF           | Le gestionnaire OpenID Connect écoute `/signout-oidc` (déconnexion par canal frontal) et terminait la session courante sur un simple `GET` inter-sites : n'importe quel site pouvait déconnecter les gens.                                     | Corrigé | `SecurityReviewOidcTests.The_remote_sign_out_paths_of_the_oidc_handler_cannot_end_a_session` |
| 3  | Basse    | En-têtes                 | Ni `X-Frame-Options` (navigateurs sans CSP `frame-ancestors`) ni `Cross-Origin-Resource-Policy`.                                                                                                                                              | Corrigé | `SecurityReviewHeaderTests.Every_response_forbids_framing_and_cross_origin_embedding` |
| 4  | Basse    | Client                   | Un lien forgé `#/scores/%` faisait lever `decodeURIComponent` pendant le routage et rendait toute l'application blanche jusqu'à la modification de l'adresse.                                                                                | Corrigé | `web/src/route/useRoute.test.ts` |
| 5  | Basse    | Hygiène des secrets      | `.gitignore` ne couvrait que `*.pfx` : un fichier PEM, clé ou `.p12` à côté des secrets compose pouvait être commité par erreur.                                                                                                             | Corrigé | `SecurityReviewRepositoryTests.Key_material_and_local_configuration_are_git_ignored` |
| 6  | Basse    | Chaîne d'approvisionnement | L'audit NuGet reposait sur les valeurs par défaut du SDK (non écrites, donc non protégées contre un changement).                                                                                                                          | Corrigé | `SecurityReviewRepositoryTests.Vulnerable_packages_fail_the_build` |
| 7  | Basse    | Pipeline de version      | Un tag sur `main` construisait et publiait l'image sans vérifier que la CI avait réussi sur ce commit.                                                                                                                                         | Corrigé | `SecurityReviewRepositoryTests.The_release_refuses_a_commit_whose_ci_has_not_passed` |
| 8  | Basse    | Conteneur                | Le service PostgreSQL de `docker-compose.yml` gardait toutes les capacités Linux et pouvait acquérir des privilèges.                                                                                                                         | Corrigé | `SecurityReviewRepositoryTests.Container_base_images_are_pinned_by_digest_and_the_runtime_is_not_root` |
| 9  | Moyenne  | Abus de stockage         | Chaque compte pouvait stocker 200 partitions de 4 Mio et les comptes n'étaient pas bornés : un script avec de nombreux comptes Google pouvait remplir le disque. Corrigé : quota de stockage par utilisateur (100 Mio, `413` `quota-exceeded`, affiché dans l'interface), limites de création de comptes (100 par jour pour l'instance, 10 par jour par adresse ; au-delà, une nouvelle personne voit l'avis « inscriptions temporairement fermées », les utilisateurs existants ne sont pas touchés) et avertissement dans les journaux quand la base dépasse un seuil (5 Gio par défaut, au démarrage puis toutes les heures). | Corrigé | `AbuseLimitsTests`, `web/src/library/quota.test.ts` |
| 10 | Basse    | Configuration            | Le mot de passe de la base pouvait être le placeholder de `.env.example` ou un mot de passe court. Corrigé : hors Development, l'application (donc le service `migrate`) refuse de démarrer avec le placeholder ou moins de 16 caractères. | Corrigé | `ConnectionStringGuardTests` |

Vérifié et jugé solide (un test fixe chacun de ces points, les nouveaux dans `SecurityReview*Tests`) :

- L'antiforgery ne peut pas être évité par `//api/...`, `/api//...`, `/API/...`, un segment encodé ou un paramètre de chemin
  (`SecurityReviewPathTests`).
- Une requête pour un hôte absent de `AllowedHosts` est refusée avant qu'une redirection soit construite à partir de lui
  (`SecurityReviewHostTests`).
- Les actions sont épinglées par SHA complet, les workflows sont en lecture seule au niveau racine, les images de base sont
  épinglées par digest, l'exécution est « chiseled » et non root, Dependabot surveille les quatre écosystèmes
  (`SecurityReviewRepositoryTests`).
- Le SQL des partitions ne contient que des nombres et des constantes ; chaque valeur, chemin et fragment est un paramètre.
- Le jeton de partage fait 256 bits, voyage dans un en-tête, est stocké en SHA-256 et recherché par hash (aucune
  comparaison de secret dans le code applicatif).
- `npm audit` (développement compris) : 0 vulnérabilité. NuGet (transitives comprises) : 0 vulnérabilité.

## Trusted Types (faisabilité)

Non activé, volontairement. Le code de l'application n'a aucun point d'entrée HTML (ni `innerHTML`, `outerHTML`,
`insertAdjacentHTML`, `document.write`, `eval` ni `new Function` ; le SVG est construit par des appels DOM et des nœuds
texte), et `script-src 'self'` sans code en ligne bloque déjà les scripts injectés. React 19 utilise lui-même `innerHTML`
à quelques endroits internes (création d'éléments script, `dangerouslySetInnerHTML`) : `require-trusted-types-for 'script'`
exigerait donc une politique par défaut pour React avant d'être appliqué. Chemin recommandé si besoin plus tard : le
livrer d'abord en `Content-Security-Policy-Report-Only` avec un point de collecte. C'est une option de durcissement,
pas une vulnérabilité ouverte.

## Rappels pour l'opérateur

Documenté dans [l'auto-hébergement](self-hosting.fr.md) : activer les en-têtes transmis derrière un reverse proxy
(sinon tous les clients partagent une clé de limitation ; l'application détecte le réglage manquant et journalise un
avertissement une fois) et garder le certificat de clés et son mot de passe hors du dépôt. Surveillez les journaux pour
`DatabaseSizeExceeded`.
