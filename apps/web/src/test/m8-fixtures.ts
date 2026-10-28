import type { MonitorStatusResponse } from "../api/client";
import { m7Monitor } from "./m7-fixtures";

export function observationFixture(health: "healthy" | "unhealthy" = "healthy", freshness: "fresh" | "stale" | "no_observation" | "excluded" = "fresh"): MonitorStatusResponse {
  return {
    monitorId: m7Monitor.id, probeStatus: freshness === "no_observation" ? "unknown" : health,
    freshness: freshness === "fresh" || freshness === "stale"
      ? { state: freshness, staleAt: "2026-10-28T12:02:00.000Z" }
      : { state: freshness, staleAt: null },
    latestCheck: freshness === "no_observation" ? null : {
      id: "9007199254740993", monitorId: m7Monitor.id, healthy: health === "healthy", statusCode: health === "healthy" ? 200 : 503,
      latencyMs: 42, checkedAt: "2026-10-28T11:59:42.000Z", errorType: health === "healthy" ? null : "http_error", errorMessage: health === "healthy" ? null : "HTTP 503",
    },
    openIncident: health === "unhealthy" ? { id: "incident", monitorId: m7Monitor.id, status: "open", startedAt: "2026-10-28T11:55:00.000Z", resolvedAt: null } : null,
  };
}
