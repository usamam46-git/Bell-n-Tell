# BellnTell — Business operations

Owner accounts, business setup, deterministic scheduling, a provider-independent contact form and an owner-only receptionist text preview. Fastify owns authorization and business actions; PostgreSQL is the booking authority. Voice, the visual builder and billing are later milestones.

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

After adding a service and hours, use **Receptionist text preview** on the owner dashboard. Load the current draft, start a pinned test snapshot, then choose a request and enter service/date/time or inquiry details. Review each synthetic action before confirming. Preview receipts say “Simulation — no appointment was created” and leave the real schedule untouched. A synthetic booking exposes a private token in the secure field for testing verification, rescheduling and cancellation. For a genuine owner test, the API has an explicit `real_test` mode that requires acknowledgement; the browser preview always uses synthetic mode. An initial Phase 3V live connection and server hangup worked; the full voice checkpoint remains open because final usage and spoken booking were not verified.

## Bounded voice checkpoint setup

The owner dashboard has a **Live voice feasibility test** below the text preview. It uses an unpublished test snapshot, records voice disclosure and real-action acknowledgement, and can make a real test booking. Live AI is disabled by default; ordinary tests and startup make no OpenAI requests.

When ready for the supervised Phase 3V smoke, use a project API key with access to the selected Realtime model. Check available API credit and configure a project hard spend limit in the OpenAI Platform. In this repository's ignored local [`.env`](.env) file, add `OPENAI_API_KEY=your-project-key` and set `LIVE_AI_ENABLED=true`; keep `OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini` for the documented rate guard. Restart `npm run dev`. Never put the key in `.env.example`, browser code, a URL, Git, or chat. The initial live smoke used a 45-second deadline; the follow-up owner test now allows 90 seconds, one call at a time, within the same $1 application lifetime guard. Provider hard-limit enforcement can lag; verify the project's actual balance/usage after the call. If final usage or termination is uncertain, the server blocks further live admission until operator reconciliation. The checkpoint has not passed until normal confirmation, interruption, server hangup and usage are observed live.

For a closed call with confirmed server hangup but missing final usage, an operator can compare its charge in the provider project Costs view and run `npm run build -w @bellntell/api`, then `npm run voice:reconcile -- <session-uuid> <displayed-usd> <conservative-budget-usd>`. If the dashboard displays an upper bound such as “< $0.01”, use `lt:0.01` as the displayed amount. The budgeted amount must cover possible dashboard rounding and prior application estimates. The command audits the source and both amounts, adjusts the lifetime guard once, and releases that session's reserve. It cannot reconcile an active or termination-unknown call. The October 25 call was reconciled with `$0.01` displayed and `$0.02` budgeted; this did not supply the missing final provider event or pass the live checkpoint.

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
