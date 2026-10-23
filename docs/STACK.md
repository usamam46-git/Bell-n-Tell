# Stack and repository shape

## Locked choices

| Layer | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript, strict mode | One language and shared contracts |
| Web | Next.js + React | Owner UI and browser voice entry |
| UI | Tailwind CSS + shadcn/ui | Accessible primitives and fast, restrained UI |
| Builder | Guided forms first; `@xyflow/react` for a controlled visual map | Owner-readable paths without free-form programming |
| API | Node.js + Fastify | Explicit HTTP boundary and testable services |
| Database | PostgreSQL | Transactional appointment safety and range exclusion |
| ORM/validation | Drizzle ORM + Zod | Typed persistence and runtime boundary checks |
| Voice | Native browser WebRTC + OpenAI Realtime GA | Direct low-latency speech-to-speech |
| Authentication | Server-side opaque sessions in PostgreSQL | Small surface; secure cookies; no extra auth framework required |
| Tests | Vitest, API integration tests, Playwright | Zero-credit logic tests and real browser journeys |
| Packaging | npm workspaces + Docker Compose for local services | No build orchestrator or cloud commitment |

Current planning model is `gpt-realtime-2.1-mini`, configurable by server environment, because official documentation lists WebRTC and function calling and current lower audio rates than `gpt-realtime-2.1`. The [model page](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini) and [pricing](https://developers.openai.com/api/docs/pricing) must be rechecked before the first paid test. Do not use deprecated `gpt-realtime-mini` merely because old examples show it. No assumption is made about this account's model access or remaining credit.

## Proposed monorepo

```text
apps/web/                 Next.js pages, owner UI, public browser entry, WebRTC UI
apps/api/                 Fastify routes, auth, voice adapter, application services, persistence
packages/contracts/       Zod HTTP/tool/config schemas and exported TypeScript types only
docs/                    Product and implementation decisions
AGENTS.md                Persistent implementation rules
```

No separate packages for workflow engine, UI components, database or AI tools. Keep modules inside `apps/api/src/{auth,businesses,scheduling,conversation,voice,db}` and `apps/web/src/{app,components,features}` until a real reuse need appears. Use explicit imports; avoid a generic plugin architecture.

Keep browser-to-API requests same-origin through a Next.js `/api` rewrite/proxy during local development and deployment, so secure cookie and CSRF behavior stays simple. Fastify remains the API authority; the Next.js layer must not bypass service authorization.

Account recovery uses saved random codes and the controlled pilot's audited operator fallback; no email service is assumed. The voice adapter uses a server-owned interpretation/speaking controller with required input transcription. Its compatibility, cost and latency are tested at the later Phase 3V checkpoint before the full builder/voice experience is completed. This document does not authorize implementation.

## Version and dependency policy

Pin major versions after Phase 1 checks official compatibility and record exact versions in the lockfile; do not freeze speculative versions in this plan. Use official OpenAI GA HTTP/event contracts through a small adapter. The official JS SDK may be used server-side if it supports the selected GA call setup cleanly; native `fetch`/WebSocket is acceptable. Do not add an Agents SDK merely to handle transport and function calls. No LangChain, LangGraph, n8n, Redis, Celery, Kafka, Kubernetes, vector database, external workflow engine, Twilio or paid development service without a demonstrated requirement and a new ADR.

The builder library does not define the persisted schema. A guided list is the primary editor; a constrained React Flow view can show and rearrange allowed stages. See [BUILDER.md](BUILDER.md).
