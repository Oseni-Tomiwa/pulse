# Development Setup

## Requirements

- Node.js 24 or newer.
- pnpm 12.4.2, as declared by the root `packageManager` field.
- PostgreSQL for migrations, integration tests, the API runtime, and the worker runtime.

Docker is not configured in the repository. Use an existing PostgreSQL instance for current development.

## Install the workspace

From the repository root:

```bash
pnpm install
```

The workspace includes `apps/*` and `packages/*`.

## Environment variables

Use placeholders or a local secret-management mechanism. Do not commit credentials.

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/pulse
TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/pulse_test
PULSE_WORKER_POLL_INTERVAL_MS=10000
```

| Variable | Required for | Notes |
| --- | --- | --- |
| `DATABASE_URL` | API, worker, Drizzle migration command | Required when creating a runtime database client. |
| `TEST_DATABASE_URL` | PostgreSQL integration and lifecycle smoke tests | Must pass the repository's explicit test-database safety guard. |
| `PULSE_WORKER_POLL_INTERVAL_MS` | Worker, optional | Positive finite milliseconds; defaults to 10 seconds. |

Importing `@pulse/database` or constructing the database-free Fastify app does not require `DATABASE_URL`.

## Build

There is no root aggregate build script. Build each workspace explicitly:

```bash
pnpm --filter @pulse/contracts build
pnpm --filter @pulse/monitoring build
pnpm --filter @pulse/database build
pnpm --filter @pulse/api build
pnpm --filter @pulse/worker build
```

Build shared packages before applications that consume their emitted declarations.

## Database schema and migrations

The Drizzle schema is in `packages/database/src/schema.ts`; generated migrations are in `packages/database/drizzle/`.

Available commands:

```bash
pnpm --filter @pulse/database schema:check
pnpm --filter @pulse/database schema:generate
pnpm --filter @pulse/database migrate
```

`schema:generate` compares the TypeScript schema with migration metadata and does not require a running database. `migrate` requires `DATABASE_URL` and applies pending migrations. Review generated migration files before applying them.

## Run the API

Development mode:

```bash
pnpm --filter @pulse/api dev
```

Compiled mode:

```bash
pnpm --filter @pulse/api build
pnpm --filter @pulse/api start
```

The API listens on `0.0.0.0:3000`. Its executable composition requires `DATABASE_URL`. The database-free app builder and injection tests do not.

## Run the worker

Development mode:

```bash
pnpm --filter @pulse/worker dev
```

Compiled mode:

```bash
pnpm --filter @pulse/worker build
pnpm --filter @pulse/worker start
```

The worker requires `DATABASE_URL`. It runs a cycle immediately and then waits between non-overlapping cycles. Use `PULSE_WORKER_POLL_INTERVAL_MS` to override the 10-second polling interval.

Both API and worker close their PostgreSQL pools during `SIGINT` or `SIGTERM` shutdown.

## Run tests

See the [testing guide](testing.md) for database-free, PostgreSQL integration, and lifecycle smoke-test commands and safety requirements.
