# BellnTell — Business operations

Owner accounts, business setup, deterministic scheduling and a provider-independent contact form. Fastify owns authorization and business actions; PostgreSQL is the booking authority. Receptionist configuration, conversation, voice and billing are later milestones.

## Local start

Requires Node.js 24 LTS, npm, and Docker Compose.

On Windows, keep Docker Desktop running and use `npm.cmd` in PowerShell if its execution policy blocks `npm.ps1`. The commands below work with `npm.cmd` substituted for `npm`.

```sh
npm install
npm run setup:env
npm run dev
```

`npm run dev` starts Docker PostgreSQL, applies migrations, starts the API and web app, and checks that the web proxy reaches the API. It can reuse already running local processes. Keep that terminal open while using the app.

Open <http://localhost:3000>. Register, save the recovery code, create a business, and add public contact details. In **Setup**, add a resource and a service linked to it. In **Hours & policy**, save weekly hours (blank means closed), dated exceptions and booking rules. In **Schedule**, find available times, enter a customer, review the exact proposal, then confirm. Proposals expire after two minutes and reserve no slot. A changed policy or appointment requires a new proposal.

Save the private management link shown once after booking. `/manage/<slug>` reads and immediately clears the token fragment, then verifies the private token through the API. Customers can review and confirm rescheduling/cancellation within the cutoff. Lost links require an owner to verify the customer offline and reissue a link with an audited reason. Retrying a committed confirmation returns its durable receipt without redisplaying the secret.

The **Public contact form** link opens `/contact/<slug>`. It requires separate contact-processing consent and works with no AI keys or provider. The owner handles follow-up through **Inquiries**, with new/in_progress/resolved status and internal notes. Customers are never merged by matching phone/email. Owner lists currently show up to 100 records; API lists support cursors.

All displayed booking times use the business timezone. Defaults: 30-minute service, 15-minute slot spacing, 60-minute notice, 60-day horizon, 24-hour management cutoff, zero buffer. Split overnight hours across days; use `24:00` only as an end. Business date exceptions replace weekly hours; resource exceptions can only restrict those hours. Owners can override the management cutoff with a reason, never overlap or closed hours. Future confirmed appointments block timezone changes. Outside bookings must be entered here or use exclusively allocated times; external calendars are not synchronized.

PostgreSQL listens only on localhost. Compose credentials are for local development. The named Docker volume preserves data across restarts; do not use `docker compose down -v` unless intentionally deleting this local database.

Optional sample data: `npm run db:seed` creates one owner/business and writes random local credentials to ignored `.local-seed-credentials` with owner-only file permissions. Re-running skips an existing seed. Do not commit that file or `.env`.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run test:isolated
npm run test:browser
npm run build
npm run test:built
```

`test:isolated` creates a uniquely named disposable database, applies fresh migrations, verifies the schema, runs the API suites, then drops that database. It is the preferred service gate. `npm test` uses the configured development database. Browser smoke uses installed Google Chrome on Windows/macOS/Linux (`PLAYWRIGHT_CHANNEL=msedge` selects Edge), checks browser-to-API requests and inspects real PostgreSQL results. It leaves uniquely named demonstration accounts and records in the development database. Start with `npm run dev` before browser verification. Run gates sequentially; build and dev/browser checks must not share `.next` concurrently. `npm run db:migrate` is repeatable. The API reads the root `.env`; the web app proxies `/api` to Fastify.

## API

Routes use `/api/v1`. Browser writes send JSON, `Origin`, and (when signed in) the CSRF token from `/auth/session` in `X-CSRF-Token`. Business writes also send `Idempotency-Key`. See [docs/API.md](docs/API.md) for the contract and [docs/PROGRESS.md](docs/PROGRESS.md) for milestone evidence.
