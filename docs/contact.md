# Contact form

**English** · [Français](contact.fr.md)

For people who run an instance and for contributors. The contact form (`#/contact`) lets anyone, signed in or not, write to the operator **without any e-mail address being published**: not on the privacy page, not in the repository, not in a response. It carries privacy requests (access, deletion, objection), questions and reports about shared pages.

## How a message travels

1. The page opens and asks `GET /api/contact/form-token` for a signed, short-lived **form token**.
2. The visitor writes a message and sends it: `POST /api/contact` with the token. The API checks the budget, the token and the fields, **stores the message in PostgreSQL** and answers `202` at once. It never waits for any mail server.
3. A background service (`ContactForwarder`) picks up the stored message and forwards it by e-mail to `Contact:ForwardTo` over SMTP. A failure is retried later with a growing delay. The status of every message is kept in the table.
4. A second background service (`ContactPurgeService`) deletes the messages older than `Contact:RetentionDays` (default 90).

If no SMTP server is configured, the message is only stored (status `Stored`) and the application logs a warning at start-up. The operator then reads the table.

## Endpoints

| Method and path                 | What it does                                                                                                                                                                                                  | Success                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `GET /api/contact/form-token`   | Public. A signed token and the minimum filling time: `{ token, minFillSeconds }`. `Cache-Control: no-store`, never compressed (BREACH rule: a response that carries a token).                                    | `200`                                  |
| `POST /api/contact`             | Public, `application/json`, at most 16 KiB: `{ topic, message, replyTo?, website?, token }`. No answer body.                                                                                                      | `202`                                  |

Errors are ProblemDetails (RFC 9457): `400` for a field (`errors.topic`, `errors.message` with `required`, `too-long` or `invalid-characters`, `errors.replyTo` with `invalid`) or for the token (`code: "contact-token"`: missing, forged, too early or expired; the page fetches a new one and sends once more), `413` over 16 KiB, `415` for another content type, `429` with `Retry-After` when a budget is spent. An invalid reason is never echoed back.

### The fields

| Field     | Rule                                                                                                                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topic`   | Exactly `personal-data`, `question`, `report` or `other`.                                                                                                                                                                                                              |
| `message` | 1 to 2000 characters after trimming. Line breaks are normalized to `\n`. Refused: control characters other than newline and tab, an unpaired surrogate, U+FFFE and U+FFFF, the line and paragraph separators and the bidirectional overrides and isolates (they could make the operator read something else). Emoji and joiners are fine. |
| `replyTo` | Optional. **One plain address**: `local@domain` in ASCII (letters, digits, `.`, `_`, `+`, `-`), 254 characters at most. No name, no quotes, no comma, no angle brackets, no comment: it can only ever be one mailbox.                                                  |
| `website` | The honeypot. A field no person sees (off screen, out of the tab order). When it is not empty the answer is still `202`, so a robot learns nothing, but **nothing is stored or sent**.                                                                                 |
| `token`   | The form token.                                                                                                                                                                                                                                                       |

## Anti-abuse

- **Form token, in place of the antiforgery cookie.** A signed-out visitor has no antiforgery cookie, so `POST /api/contact` is the **only** unsafe `/api` route the antiforgery middleware lets through (see [Authentication](authentication.md)). The form token plays that role: it is encrypted and signed by Data Protection (purpose `Polymnia.Contact.FormToken.v1`, keys in the database), so it cannot be forged or edited, and it carries the time it was issued. It is accepted from `Contact:MinFillSeconds` (2) to `Contact:TokenLifetimeMinutes` (60) after it was issued, so a robot cannot post the instant it fetches one and an old token is useless. A page of another site can neither read the token (same-origin policy, no CORS) nor send the JSON body without a preflight that the API does not answer, so a cross-site request cannot be sent at all (the guard is the required JSON content type, tested: a form or `text/plain` body is a `415`). The token is not bound to a session or an address: anyone can fetch one, which is why the budgets exist. The token is not single use: the budgets below are what bound replays. A signed-in user is treated like anyone else (the message is anonymous; the session is neither read nor needed).
- **Rate limits**, in memory: **5 messages per hour per client address** (`Contact:AddressPerHour`; the IPv4 address or the IPv6 `/64`, the same key as the other public endpoints) and **200 per hour in all** (`Contact:GlobalPerHour`), `429` with `Retry-After` beyond; 60 form tokens per hour per address (`Contact:TokensPerAddressPerHour`). Every submission costs budget, whatever it holds (a honeypot hit and a refused message included). With several instances the budgets apply to each instance. Behind a reverse proxy, enable forwarded headers (`POLYMNIA_FORWARDED_HEADERS=true`) or every visitor shares the proxy's address.
- **Size**: the body is read with a hard 16 KiB bound (declared length and streamed length alike).

## What is stored

Table `contact_messages`: id, creation date, topic, message, optional reply address, and the delivery state (`status` `Pending`, `Sent`, `Failed` or `Stored`, `attempts`, `next_attempt_at`, `locked_until`, `sent_at`, `last_error`). **No user id, no client address, no user agent**: a message cannot be tied to an account or a device. `last_error` is the type name of the last failure, never a server answer (which can quote an address). The reply address is personal data: it lives and dies with the message. The privacy page lists these messages and the retention (`Contact:RetentionDays`), and the [data inventory](privacy.md) too.

The purge runs 30 seconds after start-up and then every hour, deletes by age whatever the status (a message nobody received is not kept longer than the others), and survives a database failure (logged by type, retried the next hour). Backups keep a deleted message until they rotate out, like every other table (see [Privacy](privacy.md)).

## Forwarding by e-mail

[MailKit](https://github.com/jstedfast/MailKit) (MIT) over SMTP, started by the background service, one message at a time.

- **TLS is not optional.** `Contact:SmtpSecurity` is `StartTls` (default, usually port 587: the server **must** offer STARTTLS, otherwise the connection is dropped and nothing is sent, credentials included) or `Implicit` (TLS from the first byte, usually port 465). There is no "no TLS" setting, and certificates are validated normally.
- **Timeouts**: connect, TLS and every command time out after `Contact:SmtpTimeoutSeconds` (20), and the whole conversation after four times that.
- **Retries with backoff**: after a failure the next attempt is 1 minute later, then 2, 4, 8, 16, 32, then every hour, up to 8 attempts, after which the status is `Failed` and the message stays in the table until the purge. The forwarder wakes up when a message is stored and otherwise looks every 15 seconds. A claim is an atomic `UPDATE`, so several instances never send the same message twice.
- **At-least-once delivery.** A message is recorded as sent only after the server accepted it, and only by the instance that holds its claim. If the process dies or the database fails at that very moment, the message is sent again later: expect a rare duplicate, never a loss. A pass stops after 3 failures in a row (a down server does not burn the whole queue's attempts). After the last attempt (about two hours of outage) the message stays `Failed`: see "Operating" to retry it. Messages stored as `Stored` while no SMTP was configured are not picked up later: read them in the table or set them to `Pending`.
- **The mail**: `From` is `Contact:From`, `To` is `Contact:ForwardTo`, the subject is fixed text (`[Polymnia] Question (1a2b3c4d)`), the body is plain text (topic, date, id, then the message). The `Message-ID` uses the domain of `Contact:From`, not the machine name.
- **Header injection is closed by construction.** The only visitor text that reaches a header is the reply address, **only in `Reply-To` (never in `From`)**, and only after the strict single-address rule above (the mail builder checks it again). The subject is not taken from the visitor, and the message is in the body, where a line break is a line break. Recipients cannot be added: `To` is the configured address.
- **No address or secret in a response or a log.** The log events carry the message id only (`ContactStored` 30, `ContactForwarded` 33, `ContactForwardFailed` 34 with the type of the error...), never the text, the reply address, the forward address, the SMTP host, user or password, nor an exception message. A test runs the whole flow and checks every response and every log entry for these values.

## Configuration

Set as environment variables (`__` replaces `:`; the compose file maps the `POLYMNIA_CONTACT_*` ones). **All three of `ForwardTo`, `SmtpHost` and `From` are needed to forward**; giving only some of them (or a user without a password) is refused at start-up, naming the keys and never a value.

| Key                              | Environment variable (compose)                              | Default    | Meaning                                                                                                              |
| -------------------------------- | ----------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `Contact:ForwardTo`              | `Contact__ForwardTo` (`POLYMNIA_CONTACT_FORWARD_TO`)        | empty      | Your mailbox. Never shown anywhere                                                                                   |
| `Contact:From`                   | `Contact__From` (`POLYMNIA_CONTACT_FROM`)                   | empty      | Sender address of the forwarded mails: one your SMTP server lets you send as                                         |
| `Contact:SmtpHost`               | `Contact__SmtpHost` (`POLYMNIA_CONTACT_SMTP_HOST`)          | empty      | SMTP server                                                                                                          |
| `Contact:SmtpPort`               | `Contact__SmtpPort` (`POLYMNIA_CONTACT_SMTP_PORT`)          | `587`      | Port (`465` with `Implicit`)                                                                                         |
| `Contact:SmtpSecurity`           | `Contact__SmtpSecurity` (`POLYMNIA_CONTACT_SMTP_SECURITY`)  | `StartTls` | `StartTls` or `Implicit`                                                                                              |
| `Contact:SmtpUser`, `SmtpPassword` | `Contact__SmtpUser`, `Contact__SmtpPassword` (`POLYMNIA_CONTACT_SMTP_USER`, `POLYMNIA_CONTACT_SMTP_PASSWORD`) | empty | Credentials, both or none. A secret: keep `.env` private |
| `Contact:SmtpTimeoutSeconds`     | `Contact__SmtpTimeoutSeconds`                               | `20`       | Timeout of each SMTP step                                                                                            |
| `Contact:RetentionDays`          | `Contact__RetentionDays` (`POLYMNIA_CONTACT_RETENTION_DAYS`) | `90`       | Days a message is kept, 1 to 3650. Quoted on the privacy page: set the real value                                    |
| `Contact:AddressPerHour`, `GlobalPerHour`, `TokensPerAddressPerHour` | `Contact__AddressPerHour`... | `5`, `200`, `60` | Budgets above                                                                              |
| `Contact:MinFillSeconds`, `TokenLifetimeMinutes` | `Contact__MinFillSeconds`...                  | `2`, `60`  | Window in which a form token is accepted                                                                              |

`Legal:Contact` may be `/#/contact`: the privacy page then links to the form instead of showing an address (`GET /api/legal` answers `contactKind: "page"`). It is the only relative value accepted, and `.env.example` uses it by default. `GET /api/legal` also carries `contactRetentionDays`. The forward address is **never** in that answer.

## Operating

- **Read the messages that were not forwarded** (no SMTP, or `Failed`): `SELECT id, created_at, topic, status, attempts, last_error, message, reply_to FROM contact_messages ORDER BY created_at DESC;`
- **Retry a failed message**: `UPDATE contact_messages SET status = 'Pending', attempts = 0, next_attempt_at = now(), last_error = NULL WHERE id = '<id>';`
- **Answer**: use the `Reply-To` of the mail (or `reply_to`). Without one there is no way to answer, which the page says. For a privacy request you have one month.
- **Delete early** (a request to erase a message): `DELETE FROM contact_messages WHERE id = '<id>';`.
- A message may contain the link of a shared score (see below): treat it like the message.

## Report this page

The footer of the public viewer (`#/s/<token>`, see [Sharing](sharing.md)) has a **Report this page** link to `#/contact?topic=report&page=<token>`. The form opens on the topic "Report a shared page" with the **link of the page in the message**, so that the operator can look at it. The link is a credential (it opens the score), so it is shown to the sender in the message, who may edit or remove it, and never sent without being seen. It is stored and forwarded like any other text, for `Contact:RetentionDays`. Only a well-formed token becomes a link; the form reads nothing else from the address.

## Tests

`api/Polymnia.Tests/ContactUnitTests.cs` (no database): the address and text rules, the mail builder (header injection, `Reply-To` never `From`, fixed subject, message id), the options and the backoff. `ContactApiTests.cs` (PostgreSQL in Testcontainers and a fake SMTP server with TLS, `FakeSmtpServer.cs`): validation, honeypot, forged, edited, early and expired tokens, a payload made for another purpose, rate limits per address, global and for tokens, `202` while the mail server never answers, storage and forwarding over STARTTLS and implicit TLS (TLS before authentication and mail, a server without STARTTLS is never used in clear), retries, final failure, no SMTP, no address or secret in any response or log, the retention purge, a purge during a database failure and fail-fast on partial settings. Playwright `web/e2e/contact.spec.ts`: a message signed out and the report of a shared page (the API is mocked); `web/src/contact/contact.test.tsx` covers the form.
