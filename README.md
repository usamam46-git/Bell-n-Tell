# BellnTell — Phase 1 foundation

Owner account and business setup. The API owns authentication and tenant authorization; the web app is a same-origin client. PostgreSQL runs locally in Docker. Scheduling, receptionist configuration, voice and billing are later milestones.

## Local start

Requires Node.js 24 LTS, npm, and Docker Compose.

```sh
npm install
npm run setup:env
npm run dev
```

`npm run dev` starts Docker PostgreSQL, applies migrations, starts the API and web app, and checks that the web proxy reaches the API. It can reuse already running local processes. Keep that terminal open while using the app.

Open <http://localhost:3000>. Register, save the one-time recovery code, create a business, and add public contact details. The dashboard then shows “Add services and hours” as the next task. The database listens only on localhost. Local Compose credentials are for development; change them before using a shared machine or deployment.

Optional sample data: `npm run db:seed` creates one owner/business and writes random local credentials to ignored `.local-seed-credentials` with owner-only file permissions. Re-running skips an existing seed. Do not commit that file or `.env`.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
```

The API tests use the local Docker database and clean up their records. Browser smoke requires Google Chrome at the standard macOS application path. `npm run db:migrate` is safe to re-run. The API reads `.env` from the repository root; the web app proxies `/api` to the API process.

## API

Routes use `/api/v1`. Browser writes send JSON, `Origin`, and (when signed in) the CSRF token from `/auth/session` in `X-CSRF-Token`. Business writes also send `Idempotency-Key`. See [docs/API.md](docs/API.md) for the contract and [docs/PROGRESS.md](docs/PROGRESS.md) for milestone evidence.
