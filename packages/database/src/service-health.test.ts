import { describe, expect, it } from "vitest";
import type { ServiceHealthState } from "@pulse/contracts";
import * as health from "./index.js";

type Observation = { enabled: boolean; latestHealthy: boolean | null };
const observations: Record<string, Observation> = {
  healthy: { enabled: true, latestHealthy: true },
  unhealthy: { enabled: true, latestHealthy: false },
  unknown: { enabled: true, latestHealthy: null },
  disabled: { enabled: false, latestHealthy: false },
};

describe("Service Health aggregation", () => {
  it.each<{ name: string; inputs: string[]; state: ServiceHealthState; counts: number[] }>([
    { name: "no monitors", inputs: [], state: "unknown", counts: [0,0,0,0,0,0,0] },
    { name: "disabled only", inputs: ["disabled"], state: "unknown", counts: [1,0,0,0,0,0,1] },
    { name: "unknown only", inputs: ["unknown"], state: "unknown", counts: [1,1,0,0,0,1,0] },
    { name: "healthy", inputs: ["healthy"], state: "healthy", counts: [1,1,1,1,0,0,0] },
    { name: "unhealthy", inputs: ["unhealthy"], state: "down", counts: [1,1,1,0,1,0,0] },
    { name: "two healthy", inputs: ["healthy","healthy"], state: "healthy", counts: [2,2,2,2,0,0,0] },
    { name: "two unhealthy", inputs: ["unhealthy","unhealthy"], state: "down", counts: [2,2,2,0,2,0,0] },
    { name: "mixed reporting", inputs: ["healthy","unhealthy"], state: "degraded", counts: [2,2,2,1,1,0,0] },
    { name: "healthy partial coverage", inputs: ["healthy","unknown"], state: "healthy", counts: [2,2,1,1,0,1,0] },
    { name: "down partial coverage", inputs: ["unhealthy","unknown"], state: "down", counts: [2,2,1,0,1,1,0] },
    { name: "degraded partial coverage", inputs: ["healthy","unhealthy","unknown"], state: "degraded", counts: [3,3,2,1,1,1,0] },
    { name: "healthy and disabled", inputs: ["healthy","disabled"], state: "healthy", counts: [2,1,1,1,0,0,1] },
    { name: "down and disabled", inputs: ["unhealthy","disabled"], state: "down", counts: [2,1,1,0,1,0,1] },
    { name: "unknown and disabled", inputs: ["unknown","disabled"], state: "unknown", counts: [2,1,0,0,0,1,1] },
  ])("$name", ({ inputs, state, counts }) => {
    const [total, enabled, reporting, healthy, unhealthy, unknown, disabled] = counts;
    expect(health.aggregateServiceHealth("service-1", inputs.map(key => observations[key]!))).toEqual({
      serviceId: "service-1", state,
      monitors: { total, enabled, reporting, healthy, unhealthy, unknown, disabled },
      coverage: { reporting, enabled },
    });
  });

  it("excludes disabled observations regardless of their last outcome", () => {
    expect(health.aggregateServiceHealth("s", [true,false,null].map(latestHealthy => ({enabled:false,latestHealthy})))).toMatchObject({
      state: "unknown", monitors: { total: 3, enabled: 0, disabled: 3, unknown: 0, reporting: 0 },
    });
  });
});

describe("Overview aggregation", () => {
  function entry(id: string, name: string, keys: string[], projectId = "p1") {
    return {
      service: { id, name, projectId }, project: { id: projectId, name: "Project " + projectId },
      health: health.aggregateServiceHealth(id, keys.map(key => observations[key]!)),
    };
  }
  it("counts all services/monitors and excludes healthy services from ordered attention", () => {
    const entries = [entry("u", "A unknown", []), entry("d2", "Beta", ["unhealthy"], "p2"),
      entry("h", "Healthy", ["healthy", "unknown", "disabled"]), entry("g", "A degraded", ["healthy", "unhealthy"]),
      entry("d1b", "Alpha", ["unhealthy"]), entry("d1a", "Alpha", ["unhealthy"], "p3")];
    const result = health.aggregateOverview(entries, { projects: 4, openIncidents: 7 });
    expect(result.totals).toEqual({ projects: 4, services: 6, monitors: 8, enabledMonitors: 7, openIncidents: 7 });
    expect(result.serviceHealth).toEqual({ healthy: 1, degraded: 1, down: 3, unknown: 1 });
    expect(result.attention.map(item => item.service.id)).toEqual(["d1a", "d1b", "d2", "g", "u"]);
    expect(result.attention[0]).toMatchObject({ service: { id: "d1a", name: "Alpha", projectId: "p3" }, project: { id: "p3", name: "Project p3" }, health: { serviceId: "d1a", state: "down" } });
    expect(entries[0]!.service.id).toBe("u");
  });
  it("returns valid zero totals for an empty installation", () => {
    expect(health.aggregateOverview([], { projects: 0, openIncidents: 0 })).toEqual({
      totals: { projects: 0, services: 0, monitors: 0, enabledMonitors: 0, openIncidents: 0 },
      serviceHealth: { healthy: 0, degraded: 0, down: 0, unknown: 0 }, attention: [],
    });
  });
});
