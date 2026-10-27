import { afterEach, describe, expect, it, vi } from "vitest";
import type { HealthCheck, HttpMonitor } from "@pulse/contracts";
import { buildApp, type AppRepositories } from "./app.js";

const monitor: HttpMonitor = {
  id: "29962974-50bb-4213-9e15-bbbe78747e22", serviceId: "29962974-50bb-4213-9e15-bbbe78747e23",
  name: "API", kind: "http", method: "GET", url: "https://example.invalid",
  intervalMs: 60_000, timeoutMs: 10_000, failureThreshold: 3, recoveryThreshold: 2,
  enabled: true, createdAt: new Date("2026-10-27T12:00:00.000Z"),
};
const latest: HealthCheck = {
  id: "9007199254740993", monitorId: monitor.id, healthy: true, statusCode: 204,
  latencyMs: 0, checkedAt: new Date("2026-10-27T12:00:00.000Z"), errorType: null, errorMessage: null,
};
const apps: ReturnType<typeof buildApp>[] = [];
function setup(options: { now?: string; enabled?: boolean; check?: HealthCheck | null; fail?: boolean } = {}) {
  const clock = vi.fn(() => new Date(options.now ?? "2026-10-27T12:02:10.000Z"));
  const health = { getServiceHealth: vi.fn().mockResolvedValue(null), getOverview: vi.fn().mockResolvedValue({}) };
  const instance = buildApp({
    projects: {}, services: {}, health,
    monitors: { getMonitorById: async () => ({ ...monitor, enabled: options.enabled ?? true }) },
    monitoring: {
      getRecentHealthChecks: async () => {
        if (options.fail) throw new Error("secret database details");
        return options.check === null ? [] : [options.check ?? latest];
      },
      getOpenIncident: async () => ({ id: "incident", monitorId: monitor.id, status: "open", startedAt: latest.checkedAt, resolvedAt: null }),
    },
  } as unknown as AppRepositories, { logger: false }, clock);
  apps.push(instance);
  return { instance, clock, health };
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe("M8 Monitor Status", () => {
  it.each([
    ["2026-10-27T12:02:09.999Z", "fresh"],
    ["2026-10-27T12:02:10.000Z", "stale"],
    ["2026-10-27T12:02:10.001Z", "stale"],
  ])("preserves latest observation and incident at %s", async (now, state) => {
    const { instance, clock } = setup({ now });
    const response = await instance.inject({ method: "GET", url: `/monitors/${monitor.id}/status` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ probeStatus: "healthy", latestCheck: {
      id: "9007199254740993", checkedAt: "2026-10-27T12:00:00.000Z", latencyMs: 0, statusCode: 204,
    }, freshness: { state, staleAt: "2026-10-27T12:02:10.000Z" }, openIncident: { status: "open" } });
    expect(clock).toHaveBeenCalledTimes(1);
  });
  it("preserves stale unhealthy HTTP/error evidence and latency", async () => {
    const { instance } = setup({ check: { ...latest, healthy: false, latencyMs: 123, statusCode: 503, errorType: "http_error", errorMessage: "HTTP 503" } });
    const response = await instance.inject({ method: "GET", url: `/monitors/${monitor.id}/status` });
    expect(response.json()).toMatchObject({ probeStatus: "unhealthy", freshness: { state: "stale" },
      latestCheck: { healthy: false, latencyMs: 123, statusCode: 503, errorType: "http_error", errorMessage: "HTTP 503" } });
  });
  it("returns no observation with no deadline", async () => {
    const { instance } = setup({ check: null });
    const response = await instance.inject({ method: "GET", url: `/monitors/${monitor.id}/status` });
    expect(response.json()).toMatchObject({ probeStatus: "unknown", latestCheck: null,
      freshness: { state: "no_observation", staleAt: null } });
  });
  it.each([null, latest])("excludes disabled Monitors without losing persisted evidence %j", async check => {
    const { instance } = setup({ check, enabled: false });
    const response = await instance.inject({ method: "GET", url: `/monitors/${monitor.id}/status` });
    expect(response.json()).toMatchObject({ probeStatus: check ? "healthy" : "unknown",
      latestCheck: check ? { id: latest.id, healthy: true } : null,
      freshness: { state: "excluded", staleAt: null } });
  });
  it("retains sanitized status failures", async () => {
    const { instance } = setup({ fail: true });
    const response = await instance.inject({ method: "GET", url: `/monitors/${monitor.id}/status` });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal Server Error" });
  });
  it.each(["/overview", `/services/${monitor.serviceId}/health`])("supplies one request time to %s", async url => {
    const { instance, clock, health } = setup();
    await instance.inject({ method: "GET", url });
    expect(clock).toHaveBeenCalledTimes(1);
    if (url === "/overview") expect(health.getOverview).toHaveBeenCalledWith(new Date("2026-10-27T12:02:10.000Z"));
    else expect(health.getServiceHealth).toHaveBeenCalledWith(monitor.serviceId, new Date("2026-10-27T12:02:10.000Z"));
  });
});
