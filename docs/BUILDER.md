# Owner conversation builder

## Owner experience and scope

Onboarding creates a working draft from facts, hours and one service. The default editor is a vertical stage list with plain-language forms and previews. A constrained @xyflow/react map shows the same permitted paths; owners cannot draw arbitrary edges or conditions. The map is a view of the shared schema, not a second source of truth.

Default path: Greet → Understand → answer a question, check availability and book, capture inquiry, or offer callback → Finish. Appointment management is an engine-owned subroutine entered from Understand after a secure browser ownership check. Owners can disable booking/management but cannot remove confirmation, tenant enforcement or ownership checks.

Initial pilot language is English. Voice selection and pronunciation are configurable from supported provider options later verified in the feasibility checkpoint. Other languages require their own confirmation grammar, date/contact handling and live evaluation; multilingual behavior is not implicitly enabled.

## Complete flow shape

FlowDefinition has schemaVersion=1, entryBlockId, blocks (1–30), and server-fixed maxTransitions=30. Each block has UUID id, one of the ten kinds below, exact settings, and an outcome-to-block-ID mapping. Unknown settings/outcomes and duplicate IDs fail validation. There are no executable expressions, external URLs, model-authored tools or SQL.

Common limits: owner copy is plain text, 1–500 chars where required; optional copy is 0–500. Block labels are at most 60 chars. Catalog and FAQ IDs must belong to this business. Names/contact/time are core slots; custom answers are bounded non-sensitive inquiry notes and cannot control permissions or booking arguments.

## Supported kinds, exact settings and outcomes

In this table “default” means generated when onboarding creates the template. Every listed outcome needs a target unless explicitly terminal. Engine clarification counters handle re-asks internally; owners cannot add arbitrary self-edges.

| Kind / owner label | Settings (required unless marked optional) | Allowed outcomes and semantics |
| --- | --- | --- |
| Greet / Greet customer | greeting default “Hello, how can I help?”; AI disclosure fixed operator-approved text, owner preview only | next → Understand; consent occurs before this block |
| Ask / Ask a question | question; slotKey core inquiry_summary or custom.question_ID; answerKind text/choice; required default true; maxLength 1–500 default 200; choices required only for choice (2–5 labels, <=60 each); retryCopy optional | answered / skipped / failed; skipped valid only if not required; required failure → Human |
| Understand / Understand customer request | enabledIntents subset question/book/manage/inquiry/human (human always included); clarificationCopy default “Would you like to ask a question, book, or leave a message?” | question/book/manage/inquiry/human/unknown for enabled paths; unknown after bounded clarification → Human; manage invokes protected subroutine and then its completion target |
| Answer / Answer from business information | faqIds array max 50, default all published FAQ IDs; publicTopics subset contact/address/policy/hours/services; fallbackCopy default “I don't have that information.” | answered → Understand or Finish; unknown → Human or Inquiry |
| Availability / Check availability | allowedServiceIds nonempty; resourceChoice any/preferred default any; maxOptions 1–3 default 3 | selected → Contact or Book; none → Inquiry or Human; error → Human; options are shown within this block until one is selected |
| Book / Book appointment | allowedServiceIds nonempty; readbackIntro optional (cannot replace required fields); failureCopy optional | confirmed → Finish; conflict → Availability; rejected → Understand or Finish; error → Human; no owner-provided success claim before receipt |
| Contact / Collect contact information | requireName fixed true; contactRequirement phone/email/either default either; optional retryCopy; criticalFieldReadback fixed true | collected → Book/Inquiry/Human; declined → Human; failed → Human; contact verification here means read-back, not identity proof |
| Inquiry / Record inquiry | summaryPrompt default “What would you like the business to know?”; includeCustomAnswers default true; submissionIntro optional | recorded → Finish; declined → Finish; error → Human |
| Human / Offer human assistance | callbackOffer default “I can record a callback request.”; publicContactFallback required from business; promisedResponseTime absent unless a factual owner-entered hours statement (no guarantee) | recorded → Finish; declined → Finish; unavailable → Finish with public contact details; missing contact is handled inside block |
| Finish / Confirm and finish | closingCopy default “Thank you.”; includeReceipt default true; allowNewRequest default true | end terminal; new_request → Understand (only once/session, then end) |

For Understand.manage the protected subroutine has internal outcomes completed → Finish, declined → Understand/Finish, unverified → Human, conflict → its own availability step, error → Human. Persist these subroutine stages in engine_state; they are not arbitrary owner-created blocks. It permits only find verified appointment, prepare reschedule/cancel, complete read-back, confirmation and commit.

Custom Ask answers live in session slots under their block ID. If the customer explicitly agrees to an inquiry submission, bounded answers are copied into its summary with labels. Otherwise they are discarded on session close. They never become new columns, model tool arguments or branching expressions. Ask is intended for intake; service/time/contact collection uses the dedicated blocks and engine slots.

## Engine transitions and global interruptions

The model submits the advisory submit_turn contract in [API.md](API.md). The engine validates values and permitted actions, maps outcomes to known edges, and increments state revision. Required fields are determined by block/action schema, not by model certainty. Critical name/contact/time values are always read back; inferred confidence can only trigger more clarification.

Global events have priority over a block's local outcomes: stop → end; request human → Human; correction → invalidate dependent proposal and return to appropriate collection/availability stage; unrelated FAQ → bounded answer detour then resume the saved stage with unchanged verified fields. A changed service clears resource, slot and proposal; changed resource/date/time clears selected availability and proposal; changed contact clears proposal read-back. A changed appointment revision invalidates management confirmation.

Limits are 30 accepted stage transitions, two failed clarifications per required slot, two FAQ detours and one additional completed request per session. On exhaustion go to Human once, then Finish/public contact without another loop. If Human was reached from missing contact, it must use the public-contact fallback rather than return to Contact indefinitely. Arbitrary graph cycles are invalid; the validator recognizes only these engine-owned bounded returns.

## Policy forms

Hard action settings use explicit switches and typed fields: allow booking, allow management, approved services, contact requirement and scheduling settings from [DATABASE.md](DATABASE.md). Protect private records and configuration editing in backend code regardless of switches.

“Never promise/disclose” has fixed descriptive choices such as no availability guarantee before commit and no access to another customer's data, plus optional custom guidance text (max 2000 chars). Do not use an unspecified classifier to turn natural language into permissions. Advice/topic boundaries guide the model and callback behavior, but cannot be advertised as perfectly enforced semantic speech filters. An owner cannot configure medical/payment data collection. Arbitrary custom guidance never changes action policy.

## Drafts, test snapshots, publication and rollback

One mutable draft has an integer revision. Save with If-Match; conflicts ask the owner to refresh rather than overwrite edits. Test creation validates that revision and stores an immutable test_snapshot with checksum and fixture. A first-time owner can test with no published version. Preview and real-action tests select this snapshot explicitly. Later draft edits never change an active test.

Publish requires structural validation and owner review of a test snapshot matching the exact draft checksum. The review is an owner acknowledgement, not an AI score. Publish copies it into a numbered immutable published version and updates the public pointer atomically. A new draft is then forked. Customer sessions already running stay pinned; new visits use latest published. Operational catalog/hours remain live and are checked at commit. Rollback copies an older version into a draft, revalidates references, tests/reviews and publishes a new number.

Validation checks every settings field and outcome above, active same-tenant references, one reachable entry, a reachable Human and Finish, allowed edges, contact readiness before Book/Inquiry, mandatory proposal confirmation, terminal reachability under bounded returns, copy/FAQ size and safe custom question types. Disabled intents need no edges; enabled ones do. The engine still enforces these requirements at runtime even if a malformed graph bypasses UI validation.

## Testing and future configuration assistance

Owner text preview and owner voice preview use the real engine with synthetic fixtures/action results; display “Simulation — no appointment was created” on receipts. The fixture comes from the selected draft's catalog/hours with synthetic customers and occupied slots, never real customer data. Real-action test is an explicit opt-in, uses the same backend services as public operation and tags records owner_test; it affects real availability and must offer cleanup through ordinary cancellation.

Separately, zero-credit integration tests use real services and PostgreSQL with only interpretation/provider events mocked. Preview success is not database correctness evidence. See [TESTING.md](TESTING.md).

Future conversational editing may propose a typed diff for the owner to inspect, validate and approve. It cannot publish automatically or be invoked by a customer conversation.

