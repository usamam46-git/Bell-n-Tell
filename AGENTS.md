# Implementation rules

- Follow `docs/PHASES.md` in order. Implement only the phase the user has authorized.
- Treat `docs/API.md`, `docs/DATABASE.md`, and `docs/SECURITY.md` as contracts. Record any necessary deviation in `docs/DECISIONS.md` before widening scope.
- Keep tenant authorization in Fastify and scope every business query by verified membership.
- Do not log passwords, recovery codes, session tokens, or request bodies containing them.
- Update `docs/PROGRESS.md` with changes, tests, limits, and the next task at each milestone.
- Never report a feature or phase as complete solely because tests or builds pass. Reproduce the documented local startup and the actual user journey end to end, including required services, browser-to-API requests, and the expected result in PostgreSQL. Exercise relevant failure paths and edge inputs, especially unavailable dependencies and non-JSON error responses. State exactly what was verified, what was not verified, and any remaining blocker; do not claim completion while a required journey is broken or unverified.
- Do not rerun the same verification command without a concrete reason. Run dependent gates in sequence so they do not interfere with shared build output. After a failure, fix the cause and rerun only the affected gate and any gate invalidated by that fix. Record the result instead of repeating passing checks for reassurance.
