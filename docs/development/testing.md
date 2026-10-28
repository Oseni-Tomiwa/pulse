# Testing Strategy

Pulse uses three testing layers. The ordinary package suites stay independent of PostgreSQL; database-backed verification is explicit.

```text
Database-free unit and HTTP injection tests
                    ↓
      PostgreSQL repository integration tests
                    ↓
        Monitoring lifecycle smoke test
```

## Database-free tests

Run:

```bash
pnpm --filter @pulse/monitoring test
pnpm --filter @pulse/database test
pnpm --filter @pulse/api test
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @pulse/web test
pnpm --filter @pulse/worker test
```

For the web suite, retain the M7 `NODE_OPTIONS=--no-experimental-webstorage`
invocation above. With installed dependencies, the equivalent command from
`apps/web` is `NODE_OPTIONS=--no-experimental-webstorage ./node_modules/.bin/vitest run`.
Use the intended Node runtime consistently; this workspace's root and `apps/web`
login shells have resolved different Node executables.

If Vitest prints only `RUN`, check whether `require("jsdom")` can finish before
changing test configuration. During the M8 diagnostic gate, macOS had evicted
thousands of dependency files (`ls -lO` reported `dataless`). Loading jsdom and
running TypeScript stalled on unavailable file contents. Reading the existing
web dependency files brought their contents back locally; no package versions
or lockfile changes were needed. Keep the dependency tree downloaded locally
before running tests or builds. The webstorage flag alone did not resolve this
file-availability problem. After hydration, the full existing suite passed
143/143 on Node v24.22.1 with the flag; the isolated API-client suite also
passed without the flag, confirming that the flag was not the repair for this
startup hang.

These suites verify:

- HTTP result classification and timeout behavior.
- Pure incident thresholds and streak resets.
- Pure Incident diagnostic evidence assembly, including boundary uncertainty, deduplication, numeric bigint ordering, integrity, gaps, and the 64-check cap.
- One-Monitor orchestration and persistence call ordering.
- Database client lifecycle and integration-database safety validation without opening a PostgreSQL connection.
- Fastify Project, Service, validation, not-found, error-sanitization, and health behavior through injection.
- Web routing, light and dark themes, accessible async states, the typed API-client boundary, Project/Service/Monitor management, and independent Monitor status, uptime, Health Check, and Incident states.
- Sequential worker cycles, per-Monitor failure isolation, polling, configuration, and shutdown behavior.

M8 database-free coverage includes fixed-time freshness budgets and exact stale
boundaries, invalid/overflow dates, fresh-only Service aggregation, stale versus
never-observed counts, current coverage, Healthy partial-coverage attention,
deterministic ordering, real Drizzle SQL/row decoding with a fake transport,
and Monitor Status freshness with preserved latency/HTTP/error evidence.

No elapsed-time sleeps or PostgreSQL connection are needed for these tests. Run
`pnpm --filter @pulse/database test` (which excludes every `*.integration.test.ts`)
and `pnpm --filter @pulse/api test`. Build contracts before database and API so
workspace consumers see current generated exports. Real PostgreSQL verification
is a separate gate; existing M7 fixed-date gate fixtures need M8 clock/expectation
adaptation before reuse. Frontend polling/presentation tests belong to the later
frontend implementation pass.

## PostgreSQL integration tests

Set `TEST_DATABASE_URL` to a dedicated test database, then run:

```bash
pnpm --filter @pulse/database test:integration
```

The suite applies the actual generated Drizzle migrations before testing repository behavior. It verifies due-Monitor discovery, Health Check persistence and ordering, check-based uptime aggregation boundaries, Incident uniqueness and resolution, selected database constraints, bounded Incident diagnostic evidence semantics, and Project and Service repositories.

The command is deliberately separate from the normal database-free suite. Incident diagnostic integration cases cover resolved and open windows, multi-check thresholds, boundary ambiguity or absence, sparse and foreign-Monitor evidence, deterministic numeric-ID ordering, overlap deduplication, and high-threshold truncation.

### Safety guard

Integration tests read `TEST_DATABASE_URL` explicitly. The guard rejects:

- A missing or non-PostgreSQL URL.
- A database name without a marker such as `test`, `testing`, `integration`, or `ci`.
- Host or database names marked as production or live.
- The same host, port, and database path used by `DATABASE_URL`.

The guard does not assume localhost or embed provider credentials. Fixtures use generated IDs and clean up their own rows.

The suite creates its pool and applies migrations once in `beforeAll`. A common Project and Service fixture is still created and removed around every integration test, including repository tests that do not need the complete monitoring fixture. This adds database round trips but does not change test isolation.

## Monitoring lifecycle smoke test

With a migrated safe test database configured through `TEST_DATABASE_URL`, run:

```bash
pnpm --filter @pulse/worker smoke:test
```

The smoke test starts a temporary loopback HTTP server and exercises the real path:

```text
PostgreSQL → due discovery → worker cycle → HTTP check
→ Health Check persistence → incident decision/write → PostgreSQL
```

It runs five controlled observations:

1. HTTP 204: healthy, no Incident.
2. HTTP 500: first failure, no Incident.
3. HTTP 500: second failure, no Incident.
4. HTTP 500: third failure, one Incident opens.
5. HTTP 204: the same Incident resolves.

The test advances the injected discovery time instead of sleeping, executes only its uniquely identified Monitor, verifies five Health Checks and one resolved Incident, and removes only its own fixture. The HTTP server and PostgreSQL pool close even when an assertion fails.

The smoke test assumes the generated migration has already been applied; unlike the integration suite, it does not run migrations itself.

## What each layer establishes

| Layer | Establishes | Does not establish |
| --- | --- | --- |
| Database-free | Business rules, route behavior, orchestration, and lifecycle logic without external infrastructure. | PostgreSQL SQL behavior or migration validity. |
| Integration | Real migration, constraints, indexes, ordering, and repository behavior. | Full worker-to-network execution. |
| Smoke | The complete controlled monitoring and incident lifecycle. | Production load, multi-worker coordination, or external-network reliability. |
