# HTTP API

The Fastify API currently exposes health, Project management, and Service management. It does not expose Monitor, Health Check, Incident, status, uptime, or dashboard routes.

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

## Planned v0.1 API

The v0.1 product still needs management and read APIs for HTTP Monitors, derived status, Health Check history, and Incidents. Exact route shapes are not established by the repository and are intentionally not specified here.
