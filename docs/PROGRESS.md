# Progress

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
