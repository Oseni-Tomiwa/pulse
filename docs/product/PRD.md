# Pulse v0.1 Product Requirements

## Product summary

Pulse is a lightweight, self-hosted monitoring and incident-diagnostics product for small software teams and individual developers. It periodically checks HTTP endpoints, preserves the resulting evidence, and turns sustained failures into incidents that resolve when the endpoint recovers.

Pulse v0.1 is deliberately narrower than a general observability platform. It is intended to make basic service health and HTTP-level failure evidence understandable without requiring a hosted monitoring suite.

## Problem statement

Small applications often need a direct answer to two questions:

1. Is the application healthy now?
2. When it was unhealthy, what did the HTTP checks observe?

Ad hoc scripts can send requests, but they rarely preserve consistent history, apply explicit incident thresholds, or present failures in the context of the affected product and service. Pulse provides that minimum coherent workflow in a self-hosted system.

## Target user

- A developer or small team operating one or more applications.
- A user comfortable running Node.js and PostgreSQL infrastructure.
- A user who needs HTTP availability history and incident evidence without a broad metrics, logging, or tracing platform.

## Primary use cases

- Organize applications as Projects and deployable components as Services.
- Configure an HTTP Monitor for a Service.
- Run checks on a schedule and preserve status, latency, and errors.
- Open an incident after a configured consecutive-failure threshold.
- Resolve the same incident after a configured recovery threshold.
- Review current health, check history, and incident history.

## Product goals

- Provide reliable HTTP monitoring with explicit, understandable incident rules.
- Preserve enough HTTP-level evidence to distinguish status failures, timeouts, and connection failures.
- Keep deployment and operation practical for a self-hosted user.
- Maintain clean boundaries so future diagnostic collectors can be added without turning v0.1 into a generic observability system.

## Scope and status

### Implemented

- Project creation, listing, and retrieval through the HTTP API.
- Service creation, project-scoped listing, and retrieval through the HTTP API.
- PostgreSQL persistence for Projects, Services, HTTP Monitors, Health Checks, and Incidents.
- HTTP checks that record health, status code, latency, time, and error information.
- Per-Monitor interval, timeout, failure threshold, recovery threshold, and enabled state in persistence.
- Pure incident decisions based on newest-first check outcomes.
- One-Monitor orchestration: check, persist, evaluate, and open or resolve an incident.
- Due-Monitor discovery and sequential worker cycles with per-Monitor failure isolation.
- A non-overlapping recurring worker loop with graceful shutdown.
- Database-free tests, guarded PostgreSQL integration tests, and a real lifecycle smoke test.

### Planned for v0.1

- Management API and user flow for creating and viewing HTTP Monitors.
- Read APIs for Monitor state, Health Check history, and Incident history.
- Derived current status and uptime calculations.
- A dashboard for Projects, Services, current health, latency history, and active incidents.
- Incident detail views with the HTTP evidence recorded around the failure.
- Documented deployment packaging, including the Docker Compose outcome named by the original design.
- A complete fresh-machine setup and release verification path.

### Post-v0.1

- Log collection and ingestion.
- Container, process, CPU, memory, disk, and restart diagnostics.
- Additional probe types beyond HTTP.
- Kubernetes support, distributed tracing, infrastructure agents, and automatic remediation.
- AI root-cause analysis.
- Complex authentication, multi-tenant SaaS operation, and mobile applications.

## Functional requirements

### Resource management

- A user can create and retrieve Projects.
- A user can create a Service under an existing Project and retrieve Services by Project or ID.
- A user must eventually be able to configure at least one HTTP Monitor for a Service.
- A Service represents a logical or deployable component; a Monitor represents how Pulse checks it.

### Monitoring behavior

- Only enabled HTTP Monitors are eligible for execution.
- A Monitor with no Health Checks is due immediately.
- A checked Monitor becomes due after its configured interval.
- An HTTP check records whether it was healthy, its status code when available, latency, check time, and error details.
- An HTTP status outside the successful response range is an unhealthy observation, not a worker exception.
- Timeout and connection failures are unhealthy observations and must be persisted.
- Repository or orchestration exceptions remain operational failures and must be observable to the worker.

The persisted defaults are a 60-second interval, 10-second timeout, three failures to open, and one success to recover.

### Incident behavior

- Incident evaluation is scoped to a Monitor.
- Consecutive failures open an incident when the Monitor's failure threshold is reached.
- A success before that threshold resets the failure streak.
- Further failures do not open a duplicate incident while one is open.
- Consecutive successes resolve the open incident when the recovery threshold is reached.
- A failure during recovery resets the recovery streak.
- At most one open incident may exist for a Monitor.

### Diagnostics and evidence

The v0.1 evidence model is HTTP-level:

- HTTP status code.
- Response latency.
- Check time.
- Healthy or unhealthy outcome.
- Error category and message.
- The sequence of checks leading to incident opening and recovery.

The schema and contracts allow `http_error`, `connection_error`, `timeout`, `dns_error`, `tls_error`, and `network_error`. The current checker emits the first three categories; finer DNS, TLS, and network classification remains incomplete.

### Dashboard expectations

The dashboard is planned and not implemented. For v0.1 it should expose:

- Projects and their Services.
- Derived Service or Monitor health.
- Latest check and latency.
- Active and historical incidents.
- Health Check and latency history.
- HTTP evidence associated with an incident.

## Release criteria

Pulse v0.1 is complete when a user can configure the Project → Service → HTTP Monitor hierarchy without direct database access, run the API and worker from documented deployment instructions, observe automatically persisted checks and incident transitions, and inspect derived status, history, uptime, and incident evidence through the product interface.

The release path must include passing database-free tests, PostgreSQL integration tests, the monitoring lifecycle smoke test, and documented setup on a fresh environment.

## Non-goals

Pulse v0.1 does not aim to replace Datadog, Grafana, Sentry, Prometheus, or a log platform. It does not include tracing, arbitrary metrics ingestion, infrastructure agents, log search, automated remediation, multi-tenant SaaS administration, or deep root-cause inference.

## Post-v0.1 direction

Later versions may attach other monitor or collector types to a Service and correlate their evidence with incidents. That extension should preserve the current separation between a Service, the mechanisms that observe it, immutable observations, and incident periods.
