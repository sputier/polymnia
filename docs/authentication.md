# Authentication

**English** · [Français](authentication.fr.md)

Google is the only sign-in method. The server (not the browser) talks to Google and keeps the session: no token ever reaches JavaScript, `localStorage` or the page. This is the "backend for frontend" (BFF) pattern.

## Flow

1. The page loads `GET /api/me`. `401` means anonymous: the sign-in screen is shown.
2. The "Sign in with Google" link goes to `GET /api/auth/login?returnUrl=/path`. It is a full-page redirect, not a popup (compatible with `Cross-Origin-Opener-Policy: same-origin`). `returnUrl` must be a local path; anything else (`https://…`, `//host`, `/\host`, control characters, `/api/…`) is replaced by `/`.
3. The server redirects to Google with the authorization code flow, **PKCE (S256)**, `state` and `nonce`. The redirect URI is built from `Auth:PublicBaseUrl`, never from the request `Host` header.
4. Google redirects to `GET /api/auth/callback`. The server redeems the code, validates the signed ID token (issuer, audience, signature, expiry, `nonce`) and reads only `sub`, `name` and `picture`. `SaveTokens` is off: no Google token is kept.
5. The user is created or updated in the `users` table, a **server-side session** is stored in PostgreSQL, and the browser receives an opaque session cookie. The server redirects to `returnUrl`.
6. `POST /api/auth/logout` deletes the session on the server and clears the cookies.

`AddOpenIdConnect` is used rather than `AddGoogle`: it validates the ID token against Google's published keys, checks `nonce`, and needs no extra user-info request.

If Google reports an error or the user cancels, the server logs the failure type (never its content) and redirects to `/?signin=failed`; the sign-in screen shows a generic message.

## Data stored

| Table                  | Content                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `users`                | internal id (UUID), Google `sub` (unique), display name, avatar URL, preferred language, created and last-seen dates |
| `user_sessions`        | SHA-256 hash of the session key, user id, encrypted ticket, expiry dates                                             |
| `data_protection_keys` | ASP.NET Core Data Protection keys                                                                                    |

**No e-mail address is requested or stored** (scope is `openid profile`). The avatar URL is kept only if it is an `https` URL on a `*.googleusercontent.com` host (the Content Security Policy allows images from that host only).

## Cookies

| Cookie                                                     | Purpose                                         | Flags                                                             |
| ---------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `__Host-Polymnia.Session`                                  | opaque session key (random, 256 bits)           | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`       |
| `__Host-Polymnia.Correlation.*`, `__Host-Polymnia.Nonce.*` | sign-in `state` and `nonce` checks, short-lived | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`                    |
| `__Host-Polymnia.Antiforgery`                              | antiforgery cookie token                        | `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`                 |
| `__Host-XSRF-TOKEN`                                        | antiforgery request token, readable by the page | `Secure`, `SameSite=Strict`, `Path=/` (not `HttpOnly`, by design) |

`__Host-` cookies are refused by the browser unless they are `Secure`, `Path=/` and have no `Domain`. `SameSite=Lax` (not `Strict`) on the session cookie is required: the browser must send it on the redirect coming back from Google.

### Server-side session

The cookie holds only a random key. The ticket (the internal user id) is encrypted with Data Protection and stored in `user_sessions`, found by the SHA-256 hash of the key. Consequences:

- Logout deletes the row: a copy of the cookie taken earlier stops working immediately.
- Deleting a user deletes their sessions (cascade); on every request the user must still exist, otherwise the session is rejected.
- The session slides: it ends after 7 days without use (`Auth:IdleTimeout`) and never lives longer than 30 days (`Auth:AbsoluteTimeout`), however active it is. Expired rows are purged hourly.

### Data Protection keys

Keys are stored in PostgreSQL (`data_protection_keys`) and the application name is `Polymnia`: restarts and several containers share the same keys, so cookies and tokens stay valid. **They are encrypted at rest with a certificate, mandatory outside Development** (the application refuses to start without `DataProtection:CertificatePath`), so a database dump or backup does not expose them. See "Encrypt the Data Protection keys" below. Session keys are random and stored hashed, and do not depend on these keys.

## CSRF protection (antiforgery)

Cookie + header pattern. Every `POST`, `PUT`, `PATCH` and `DELETE` (and any method other than `GET`, `HEAD`, `OPTIONS`, `TRACE`) under `/api` must carry the header `X-XSRF-TOKEN`, checked by a global middleware before routing, so no endpoint can forget it. Failure is `400` with a problem body whose `code` is `antiforgery`. Nothing is read from the request body.

1. The page calls `GET /api/auth/antiforgery`. The response has no body: the server sets the `HttpOnly` cookie token and the readable request-token cookie. The endpoint is never compressed and never cached (BREACH rule: a response carrying a token is not compressed).
2. The API client copies the request token cookie into `X-XSRF-TOKEN` on unsafe methods. A token is bound to the current identity, so the page fetches a fresh one after it learns who the user is; a rejected token is replaced once and the request is retried.

An API call without a valid session is a `401`, never a redirect to Google.

## Configuration

| Key                                                   | Environment variable                                      | Meaning                                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Auth:PublicBaseUrl`                                  | `Auth__PublicBaseUrl`                                     | Public origin, for example `https://polymnia.example` (scheme, host, optional port; no path). `https` required, except `http://localhost…` in Development.       |
| `Auth:Google:ClientId`                                | `Auth__Google__ClientId`                                  | OAuth client id                                                                                                                                                  |
| `Auth:Google:ClientSecret`                            | `Auth__Google__ClientSecret`                              | OAuth client secret. Never commit it.                                                                                                                            |
| `Auth:IdleTimeout`                                    | `Auth__IdleTimeout`                                       | Sliding expiration, default `7.00:00:00`                                                                                                                         |
| `Auth:AbsoluteTimeout`                                | `Auth__AbsoluteTimeout`                                   | Absolute lifetime, default `30.00:00:00`                                                                                                                         |
| `DataProtection:CertificatePath`                      | `DataProtection__CertificatePath`                         | PKCS#12 file (`.pfx`) that encrypts the Data Protection keys. Required outside Development.                                                                      |
| `DataProtection:CertificatePasswordFile`              | `DataProtection__CertificatePasswordFile`                 | Text file holding the password of that `.pfx` (preferred: a Docker secret, not in the environment; a trailing newline is ignored). Wins over the variable below. |
| `DataProtection:CertificatePassword`                  | `DataProtection__CertificatePassword`                     | The password itself, if you cannot use a file                                                                                                                    |
| `Auth:RateLimit:PermitLimit`, `Auth:RateLimit:Window` | `Auth__RateLimit__PermitLimit`, `Auth__RateLimit__Window` | Requests per client IP on `/api/auth/*` per window, default `60` per `00:01:00`. Above it: `429` with `Retry-After`.                                             |

- **Any environment except Development fails to start** if the client id, the client secret or a valid `Auth:PublicBaseUrl` is missing (the message names the key, never its value).
- In Development and tests the application starts without them: authentication is disabled, a sign-in attempt returns `503` and `/api/me` returns `401`.
- **`AllowedHosts` must list the real host names** (not empty, not `*`) outside Development, otherwise the application refuses to start. The redirect URI does not depend on it, but unexpected `Host` headers must be refused.
- **`DataProtection:CertificatePath` is mandatory** outside Development (see "Encrypt the Data Protection keys").
- Behind a reverse proxy, forward the original scheme (see "Behind a reverse proxy" in the [development guide](development.md)): cookies are `Secure` and HTTPS redirection must see HTTPS.

## Encrypt the Data Protection keys

Create a self-signed certificate once (it only encrypts keys, nobody connects to it) and keep the file and its password in your secret store:

```
mkdir -p secrets && umask 077
openssl rand -hex 24 > secrets/polymnia-keys.password
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -subj "/CN=polymnia-keys" -days 3650
openssl pkcs12 -export -inkey key.pem -in cert.pem -out secrets/polymnia-keys.pfx -passout file:secrets/polymnia-keys.password
shred -u key.pem cert.pem
```

With `docker-compose.yml`: the `.pfx` and the password file are mounted as Docker secrets at `/run/secrets/polymnia_keys` and `/run/secrets/polymnia_keys_password` (host paths set by `POLYMNIA_KEYS_CERT_FILE` and `POLYMNIA_KEYS_CERT_PASSWORD_FILE`, defaults `./secrets/polymnia-keys.pfx` and `./secrets/polymnia-keys.password`). Plain `docker compose` bind-mounts file secrets as they are (it ignores `uid`, `gid` and `mode`, which we tested), so give the host files to the container user and make them read-only: `sudo chown 1654:1654 secrets/polymnia-keys.* && sudo chmod 0400 secrets/polymnia-keys.*`. Nobody else on the host can then read them. Without compose, set `DataProtection__CertificatePath` and `DataProtection__CertificatePasswordFile` (or `DataProtection__CertificatePassword`). **Keep both files: without them the stored keys cannot be read, every session and token becomes invalid and users sign in again.** The certificate must contain the private key and be within its validity period, otherwise the application refuses to start. **Enabling encryption on a database that already holds keys:** existing keys stay readable but unencrypted until they expire (90 days); to encrypt everything at once, run `DELETE FROM data_protection_keys;` once the certificate is configured (every session and token becomes invalid, users sign in again). Threat model: this protects a leaked database or backup; someone who can read the running host or container can still decrypt, as the application itself must. To rotate the certificate, generate a new file and replace it, accepting that users sign in again.

## Rate limiting and audit log

`/api/auth/*` is limited per client IP (`Auth:RateLimit`, default 60 requests per minute): beyond it the answer is `429` with `Retry-After`. The key is the IPv4 address, or the /64 prefix for IPv6. **Behind a reverse proxy, set `POLYMNIA_FORWARDED_HEADERS=true`** (see the [development guide](development.md)): otherwise every user shares the proxy address and one abuser can lock everyone out of sign-in. With a CDN in front of the proxy, raise `ForwardedHeaders:ForwardLimit` accordingly. A request with no client address (Unix socket) is not limited. A limited call to `/api/auth/callback` is redirected to `/?signin=failed` instead of showing an error; rejections are logged at most once every 10 seconds, with a count. Sign-in and sign-out are logged as structured events at `Information` level (`AuthSignedIn` id 10, `AuthSignedOut` id 11, with the internal user id only: never a name, e-mail, Google subject or token); a failed sign-in is `AuthSignInFailed` (id 4, `Warning`, failure type only) and a rate-limited request `AuthRateLimited` (id 12). The correlation and nonce cookies of a sign-in live 10 minutes.

## Create the Google OAuth client

1. Open the [Google Cloud console](https://console.cloud.google.com/), create or select a project.
2. "APIs & Services" → "OAuth consent screen": choose "External", set the application name and your support e-mail, add your domain. Scopes: the defaults (`openid`, `profile`); you do not need to add any sensitive scope. Publish the app when you are ready for users outside the test list.
3. "Credentials" → "Create credentials" → "OAuth client ID" → application type "Web application".
4. "Authorized redirect URIs": add `<Auth:PublicBaseUrl>/api/auth/callback` (for example `https://polymnia.example/api/auth/callback`). For local development also add `http://localhost:5173/api/auth/callback`. Leave "Authorized JavaScript origins" empty: the browser never calls Google.
5. Copy the client id and secret into your secret store (see below), never into the repository.

## Local setup

1. Start PostgreSQL and apply the migrations (see the [development guide](development.md)).
2. Give the API its Google settings (user-secrets, never committed):

   ```
   dotnet user-secrets set "Auth:Google:ClientId" "<client id>" --project api/Polymnia.Api
   dotnet user-secrets set "Auth:Google:ClientSecret" "<client secret>" --project api/Polymnia.Api
   ```

   In Development `Auth:PublicBaseUrl` defaults to `http://localhost:5173` (the Vite dev server).

3. Run the API (`dotnet run --project api/Polymnia.Api`) and the front end (`npm run dev` in `web/`). Open `http://localhost:5173`: the Vite proxy forwards `/api` to the API, so the browser sees a single origin and the cookies work. Browsers accept `Secure` cookies on `localhost` over HTTP, except Safari: use Chrome or Firefox for local sign-in.

Without Google settings, the application runs but cannot sign anyone in.

## Tests

The tests never call Google. A fake remote handler replaces the Google scheme and returns configurable claims; everything after it is the real code (correlation cookie, user creation, server-side session). One test also drives the real OpenID Connect handler up to the redirect to Google, with a static discovery document, to check the redirect URI, PKCE, `state`, `nonce` and cookie flags. Signing in with a real Google account is checked by hand.
