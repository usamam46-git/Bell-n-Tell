# PostgreSQL data model

This is a schema plan, not an executable migration. UUID primary keys; all tenant tables include business_id and unique (business_id,id) targets for composite foreign keys. Every tenant relationship uses both columns. Timestamps are timestamptz; business timezone is an IANA identifier. Global users/auth, security throttles and the operator usage guard are explicit exceptions to tenant ownership. Check enum values, lengths, non-null requirements and positive revisions in migrations as well as Zod.

## MVP tables and phase ownership

Phase 2 implementation uses the eleven planned operations tables, with service/resource revisions and appointment timezone snapshots. Phase 1 tables are in `foundation-schema.ts`; `schema.ts` exports the complete Drizzle schema. Migration 0002 backfills default scheduling policies for existing businesses and adds btree_gist, appointment/hour/override exclusion constraints, closed-date uniqueness and a trigger rejecting contradictory closed/open overrides. These custom constraints are maintained in SQL alongside the generated migration/snapshot. Public management proof uses short-lived signed handles bound to a browser cookie and current token credential; it adds no speculative session table. See ADR-018.

| Table / first phase | Key fields and constraints |
| --- | --- |
| users / 1 | normalized email unique, password_hash, name, recovery_code_hash, disabled_at; never store plaintext recovery code |
| auth_sessions / 1 | user_id FK, token_hash unique, expires_at, revoked_at; index user/expiry |
| security_throttles / 1 | scope, hashed_subject_key, window_start, count, blocked_until; unique scope/key/window and expiry index; server-only counters for login, recovery and appointment-proof attempts, no raw credentials |
| businesses / 1 | slug unique, name, timezone, status setup/active/paused; at most one business creation per owner enforced by Phase 1 service transaction |
| business_memberships / 1 | business_id, user_id, role owner/manager/viewer, status; unique business/user; service transaction prevents removal of last owner |
| business_settings / 1 | business_id PK/FK, revision, public facts, FAQs, greeting/consent source copy, retention settings; FAQ max 50 items, each stable ID/question <=200/answer <=1000 chars |
| receptionist_configs / 3 | business_id PK/FK, draft_version_id, published_version_id nullable; tenant-matching version FKs; pointers assigned after versions exist |
| receptionist_config_versions / 3 | business_id, version_no nullable, draft_revision, source_draft_id/revision nullable, status draft/test_snapshot/published/archived, flow/policy/content JSONB, test_fixture JSONB nullable, checksum, created_by/at, published_at; one mutable draft per business (partial unique), unique non-null business/version_no; non-draft payload immutable |
| scheduling_policies / 2 | business_id PK/FK, revision, notice/horizon/cancellation/slot settings below; serialize scheduling edits and commits by locking this row |
| services / 2 | business_id, name, duration_minutes, public_description, price_text, active; partial unique active normalized name; duration 5–480, multiple of 5 |
| resources / 2 | business_id, display_name, active; partial unique active normalized name |
| service_resources / 2 | business_id, service_id, resource_id; unique triple and composite tenant FKs |
| business_hours / 2 | business_id, weekday 0–6, start/end local time; nonempty, nonoverlapping intervals per weekday; end later than start |
| availability_overrides / 2 | business_id, resource_id nullable, local_date, kind closed/open, start/end nullable; index business/date/resource; scope/date is either one closed marker or nonoverlapping open intervals |
| customers / 2 | business_id, revision, name, phone_e164/email nullable, created_at; at least one contact; indexed business/phone and business/email, no automatic merge or uniqueness on contact |
| appointments / 2 | business_id, revision, customer_id, service_id, resource_id, starts_at, ends_at, service_name/duration/price description snapshots, status confirmed/cancelled/completed/no_show, source voice/owner/owner_test, booking_ref, manage_token_hash, timestamps; unique business/reference, tenant FKs, index business/start/status and customer |
| inquiries / 2 | business_id, revision, customer_id nullable, voice_session_id nullable (added in 3), type lead/callback, summary, owner_note nullable, status new/in_progress/resolved, source, timestamps; index business/status/time |
| action_proposals / 2 | business_id, revision, actor_kind/id, voice_session_id nullable (added in 3), kind, payload JSONB, payload_hash, scheduling_revision nullable, appointment_id/revision nullable, expected_state_revision nullable, expires_at, status prepared/awaiting_confirmation/confirmed/committed/rejected/expired, confirmation metadata, request_key nullable, result/receipt JSONB, created/committed_at; unique business/request_key when present; index business/status/expiry; ID is logical mutation key |
| tool_executions / 3 | business_id, session_id, provider_function_call_id nullable, provider_response_id nullable, input_turn_id, expected_state_revision, requested operation, proposal_id nullable, redacted_args/result, status pending/succeeded/rejected/failed, timestamps; unique session/function-call ID; index session/time; observational log, never mutation authority |
| voice_sessions / 3 | business_id, config_version_id, restart_of_session_id nullable, provider_realtime_call_id nullable unique, mode preview/real_test/public/integration, transport simulator/realtime, status admitted/connecting/active/closing/closed/failed/termination_unknown, state_revision, engine_state JSONB, consent_at/text_version, admission_expires_at, max_end_at, heartbeat_at, reserved_usd, usage_complete, timestamps, outcome |
| conversation_messages / 3 | business_id, session_id, provider_item_id nullable, input_turn_id nullable, role, redacted text, sequence, generated/completed/interrupted metadata; unique session/sequence and session/provider-item ID; distinguish generated words from acknowledged playback |
| usage_events / 3V | business_id, session_id, source response/transcription, provider_event_key, model, raw numeric usage, rate_snapshot JSONB, estimated_usd, created_at; unique session/source/event-key; no transcript or PII |
| usage_guard_state / 3V | singleton operator row id=1, lifetime_observed_usd, unresolved_reserve_usd, reconciliation timestamp/operator adjustment; not tenant-facing; locked for global budget/concurrency admission |
| audit_events / 2 | business_id, actor_kind/id, operation, target_type/id, safe_metadata, outcome, created_at; append-only application permission; index business/time/operation |

Phase 3V is the later-authorized feasibility checkpoint inside Phase 3, after its core controller/session slice and before the full builder. It adds usage accounting to the existing session table, not a parallel schema. Phase 2 proposals/inquiries get optional session columns and composite FKs when Phase 3 creates sessions. Migration ordering must not reference absent tables. If account access prevents the checkpoint, record it as a live-integration blocker; do not silently remove it.

Explicit NOT NULL requirements include appointment tenant/resource/customer/service/start/end/status/revision, proposal kind/hash/expiry/status, and every tenant FK component except relationships described as optional. Avoid nullable fields weakening exclusion constraints. All revision checks are optimistic concurrency checks in addition to transaction locks.

## Configuration and test snapshots

Settings and the mutable draft are source material. Starting a preview validates and atomically copies the requested draft revision into an immutable test_snapshot row, including FAQ/copy and separate test_fixture JSONB with synthetic catalog/hours and no customer data. The reviewed configuration checksum excludes fixture/runtime metadata. Publication copies configuration only, never synthetic fixture data. Public sessions must reference a published version; owner preview/real_test may reference an authorized test_snapshot. Store that selection in the session. Only preview uses the synthetic action gateway; real_test uses current real operational data.

Draft changes increment draft_revision and do not affect running snapshots. Publication requires the tested/reviewed checksum to match the draft revision being published; a changed draft must be reviewed again. Publish creates a numbered immutable published copy, leaves historical test snapshots intact for their retention period, and creates the next editable draft. Rollback copies an old version into a new draft and follows the same checks. Public sessions read current catalog/hours through tools, while copy/FAQ behavior stays pinned. A published flow cannot promise static prices/hours that override live results.

## Scheduling rules (MVP defaults)

- One resource per appointment, capacity one. All resources share recurring business hours; dated resource exceptions can restrict them. No recurring staff-specific hours in MVP.
- Slots start on a 15-minute local-time grid, measured from local midnight. Service duration defaults to 30 minutes. Buffer is fixed at zero. Duration is derived from the service by the backend, never supplied as an end time by the model.
- Minimum booking/rescheduling notice: 60 minutes. Maximum start: 60 calendar days ahead in the business timezone. Public cancellation/rescheduling cutoff: 24 hours before the existing start. Owners may override only the management cutoff in their authenticated UI with an audited reason; they cannot override overlap, active resources or hours.
- These four policy values are typed owner settings (slot spacing 5/10/15/30/60; notice 0–10080 minutes; horizon 1–180 days; cutoff 0–10080 minutes). Editing them increments scheduling revision. Fixed defaults are sufficient for onboarding.
- Business date exceptions replace weekly hours for that date. A closed business date is empty availability; otherwise its listed open intervals replace weekly intervals. Resource date exceptions then intersect that business availability: a resource cannot reopen a closed business. Contradictory closed/open rows for the same scope/date are rejected.
- Overnight hours must be entered as two adjacent-date intervals; unsupported single intervals crossing midnight are rejected. Generate in local timezone then convert to UTC. Skip nonexistent DST instants; offer ambiguous repeated times only with explicit offset/timezone in read-back. Store the chosen instant and business timezone used.
- Every slot must fit completely within an allowed interval and pass notice/horizon rules. Relative dates use business local date; ask for clarification where caller timezone is unclear. Past public bookings are rejected.
- Changing timezone is blocked while future confirmed appointments exist; migration of those appointments is outside MVP.

All scheduling writes (catalog, resource eligibility, hours, exceptions, policy) lock scheduling_policies for that business and increment its revision. Appointment commits lock the same row before validating current availability. This simple lock order trades per-business write throughput for clear correctness at pilot scale. Lock order is session (when applicable) → scheduling row → proposal → appointment; no reverse order in any operation. Owner-only operations omit the session lock and never acquire it later. Preparation captures scheduling revision; a changed revision requires new read-back even if the slot still appears available.

## Appointment transaction and idempotency

Enable btree_gist and exclude overlapping confirmed intervals with business_id equality, resource_id equality and tstzrange(starts_at,ends_at,'[)') overlap. Require ends_at > starts_at and all constraint inputs non-null. See PostgreSQL [range constraints](https://www.postgresql.org/docs/current/rangetypes.html) and [partial exclusion predicates](https://www.postgresql.org/docs/current/sql-createtable.html).

Prepare a durable proposal with a 120-second expiry. No schedule is reserved. Repeated preparation of the same kind/canonical payload and dependency revisions in the same active conversation returns the existing unexpired proposal. Material correction invalidates it and creates another. The proposal ID is the logical action identity, regardless of how many interpretation responses/function calls arrive.

On confirmation:
1. Lock session when applicable, scheduling row if applicable, proposal, then appointment. Verify tenant, actor/session, exact proposal, expiry, confirmation evidence, ownership and captured revisions. Each proposal has a revision; arming completed read-back binds the current state revision. Any later material state change clears that eligibility. This serializes correction versus confirmation without a lock-order inversion.
2. Persist the confirmation evidence and perform the mutation within the same transaction. For reschedule/cancel, update only the expected appointment revision; increment revision. Exclusion conflict produces SLOT_UNAVAILABLE. A revision change produces STALE_PROPOSAL; neither silently overwrites owner edits.
3. Insert/update customer only as explicitly authorized; new callers do not inherit history based on matching phone. Persist record, redacted receipt, proposal committed status and audit event in the same transaction.
4. Commit, then return receipt. Replay of any call referencing the committed proposal returns that receipt.

There is no separately committed “mutation in progress” reservation. A crash before transaction commit rolls back the record and confirmation; a crash after commit leaves both receipt and record durable. A concurrent retry waits for the proposal lock or receives ACTION_IN_PROGRESS. It then reads committed status. Expired uncommitted proposals are marked expired by a sweep; never auto-confirm or replay them. Pending tool log entries abandoned by a process are marked failed after session reconciliation; they do not prove mutation failure. A genuinely uncertain DB response is resolved by proposal lookup, not a new write.

Owner/form Idempotency-Key maps to unique business/request_key and payload hash in action_proposals. Reuse with changed payload is IDEMPOTENCY_CONFLICT. Success receipts remain retrievable for 90 days; expired identifiers cannot authorize new actions. Keep non-PII consumed-key tombstones for the life of the associated business record (or a deletion tombstone) to prevent an old retry becoming a fresh write.

## Recovery, identity and retention

One application session has at most one provider_realtime_call_id. A restart is a new session with restart_of_session_id pointing to its predecessor. Close/reconcile the predecessor first, copy only safe intent and config reference, clear verification handles and pending proposals. IDs for provider connections, provider responses and function calls are never interchangeable.

Privacy defaults: no raw audio storage. Redacted transcript/tool detail retention 30 days; session metadata/usage events 90 days; audit metadata 1 year. Clear engine slots, verification handles and uncommitted proposal PII when a session closes, retaining only IDs/revisions needed to reconcile uncertain actions; clear remaining reconciliation payload immediately after resolution and no later than 24 hours by escalating to an operator. Committed records retain operational data until owner deletion/applicable policy.

The deletion job covers messages, tool arguments/results, engine_state, action proposal payloads, inquiry/customer copies and exports. Receipts retained for idempotency contain IDs/outcome only after content expiry. Logs are redacted at ingestion and do not duplicate raw payloads. Backups age out under a documented 30-day rolling policy; a restore must reapply deletion tombstones before serving traffic. Retention settings are operator-bounded and pilot-jurisdiction review remains required.

A management token is random with at least 128 bits of entropy, stored only as a keyed hash on the appointment. Account recovery codes are separate credentials, also at least 128 bits and stored as hashes. Verification attempts are throttled; no contact-detail matching grants ownership. Details are in [SECURITY.md](SECURITY.md).

## Deferred tables

Locations, calendar connections, group capacity, billing, notification delivery, raw recordings and industry-specific data remain deferred. The new action proposal and usage tables above address concrete confirmation/retry/budget requirements; do not add a generic event-sourcing or workflow subsystem.



