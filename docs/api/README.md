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

Optional defaults are `GET`, `60000`, `10000`, `3`, `1`, and `true`, respectively. Numeric configuration must be a positive safe integer. URLs must be absolute `http:` or `https:` URLs. Names and URLs are trimmed; methods are exactly `GET` or `HEAD`.

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

For all three routes:

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
