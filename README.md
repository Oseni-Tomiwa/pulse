# Pulse

Pulse is a lightweight, self-hosted monitoring and incident-diagnostics platform for software projects and backend services. It checks HTTP endpoints, records health observations, and opens and resolves incidents from configurable failure and recovery thresholds.

## Status

Pulse is in active v0.1 development. The monitoring backend, management and monitoring-read APIs, worker runtime, and production web workflows for Projects, Services, Monitors, Incident Diagnostics (M6), and Service Health/Overview (M7) are implemented. M8 backend logic derives observation freshness and current coverage; its production frontend pass remains pending. Deployment packaging and release verification remain incomplete.

## Repository

```text
apps/
  api/          Fastify management API
  web/          React application shell
  worker/       Monitoring worker and polling runtime
packages/
  contracts/    Shared domain types
  database/     Drizzle schema and persistence
  monitoring/   HTTP checks and incident decisions
```

## Documentation

- [Product requirements](docs/product/PRD.md)
- [Architecture overview](docs/architecture/overview.md)
- [Data model](docs/architecture/data-model.md)
- [HTTP API](docs/api/README.md)
- [Development setup](docs/development/setup.md)
- [Testing strategy](docs/development/testing.md)
- [Original v0.1 design](docs/pulse-v0.1-design.md)
