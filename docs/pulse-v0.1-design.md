# Pulse v0.1 Design

## 1. Purpose

Pulse is a lightweight, self-hosted monitoring and incident-diagnostics platform for software projects and backend services.

Pulse should answer two questions:

1. Is my service healthy?
2. If it isn't, what happened?

The first version focuses on HTTP service monitoring, latency history, incident detection, and preserving useful diagnostic evidence around failures.

---

## 2. Core Concepts

### Project

A software project being monitored.

Examples:

- ResolveAI
- DevStride
- FocusTracker

A project may contain multiple services.

### Service

An individually monitored component belonging to a project.

Examples:

- Frontend
- API
- Health endpoint

Each service has a URL that Pulse periodically checks.

### Health Check

A single observation of a service.

Pulse records:

- timestamp
- HTTP status code
- response latency
- success/failure
- error type
- error message when applicable

### Incident

A period during which a service is considered unhealthy.

An incident opens after repeated failed checks rather than after one transient failure.

An incident closes when the service successfully recovers.

---

## 3. v0.1 Monitoring Flow

Service
  ↓
Scheduled HTTP check
  ↓
Measure response time
  ↓
Store check result
  ↓
Healthy?
  ├── Yes → continue monitoring
  └── No
       ↓
    retry / failure counter
       ↓
    failure threshold reached?
       ├── No → continue monitoring
       └── Yes → open incident

When a service with an open incident becomes healthy again:

Successful health check
  ↓
Resolve incident
  ↓
Calculate incident duration

---

## 4. Initial Incident Policy

Default check interval:

60 seconds

Default timeout:

10 seconds

Open an incident after:

3 consecutive failed checks

Resolve an incident after:

1 successful check

These values should eventually be configurable per service.

---

## 5. Dashboard

The dashboard should show:

### Overview

- total projects
- monitored services
- healthy services
- unhealthy services
- active incidents

### Service Status

For each service:

- project
- service name
- current status
- latest latency
- uptime percentage
- last checked time

### Service Detail

Show:

- current status
- latency history
- health-check history
- uptime
- incident history

### Incident Detail

Show:

- affected service
- start time
- recovery time
- duration
- failed checks
- HTTP/error information
- diagnostic evidence available around the failure

---

## 6. Diagnostics

Pulse should preserve enough structured evidence to help explain failures.

v0.1 diagnostics include evidence available from HTTP monitoring:

- HTTP status
- timeout
- DNS failure
- connection refusal
- TLS/network errors
- response latency
- consecutive failure history

The architecture should allow future collectors to contribute:

- application logs
- Docker/container state
- CPU usage
- memory usage
- disk usage
- restart counts
- process/service state

Pulse should correlate evidence rather than assuming a single failed request identifies root cause.

---

## 7. Architecture

Pulse uses a monorepo.

apps/
  api/
  worker/
  web/

packages/
  database/
  contracts/
  config/

### API

Responsible for:

- projects
- services
- incidents
- health-check history
- dashboard queries

### Worker

Responsible for:

- scheduling checks
- performing HTTP requests
- measuring latency
- recording results
- updating incident state

### Web

Responsible for:

- dashboard
- project views
- service views
- incident views

### Database

PostgreSQL will be the canonical persistent store.

---

## 8. Technology

- TypeScript
- Node.js
- Fastify
- PostgreSQL
- Drizzle ORM
- TypeBox
- React
- Vite
- Tailwind CSS
- Vitest
- pnpm workspaces
- Docker / Docker Compose

---

## 9. v0.1 Boundaries

Included:

- project management
- service management
- HTTP monitoring
- configurable health endpoints
- latency measurements
- health-check history
- uptime calculation
- incident detection
- incident recovery
- dashboard
- HTTP-level diagnostic evidence
- Docker deployment

Not included in v0.1:

- Kubernetes
- automatic remediation
- distributed tracing
- full log ingestion
- infrastructure agents
- AI root-cause analysis
- mobile applications
- complex authentication
- multi-tenant SaaS functionality

These may be considered after the core monitoring system works reliably.

---

## 10. Definition of Done

Pulse v0.1 is complete when:

1. A project can be created.
2. A service and health-check URL can be added.
3. Pulse automatically checks the service.
4. Every check is persisted.
5. Latency history can be viewed.
6. Repeated failures open an incident.
7. Recovery resolves the incident.
8. Uptime can be calculated from historical checks.
9. The dashboard accurately reflects service health.
10. Incident pages provide useful HTTP-level diagnostic evidence.
11. Pulse can run through Docker Compose.
12. A fresh machine can run Pulse using documented setup instructions.