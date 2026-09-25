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
pnpm --filter @pulse/worker test
```

These suites verify:

- HTTP result classification and timeout behavior.
- Pure incident thresholds and streak resets.
- One-Monitor orchestration and persistence call ordering.
- Database client lifecycle and integration-database safety validation without opening a PostgreSQL connection.
- Fastify Project, Service, validation, not-found, error-sanitization, and health behavior through injection.
- Sequential worker cycles, per-Monitor failure isolation, polling, configuration, and shutdown behavior.

At the September 2026 documentation sync, the repository contains 30 monitoring, 8 database, 30 API, and 26 worker database-free tests: 94 total. These counts are a snapshot and will change as behavior is added.

## PostgreSQL integration tests

Set `TEST_DATABASE_URL` to a dedicated test database, then run:

```bash
pnpm --filter @pulse/database test:integration
```

The suite applies the actual generated Drizzle migration before testing repository behavior. It verifies due-Monitor discovery, Health Check persistence and ordering, Incident uniqueness and resolution, selected database constraints, and Project and Service repositories.

The current suite contains nine integration tests. It has been validated against a Supabase database named `pulse_test`, but the command is deliberately separate from the normal database-free suite.

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
