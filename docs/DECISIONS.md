# Architecture decision records

## ADR-020 — Owner-only Phase 3V offline adapter boundary (2026-10-25)

The bounded feasibility surface accepts only an authenticated owner/manager `real_test` session pinned to an immutable test snapshot, with an explicit real-action acknowledgement and `owner-voice-test-v1` disclosure. The API adds `POST /voice-sessions/:id/heartbeat` so the server can detect a missing browser within 15 seconds; this is the one additive HTTP contract for the checkpoint. `/offer` receives JSON `{sdp}` under the existing CSRF/session-capability boundary. No public admission or general voice deployment is enabled.

The provider-facing `submit_turn` schema is intentionally limited to the fixed booking slice and has no requested operation; the shared strict Zod contract still validates every returned turn. Provider response IDs bind to their originating input and state revision. A later finalized input discards an older result before any proposal or action. The sideband handles response creation, input transcription, read-back playback events and server-owned commits; the browser can explicitly confirm the displayed proposal. Automatic voice confirmation remains ineligible without a finalized exact affirmation and provider output-buffer completion for the full read-back.

Live admission defaults off, reserves $0.25 under a $1 lifetime local guard, and permits one call at a time. A call with missing final usage or uncertain termination retains its reservation and blocks another call until operator reconciliation. The API stays available for provider-independent forms if PostgreSQL is temporarily unavailable at startup; live admission remains closed until orphan reconciliation succeeds. This conservative setup may end with `termination_unknown` or incomplete usage during the first provider smoke and requires live evidence before Phase 3V can pass. Current provider model/rates and event compatibility must be checked against the configured project immediately before spending.

## ADR-019 — Phase 3 offline controller and simulator boundary (2026-10-24)

Implement the documented Phase 3 core before the remaining engine. The owner-only simulator uses the same controller and real services for explicitly acknowledged real_test; preview uses an immutable synthetic fixture. Simulator turns accept text and optionally the strict submit_turn semantic payload; the server attaches event/turn/session/provider identities, enforces expected revision and owns confirmation. No HTTP endpoint accepts trusted voice playback/confirmation events. Those controller methods are exercised by offline fixtures and reserved for the future provider adapter. Browser confirmation binds the displayed proposal revision and session state. Add owner-authenticated simulator GET state and secure verification/confirm/reject/end routes under the existing session contracts; no public session admission or live transport is enabled.

Session creation returns a random capability once, stores only its keyed hash and also requires the creating owner's current membership/CSRF on HTTP writes. Session rows carry created_by, capability_hash, sequence and close timestamps in addition to the planned fields. Conversation-message metadata records deduplicated controller events; tool executions remain observational and cannot authorize mutations. Session lock precedes scheduling/proposal/appointment locks. Real proposals carry the session/state revision and owner_test source; the same deterministic action transaction commits record, receipt and confirmation. Preview receipts are visibly synthetic and never create operational rows. Phase 4 publication/rollback/map UI remain out of scope; Phase 3 supplies only the draft/snapshot API and text test surface needed by its acceptance journey.

## ADR-018 — Phase 2 browser management before conversation sessions (2026-10-24)

Phase 2 is authorized. Add owner GET/PUT `/businesses/:b/scheduling-policy`, GET `/businesses/:b/availability`, and GET/reject on owner action proposals. Add public management routes under `/public/:slug`: appointment-verifications, managed-appointment, availability, action-proposals, proposal detail/confirm/reject. These are deterministic browser routes; they create no Phase 3 voice sessions. Verification issues a signed ten-minute handle bound to a random HttpOnly/SameSite browser cookie, tenant, appointment and current management-token hash. Each use reloads that appointment and checks the signature, cookie, expiry and token hash; rotation immediately revokes old proof. Origin plus a handle-derived CSRF token protects management writes. Only reference/token verification accepts the secret, in the JSON body. The browser reads and immediately removes the fragment. No raw secret is persisted or replayed; failed one-time delivery uses audited owner recovery.

Setup/status/contact updates also use committed action_proposals as durable idempotency tombstones, storing only their ordinary result. Services/resources carry their own revisions in addition to the scheduling revision. Custom SQL in the generated migration adds exclusion constraints and an override-consistency trigger that Drizzle cannot express; retain that migration when generating later changes. No provider integration or paid service is introduced.

Decisions are binding for the planned MVP unless new evidence justifies an amendment. Date: 2026-10-23; amended after architecture review. Implementation is not authorized until the user's later explicit request. See linked documents for contracts.

## ADR-001 — Receptionist domain, not general automation

**Decision:** Implement one conversation-and-reception engine with fixed block kinds and business actions. **Reason:** Owners buy answered inquiries and reliable bookings; arbitrary workflows add setup and failure modes. **Consequence:** New actions require product review and explicit service contracts, not a generic node/connector framework. See [PRODUCT.md](PRODUCT.md).

## ADR-002 — Deterministic actions, natural speech

**Decision:** The server requests a text-only submit_turn interpretation, applies a typed/revision-bound engine event, then requests tool-free speech. Backend owns transitions and calls commits directly after its confirmation gate. **Reason:** Model output must not approve its own action; a clear event protocol prevents state divergence. **Consequence:** Two response stages add latency/cost and require the Phase 3V feasibility check. See [ARCHITECTURE.md](ARCHITECTURE.md), [API.md](API.md) and [VOICE.md](VOICE.md).

## ADR-003 — Guided builder first

**Decision:** Default editor is a stage list and forms; React Flow is a constrained overview/branch view. **Reason:** A free-form canvas is harder for a nontechnical owner and invites invalid logic. **Consequence:** No arbitrary conditions or edges; fixed branch choices and publish validator. See [BUILDER.md](BUILDER.md).

## ADR-004 — Immutable published versions and persisted session state

**Decision:** Public sessions pin immutable published versions; owner tests pin immutable snapshots of a selected draft revision, including before first publish. Reconnect starts a new linked application session/provider call and clears proof/proposals after receipt reconciliation. **Reason:** Tests must reflect edits without changing running sessions. **Consequence:** Publish binds the reviewed checksum; no seamless media resume in MVP. See [DATABASE.md](DATABASE.md).

## ADR-005 — Simple FAQ snapshot before RAG

**Decision:** Use owner-entered structured facts and a bounded FAQ snapshot. **Reason:** First businesses have small knowledge sets and need predictable answers; search infrastructure is unproven. **Consequence:** Unknown questions trigger clarification or callback. Add retrieval only after measured FAQ volume/accuracy demands it. See [BUILDER.md](BUILDER.md).

## ADR-006 — PostgreSQL as booking authority

**Decision:** Transactional scheduling plus a resource/time exclusion constraint; application availability is advisory. **Reason:** Concurrent voice sessions can select the same slot. **Consequence:** PostgreSQL extension/migration and conflict handling, but no Redis lock. See [DATABASE.md](DATABASE.md).

## ADR-007 — Idempotent, confirmed mutations

**Decision:** A durable proposal binds canonical fields, expiry, scheduling/appointment revisions and confirmation evidence. Proposal ID is the logical action key; record/receipt/consumed status commit atomically. **Reason:** New model function IDs must not produce duplicate writes or overwrite owner edits. **Consequence:** Stale fields require new read-back; no separately committed in-progress mutation reservation. See [API.md](API.md) and [DATABASE.md](DATABASE.md).

## ADR-008 — Browser Realtime with server-owned control

**Decision:** Native WebRTC, GA unified `/v1/realtime/calls`, backend sideband for function tools; adapter hides provider events. **Reason:** Browser voice meets first value goal without telephony or extra provider. **Consequence:** Server participates in call setup and must manage sideband lifecycle. Current docs: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [server controls](https://developers.openai.com/api/docs/guides/voice-server-controls). See [VOICE.md](VOICE.md).

## ADR-009 — Low-cost model with local and provider controls

**Decision:** Start live tests with configurable `gpt-realtime-2.1-mini`; run most tests offline; enforce local session/concurrency/estimate guards and configure provider project hard limit where permitted. **Reason:** Approximately $5 credit balance. **Consequence:** Cost estimate is advisory and live testing is deliberately narrow. Recheck [pricing](https://developers.openai.com/api/docs/pricing) and [spend limits](https://developers.openai.com/api/docs/guides/spend-limits) before use. See [VOICE.md](VOICE.md).

## ADR-010 — Minimal monorepo and secure sessions

**Decision:** npm workspaces with web, API and contracts; Fastify session cookies backed by PostgreSQL. **Reason:** Shared types and a small operational footprint. **Consequence:** Implement CSRF, revocation and session expiry correctly; no auth/workflow infrastructure without evidence. See [STACK.md](STACK.md).

## ADR-011 — Public booking management uses a private code

**Decision:** Booking reference plus >=128-bit management token establishes a session-scoped handle via secure browser field/saved fragment link. Tokens are never requested in voice or sent to model tools. **Reason:** Contact details are not ownership proof, and a spoken 12-character code is poor browser UX. **Consequence:** One-time delivery, hash storage, throttling and audited owner-assisted reissue; no paid delivery dependency. See [SECURITY.md](SECURITY.md).

## ADR-012 — Owner test semantics are explicit

**Decision:** Owner preview uses synthetic action fixtures; integration conversations use real services and disposable PostgreSQL with only model/transport mocked. Owner real-action tests require opt-in and produce tagged schedule records. **Reason:** Safe preview and database correctness need distinct evidence. **Consequence:** Preview success cannot satisfy real booking acceptance. See [BUILDER.md](BUILDER.md) and [TESTING.md](TESTING.md).

## Open questions with implementation gates

1. **Pilot jurisdiction/sector:** Determine privacy/consent text, retention and prohibited categories with the actual pilot business before Phase 7. The generic defaults are provisional.
2. **Model access/current rates:** Check the project can use the selected Realtime model and inspect current official GA contract/pricing at Phase 5; if unavailable, choose a current compatible model and record an ADR amendment before spending.
3. **Live customer entry:** Public browser link admission and abuse limits need measurement in Phase 5/6. Keep it owner-only until those checks pass.
4. **Voice behavior:** Tune VAD, response style and transcript handling with a small live test set; no architecture change is implied.
5. **Provider-side cost limit:** An organization/project admin must configure alerts and hard limit if available. Account-side controls may lag; retain local guard.

## ADR-013 — Server shutdown and durable budget accounting

**Decision:** Server hangup, not browser cleanup or sideband closure, terminates paid calls. Persist usage/reservations and reconcile orphaned calls before new admission. **Consequence:** Unknown termination/usage blocks further development calls until resolved; incomplete usage is never treated as zero. See [VOICE.md](VOICE.md).

## ADR-014 — Conservative spoken confirmation

**Decision:** Required finalized input transcription, completed read-back, exact full-turn English affirmation grammar and scoped browser fallback. Controller commits directly. **Consequence:** Mixed/late/ambiguous affirmations cannot commit; ASR and general generated speech retain limitations explicitly tested rather than advertised as perfectly controlled. Initial pilot is English only.

## ADR-015 — Scheduling rules and commercial authority

**Decision:** One resource/capacity, shared weekly hours, deterministic dated exception precedence, typed notice/horizon/cutoff defaults, and a scheduling revision lock. **Consequence:** Pilot must use this authoritative schedule or exclusive allocations; browser pilot proves website reception value, not telephone coverage. See [DATABASE.md](DATABASE.md) and [PRODUCT.md](PRODUCT.md).

## ADR-016 — Recovery and deletion cover operational copies

**Decision:** Saved random account recovery codes plus audited pilot support; provider-independent contact form; purge PII from engine state, proposals and logs as well as transcripts. **Consequence:** Keep only non-PII consumed-key tombstones where necessary; restore reapplies deletion records. See [SECURITY.md](SECURITY.md).

## ADR-017 — Early bounded feasibility before full builder

**Decision:** Phase 3V tests one fixed real booking scenario after the deterministic core slice, before the full visual builder. **Consequence:** Confirm provider compatibility, shutdown and cost with a bounded manual smoke before polishing all screens. It is a future implementation step and authorizes no paid calls during planning.
