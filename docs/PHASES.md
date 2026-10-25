# Dependency-aware implementation plan

**Current state: Phases 1 and 2 implemented and locally verified; Phase 3 is authorized and in progress.** The offline engine, owner text preview and Phase 3V adapter fixtures have local evidence, but the required Phase 3V live voice checkpoint remains unverified. Later phases require a new user request. The sequence below defines execution order and scope. Each milestone records changes, evidence, risks and next task in docs/PROGRESS.md; do not create application placeholders to satisfy this document.

## Phase 0 — Planning and review

- Objective: settle product journey, contracts and failure behavior.
- Included/deliverables: all requested planning documents and root AGENTS.md; review corrections for event/confirmation protocol, draft snapshots, retries, shutdown, recovery, scheduling and pilot assumptions.
- Dependencies: requirements and verified official provider references.
- Files/modules: documentation only.
- Database: design only.
- Tests: requirement traceability and cross-document consistency, no paid calls.
- Acceptance/definition of done: clear source-of-truth contracts, explicit unresolved account/pilot checks, and an implementation-authorization boundary.
- Excluded: application code, scaffolding, installs, migrations and live inference.

## Phase 1 — Foundation (first later-authorized milestone)

- Objective: owner can securely create an account/business and reach setup.
- Features: npm workspace, strict TypeScript, Next.js/Tailwind/shadcn, Fastify, Drizzle/Zod, PostgreSQL, secure sessions, recovery code, CSRF, throttling, owner membership, timezone/contact setup and restrained dashboard shell.
- Dependencies: Phase 0 and explicit implementation request; verify official package compatibility when pinning versions.
- Deliverables/modules: apps/web, apps/api/src/{auth,businesses,db}, packages/contracts, local Compose, env validation/example, migration tooling, clean-start instructions and PROGRESS.md.
- Database: users, auth_sessions, security_throttles, businesses, business_memberships, business_settings.
- Tests: fresh DB migration, session/CSRF/recovery, two-business forbidden access, basic onboarding browser smoke.
- Acceptance: owner creates business, saves timezone/contact, signs out/in and can recover using saved code; cross-tenant access denied.
- Exclusions: scheduling, builder, OpenAI, public sessions and billing.
- Done: typecheck/lint/build and targeted tests pass with reproducible local setup; progress recorded.

## Phase 2 — Business operations

- Objective: deterministic services can create/manage appointments and inquiries without a model.
- Features: service/resource/hours/policy setup, minimal schedule/customer/inquiry views, availability, durable proposals and receipts, management-token browser flow, callback status updates, provider-independent contact form.
- Dependencies: Phase 1.
- Deliverables/modules: apps/api/src/{catalog,scheduling,customers,inquiries,actions}, shared schemas and minimal owner forms; defer dashboard polish.
- Database: scheduling_policies, services, resources, service_resources, business_hours, availability_overrides, customers, appointments, inquiries, action_proposals, audit_events; exclusion constraint and revisions.
- Tests: real PostgreSQL overlap races, stale appointment/policy revisions, idempotency across crashes, scheduling defaults/DST, management proof and tenant isolation.
- Acceptance: one real booking/reschedule/cancel/inquiry through the API with exact proposal confirmation, one durable receipt, no overlap; public contact form works with AI disabled.
- Exclusions: Realtime, visual editor, external calendars and polished analytics.
- Done: service/API gates pass; documentation/progress updated.

## Phase 3 — Conversation core and complete engine

- Objective: conversation state drives the same real services and exposes safe owner preview.
- Dependencies: Phase 2.
- First core slice: submit_turn envelope and stale-result rejection; fixed booking route; draft/test snapshot selection; full read-back/confirmation events; session state; real-service scripted booking. Complete this slice before Phase 3V.
- Remaining features after the checkpoint: all ten typed blocks, management subroutine, bounded detours, custom inquiry answers, validator, full default template and text preview with explicit synthetic receipts.
- Deliverables/modules: apps/api/src/conversation/{contracts,controller,engine,validator,preview}, shared block contracts and text test UI.
- Database: receptionist_configs, receptionist_config_versions, voice_sessions, conversation_messages, tool_executions; session FKs on proposals/inquiries.
- Tests: full settings/outcome matrix; changed-mind/stale-turn tests; draft preview before publish; zero-credit conversations using real services/test DB; separate preview tests.
- Acceptance: a scripted booking genuinely commits in test DB; synthetic preview is visibly distinct; invalid graphs/confirmation cannot bypass gates.
- Exclusions: full public voice UX, unrestricted conditions, conversational configuration editing.
- Done: both core slice and remaining engine tests pass; checkpoint outcome recorded before building full visual editor.

## Phase 3V — Bounded voice feasibility checkpoint

This is a future implementation checkpoint inside Phase 3, after its core booking slice and before completing the builder. It is not authorization to make a paid call during planning.

- Objective: verify the risky voice/controller/confirmation/shutdown pattern before investing in the complete owner builder.
- Dependencies: Phase 2 and Phase 3 core slice; operator explicitly enables live AI, checks balance/access and configures project limits.
- Features: fixed test-business browser page, unified GA setup, sideband, submit_turn interpretation, controlled read-back, finalized transcription, one real test booking, provider hangup and usage collection. Use the same adapter/controller modules that Phase 5 expands.
- Deliverables/modules: minimal apps/api/src/voice/{openai,controller,usage,admission} and browser test surface; measured compatibility/latency/cost notes.
- Database: usage_events and usage_guard_state; existing session fields track provider call, reservation, consent and termination.
- Tests: provider fixtures first; then at most the bounded smoke scenarios within the $1 total guard, starting at 45 seconds. Test one normal confirmation and one interruption/shutdown path.
- Acceptance: no deadlock between interpretation and commit; real receipt precedes requested success speech; backend hangup works; usage is recorded or conservatively marked unknown; no duplicate mutation.
- Exclusions: public exposure, full builder, marketing UI, seamless reconnect and telephony.
- Done: evidence recorded; if feasibility fails, amend ADR/contract and resolve before full voice work. Offline engine work can continue without spending; lack of account access never permits silently removing gates.

## Phase 4 — Owner builder

- Objective: owner configures, previews, publishes and rolls back independently.
- Dependencies: Phase 3; checkpoint findings resolved or explicitly tracked as blocking live integration.
- Features: guided stage list/forms, constrained React Flow map, exact schema validation, draft revision conflicts, immutable test snapshots, reviewed-checksum publication and version history.
- Deliverables/modules: apps/web/src/features/receptionist/{setup,builder,test}; config/publish API.
- Database: existing config/version tables; no speculative new tables.
- Tests: first unpublished draft → preview → edit during test → publish matching revision → active/public version continuity → rollback; accessibility.
- Acceptance: default setup needs no manual edge drawing; invalid paths explain actionable errors; tests reflect selected draft.
- Exclusions: arbitrary scripting, auto-publish and conversational editing.
- Done: owner journey and immutable snapshot tests pass; progress updated.

## Phase 5 — Complete browser voice integration

- Objective: turn validated voice mechanics into the usable receptionist/test experience.
- Dependencies: Phases 3V and 4; recheck provider model/API/rates.
- Features: all receptionist paths, real/simulated test distinction, public link behind admission controls, microphone/device errors, stage/transcript/receipt display, secure management field, server watchdog, usage UI and new linked-session restart.
- Deliverables/modules: extend existing voice adapter/controller and web voice features; no duplicate prototype architecture.
- Database: only necessary refinements of session/usage fields; no new connection-attempt hierarchy for MVP.
- Tests: full event fixtures, browser fake-media tests and bounded manual live journeys.
- Acceptance: booking and inquiry work in browser; server closes calls under failure/limit; new sessions clear stale proof/proposals; cost estimates label incomplete usage.
- Exclusions: telephony, live transfer, external calendars and automatic live CI tests.
- Done: all offline suites plus documented live evidence pass; guard remains enabled.

## Phase 6 — End-to-end quality

- Objective: resolve correctness/operating defects before exposing a pilot.
- Dependencies: Phase 5.
- Features: recovery drills, concurrency/security, transcript reconciliation, retention/deletion, account/customer recovery, owner callback work and accessibility polish.
- Deliverables/modules: existing services/UI, test fixtures, runbook and operational metrics.
- Database: only evidence-driven fixes.
- Tests: all scenarios in TESTING.md, especially mixed affirmation, late results, owner/customer races, orphan call, missing usage and privacy copies.
- Acceptance: exercised scenarios show no unauthorized/duplicate writes, false confirmations or tenant leakage; failures are truthful and actionable.
- Exclusions: scale infrastructure, billing and advanced analytics.
- Done: targeted defects fixed, evidence/remaining limitations recorded; no unsupported claim of statistical reliability from a few trials.

## Phase 7 — Controlled commercial browser pilot

- Objective: measure usefulness to one non-clinical business.
- Dependencies: Phase 6, identified business/jurisdiction and explicit schedule-authority agreement.
- Features: TLS/secrets/backups, restore and retention, onboarding/help, recovery support, owner callback responsibility, metrics and feedback.
- Deliverables/modules: deployment/runbook docs and required Docker configuration; operator support procedures.
- Database: pilot-specific retention adjustments only if necessary.
- Tests: restore/deletion replay, recovery/callback drills, owner setup without developer help, manual outside-booking entry plus browser conversation.
- Acceptance: business uses this authoritative schedule or exclusive allocations; understands this handles website conversations rather than phone calls; measures useful outcomes, correction burden, owner time and willingness to pay.
- Exclusions: telephone answering/transfer, calendar synchronization, billing automation, regulated clinical workflows.
- Done: pilot evidence and product value decision documented.

## Future

Telephone adapter, verified delivery, calendar sync, group/multi-location scheduling, industry templates, billing and owner-approved conversational changes require customer evidence and new ADRs. No phase in this document authorizes those features now.

