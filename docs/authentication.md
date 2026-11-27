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

| Table | Content |
| --- | --- |
| `users` | internal id (UUID), Google `sub` (unique), display name, avatar URL, preferred language, created and last-seen dates |
| `user_sessions` | SHA-256 hash of the session key, user id, encrypted ticket, expiry dates |
| `data_protection_keys` | ASP.NET Core Data Protection keys |

**No e-mail address is requested or stored** (scope is `openid profile`). The avatar URL is kept only if it is an `https` URL on a `*.googleusercontent.com` host (the Content Security Policy allows images from that host only).

## Cookies

| Cookie | Purpose | Flags |
| --- | --- | --- |
| `__Host-Polymnia.Session` | opaque session key (random, 256 bits) | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` |
| `__Host-Polymnia.Correlation.*`, `__Host-Polymnia.Nonce.*` | sign-in `state` and `nonce` checks, short-lived | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` |
| `__Host-Polymnia.Antiforgery` | antiforgery cookie token | `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` |
| `__Host-XSRF-TOKEN` | antiforgery request token, readable by the page | `Secure`, `SameSite=Strict`, `Path=/` (not `HttpOnly`, by design) |

`__Host-` cookies are refused by the browser unless they are `Secure`, `Path=/` and have no `Domain`. `SameSite=Lax` (not `Strict`) on the session cookie is required: the browser must send it on the redirect coming back from Google.

### Server-side session

The cookie holds only a random key. The ticket (the internal user id) is encrypted with Data Protection and stored in `user_sessions`, found by the SHA-256 hash of the key. Consequences:

- Logout deletes the row: a copy of the cookie taken earlier stops working immediately.
- Deleting a user deletes their sessions (cascade); on every request the user must still exist, otherwise the session is rejected.
- The session slides: it ends after 7 days without use (`Auth:IdleTimeout`) and never lives longer than 30 days (`Auth:AbsoluteTimeout`), however active it is. Expired rows are purged hourly.

### Data Protection keys

Keys are stored in PostgreSQL (`data_protection_keys`) and the application name is `Polymnia`: restarts and several containers share the same keys, so cookies and tokens stay valid. Session keys are random and stored hashed, so they do not depend on these keys. By default the keys are stored unencrypted in the same database; to encrypt them at rest, set `DataProtection:CertificatePath` (a PKCS#12 `.pfx` file, for example mounted as a secret) and `DataProtection:CertificatePassword`. Recommended for any deployment whose database backups leave the server.

## CSRF protection (antiforgery)

Cookie + header pattern. Every `POST`, `PUT`, `PATCH` and `DELETE` (and any method other than `GET`, `HEAD`, `OPTIONS`, `TRACE`) under `/api` must carry the header `X-XSRF-TOKEN`, checked by a global middleware before routing, so no endpoint can forget it. Failure is `400` with a problem body whose `code` is `antiforgery`. Nothing is read from the request body.

1. The page calls `GET /api/auth/antiforgery`. The response has no body: the server sets the `HttpOnly` cookie token and the readable request-token cookie. The endpoint is never compressed and never cached (BREACH rule: a response carrying a token is not compressed).
2. The API client copies the request token cookie into `X-XSRF-TOKEN` on unsafe methods. A token is bound to the current identity, so the page fetches a fresh one after it learns who the user is; a rejected token is replaced once and the request is retried.

An API call without a valid session is a `401`, never a redirect to Google.

## Configuration

| Key | Environment variable | Meaning |
| --- | --- | --- |
| `Auth:PublicBaseUrl` | `Auth__PublicBaseUrl` | Public origin, for example `https://polymnia.example` (scheme, host, optional port; no path). `https` required, except `http://localhost…` in Development. |
| `Auth:Google:ClientId` | `Auth__Google__ClientId` | OAuth client id |
| `Auth:Google:ClientSecret` | `Auth__Google__ClientSecret` | OAuth client secret. Never commit it. |
| `Auth:IdleTimeout` | `Auth__IdleTimeout` | Sliding expiration, default `7.00:00:00` |
| `Auth:AbsoluteTimeout` | `Auth__AbsoluteTimeout` | Absolute lifetime, default `30.00:00:00` |

- **Any environment except Development fails to start** if the client id, the client secret or a valid `Auth:PublicBaseUrl` is missing (the message names the key, never its value).
- In Development and tests the application starts without them: authentication is disabled, a sign-in attempt returns `503` and `/api/me` returns `401`.
- Set `AllowedHosts` to the real host name in production. The redirect URI does not depend on it, but unexpected `Host` headers should be refused anyway.
- Behind a reverse proxy, forward the original scheme (see "Behind a reverse proxy" in the [development guide](development.md)): cookies are `Secure` and HTTPS redirection must see HTTPS.

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
