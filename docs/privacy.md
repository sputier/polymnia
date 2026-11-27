# Privacy, account deletion and data export

**English** · [Français](privacy.fr.md)

For people who run an instance. Polymnia stores little personal data and gives every user self-service access, export and erasure (GDPR articles 15, 17 and 20). As the operator you are the data controller: this page tells you what the software holds, what you must configure and what remains your job. It is not legal advice.

## Data inventory

| Where                       | Data                                                                                                                                                                    | Why                        | Retention                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `users`                     | internal id, Google `sub` (opaque id), display name, avatar URL (Google host only), language, created and last-seen dates. **No e-mail, no password, no Google token.** | the account                | until the user deletes the account                                                                          |
| `scores`                    | title, content (JSON), dates, version                                                                                                                                   | the service                | until the user deletes the score or the account                                                             |
| `share_links`               | hash of the link token, score id, dates (the token itself is never stored)                                                                                              | sharing                    | until revoked or the account is deleted                                                                     |
| `contact_messages` | topic, message text and, only if the sender gives one, a reply address. **No account, no IP address, no user agent.** Forwarded by e-mail to you when SMTP is configured ([Contact form](contact.md)) | contact form | `Contact:RetentionDays` (default 90), purged hourly whatever the status; backups keep them until they rotate out |
| `user_sessions`             | SHA-256 of the session key, user id, encrypted ticket, dates                                                                                                            | staying signed in          | idle `Auth:IdleTimeout` (7 d), absolute `Auth:AbsoluteTimeout` (30 d), expired rows purged hourly           |
| `registration_events`       | one timestamp per account creation, kept 2 days for the daily registration cap. **No user id, no IP address**; not removed when an account is deleted, and not personal data |
| `data_protection_keys`      | encryption keys of cookies and tokens (no personal data; encrypted at rest with your certificate)                                                                       | security                   | key lifetime (90 days), then rotated                                                                        |
| Application logs            | audit events (sign-in, sign-out, export, deletion, rate limits) with the **internal user id only**: no name, e-mail, Google id, token or score content                  | security, abuse prevention | **you decide** (`Legal:LogRetentionDays`, default 30): the app does not rotate logs, your log pipeline does |
| Reverse proxy and host logs | typically IP addresses and URLs. **Not produced by Polymnia**: your proxy and provider settings apply                                                                   | operation                  | yours to define and to disclose                                                                             |
| Browser (`localStorage`)    | language and theme choices. Never sent to the server                                                                                                                    | comfort                    | in the user's browser                                                                                       |

Cookies are all strictly necessary (session, antiforgery, sign-in checks): no consent banner is needed. There is no analytics and no third-party request except to Google for the sign-in and to Google's image host for avatars.

## What you must configure

The `Legal` settings identify you on the public privacy page (`#/privacy`). **Outside Development the application refuses to start without the first three**, so a public instance can never run without a controller and a contact.

| Key                      | Environment variable (compose)                               | Required | Meaning                                                                                                                  |
| ------------------------ | ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Legal:OperatorName`     | `Legal__OperatorName` (`POLYMNIA_LEGAL_OPERATOR_NAME`)       | yes      | Your legal name (person or organization), at most 200 characters                                                         |
| `Legal:Contact`          | `Legal__Contact` (`POLYMNIA_LEGAL_CONTACT`)                  | yes      | An e-mail address, an `https` URL, or `/#/contact` (the built-in [contact form](contact.md), so that **no address is published**). Nothing else is accepted (it becomes a link) |
| `Legal:HostingProvider`  | `Legal__HostingProvider` (`POLYMNIA_LEGAL_HOSTING_PROVIDER`) | yes      | Your hosting provider (a processor); name it, and have a data processing agreement with it                               |
| `Legal:HostingCountry`   | `Legal__HostingCountry` (`POLYMNIA_LEGAL_HOSTING_COUNTRY`)   | no       | Country where the data is stored                                                                                         |
| `Legal:Address`          | `Legal__Address` (`POLYMNIA_LEGAL_ADDRESS`)                  | no       | Postal address, at most 400 characters                                                                                   |
| `Legal:LogRetentionDays` | `Legal__LogRetentionDays` (`POLYMNIA_LOG_RETENTION_DAYS`)    | no       | Days you keep the application logs, 1 to 3650, default 30. The page quotes it: make it true                              |

Everything is shown as is on a public page: use details you are happy to publish. Nothing is hard-coded in the repository. In Development the settings may be left empty: the page then shows a clear "not configured" notice and `GET /api/legal` answers `configured: false`. The validator reports the key names that are wrong or missing, never their values. The session periods quoted on the page come from `Auth:IdleTimeout` and `Auth:AbsoluteTimeout`.

## What users can do

All from the account menu (the name in the toolbar):

- **Privacy policy**: `#/privacy`, in French and English, also linked from the sign-in screen. Public, no session needed. It is a separate lazy chunk (about 5 KB gzip), so the first load is unchanged.
- **Export my data** (access and portability): `GET /api/me/export` downloads a ZIP with `profile.json` and one JSON file per score (the Polymnia score format, [score-format.md](score-format.md)). It contains exactly the user's own data and no credential: not the session key or its hash, not the ticket, not any token. Limited to 3 per 10 minutes. MusicXML is not in the archive: that conversion lives in the browser ([musicxml.md](musicxml.md)) and would force the page to download and convert up to 200 scores; each score can still be exported to MusicXML, MIDI, PDF or PNG from the editor, and the JSON files can be re-imported by any tool that reads the open score format.
- The export does not require a recent sign-in, unlike deletion: everything in it (scores, and the account data the user already sees) is readable with the same session through `GET /api/scores` and `GET /api/me`, so it adds only the Google identifier and session dates. Deletion is irreversible, which is why it is stricter. The export is rate limited.
- **Delete my account** (erasure): a dialog asks to type `DELETE` (`SUPPRIMER` in French), then `DELETE /api/me` removes the user, and by `ON DELETE CASCADE` every score, session and share link, in one statement. The cookies are cleared and the sign-in screen confirms it. Requires a **recent sign-in** (10 minutes by default, `Auth:RecentSignInWindow`): an older session is sent through Google again first, see [Authentication](authentication.md#recent-sign-in-account-deletion). The decision: a confirmation step that forces a fresh Google sign-in beats "the session is younger than N minutes" alone, because a stolen cookie cannot pass it, and the window keeps it from annoying someone who just signed in.
- **Correction** (rectification): the name and avatar come from Google and are refreshed at each sign-in; the user changes them in their Google account.

Anything else (restriction, objection, questions) reaches you through `Legal:Contact`. You have one month to answer. With `Legal:Contact=/#/contact` that is the [contact form](contact.md): topic "Personal data", forwarded to your mailbox by SMTP (`Contact:*`, an address nobody ever sees) and kept `Contact:RetentionDays` days. The privacy page lists these messages, their retention and what is not stored with them.

## Storage and registration limits

To keep the amount of stored personal data bounded, each user can store at most 100 MiB of scores (`Scores:MaxStorageBytesPerUser`), the instance accepts at most 100 new accounts per day and 10 per client address (`Auth:Registration:*`), and a warning is logged when the database grows past a threshold (`Monitoring:DatabaseSizeWarningBytes`). See [self-hosting](self-hosting.md#abuse-limits-and-alerts).

## Audit trail

Deletion and export are logged at `Information` with the internal user id only (`AuthAccountDeleted` id 13, `AuthDataExported` id 14 with the score count). An interrupted export is `AuthDataExportFailed` (id 15, `Warning`) and a refused deletion `AuthReauthRequired` (id 16). After the account is deleted the log line keeps the now-orphan id for `Legal:LogRetentionDays`: it identifies nobody once the user row is gone.

## What is still your job

1. **Backups.** A deletion removes the data from the live database only. Backups keep it until they rotate out (see "Backup and restore" in [Self-hosting](self-hosting.md)). Keep the rotation short (the privacy page says "until they are replaced in their normal rotation"), and if you restore a backup, **delete again the accounts that were deleted since** (keep a list of deletion dates and user ids from the audit log).
2. **Logs.** Enforce `Legal:LogRetentionDays` in your log pipeline, proxy and host.
3. **Processors.** Have an agreement with your hosting provider. Google is an independent controller for the sign-in.
4. **Requests by e-mail.** Answer within one month. Most requests are covered by the self-service buttons.
5. **Do not add tracking.** Any analytics or third-party request changes the policy, and may require consent.

## Tests

`api/Polymnia.Tests/AccountPrivacyTests.cs` (PostgreSQL in Testcontainers): the deletion removes every row of the user in every table that references them (found from the catalog) and nothing of another user; every foreign key to `users` cascades; the antiforgery header is enforced; an old sign-in is refused with `reauth-required` and succeeds after signing in again; the export holds exactly the user's data and no credential, is rate limited, and for 200 scores (208 MB of JSON) streams in bounded memory (about 4 s, 3 MB of heap growth). `LegalTests.cs`: `GET /api/legal` and the fail-fast rule. The contact messages and their purge: [Contact form](contact.md). Playwright `web/e2e/privacy.spec.ts`: the privacy page signed out, the deletion flow and the export download (the API is mocked).
