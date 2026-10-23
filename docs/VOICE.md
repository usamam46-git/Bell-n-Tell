# Browser voice, confirmation and budget controls

## Verified provider baseline

Planning baseline checked against official documentation on 2026-10-23: gpt-realtime-2.1-mini supports Realtime function calling and WebRTC. Rates per million tokens: audio input $10, cached audio input $0.30, audio output $20; text input $0.60, cached text input $0.06, text output $2.40. See [model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini) and [pricing](https://developers.openai.com/api/docs/pricing). The first later live checkpoint must recheck model availability, account access, prices and exact GA event compatibility.

Use the GA unified interface: browser SDP offer → Fastify → POST /v1/realtime/calls with server key/configuration → SDP answer to browser. Capture Location's provider call ID and attach the Realtime sideband. No provider key is exposed to the browser. Short-lived client-secret setup is a documented alternative, but is not the selected MVP route; it would require a new budget/admission review because a secret can create multiple sessions before expiry. Sources: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [server controls](https://developers.openai.com/api/docs/guides/voice-server-controls), [client-secret reference](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create).

## Turn ownership and speech

The sideband controller initiates every model response. Set server VAD with create_response=false and interrupt_response=true; handle cancellation races idempotently. Wait for the effective session update before starting conversation. An interpretation response uses text modality and required submit_turn function; a speaking response uses audio modality and no tools. Never run two competing responses into the default conversation. Revalidate these per-response settings at Phase 3V. [Client events](https://developers.openai.com/api/reference/resources/realtime/client-events) document modalities, tool choice and response creation; [VAD](https://developers.openai.com/api/docs/guides/realtime-vad) documents automatic response/interrupt settings.

Enable input transcription for all real voice MVP sessions because finalized text is needed for owner history and the confirmation grammar. Use gpt-transcribe for committed-turn input transcription if the selected GA session supports it at the checkpoint; current listed price is $0.0045 per audio minute, accounted separately. If unavailable, select and document a supported input-transcription model before enabling speech confirmation, rather than silently dropping it. [Transcription guidance](https://developers.openai.com/api/docs/guides/transcription) and [pricing](https://developers.openai.com/api/docs/pricing).

Finalized text is still fallible: transcription is asynchronous and is not an exact record of what the speech-to-speech model perceived. Correlate by input item/turn ID, handle delayed/out-of-order completion and never use arrival order as conversation order. Unknown/failed transcription disables automatic voice confirmation for that turn and offers the browser control. Do not treat model-generated confidence as an ASR confidence score. [Realtime event reference](https://developers.openai.com/api/reference/resources/realtime/client-events).

## Exact confirmation sequence

1. The engine prepares a durable proposal containing exact action, service, resource, local date/time plus timezone, contact, expected revisions and 120-second expiry. Browser shows the same normalized details. No appointment/inquiry write occurs yet.
2. Controller generates a read-back response with no tools. It requests all required fields and the explicit confirmation question. Persist proposal/read-back response association. The proposal remains ineligible for voice confirmation until read-back completes without interruption and its final text contains the required details. Provider response completion alone is not playback completion: correlate the WebRTC output-buffer completion event for that response, with browser playback state as UX evidence. If this cannot be established, use displayed browser confirmation instead.
3. Any speech starting before read-back completion cancels that read-back and invalidates voice confirmation eligibility. Process the correction/question, then prepare or repeat a full read-back. A bare “yes” during an interrupted read-back does not commit.
4. After full read-back, normalize the *entire finalized English input turn*: trim, lowercase, remove terminal punctuation and collapse whitespace. Accept only exact “yes”, “yes please”, “confirm”, “please confirm” or “yes confirm”. Exact “no”, “no thanks” and “cancel that” reject the pending proposal. Mixed phrases such as “yes, but Friday” or “don't confirm” never pass a substring match; route them to interpretation and invalidate the old confirmation eligibility. Other languages/uncertain turns use the browser control or clarification.
5. The controller emits confirmation_received with proposal ID/revision, input-turn ID and source voice or browser. It invokes the engine-only commit directly; no further model tool call is required. The browser confirmation endpoint also binds exact displayed proposal/revision and session capability.
6. Commit rechecks tenant, ownership proof, expiry, state/dependency revisions and policy atomically. Only a committed receipt permits a success speaking response. Conflict or stale proposal generates an honest failure and fresh choices/read-back. Duplicate confirmation returns the same receipt.
7. New speech before commit is serialized against the proposal. If correction wins, reject the old confirmation; if commit already won, explain the actual committed outcome and offer a separately confirmed change. Never pretend a completed write was undone.

Read-back checks and ASR cannot prove a human heard or intended every word. The exact grammar and UI reduce risk but do not eliminate misrecognition. General generated speech may also make unsupported claims outside the controlled commit path. Do not describe prompt instructions or sideband as a perfect speech filter. Test actual audio for premature claims, terminate/correct on detected failures, and do not claim the pilot meets its acceptance gate if this behavior is observed. A deployment needing a hard guarantee for every spoken statement would need a different output-control design and latency trade-off.

## Lifecycle and authoritative shutdown

Before microphone access show AI/transcription/contact-processing disclosure. Record its version and consent timestamp. Owner preview pins an immutable draft test snapshot, including before first publication. Public sessions pin published versions. Use HTTPS outside localhost and provide mic permission/device failure guidance plus provider-independent text inquiry.

Create application session in admitted with a 60-second admission expiry. Reserve budget/concurrency atomically. Set a 15-second provider setup timeout. Begin with no automatic responses/tools and attach sideband before activating the session. If call creation returns an ID, persist it before returning the SDP answer. A timed-out create request with unknown provider ID is an uncertain charged session: do not automatically retry; block new live admission until operator reconciliation.

On user stop, server duration/idle/budget limit, sideband disconnect, browser heartbeat failure (>15 seconds), or business pause:
- Mark closing and deny new interpretation/mutation work. Resolve already-running DB transactions by their proposal IDs.
- Server calls POST /v1/realtime/calls/{call_id}/hangup. This ends SIP or WebRTC calls; merely closing sideband is insufficient. [Official hangup API](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup).
- On successful termination/already-ended reconciliation, finalize usage, mark closed/failed and release the permit. Browser stops tracks and peer connection too.
- If provider termination cannot be established, mark termination_unknown, retain reserved budget/permit and block additional development calls. Retry hangup with bounded backoff while control is available; operator reconciles otherwise.

At API startup reconcile every persisted nonterminal provider session by hanging it up before permitting new live calls; the API does not attempt to restore orphaned sockets. Expired admissions with no provider call are safe to release. Keep accounting for unresolved calls conservative. Neither browser timers nor provider credit limits replace this procedure.

MVP reconnect creates a new application session linked by restart_of_session_id, with one new provider call and a new admission reservation. Reconcile old receipts first; clear pending proposals and ownership proof. Carry only safe intent and the authorized immutable configuration. No seamless media resume is promised.

## Transcript and progress

Persist finalized input text and assistant text with provider item/response IDs. Mark assistant text interrupted/generated versus playback-completed; full generated text must not be presented as definitely heard. UI can show provisional captions with a visual distinction. App event stream is authoritative for stages/actions; browser provider events never execute tools. Secrets are entered through secure browser fields and excluded from model input, traces and replay.

Measure setup, speech-stop to first audible reply, interpretation time, action latency, read-back/commit latency, transcript delay and interruption recovery. Two-response turns may cost more and feel slower; Phase 3V records this before the full builder is built.

## Five-dollar development policy and accounting

LIVE_AI_ENABLED=false by default. No default test or CI task calls OpenAI. Require an operator-checked project balance and enablement. Defaults: one global live call, 180-second maximum, 60 seconds of user inactivity, maximum 12 input turns and 24 model responses, 10 admitted calls per local day (operator timezone), 256 maximum output tokens per response, and $1 total development guard. First feasibility smoke is limited to 45 seconds, then 90 seconds only if needed within the same guard.

Persist one usage_events record per response ID and one per transcription item. For each modality m (text/audio), let I_m be total input tokens including cached, C_m cached input tokens, O_m output tokens, and r rates per million. Estimated response cost = sum((I_m-C_m)*r_input_m + C_m*r_cached_m + O_m*r_output_m)/1,000,000. Add transcription seconds/60 * transcription per-minute rate. Do not count cached tokens twice. Store the model/rate snapshot with usage so later price changes do not rewrite history. Count cancelled/failed responses when usage is reported.

Reserve $0.25 per admitted development call, explicitly a heuristic allowance rather than a worst-case ceiling; it includes a transcription allowance. Admission requires observed cumulative spend plus all reserved/unresolved allowance plus the new reservation <= $1. Convert observed events into cumulative spend without double counting, keep at least the remaining reservation while a call is live, and shut down at the configured per-session estimate allowance or global guard. Revise the allowance only after measuring a bounded session, never silently lower it to permit more calls. Context replay and extra responses make duration alone an unreliable cost estimate.

If usage is absent/incomplete, never report zero. Retain the call's allowance, mark estimate incomplete, and require operator reconciliation against actual provider project usage before more paid testing. The guard_state lifetime counter survives detailed-event retention and process restarts; changing/purging logs must not reset spend. Operator adjustments are explicit and audited.

Use OpenAI Platform actual usage/balance as the financial source of truth. Configure alerts and an enforced project hard spend limit where permitted; alerts alone do not stop traffic and hard enforcement can lag. This application guard is not a guaranteed spending cap. See [cost accounting](https://developers.openai.com/api/docs/guides/voice-latency-cost) and [spend limits](https://developers.openai.com/api/docs/guides/spend-limits).

## Future telephony

PSTN/SIP requires carrier/number, authenticated webhook admission, call lifecycle/transfer routing, consent, abuse controls and jurisdiction review. Reuse the engine behind a new transport adapter. The browser pilot measures website inquiries/bookings and does not claim to answer missed telephone calls. Callback capture is not live transfer.


