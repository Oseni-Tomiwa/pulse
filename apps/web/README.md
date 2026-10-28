# Pulse web frontend

The M8 views use the backend's `MonitorStatusSnapshot.freshness` decision and
`staleAt` deadline. React does not calculate freshness or change a historical
probe outcome when evidence is stale. Service Health and Current coverage use
server results; the JSON keys remain `coverage.reporting` and `coverage.enabled`.
Overview preserves server attention ordering, including Healthy Services with
incomplete current coverage.

Overview, Service Details and Monitor Details share one 15-second network cadence
per mounted page. Each resource allows an in-flight request to finish rather than
starting an overlapping request at the next tick. Hidden tabs pause polling and
abort active requests; becoming visible refreshes immediately. Identity changes,
retries and unmounts cancel obsolete work. A local collection update also cancels
an older collection read so it cannot remove a newly created Monitor.

Service Details still uses one status request per enabled Monitor because the
current API has no batch status endpoint. Rows share the page cadence, with no
independent polling timers. One shared, subscription-based one-second clock updates
relative observation ages without network requests and stops after its last
subscriber unmounts. Relative ages are not live-region announcements.

Background refresh failures retain the last successful data and show a polite,
non-destructive warning. Initial failures retain the existing retryable errors.
Uptime windows and immutable historical check/Incident evidence remain separate.
Incident Details keeps its existing request/retry behavior; it does not poll
resolved diagnostics or add optional open-Incident polling in this pass.

## Verification

Run from `apps/web` with installed dependencies:

```sh
NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run src/live src/pages/m8-frontend.test.tsx
NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run
NODE_OPTIONS=--no-experimental-webstorage node node_modules/typescript/bin/tsc -b
NODE_OPTIONS=--no-experimental-webstorage node node_modules/vite/bin/vite.js build
```

Live-resource and relative-age tests use fixed clocks/fake timers. Page tests
cover fresh/stale historical outcomes, current coverage, evidence, polling,
visibility, background failures, navigation and request fan-out. No database is
required. The approved prototype is a read-only UX reference, not a production
data source.
