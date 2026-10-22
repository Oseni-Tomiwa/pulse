import { randomUUID } from "node:crypto";
import type { Overview, ServiceHealth } from "@pulse/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type AppRepositories } from "./app.js";

const serviceId = randomUUID();
const health: ServiceHealth = {
  serviceId, state: "healthy",
  monitors: { total: 2, enabled: 2, reporting: 1, healthy: 1, unhealthy: 0, unknown: 1, disabled: 0 },
  coverage: { reporting: 1, enabled: 2 },
};
const overview: Overview = {
  totals: { projects: 2, services: 1, monitors: 2, enabledMonitors: 2, openIncidents: 1 },
  serviceHealth: { healthy: 1, degraded: 0, down: 0, unknown: 0 }, attention: [],
};
const apps: ReturnType<typeof buildApp>[] = [];
function setup() {
  const reads = { getServiceHealth: vi.fn().mockResolvedValue(health), getOverview: vi.fn().mockResolvedValue(overview) };
  const instance = buildApp({ projects: {}, services: {}, monitors: {}, monitoring: {}, health: reads } as unknown as AppRepositories, { logger: false });
  apps.push(instance);
  return { instance, reads };
}
afterEach(async () => { await Promise.all(apps.splice(0).map(instance => instance.close())); });

describe("M7 health routes", () => {
  it("returns Service Health with partial coverage without degrading healthy state", async () => {
    const { instance } = setup();
    const response = await instance.inject({ method: "GET", url: `/services/${serviceId}/health` });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual(health);
  });
  it("returns 200 unknown health for an existing Service with no Monitors", async () => {
    const { instance, reads } = setup();
    reads.getServiceHealth.mockResolvedValue({ serviceId, state: "unknown",
      monitors: { total: 0, enabled: 0, reporting: 0, healthy: 0, unhealthy: 0, unknown: 0, disabled: 0 },
      coverage: { reporting: 0, enabled: 0 } });
    const response = await instance.inject({ method: "GET", url: `/services/${serviceId}/health` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ serviceId, state: "unknown", coverage: { reporting: 0, enabled: 0 } });
  });
  it("rejects malformed service UUIDs before reading a repository", async () => {
    const { instance, reads } = setup();
    const response = await instance.inject({ method: "GET", url: "/services/not-a-uuid/health" });
    expect(response.statusCode).toBe(400); expect(response.json()).toEqual({ error: "Invalid service ID" });
    expect(reads.getServiceHealth).not.toHaveBeenCalled();
  });
  it("returns 404 for a valid unknown Service", async () => {
    const { instance, reads } = setup(); reads.getServiceHealth.mockResolvedValue(null);
    const response = await instance.inject({ method: "GET", url: `/services/${serviceId}/health` });
    expect(response.statusCode).toBe(404); expect(response.json()).toEqual({ error: "Service not found" });
  });
  it("returns Overview totals and attention", async () => {
    const { instance, reads } = setup();
    const payload: Overview = { ...overview, serviceHealth: { healthy: 0, degraded: 0, down: 1, unknown: 0 },
      attention: [{ service: { id: serviceId, name: "API", projectId: "project-1" }, project: { id: "project-1", name: "Pulse" }, health: { ...health, state: "down", monitors: { ...health.monitors, healthy: 0, unhealthy: 1 } } }] };
    reads.getOverview.mockResolvedValue(payload);
    const response = await instance.inject({ method: "GET", url: "/overview" });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual(payload);
  });
  it.each(["service", "overview"])("sanitizes unexpected %s repository errors", async target => {
    const { instance, reads } = setup();
    (target === "service" ? reads.getServiceHealth : reads.getOverview).mockRejectedValue(new Error("postgres secret query details"));
    const response = await instance.inject({ method: "GET", url: target === "service" ? `/services/${serviceId}/health` : "/overview" });
    expect(response.statusCode).toBe(500); expect(response.json()).toEqual({ error: "Internal Server Error" });
    expect(response.body).not.toContain("secret");
  });
});
