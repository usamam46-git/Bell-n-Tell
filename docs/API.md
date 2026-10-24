# HTTP, conversation-event and business-action contracts

All routes use the `/api/v1` prefix. JSON bodies reject unknown fields and use shared Zod schemas. Owner tenant context comes from verified membership; public context comes from the server-resolved business and scoped session. Never accept tenant, role or ownership claims from model arguments. IDs are UUIDs unless marked opaque tokens; dates are ISO 8601 instants with offsets. Error messages contain no secrets.

## Owner HTTP routes

| Route | Method and access | Contract |
| --- | --- | --- |
| `/auth/register`, `/auth/login` | POST, public, throttled | Email/password; registration returns one-time account recovery code; opaque secure session cookie |
| `/auth/session`, `/auth/logout` | GET / POST, authenticated | Session identity; logout revokes server session |
| `/auth/recover` | POST, public, throttled | Email, private recovery code, new password; generic failures; atomically consume code, revoke sessions, return replacement code |
| `/auth/recovery-code` | POST, authenticated plus current password | Rotate account recovery code; show once |
| `/businesses` | GET/POST, authenticated | List memberships or create name/slug/IANA timezone plus owner membership |
| `/businesses/:b`, `/businesses/:b/settings` | GET viewer+, PATCH manager+ | Facts/settings; explicit revision precondition |
| `/businesses/:b/services`, `/businesses/:b/resources` | GET viewer+, POST manager+ | Catalog/resource creation |
| `/businesses/:b/services/:id`, `/businesses/:b/resources/:id` | PATCH manager+ | Edit/deactivate; increment scheduling revision |
| `/businesses/:b/hours` | GET viewer+, PUT manager+ | Complete weekly hours and dated exceptions; validate precedence and increment scheduling revision |
| `/businesses/:b/receptionist/draft` | GET viewer+, PUT manager+ | Flow/policy/copy with `If-Match` draft revision |
| `/businesses/:b/receptionist/validate` | POST manager+ | Validate exact draft revision, return block/field errors |
| `/businesses/:b/receptionist/test-snapshots` | POST manager+ | Exact draft ID/revision; validate then persist immutable snapshot; return snapshot ID |
| `/businesses/:b/receptionist/publish` | POST owner | Draft revision plus reviewed test snapshot ID; atomically publish that same content |
| `/businesses/:b/receptionist/versions` | GET viewer+ | Version metadata |
| `/businesses/:b/receptionist/draft/from/:versionId` | POST manager+ | Copy old published version into new draft; revalidate current references |
| `/businesses/:b/appointments`, `/businesses/:b/appointments/:id` | GET viewer+ | Tenant-filtered list/detail |
| `/businesses/:b/action-proposals` | POST manager+ | Prepare manual create/reschedule/cancel with expected appointment revision |
| `/businesses/:b/action-proposals/:id/confirm` | POST manager+ | Explicit owner UI confirmation; same deterministic commit service |
| `/businesses/:b/appointments/:id/status` | PATCH manager+ | Mark completed/no_show only after appointment start; expected revision; cancellation uses proposal |
| `/businesses/:b/appointments/:id/management-token` | POST owner | Audited offline recovery reason; rotate token hash and return replacement link once, revoking old token |
| `/businesses/:b/customers`, `/businesses/:b/customers/:id` | GET viewer+; PATCH detail manager+ | Read/correct contact details with revision; do not auto-merge by phone |
| `/businesses/:b/inquiries`, `/businesses/:b/inquiries/:id` | GET viewer+; PATCH detail manager+ | Change `new/in_progress/resolved`, add bounded owner-only note, expected revision |
| `/businesses/:b/voice-sessions`, `/businesses/:b/voice-sessions/:id`, `/businesses/:b/overview` | GET viewer+ | Scoped redacted history/activity |
| `/businesses/:b/customers/:id/export`, `/businesses/:b/customers/:id` | GET export / DELETE, owner | Scoped export or deletion/redaction workflow with audit and dependent-copy cleanup |

All cookie-authenticated writes require CSRF and role checks. Consequential business writes, public inquiry submissions and publication require an Idempotency-Key; authentication routes use their own token/nonce semantics. Owner is a superset of manager/viewer. Expose owner-only UI in the first pilot, while testing role enforcement. Lists use opaque cursor and maximum 100 rows.

## Browser and preview HTTP routes

Phase 2 additions are authorized by ADR-018. Owner routes: GET/PUT `/businesses/:b/scheduling-policy` (revision, slotMinutes, noticeMinutes, horizonDays, cutoffMinutes); GET `/businesses/:b/availability` (serviceId, optional resourceId, from/to local dates, at most seven inclusive dates); GET/reject `/businesses/:b/action-proposals/:id`. Service/resource writes carry full validated fields and explicit revisions for updates. Hours PUT replaces weekly hours and dated exceptions atomically: `{revision,weekly:[{weekday,intervals:[{start,end}]}],overrides:[{date,resourceId:null|UUID,closed,intervals}]}`. All times are local HH:mm, with 24:00 allowed only as an end. Scheduling revision is shared by hours and policy and increments on all scheduling edits.

Owner proposal kinds: `book` (serviceId, resourceId, startsAt, contact), `reschedule` (appointmentId, appointmentRevision, resourceId, startsAt, optional owner-only overrideReason), `cancel` (appointmentId, appointmentRevision, optional overrideReason), `inquiry` (contact, summary, type, consentVersion, consent). Contact is `{name,phone:null|E.164,email:null|email}` and needs at least one contact channel. Confirmation is exactly `{revision,confirm:true}`. All preparation/confirmation writes require Idempotency-Key. Confirmed replays return the same receipt; a managementToken may accompany only the first successful booking/reissue response, never a stored receipt.

Phase 2 public browser routes use `/public/:slug`: GET receptionist returns facts, `voiceAvailable:false` and consent version `contact-v1`; POST inquiries takes `{contact,summary,type,consentVersion:'contact-v1',consent:true}`. POST appointment-verifications takes `{reference,token}` and returns a ten-minute signed handle, CSRF token and this appointment. It sets a random HttpOnly browser cookie. GET managed-appointment and availability require `X-Management-Handle`. POST action-proposals takes `{handle,action:{kind:'reschedule'|'cancel',appointmentRevision,...}}`; confirm takes `{handle,revision,confirm:true}`; reject takes `{handle}`. Management writes require Origin, X-CSRF-Token and Idempotency-Key. GET proposal detail requires the handle header. No Phase 3 voice session is created. Verification is limited to five attempts per reference and thirty per IP over a persisted rolling fifteen-minute window (successes also consume this conservative budget).

| Route | Contract |
| --- | --- |
| GET `/public/:slug/receptionist` | Public facts, voice availability, disclosure and text inquiry option |
| POST `/public/:slug/inquiries` | Name (1–100), phone or email, summary (1–2000), type lead/callback, contact-processing consent version and idempotency key; rate-limit; no microphone, transcript consent, provider call or AI credit required |
| POST `/public/:slug/session-admissions` | Consent version and timestamp assertion; atomically reserve budget/concurrency; single-use admission expires after 60 seconds |
| POST `/voice-sessions` | Public: redeem admission, server selects published version. Owner: business, immutable test snapshot ID, transport, and mode preview/real_test; real_test requires explicit acknowledgement. Return scoped app session capability and selected snapshot checksum |
| POST `/voice-sessions/:id/offer` | One SDP exchange per app session; creates one provider call; repeating an uncertain setup must reconcile or end it, not create another call |
| GET `/voice-sessions/:id/events` | Scoped SSE with sequence/replay cursor or bounded polling; stage, proposal, transcript and receipt events; never secrets in normal replay |
| POST `/voice-sessions/:id/proposals/:proposalId/confirm` | Browser confirmation of exact proposal revision; session capability, Origin/CSRF protection as applicable; same commit service |
| POST `/voice-sessions/:id/proposals/:proposalId/reject` | Invalidate pending proposal; no implied cancellation of already committed appointment |
| POST `/voice-sessions/:id/appointment-verifications` | Booking reference and private management token from secure browser field; return short-lived verified handle; never forward token to model |
| POST `/voice-sessions/:id/end` | Idempotent server hangup and application closure |
| POST `/voice-sessions/:id/restarts` | Authorize old session, reconcile/close it, create new linked app session; reuse immutable snapshot if authorized; never reuse pending confirmation/proof |
| POST `/simulations`, POST `/simulations/:id/turns` | Owner preview snapshot plus text/scripted semantic turn; isolated preview gateway; receipts explicitly simulated |

Session capabilities belong to exactly one tenant/session, expire at session close or the short receipt-retrieval grace period (10 minutes), and grant no owner privileges. A signed admission is consumed atomically; it cannot create many paid calls. Current origin checks are defense in depth, not authentication. No permanent or ephemeral provider key is returned in the chosen unified-interface design.

## Conversation event protocol

The interpretation response has one function tool, `submit_turn`. Required payload:

- `intent`: question, book, manage, inquiry, human, finish, correction, unknown.
- `slot_changes`: at most 8 entries with a known slot key, operation set/clear, typed value if set, and supporting words from the current input. No arbitrary customer IDs or nested objects.
- `requested_operation`: one discriminated read/preparation operation from the registry below, or none.
- `question_text`: nullable string, at most 500 characters, only for FAQ selection/clarification context.
- `uncertain_fields`: list of slot keys requiring read-back. This is advisory; do not rely on model confidence for critical fields.

The backend supplies the envelope: `event_id, session_id, input_turn_id, expected_state_revision, provider_response_id, provider_function_call_id`. Input-turn identity comes from provider item ID or an authenticated simulator turn. The model cannot author these fields, a confirmation event or a target block ID.

Internal events: `turn_interpreted`, `readback_started`, `readback_completed`, `readback_interrupted`, `confirmation_received`, `proposal_rejected`, `action_completed`, `session_stop_requested`. Only the controller or authorized browser-confirm endpoint emits confirmation. Event sources and payloads are validated, deduplicated and applied under a session revision lock. Match every model response to the input turn and revision that requested it. A stale response yields STALE_TURN and no action. Every accepted change increments state revision.

Critical slot keys are service_id, resource_id, preferred_date, starts_at, name, phone, email, inquiry_summary. A correction clears downstream availability/proposal/read-back eligibility. A finished action's customer record is not silently overwritten by later slot corrections. One engine cycle executes at most one requested operation; the engine may perform required internal reads to validate it. Unknown/disallowed operations produce a safe directive, never arbitrary execution.

Example: turn T12 proposes Friday at state revision 7; engine invalidates proposal P1, clears selected Thursday slot, computes Friday options and advances to revision 8. A late response to T11 at revision 7 is discarded. Saying “yes” cannot revive P1.

## Operation registry

These are Zod contracts inside requested_operation; the adapter exposes the nested allowlist through submit_turn. Engine-only commit operations are omitted from all model schemas.

| Operation | Input | Result/gate |
| --- | --- | --- |
| get_business_details | topic enum contact/address/policy | Public snapshot facts |
| get_services | optional query, max 100 chars | Current active catalog |
| get_business_hours | optional local ISO date | Current hours and IANA timezone |
| find_resources | service_id | Eligible public resource names |
| check_availability | service_id, from/to local dates (maximum 7 days), optional resource_id | Up to 3 candidates, no reservation |
| find_appointment | verified_appointment_handle | Only the verified appointment; no lookup by unverified name/phone |
| prepare_appointment | service_id, resource_id, starts_at, name, phone/email | Durable normalized proposal, read-back and expiry; end time calculated server-side |
| prepare_reschedule | verified handle, starts_at, optional resource_id | Proposal tied to current appointment revision |
| prepare_cancellation | verified handle | Proposal tied to current appointment revision |
| prepare_inquiry | name, phone/email, summary, type lead/callback | Proposal for explicit submission consent |

Contact validation: trimmed name 1–100 chars; phone normalized to E.164 with explicit country context; email at most 254 chars and structurally validated; at least one contact channel required. Read back critical contact and exact time regardless of model confidence. Unsupported/custom question answers cannot be passed as action arguments.

Engine-only operations are create_appointment, reschedule_appointment, cancel_appointment, capture_inquiry and request_human_assistance. Each accepts only a server-loaded confirmed proposal and verified execution context. They are called directly by the turn controller after confirmation, with no second model tool call. Public text inquiry forms and owner forms count as explicit submission after their exact content is shown; they prepare and confirm through the same service boundary.

## Proposal and retry rules

A proposal is bound to business, session/owner actor, kind, canonical payload hash, state revision, scheduling revision, appointment revision when applicable, confirmation evidence and expiry. Default lifetime is 120 seconds from preparation. A material edit creates a new proposal and invalidates the previous one. A consumed proposal cannot create a new action even if the model repeats the operation under a new function-call ID.

Use the proposal ID as the stable logical mutation identity. Owner/form idempotency keys map to a single proposal plus canonical request hash. Pending attempts, transaction boundaries and recovery are specified in [DATABASE.md](DATABASE.md). If a slot or policy revision is stale, return STALE_PROPOSAL and require fresh read-back. Existing receipts can be read after expiry, but an expired uncommitted proposal cannot be confirmed.

## Errors and receipts

HTTP error: `{error:{code,message,requestId,details?}}`. Operation result: `{status:ok|rejected|retryable|unknown,code?,data?,actionReceiptId?}`. Use 400 for schema errors, 401/403 for auth/role, 404 for inaccessible IDs, 409 for revision/idempotency/slot conflicts, 410 for expired proposals/capabilities, 429 for admission limits, 503 for dependency failure. Codes include VALIDATION_ERROR, OWNERSHIP_UNVERIFIED, CONFIRMATION_REQUIRED, PROPOSAL_EXPIRED, STALE_TURN, STALE_PROPOSAL, SLOT_UNAVAILABLE, POLICY_DENIED, IDEMPOTENCY_CONFLICT, ACTION_IN_PROGRESS, BUDGET_GUARD, TEMPORARILY_UNAVAILABLE and UNKNOWN_COMMIT_STATUS.

Public verification failures do not reveal whether a booking exists. Retries resolve stored action status before further mutation. Durable success receipts contain action ID, committed timestamp, resulting record ID/revision and safe display details. They never contain management/recovery secrets in persisted/replayed model results. Secret delivery is one-time through the scoped browser receipt; failed delivery uses owner-assisted recovery.

