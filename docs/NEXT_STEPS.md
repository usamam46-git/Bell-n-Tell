# Exact first implementation tasks for Sol

**Authorization gate: do not execute these tasks yet. The user will explicitly request implementation later. Until then, this file is a plan only.**

After explicit implementation authorization, read root [AGENTS.md](../AGENTS.md), then [PRODUCT.md](PRODUCT.md), [STACK.md](STACK.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [API.md](API.md) and Phase 1 of [PHASES.md](PHASES.md). Begin **Phase 1 only**. The later bounded voice checkpoint belongs to Phase 3V, after deterministic services and the core controller exist.

1. Inspect the repository and preserve these planning documents. Confirm no existing application files. Create `docs/PROGRESS.md` with Phase 0 complete, Phase 1 in progress, current task, decisions made, test evidence and blockers.
2. Check current official compatibility for Node LTS, Next.js, Fastify, Drizzle, Auth/session primitives, Tailwind, shadcn and Vitest before pinning versions. Use npm workspaces with exactly `apps/web`, `apps/api`, `packages/contracts`; strict TypeScript and consistent scripts. Record exact versions in the lockfile, not these docs.
3. Add local PostgreSQL Docker Compose, environment example with safe defaults and server-only secrets, Drizzle connection/migration tooling, Fastify health route and Next.js shell. Validate env at startup. Make clean-start instructions concise.
4. Implement Phase 1 migration only: `users`, `auth_sessions`, `security_throttles`, `businesses`, `business_memberships`, `business_settings` with tenant keys/constraints from [DATABASE.md](DATABASE.md). Provide a repeatable development seed without a committed password or API key.
5. Implement secure email/password login, opaque hashed sessions, secure cookies, expiry/revocation, CSRF and persistent throttling. Implement one-time saved account recovery codes and recovery/rotation endpoints from SECURITY.md; no paid email service. Creating a business creates its owner membership. Session and membership checks live in Fastify, not only in UI.
6. Implement `POST/GET /businesses`, `GET/PATCH /businesses/:businessId` and settings shell with Zod contracts. Normalize slug, validate IANA timezone and enforce membership/role on each route. Keep public/customer routes out of Phase 1.
7. Build a restrained, keyboard-accessible onboarding and dashboard shell. Owner can create a business, review timezone/contact and see a clear next task (“Add services and hours”). Avoid builder visuals until Phase 4.
8. Add meaningful tests: fresh migration, auth/session/CSRF, two-business tenant isolation, onboarding browser smoke. Run typecheck, lint, tests and production build once. Record commands and results in `docs/PROGRESS.md`.
9. Stop at the Phase 1 acceptance gate. Note any deviations from these docs with an ADR amendment before widening the architecture. Then identify the first Phase 2 task in progress documentation.

No application code, dependency install or scaffold was created during planning. These tasks become executable only when the user explicitly asks to begin implementation.
