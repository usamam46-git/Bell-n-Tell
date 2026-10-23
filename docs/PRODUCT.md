# Product definition

## Promise and first customer

An appointment-based business owner can enter business facts, hours and services, choose a greeting, test a browser voice receptionist, publish it, and receive a booked appointment or a callback inquiry. The first pilot is **one single-location, single-capacity service business** (for example, a salon or consultancy). The core is industry-neutral; labels and defaults may later vary by template.

The browser pilot handles website inquiries and routine scheduling. It does not yet answer missed telephone calls. The owner uses the dashboard; a customer uses a browser voice entry point. Staff can be a bookable resource but do not need accounts in the first product. An owner should reach a working default flow during onboarding without arranging blocks. The first pilot is English-speaking and non-clinical.

## First complete journey

1. Owner creates an account and business, sets its IANA timezone, public contact details, hours, one service (duration and price description), and one resource.
2. The app creates a valid default draft: greet, understand request, answer known business facts or schedule service, collect contact, confirm action, finish or offer callback.
3. Owner changes greeting and a FAQ and tests an immutable snapshot of that draft revision before first publication. A zero-credit text preview comes first; a later enabled browser voice preview shows transcript, stage and explicitly simulated receipts. An explicit **test with real actions** option uses the actual database and labels resulting records as tests. Editing the draft during a test does not alter its snapshot.
4. Owner publishes after validation. An active business can share a browser link. A customer consents to transcription, asks for a service, changes their mind about a time, hears current options, chooses one, supplies name and contact, and explicitly confirms the final date, time, service and resource.
5. The backend rechecks proposal, appointment and scheduling revisions plus policy/availability, commits exactly one appointment, then returns a receipt. Only then does the controller request confirmation speech. The browser shows a booking reference and a private management link to save. An uncertain result triggers a status check or callback, never an intentional success claim.
6. The owner sees the appointment, transcript and action result. A later customer supplies the saved management token in a secure browser field to authorize changes; it is not dictated to the model. Without it, the receptionist records a callback request for owner-assisted recovery.

The alternative successful outcome is an inquiry with contact details and a clear owner follow-up status. Human assistance in the MVP means a callback request, never a live transfer.

The public text inquiry form remains available without OpenAI or microphone access, including when transcription consent is declined. The owner can mark inquiries in progress/resolved. Account recovery uses a saved private recovery code and an audited operator fallback for the controlled pilot; paid email delivery is not required.

## Pilot operating agreement

The application must be the authoritative schedule for the pilot's bookable resources, with outside bookings entered manually, or receive exclusive resources/time windows. Without that agreement it cannot safely claim to prevent conflicts with external calendars. Onboarding asks the owner to acknowledge this limitation. Measure website conversation outcomes, not telephone coverage. Record a baseline of owner time spent on inquiries and scheduling, then compare useful completed outcomes, correction work and callback backlog during the pilot. Willingness to pay must be tested with that actual browser product.

## Users and jobs

| User | Job | First-product value |
| --- | --- | --- |
| Owner | Set facts and behavior, test, publish, review work | Self-service setup and confidence |
| Customer | Ask a question, book or request help | Immediate response and reliable receipt |
| Owner's staff | See schedule and follow up | Owner-managed access only in MVP; member role can be extended later |

## MVP boundaries

Included: one business per owner initially (schema allows memberships in several); one location and timezone per business; one-on-one appointments against a single resource; configurable services, weekly hours, date exceptions, FAQ entries and restricted conversation blocks; browser speech-to-speech; text simulator; owner test; published browser link for controlled pilot; appointment and inquiry records; transcript/action history; basic activity and estimated model cost. The common engine supports multiple businesses with isolated data.

Excluded: telephone numbers, SIP/PSTN, SMS/email delivery, payments, deposits, multi-location, group classes/capacity greater than one, recurring bookings, external calendars, insurance or clinical advice, emergency dispatch, automatic live handoff, customer accounts, billing, marketing analytics, open workflow programming, RAG/vector search, autonomous configuration editing. Clinics can use administrative scheduling only; specialty regulatory requirements need a separate pilot review before real use.

## Essential screens and navigation

1. Sign in/create account.
2. Guided onboarding: business identity/timezone, hours, services/resources, contact and FAQ, greeting, preview.
3. Overview: today's bookings, unanswered inquiries, recent conversations, test/publish status and usage.
4. Business information: facts, services, resources, hours and exceptions.
5. Receptionist setup: voice, greeting, policies, escalation, consent text.
6. Conversation builder: guided stage list; visual links only for allowed branches.
7. Test receptionist: simulator and browser microphone; transcript, stage timeline and action receipts.
8. Appointments: list, detail, manual correction and status.
9. Customers and inquiries: contact history and callback queue.
10. Conversation history: filtered session transcript and outcomes.

Use plain labels, keyboard-accessible controls, clear save/publish state, visible timezone and date formats, and no AI-themed decorative dashboard. The owner can recover from microphone denial through text simulation.

## Success measures

Technical: a browser conversation creates one confirmed appointment or inquiry via the real backend, with no double booking or cross-tenant read. Product: an owner sets up, edits, tests and publishes without developer help. Pilot: owner reports that captured appointments/inquiries are useful enough to pay for, with measured completion, erroneous-confirmation, escalation and follow-up rates. No invented conversion target is assumed before pilot observation.

See [PHASES.md](PHASES.md) for delivery gates and [TESTING.md](TESTING.md) for evidence.
