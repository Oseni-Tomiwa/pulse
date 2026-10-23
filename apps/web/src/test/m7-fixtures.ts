import type { MonitorResponse, OverviewResponse, ServiceHealthResponse, ServiceResponse } from "../api/client";

export const m7Service: ServiceResponse = {
  id: "29962974-50bb-4213-9e15-bbbe78747e22", projectId: "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
  name: "Payments API", createdAt: "2026-10-22T12:00:00.000Z",
};
export const m7Monitor: MonitorResponse = {
  id: "30e4a63a-cd17-4c64-b10a-9e70b468b66e", serviceId: m7Service.id, name: "Production API",
  kind: "http", url: "https://example.com/health", method: "GET", intervalMs: 60000, timeoutMs: 10000,
  failureThreshold: 3, recoveryThreshold: 2, enabled: true, createdAt: m7Service.createdAt,
};
export function healthFixture(state: ServiceHealthResponse["state"] = "degraded"): ServiceHealthResponse {
  const counts = {
    healthy: { reporting: 2, healthy: 2, unhealthy: 0, unknown: 1 },
    degraded: { reporting: 2, healthy: 1, unhealthy: 1, unknown: 1 },
    down: { reporting: 2, healthy: 0, unhealthy: 2, unknown: 1 },
    unknown: { reporting: 0, healthy: 0, unhealthy: 0, unknown: 3 },
  }[state];
  return { serviceId: m7Service.id, state, monitors: { total: 4, enabled: 3, disabled: 1, ...counts }, coverage: { reporting: counts.reporting, enabled: 3 } };
}
export function emptyHealth(serviceId = m7Service.id): ServiceHealthResponse {
  return { serviceId, state: "unknown", monitors: { total: 0, enabled: 0, reporting: 0, healthy: 0, unhealthy: 0, unknown: 0, disabled: 0 }, coverage: { reporting: 0, enabled: 0 } };
}
export function overviewFixture(): OverviewResponse {
  return {
    totals: { projects: 3, services: 8, monitors: 15, enabledMonitors: 14, openIncidents: 1 },
    serviceHealth: { healthy: 5, degraded: 1, down: 1, unknown: 1 },
    attention: ([
      [m7Service.id, "Payments API", "Commerce", "down"],
      ["39962974-50bb-4213-9e15-bbbe78747e22", "API", "ResolveAI", "degraded"],
      ["49962974-50bb-4213-9e15-bbbe78747e22", "Background Jobs", "DevStride", "unknown"],
    ] as const).map(([id, name, projectName, state], index) => ({
      service: { id, name, projectId: "project-" + index }, project: { id: "project-" + index, name: projectName },
      health: { ...healthFixture(state), serviceId: id },
    })),
  };
}
export const emptyOverview: OverviewResponse = {
  totals: { projects: 0, services: 0, monitors: 0, enabledMonitors: 0, openIncidents: 0 },
  serviceHealth: { healthy: 0, degraded: 0, down: 0, unknown: 0 }, attention: [],
};
