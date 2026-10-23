# Security, privacy and failure policy

## Trust and threat controls

| Threat | Required control and evidence |
| --- | --- |
| Owner account takeover | Maintained password hashing, opaque hashed server sessions, secure HttpOnly SameSite cookie, CSRF, throttling, expiry/revocation; recovery codes described below |
| Cross-tenant access | Server-derived tenant, scoped repositories, composite FKs, membership checks on every owner route; two-business read/write/replay tests |
| Public cost drain | Single-use admission, persisted global budget/concurrency lock, server deadline and provider hangup, startup reconciliation; browser timers/origins are not authority |
| Caller/FAQ injection | Fixed submit_turn schema, server-selected operation allowlist, no configuration tools, no arbitrary SQL, prompt content treated as data |
| Private data disclosure | No general customer lookup tool; appointment details require scoped proof; contact matching never grants identity; redact at ingestion |
| Unauthorized or duplicate action | Durable proposal, confirmation bound to exact payload/revisions, transactionally stored receipt, stable proposal ID across repeated function calls |
| Incorrect success speech | Controller requests success speech only after receipt; no model-exposed commit tool; evaluate residual generated-speech risks rather than promise perfect filtering |
| Stale appointment/configuration | Immutable config snapshot; expected appointment/scheduling revisions; new read-back on material changes |
| Misheard critical fields | Always read back contact/service/time; conservative full-turn English confirmation grammar; browser confirmation on ambiguity |
| Timeout/disconnect | Server closes provider call, denies further writes, resolves proposal transaction result; honest callback/form fallback |

The model cannot authorize itself. Owner-authenticated routes and public session routes have distinct credentials. Direct WebRTC clients can send provider events; sideband is not an exclusive security boundary. Independent backend gates still apply even if session instructions or tool exposure are tampered with.

## Appointment ownership

At booking issue a nonsequential reference and random management token with at least 128 bits of entropy. Store only a keyed hash. Deliver once through a scoped browser receipt with “Save management link”; use a URL fragment for the token, immediately read and clear it from the address bar, and submit it only to the verification endpoint. No token in query strings, referrers, analytics, provider tool results or normal event replay. Offer a paste field for the saved token; do not ask customers to dictate secrets to the voice model.

Verification requires reference and token, compares hashes safely, and returns a handle bound to business, appointment and current session for 10 minutes or session close, whichever is sooner. Use it to read only that appointment and prepare management actions. Proof permits access; it does not bypass revision checks or explicit confirmation. Same-session booking may issue this scoped handle after commit without resubmitting the token.

Throttle by session/IP and hashed reference, maximum five failed attempts per reference/session in 15 minutes; generic failure messages and bounded lockout. Persist limiter state in PostgreSQL for the initial single API deployment or use audited database counters; process restart must not reset credential guessing limits. Do not log submitted tokens, hashes or password/recovery fields. If a caller volunteers a token in speech, redact recognized secrets before application persistence and tell them to use the secure field; do not claim that the provider never processed volunteered audio.

A lost token or interrupted one-time delivery uses owner-assisted recovery. Contact details alone are not proof. The named pilot owner verifies through their established offline customer process and can reissue a token from the authenticated dashboard with a reason/audit, revoking the old token. The application does not invent a weak automated recovery quiz. No email/SMS service is needed for development.

## Account recovery without paid delivery

At registration show one random recovery code (>=128 bits), require an acknowledgement that it was saved, store only its hash and never send it to a model. The unauthenticated recovery form accepts email, recovery code and new password; throttle and use generic failures. Success atomically consumes/rotates the code, revokes all sessions, and shows a new code once. A logged-in user can rotate it only after re-entering the current password.

For the controlled one-owner pilot, loss of both password and recovery code requires an operator to verify the owner through the contact/process established during onboarding, record the decision and perform an audited reset. Do not reset based only on someone supplying the account email. Document this manual support procedure before pilot; self-service email delivery is future work.

## Consent and minimization

Before mic access disclose AI, provider audio processing, application transcription storage and purposes. Store consent timestamp plus exact disclosure version. No raw audio is stored by this application; provider processing/retention is separate and must not be misrepresented. Declining transcription prevents voice activation but offers a text inquiry form with separate contact-processing consent. Name/contact/summary are sufficient; do not collect payment card or clinical history.

Input transcription is required for the planned voice MVP, not an invisible optional charge. Secret fields are browser-only. Human-entered contact info is unverified until explicitly proven for a particular operation; do not merge customers or disclose prior bookings from a phone/email match.

The first pilot is a non-clinical administrative service business. Fixed topic guidance directs advice/sensitive requests to human assistance. Custom “never say” text is guidance, not a provable semantic filter. An urgent request must not be represented as handled by a callback queue; provide the approved urgent-services wording and public contact path. Clinical/regulated deployments need a separate suitability and jurisdiction review before real data.

## Retention and deletion

[DATABASE.md](DATABASE.md) is the authoritative retention matrix: transcript/tool detail 30 days, session metadata 90 days, audit metadata one year, and operational records according to owner/applicable policy. Clear session slots/proof and pending proposal PII after closure/reconciliation. Purge copies in engine_state, proposals, tool logs and exports as well as visible transcripts. Retain only non-PII idempotency outcomes/tombstones as required.

Backups have a provisional 30-day rolling lifetime; restore reapplies deletion tombstones before access. Owner export/delete routes are scoped and audited. Never let an HTTP logger capture raw password, token, SDP or voice event bodies. Consent/privacy wording, retention and provider data settings need pilot-specific review; these defaults are not legal clearance.

## Operational fallback

The server can pause a business, disable live AI globally, end provider calls and keep the public contact form available. Startup reconciles abandoned calls before new admission. Uncertain transactions are looked up by proposal ID; a failed transport does not imply failed booking. Owner callback queue supports new/in_progress/resolved and internal notes. Audit recovery, publish, policy changes, management actions, deletion and limit interventions.

Before pilot: TLS/secrets, backup restore, retention purge, account recovery, customer management recovery and callback-handling drills. No live transfer, telephone answering or external-calendar coverage is claimed.

