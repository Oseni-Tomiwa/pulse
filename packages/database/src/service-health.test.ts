import { describe, expect, it } from "vitest";
import type { ServiceHealthState } from "@pulse/contracts";
import * as health from "./index.js";

const now = new Date("2026-10-27T12:02:10.000Z");
const config = { intervalMs: 60_000, timeoutMs: 10_000 };
type Observation = { enabled: boolean; latestHealthy: boolean | null; checkedAt: Date | null; intervalMs: number; timeoutMs: number };
const observations: Record<string, Observation> = {
  healthy: { enabled: true, latestHealthy: true, checkedAt: new Date("2026-10-27T12:02:00.000Z"), ...config },
  unhealthy: { enabled: true, latestHealthy: false, checkedAt: new Date("2026-10-27T12:02:00.000Z"), ...config },
  unknown: { enabled: true, latestHealthy: null, checkedAt: null, ...config },
  staleHealthy: { enabled: true, latestHealthy: true, checkedAt: new Date("2026-10-27T12:00:00.000Z"), ...config },
  staleUnhealthy: { enabled: true, latestHealthy: false, checkedAt: new Date("2026-10-27T12:00:00.000Z"), ...config },
  disabled: { enabled: false, latestHealthy: false, checkedAt: new Date("2026-10-27T12:02:00.000Z"), ...config },
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
    expect(health.aggregateServiceHealth("service-1", inputs.map(key => observations[key]!), now)).toEqual({
      serviceId: "service-1", state,
      monitors: { total, enabled, reporting, healthy, unhealthy, unknown, disabled, stale: 0 },
      coverage: { reporting, enabled },
    });
  });

  it("excludes disabled observations regardless of their last outcome", () => {
    expect(health.aggregateServiceHealth("s", [true,false,null].map(latestHealthy => ({enabled:false,latestHealthy,checkedAt:new Date(0),...config})), now)).toMatchObject({
      state: "unknown", monitors: { total: 3, enabled: 0, disabled: 3, unknown: 0, reporting: 0 },
    });
  });
  it.each([
    [["healthy", "staleHealthy"], "healthy", 1, 1, 0],
    [["healthy", "staleUnhealthy"], "healthy", 1, 1, 0],
    [["unhealthy", "staleHealthy"], "down", 1, 0, 1],
    [["unhealthy", "staleUnhealthy"], "down", 1, 0, 1],
    [["staleHealthy", "staleUnhealthy"], "unknown", 0, 0, 0],
    [["unknown", "staleHealthy"], "unknown", 0, 0, 0],
  ] as const)("excludes stale evidence for %j", (keys, state, reporting, healthy, unhealthy) => {
    const result = health.aggregateServiceHealth("s", keys.map(key => observations[key]!), now);
    expect(result).toMatchObject({ state, coverage: { reporting, enabled: 2 },
      monitors: { healthy, unhealthy, stale: keys.filter(key => key.startsWith("stale")).length } });
    expect(result.monitors.unknown).toBe(keys.includes("unknown" as never) ? 1 : 0);
  });
  it("becomes stale at exactly the deadline without changing historical input", () => {
    const observation = { ...observations.staleHealthy! };
    expect(health.aggregateServiceHealth("s", [observation], new Date("2026-10-27T12:02:09.999Z"))).toMatchObject({ state: "healthy" });
    expect(health.aggregateServiceHealth("s", [observation], now)).toMatchObject({ state: "unknown", monitors: { stale: 1, unknown: 0 } });
    expect(observation.latestHealthy).toBe(true);
  });

});

describe("Overview aggregation", () => {
  function entry(id: string, name: string, keys: string[], projectId = "p1") {
    return {
      service: { id, name, projectId }, project: { id: projectId, name: "Project " + projectId },
      health: health.aggregateServiceHealth(id, keys.map(key => observations[key]!), now),
    };
  }
  it("counts all services/monitors and includes partially covered Healthy services in attention", () => {
    const entries = [entry("u", "A unknown", []), entry("d2", "Beta", ["unhealthy"], "p2"),
      entry("h", "Healthy", ["healthy", "unknown", "disabled"]), entry("g", "A degraded", ["healthy", "unhealthy"]),
      entry("d1b", "Alpha", ["unhealthy"]), entry("d1a", "Alpha", ["unhealthy"], "p3")];
    const result = health.aggregateOverview(entries, { projects: 4, openIncidents: 7 });
    expect(result.totals).toEqual({ projects: 4, services: 6, monitors: 8, enabledMonitors: 7, openIncidents: 7 });
    expect(result.serviceHealth).toEqual({ healthy: 1, degraded: 1, down: 3, unknown: 1 });
    expect(result.attention.map(item => item.service.id)).toEqual(["d1a", "d1b", "d2", "g", "u", "h"]);
    expect(result.attention[0]).toMatchObject({ service: { id: "d1a", name: "Alpha", projectId: "p3" }, project: { id: "p3", name: "Project p3" }, health: { serviceId: "d1a", state: "down" } });
    expect(entries[0]!.service.id).toBe("u");
  });
  it("counts freshness-aware health and orders partial Healthy last with name/ID ties", () => {
    const result = health.aggregateOverview([
      entry("h2", "Alpha", ["healthy", "unknown"]), entry("h1", "Alpha", ["healthy", "staleUnhealthy"]),
      entry("full", "Fully covered", ["healthy"]), entry("u", "Unknown", ["staleHealthy"]),
      entry("g", "Degraded", ["healthy", "unhealthy"]), entry("d", "Down", ["unhealthy"]),
      entry("h3", "Beta", ["healthy", "staleHealthy"]),
    ], { projects: 1, openIncidents: 0 });
    expect(result.serviceHealth).toEqual({ healthy: 4, degraded: 1, down: 1, unknown: 1 });
    expect(result.attention.map(item => item.service.id)).toEqual(["d", "g", "u", "h1", "h2", "h3"]);
  });
  it("returns valid zero totals for an empty installation", () => {
    expect(health.aggregateOverview([], { projects: 0, openIncidents: 0 })).toEqual({
      totals: { projects: 0, services: 0, monitors: 0, enabledMonitors: 0, openIncidents: 0 },
      serviceHealth: { healthy: 0, degraded: 0, down: 0, unknown: 0 }, attention: [],
    });
  });
});
