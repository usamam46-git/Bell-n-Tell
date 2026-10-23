# Test and evaluation strategy

## Test boundaries

All default automated tests consume zero AI credit. Real PostgreSQL is mandatory for scheduling constraints, transaction recovery and tenancy. Distinguish three modes: owner preview (synthetic gateway and visibly simulated receipts), integration conversation (real engine/services/test DB, mocked interpretation/transport), and manually enabled live voice. Preview success is not proof of booking correctness.

## Required suites

| Suite | Evidence |
| --- | --- |
| Contract/unit | Every block setting/outcome, slot invalidation, exact confirmation grammar, state revision rejection, date/policy defaults, cost formula and cached-token accounting |
| Service/API integration | Real migrations, tenant FKs, membership/CSRF, proposal transaction/receipt, overlapping booking races, appointment revision races, recovery/throttling and public form without provider |
| Conversation integration | Scripted submit_turn and lifecycle events drive real action services and isolated PostgreSQL; assert records, receipts and stage states |
| Browser | Owner onboarding, unpublished draft preview, publish/version history, management-token field/link, callback queue, keyboard navigation, consent and device failures |
| Provider event fixtures | Delayed/out-of-order transcript, interrupted output, stale interpretation, duplicate call IDs, sideband loss, unknown setup, hangup failure and usage replay |
| Live checkpoint | Bounded manually enabled sessions establish API compatibility, actual read-back/affirmation/commit, latency, barge-in, transcription and actual cost |

## Critical scenarios and acceptance

1. First owner has no published version: preview a draft, edit during preview, confirm snapshot stays unchanged. Publish only the reviewed matching checksum; public sessions cannot select drafts.
2. Complete booking through the real services: collect fields, prepare, full read-back, explicit confirmation, exactly one database record and committed receipt before success response.
3. Confirmation grammar rejects “yes, but Friday”, “don't confirm”, early/interrupted yes, expired proposal and late transcription for an older turn. Browser confirmation of a stale proposal also fails.
4. Interpret Friday at state revision 8 while Thursday's revision-7 result arrives late: discard stale result; no old proposal can commit.
5. Two customers race for the same slot: exactly one wins. Two confirmations of the same proposal, including different model function-call IDs, return one receipt.
6. Owner reschedules while customer confirms cancellation: expected appointment revision blocks stale cancellation. Hours, service duration or policy edits between prepare/commit require fresh read-back.
7. Simulate crash before DB commit and after DB commit/before response: first rolls back, second returns stored receipt. Abandoned tool log status never triggers an extra mutation.
8. Past booking, notice/horizon/cutoff, full interval fitting, DST gap/repeat, overnight rejection, business/resource exception precedence and timezone-change restriction behave as specified.
9. Wrong management token, cross-tenant token, expired proof, owner impersonation and forged model operation cannot expose records or modify configuration. Shared phone numbers never merge history automatically.
10. Secure token and recovery code never appear in model payloads, URLs with query strings, ordinary logs, transcript replay or persisted receipts. Recovery rotates credentials and revokes old sessions/tokens.
11. Public text inquiry works when OpenAI is disabled/down and when voice consent is declined; separate contact consent is required. Owner moves new → in_progress → resolved.
12. Stop/duration/budget/heartbeat/sideband failure invokes server hangup. Noncooperating browser cannot keep app mutations alive. Unknown termination retains permit/reserve; restart reconciles orphan calls before new admission.
13. Duplicate usage events count once; cached input is a subset; transcription is added; missing usage stays unknown; log purge/restart does not reset lifetime guard.
14. Reconnection creates a new linked application session and provider ID. Prior committed receipt survives; pending proposal and ownership handle do not automatically transfer.
15. Prompt injection in FAQ/caller speech cannot add actions or permissions. Unknown question/loop exhaustion ends in truthful callback/public contact, without an infinite Human/Contact loop.
16. Retention/deletion removes copies in engine_state, proposals, tool logs and exports. Non-PII retry tombstones remain. Restore reapplies deletion records.
17. Owner real-action test is explicitly acknowledged, tagged and cleaned up by normal cancellation. Synthetic preview never appears as a real booking.
18. Pilot records outside bookings consistently or uses exclusive schedule allocation; test manual-entry race with voice booking.

## Live evidence and limits

Record scenario, observed speech, database outcome, provider IDs, model/rate snapshot, spend and latency. For limited live trials report individual values and median; do not claim a credible p95 from a handful of sessions. Before pilot choose target latency and acceptable task completion from observed baseline, then evaluate a representative sample. Zero unauthorized writes, duplicate bookings or false confirmations in the exercised scenarios is a release gate, not proof that arbitrary model speech can never fail.

The early voice checkpoint uses a fixed test business/booking scenario and the global guard; it does not authorize public deployment. A failed confirmation/shutdown/usage invariant blocks progression to full voice integration until resolved. No live API calls run automatically in CI.

## Review traceability

The planning review corrections map to the scenarios above: event protocol (4), confirmation (2–3), draft testing (1), shutdown (12), logical idempotency (5–7), stale revisions (6), builder completeness (contract suite/15), scheduling rules (8), real-service simulation (2–7), missing daily operations/recovery (10–11), reconnect/retention (14/16), and pilot schedule authority (18). See [PHASES.md](PHASES.md) for delivery order.

