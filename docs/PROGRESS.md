# Progress

## Phase 3 — In progress (2026-10-24)

The user authorized Phase 3 and requested strict adherence to the docs and all checks. Sequence: implement and prove the fixed booking core first; record the Phase 3V checkpoint outcome; continue the offline complete engine and owner text preview; then run the relevant service, browser, startup and build gates in sequence. The local environment contains no provider credential or LIVE_AI_ENABLED setting. Live feasibility therefore remains gated by the documented operator enablement/balance/project-limit requirements; offline engine work can continue, and no live-checkpoint success will be claimed without live evidence.

Core checkpoint: fresh migration verified 22 tables and the appointment exclusion constraint. All five fixed-core PostgreSQL scenarios passed: genuine booking only after full read-back, stale/changed-mind rejection, exact whole-turn grammar and interrupted read-back, pre-commit rollback/after-commit lost-response replay, immutable unpublished snapshot selection and tenant isolation. Receipt persistence precedes success output in the recorded event sequence. Phase 3V live outcome: NOT RUN — no operator live enablement/provider account configuration exists here. No API call or AI spend was made. This remains a live-integration blocker; the documented permission to continue offline engine work is being used for the remaining Phase 3 engine/preview.

## Phase 2 — Complete for local development (office Windows machine, 2026-10-24)

Authorized by the user. Docker Desktop PostgreSQL 17 was pulled and started healthy with the project Compose volume and localhost-only port. Node 24.21.0 is installed. PowerShell blocks npm.ps1, so commands use npm.cmd. Startup now invokes npm through its JavaScript entry point on Windows; migration paths use fileURLToPath; Chrome selection is portable. The local .env has a new random authentication hash key and is ignored by Git. Docker, Fastify and Next.js are running at http://localhost:3000 following the final restart.

Milestone: migration 0002 and all eleven Phase 2 tables are implemented, with exclusion constraints, default policies, owner setup/schedule/customer/inquiry forms, durable proposal/confirmation services, public consented inquiry form and private browser management. ADR-018 records the Phase 2 HTTP additions and proof design. Drizzle ORM was updated from 0.44.7 to 0.45.4 after npm reported [the identifier-escaping advisory](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9); current application identifiers are static/allowlisted. Four development-tool advisories remain; no forced dependency migration was applied.

### Verification evidence

- Fresh disposable PostgreSQL migration verified all 17 tables and the appointment exclusion constraint. Initial integration run found raw Drizzle timestamps were strings, breaking duration/expiry comparisons; normalization was fixed. The affected gate then passed all 17 tests (7 foundation, 10 operations).
- Expanded operations/scheduling gate passed 15 scenarios (10 operations plus 5 scheduling cases). Two targeted checks then passed for the added owner-cutoff/audit scenario and database rejection of contradictory date exceptions. In total, 23 distinct API/scheduling scenarios were exercised successfully across these runs. They cover confirmation/replay, simultaneous API confirmations, direct concurrent SQL overlap, rollback before commit and lost response after commit, stale revisions/expiry, inquiry consent/idempotency, token hashing/revocation/browser/tenant/expiry binding, persisted rolling guessing budgets, roles, tenant FKs, cursor bounds, default policy, notice/horizon/grid/full-interval boundaries, half-open adjacency, resource restriction precedence, split overnight hours and DST gap/repeat/transition duration. The expiry sweep marks pending proposals expired and clears their payload; a targeted assertion verifies this. Management proposal actors bind browser, appointment and credential, so another appointment's proof cannot retrieve them.
- Four Chrome scenarios passed across affected-gate runs: original owner onboarding and unavailable-registration response, the complete Phase 2 journey, and contact-form non-JSON/connection-refused responses with input preservation. The initial Phase 2 browser run exposed ambiguous select labels and a route-announcer error-selector collision; explicit labelled controls and scoped assertions corrected them. The full Phase 2 browser journey passed again after the final proof-binding change: owner register/create business → resource/service → weekly hours/policy → review booking → confirm → save private link → separate customer browser verifies token → reschedules → cancels → submits public callback → owner marks in_progress then resolved with internal note.
- Browser tests queried PostgreSQL: no appointment before confirmation; one confirmed booking/revision 1 with committed receipt; reschedule revision 2; cancellation revision 3/status cancelled; inquiry revision 3/status resolved with expected internal note. The fragment was removed from the customer URL before verification. A schedule-page screenshot was inspected for layout; there was no clipping in that desktop view.
- Dependency failure: an API instance with unreachable PostgreSQL returned structured HTTP 503/TEMPORARILY_UNAVAILABLE. Browser interception exercised plain-text HTTP 503 and connection refusal without losing form content. The real local stack's PostgreSQL, API and web proxy were reachable during successful journeys; Docker was not deliberately stopped mid-journey.
- `npm.cmd run dev`: documented startup ran Docker, migrations, Fastify and Next.js, then printed ready only after checking the web /api proxy. After sequential production builds it was restarted and printed ready again.
- Root typecheck, lint and production builds passed. After the final reschedule read-back change, the affected API typecheck/lint/build and targeted management integration case passed again. The compiled API started directly under Node and passed health plus a database-backed Phase 2 route (`npm.cmd run test:built`). Shared contracts stay in one source module so native Node can load them without tsx-only sibling resolution.

### Limits and next task

This is local development evidence, not pilot or production-release certification. Chrome was exercised on Windows; Edge/Safari, mobile layouts and a production browser deployment were not directly tested. Crash boundaries use injected pre-commit/after-commit failures plus a fresh API instance; no host power-loss drill was performed. Browser tests leave uniquely named demonstration accounts and operational records in the local database. API lists support cursors; the minimal owner views show at most 100 rows. Booking secrets are one-time deliveries; a lost response requires the audited owner-assisted reissue path. No email/SMS delivery, external calendars, model, voice, public self-booking, visual editor or billing was introduced. Public inquiry and management work without provider credentials. The existing Phase 1 seed was extended to create its default scheduling policy.

The next implementation task, only when authorized, is Phase 3's fixed booking conversation core over these real services, followed by its documented checkpoint order. Phase 3 and paid AI are not authorized by this milestone.

## Phase 0 — Complete

Planning contracts and phase boundaries are in the existing docs. The user authorized Phase 1 on 2026-10-23 and requested PostgreSQL through Docker.

## Phase 1 — Foundation verified after registration fix

On 2026-10-23 the user reported account creation displaying “The string did not match the expected pattern.” The prior Chrome smoke auto-started both servers and missed the real local state: the web app was running while Fastify was stopped. The Next.js proxy returned plain-text HTTP 500, and the client tried to parse it as JSON. The completion claim was premature. `AGENTS.md` and `TESTING.md` now require a documented startup check, browser-to-API verification, relevant failure-path checks, and no redundant gate reruns. The client now handles non-JSON proxy responses clearly, and `npm run dev` starts Docker, migrations and any missing app process before checking the proxy.

### Delivered

- npm workspaces: `apps/web`, `apps/api`, `packages/contracts`; strict TypeScript, Next.js/Tailwind/shadcn-style components, Fastify, Drizzle, Zod, Vitest and Playwright.
- PostgreSQL 17 local Compose, generated Drizzle migrations for the six Phase 1 tables, environment validation, random local secret setup, repeatable optional development seed, and clean-start instructions in `README.md`.
- Email/password registration and login, Argon2id hashing, opaque hashed seven-day sessions with revocation, HttpOnly/SameSite cookies, Origin plus CSRF checks, persistent PostgreSQL throttles, one-time saved recovery codes, password recovery and logged-in code rotation.
- Owner business creation with normalized slug and IANA timezone, owner membership, one-created-business rule, business/settings revision checks, per-request membership/role enforcement, contact setup, and a restrained dashboard shell with the next task “Add services and hours.” Business creation replays matching `Idempotency-Key` requests.
- Same-origin `/api` rewrite. No scheduling, public customer route, builder, OpenAI or billing code.

### Compatibility and decisions

Tests ran on Node 24.19.0. The lockfile records Next.js 16.4.3, React 19.3.1, Fastify 5.12.7, `@fastify/cookie` 11.1.3, Drizzle ORM 0.44.7 / Kit 0.31.11, Zod 4.6.7, Tailwind 4.3.3 and Vitest 5.0.5. Node 24 LTS is required by this repository. Official checks: [Node releases](https://nodejs.org/en/blog/release), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Fastify v5 support](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/), [cookie compatibility](https://github.com/fastify/fastify-cookie), [Drizzle migrations](https://orm.drizzle.team/docs/kit-overview), [Tailwind Next.js setup](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [shadcn Next.js setup](https://ui.shadcn.com/docs/installation/next), [Vitest releases](https://vitest.dev/releases.html), and [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Next.js production build uses webpack because Turbopack's Tailwind worker failed to bind a local helper port in this environment; webpack build passes. This is a build setting only. Business creation stores keyed request/payload hashes in the planned `businesses` table to make replay safe, without adding a new table or widening the feature set.

### Evidence

- Fresh temporary PostgreSQL database: both migrations applied; six required tables present. Optional seed created one user, business, membership and settings row; rerun made no duplicates. Temporary database and credential file removed.
- `npm run typecheck`: passed for all three workspaces.
- `npm run lint`: passed for all three workspaces.
- `npm test`: 7 API integration tests passed against Docker PostgreSQL. Coverage includes CSRF/Origin, hashed session logout, one-time recovery and session revocation, persistent login throttle, idempotent business creation, revision conflicts, two-business isolation, viewer write denial, email whitespace and non-Latin slug normalization.
- `npm run test:browser`: 2 Chrome scenarios passed against the live local app: register → save recovery code → create business → save contact → sign out/in, and plain-text HTTP 500 on registration → clear unavailable-server message.
- `npm run dev`: verified with the API stopped and web already running; it started the API, applied migrations, and confirmed the web `/api` proxy reached Fastify. The API remains running for local use.
- `npm run build`: passed for all workspaces. Built API started and `/api/v1/health` returned `{"ok":true}`.

### Limits and next task

The browser smoke leaves its uniquely named test account in the local development database. Docker Compose uses development-only database credentials and binds PostgreSQL to localhost. No pilot deployment or live AI capability is claimed.

The exercised Phase 1 acceptance paths now pass. The first Phase 2 task, when authorized, is the scheduling schema and deterministic service/resource/hours setup; it has not started. Browser smoke used Chrome; Safari was not directly automated. The reported Safari error path was reproduced as a non-JSON proxy response and covered by the browser error test.
