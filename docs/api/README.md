# HTTP API

The Fastify API currently exposes health, Project, Service, and HTTP Monitor management, plus Monitor status, evidence history, and check-based uptime. It does not expose dashboard routes.

Dates are serialized as ISO 8601 strings in JSON. Resource IDs are UUIDs.

## Error behavior

- Route UUIDs must be canonical UUIDs; invalid values return `400`.
- Project and Service names must be strings, are trimmed before persistence, and must not be empty after trimming.
- Missing resources return `404` with a resource-specific message.
- Unexpected repository errors are logged server-side and return `500` with `{ "error": "Internal Server Error" }`.
- Raw PostgreSQL messages, stack traces, URLs, and credentials are not returned to clients.

## Health

### `GET /health`

Confirms that the API process can serve requests. This route does not query PostgreSQL.

Response `200`:

```json
{
  "status": "ok",
  "service": "pulse-api"
}
```

## Projects

Project collection responses are ordered by creation time descending, then ID descending.

### `POST /projects`

Request:

```json
{
  "name": "My Project"
}
```

Response `201`:

```json
{
  "id": "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
  "name": "My Project",
  "createdAt": "2026-09-25T12:00:00.000Z"
}
```

Returns `400` with `{ "error": "Project name must be a non-empty string" }` when `name` is missing, is not a string, or becomes empty after trimming.

### `GET /projects`

Response `200`:

```json
[
  {
    "id": "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
    "name": "My Project",
    "createdAt": "2026-09-25T12:00:00.000Z"
  }
]
```

### `GET /projects/:projectId`

Response `200` is one Project object in the same shape shown above.

- Invalid UUID: `400`, `{ "error": "Invalid project ID" }`
- Unknown Project: `404`, `{ "error": "Project not found" }`

## Services

Service collection responses are scoped to a Project and ordered by creation time descending, then ID descending.

### `POST /projects/:projectId/services`

The parent Project must exist.

Request:

```json
{
  "name": "API"
}
```

Response `201`:

```json
{
  "id": "29962974-50bb-4213-9e15-bbbe78747e22",
  "projectId": "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
  "name": "API",
  "createdAt": "2026-09-25T12:05:00.000Z"
}
```

- Invalid Project UUID: `400`, `{ "error": "Invalid project ID" }`
- Invalid name: `400`, `{ "error": "Service name must be a non-empty string" }`
- Unknown Project: `404`, `{ "error": "Project not found" }`

### `GET /projects/:projectId/services`

Returns only Services belonging to the requested Project.

Response `200`:

```json
[
  {
    "id": "29962974-50bb-4213-9e15-bbbe78747e22",
    "projectId": "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
    "name": "API",
    "createdAt": "2026-09-25T12:05:00.000Z"
  }
]
```

- Invalid Project UUID: `400`, `{ "error": "Invalid project ID" }`
- Unknown Project: `404`, `{ "error": "Project not found" }`

An existing Project with no Services returns an empty array.

### `GET /services/:serviceId`

Response `200` is one Service object in the same shape shown above.

- Invalid UUID: `400`, `{ "error": "Invalid service ID" }`
- Unknown Service: `404`, `{ "error": "Service not found" }`

## HTTP Monitors

Monitor collection responses are scoped to a Service and ordered by creation time descending, then ID descending. Only HTTP Monitors exist in v0.1.

### `POST /services/:serviceId/monitors`

The parent Service must exist. `name` and `url` are required. PostgreSQL supplies the documented defaults when optional configuration is omitted.

Request:

```json
{
  "name": "Production API",
  "url": "https://example.com/health",
  "method": "GET",
  "intervalMs": 60000,
  "timeoutMs": 10000,
  "failureThreshold": 3,
  "recoveryThreshold": 1,
  "enabled": true
}
```

Response `201`:

```json
{
  "id": "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
  "serviceId": "29962974-50bb-4213-9e15-bbbe78747e22",
  "name": "Production API",
  "kind": "http",
  "url": "https://example.com/health",
  "method": "GET",
  "intervalMs": 60000,
  "timeoutMs": 10000,
  "failureThreshold": 3,
  "recoveryThreshold": 1,
  "enabled": true,
  "createdAt": "2026-09-26T12:00:00.000Z"
}
```

Optional defaults are `GET`, `60000`, `10000`, `3`, `1`, and `true`, respectively. Numeric configuration must be an integer from `1` through `2147483647`, inclusive. URLs must be absolute `http:` or `https:` URLs. Names and URLs are trimmed; methods are exactly `GET` or `HEAD`.

- Invalid Service UUID: `400`, `{ "error": "Invalid service ID" }`
- Unknown Service: `404`, `{ "error": "Service not found" }`
- Invalid Monitor input: `400` with a field-specific error

### `GET /services/:serviceId/monitors`

Returns only Monitors belonging to the requested Service. An existing Service with no Monitors returns an empty array.

Response `200` is an array of Monitor objects in the shape shown above.

- Invalid Service UUID: `400`, `{ "error": "Invalid service ID" }`
- Unknown Service: `404`, `{ "error": "Service not found" }`

### `GET /monitors/:monitorId`

Response `200` is one Monitor object in the shape shown above.

- Invalid Monitor UUID: `400`, `{ "error": "Invalid monitor ID" }`
- Unknown Monitor: `404`, `{ "error": "Monitor not found" }`

## Monitoring evidence

All evidence routes validate that the Monitor exists. An unknown Monitor returns `404` rather than an empty history.

### `GET /monitors/:monitorId/checks`

Returns recent Health Checks ordered by `checkedAt DESC, id DESC`. The optional `limit` query parameter defaults to `50` and must be an integer from `1` through `200`.

Response `200`:

```json
[
  {
    "id": "9007199254740993",
    "monitorId": "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
    "healthy": false,
    "statusCode": 500,
    "latencyMs": 42,
    "checkedAt": "2026-09-26T12:10:00.000Z",
    "errorType": "http_error",
    "errorMessage": "HTTP 500"
  }
]
```

Health Check IDs are decimal strings because PostgreSQL bigint values are never converted through JavaScript numbers. A Monitor with no checks returns `[]`.

### `GET /monitors/:monitorId/incidents`

Returns recent Incidents ordered by `startedAt DESC, id DESC`. The optional `limit` has the same `50` default and `200` maximum.

Response `200`:

```json
[
  {
    "id": "58a5abe4-f783-46ca-b43d-b44eb8da1da5",
    "monitorId": "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
    "status": "resolved",
    "startedAt": "2026-09-26T12:00:00.000Z",
    "resolvedAt": "2026-09-26T12:04:00.000Z"
  }
]
```

Incident duration is not returned as a separate field. A Monitor with no Incidents returns `[]`.

### `GET /incidents/:incidentId`

Returns one Incident with its current HTTP Monitor configuration and a bounded set of persisted Health Checks selected around the opening and recovery transitions. This is observational evidence; Pulse does not claim a root cause.

Response `200` (abridged):

```json
{
  "incident": {
    "id": "58a5abe4-f783-46ca-b43d-b44eb8da1da5",
    "monitorId": "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
    "status": "resolved",
    "startedAt": "2026-09-26T12:00:00.000Z",
    "resolvedAt": "2026-09-26T12:04:00.000Z"
  },
  "monitor": {
    "id": "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
    "serviceId": "29962974-50bb-4213-9e15-bbbe78747e22",
    "name": "Production API",
    "kind": "http",
    "url": "https://example.com/health",
    "method": "GET",
    "intervalMs": 60000,
    "timeoutMs": 10000,
    "failureThreshold": 3,
    "recoveryThreshold": 2,
    "enabled": true,
    "createdAt": "2026-09-25T12:00:00.000Z"
  },
  "durationMs": 240000,
  "evidence": {
    "thresholdSource": "current_monitor",
    "opening": {
      "boundary": { "match": "exact", "checkId": "9007199254740993" },
      "sequence": {
        "configuredThreshold": 3,
        "returnedCount": 3,
        "complete": true,
        "contradictory": false,
        "truncated": false
      }
    },
    "recovery": {
      "boundary": { "match": "exact", "checkId": "9007199254741010" },
      "sequence": {
        "configuredThreshold": 2,
        "returnedCount": 2,
        "complete": true,
        "contradictory": false,
        "truncated": false
      }
    },
    "during": { "truncated": true },
    "checks": [
      {
        "id": "9007199254740993",
        "monitorId": "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
        "healthy": false,
        "statusCode": 500,
        "latencyMs": 42,
        "checkedAt": "2026-09-26T12:00:00.000Z",
        "errorType": "http_error",
        "errorMessage": "HTTP 500",
        "contexts": ["opening"]
      }
    ],
    "gaps": [
      {
        "afterCheckId": "9007199254740998",
        "beforeCheckId": "9007199254741005"
      }
    ],
    "truncated": true
  }
}
```

`durationMs` is `resolvedAt - startedAt` for a resolved Incident and `null` for an open Incident. It is not a live elapsed timer. `recovery` is also `null` while the Incident is open.

Boundary matching uses Health Checks for the same Monitor at the exact Incident timestamp. One candidate is `exact`, multiple candidates are `ambiguous`, and no candidate is `missing`. Ambiguous and missing matches always have `checkId: null`; the API never invents a boundary identity.

Opening evidence uses the current `failureThreshold` rows ending at `startedAt` plus an immediate predecessor when the complete sequence is available. Resolved evidence also selects first and last bounded during-Incident context, the current `recoveryThreshold` rows ending at `resolvedAt`, and the first later check. Open evidence selects first and latest bounded context after opening. Each check's `contexts` array records every selected role after ID deduplication.

At most 64 checks are returned, ordered by `checkedAt ASC` and then numeric bigint `id ASC`. IDs remain decimal strings in JSON. `truncated` fields identify bounded sections, and `gaps` names adjacent returned IDs with known omitted rows between them; clients must not imply those rows were contiguous. An existing Incident with no matching evidence returns `200` with an empty `checks` array and missing/incomplete boundary metadata.

`sequence.complete` means the configured number of checks and boundary-timestamp evidence were available without threshold truncation. `sequence.contradictory` is true when a selected opening row is healthy or a selected recovery row is unhealthy. Persisted evidence is returned unchanged.

Incident rows do not snapshot Monitor configuration. The `monitor` object and `thresholdSource: "current_monitor"` explicitly mean that method, URL, interval, timeout, and thresholds are current settings and may differ from settings in effect when an older Incident occurred.

- Invalid Incident UUID: `400`, `{ "error": "Invalid incident ID" }`
- Unknown Incident: `404`, `{ "error": "Incident not found" }`
- Unexpected failure: sanitized `500`, `{ "error": "Internal Server Error" }`

### `GET /monitors/:monitorId/status`

Returns latest probe state and open-Incident state as separate signals:

```json
{
  "monitorId": "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
  "probeStatus": "healthy",
  "latestCheck": {
    "id": "42",
    "monitorId": "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
    "healthy": true,
    "statusCode": 204,
    "latencyMs": 12,
    "checkedAt": "2026-09-26T12:10:00.000Z",
    "errorType": null,
    "errorMessage": null
  },
  "openIncident": {
    "id": "58a5abe4-f783-46ca-b43d-b44eb8da1da5",
    "monitorId": "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
    "status": "open",
    "startedAt": "2026-09-26T12:00:00.000Z",
    "resolvedAt": null
  }
}
```

`probeStatus` is `unknown` only when `latestCheck` is null. Otherwise it reflects that check's `healthy` value. A healthy probe can coexist with an open Incident while a recovery threshold is still being satisfied.

For the three Monitor-scoped routes:

- Invalid Monitor UUID: `400`, `{ "error": "Invalid monitor ID" }`
- Unknown Monitor: `404`, `{ "error": "Monitor not found" }`

For the two history routes, an invalid limit returns `400` with `{ "error": "limit must be an integer between 1 and 200" }`.

### `GET /monitors/:monitorId/uptime`

Returns check-based uptime for a trailing elapsed-time window. The optional `window` query parameter accepts `24h`, `7d`, or `30d` and defaults to `24h`. Pulse captures one request time as `to`, derives `from` by subtracting the exact duration, and includes checks whose timestamps fall in `[from, to)`.

Response `200`:

```json
{
  "monitorId": "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
  "window": "24h",
  "from": "2026-09-25T15:00:00.000Z",
  "to": "2026-09-26T15:00:00.000Z",
  "totalChecks": 1440,
  "healthyChecks": 1437,
  "unhealthyChecks": 3,
  "uptimePercentage": 99.7917
}
```

`uptimePercentage` is the percentage of matching Health Checks whose outcome is healthy, rounded to at most four decimal places. It is `null` when the window contains no checks. This is check-based uptime; it does not measure time-weighted availability or define an SLA or SLO.

- Invalid Monitor UUID: `400`, `{ "error": "Invalid monitor ID" }`
- Invalid or repeated window: `400`, `{ "error": "window must be 24h, 7d, or 30d" }`
- Unknown Monitor: `404`, `{ "error": "Monitor not found" }`

## Planned v0.1 API

The v0.1 product still needs higher-level Service status presentation. Its exact route shape is intentionally not specified yet.
