import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import * as database from "./index.js";

// Real Drizzle SQL generation/row mapping with a fake pg transport. No Pool or socket.
function fixture(options: { rows?: unknown[][]; projects?: string; incidents?: string; fail?: boolean } = {}) {
  const query = vi.fn(async (config: { text: string }, params: unknown[] = []) => {
    const text = config.text;
    if (options.fail && text.startsWith("select")) throw new Error("query failed");
    if (text.includes('from "services"')) return { rows: options.rows ?? [] };
    if (text.includes('from "projects"')) return { rows: [[options.projects ?? "0"]] };
    if (text.includes('from "incidents"')) return { rows: [[options.incidents ?? "0"]] };
    return { rows: [] };
  });
  const db = drizzle({ client: { query } as unknown as Pool });
  return { db, query };
}
// serviceId, serviceName, projectId, projectName, monitorId, enabled, latestHealthy
const row = (s: string, p: string, m: string | null, enabled: boolean | null, latest: boolean | null, name = s) =>
  [s, name, p, "Project " + p, m, enabled, latest];

describe("Service Health read repository", () => {
  it("retains an existing Service with no Monitors as unknown", async () => {
    const { db } = fixture({ rows: [row("s1", "p1", null, null, null)] });
    expect(await database.createHealthRepository(db).getServiceHealth("s1")).toEqual({
      serviceId: "s1", state: "unknown", monitors: { total: 0, enabled: 0, reporting: 0, healthy: 0, unhealthy: 0, unknown: 0, disabled: 0 }, coverage: { reporting: 0, enabled: 0 },
    });
  });
  it("returns null when a Service is absent", async () => {
    const { db } = fixture(); expect(await database.createHealthRepository(db).getServiceHealth("missing")).toBeNull();
  });
  it("scopes reads to the requested Service and correlates latest checks to their Monitor", async () => {
    const { db, query } = fixture({ rows: [row("s1", "p1", "m1", true, false)] });
    const health = await database.createHealthRepository(db).getServiceHealth("s1");
    expect(health).toMatchObject({ serviceId: "s1", state: "down" });
    const [config, params] = query.mock.calls[0]!;
    expect(config.text).toContain('where "services"."id" ='); expect(params).toContain("s1");
    expect(config.text).toContain('"health_checks"."monitor_id" = "monitors"."id"');
    expect(config.text).toContain('left join "monitors" on "monitors"."service_id" = "services"."id"');
    expect(config.text).not.toContain('"incidents"');
  });
  it("uses the same latest timestamp and numeric bigint tie-break ordering as Monitor status", async () => {
    const { db, query } = fixture();
    await database.createHealthRepository(db).getServiceHealth("s1");
    await database.createMonitoringRepository(db).getRecentHealthChecks("m1", 1);
    for (const [config, params] of query.mock.calls) {
      expect(config.text).toContain('order by "health_checks"."checked_at" desc, "health_checks"."id" desc limit');
      expect(params).toContain(1);
      expect(config.text).not.toMatch(/cast\(.*"id".*text/i);
    }
  });
  it("keeps Service/Project observations and identities isolated when building Overview", async () => {
    const { db, query } = fixture({ projects: "4", incidents: "3", rows: [
      row("s1", "p1", "m1", true, true, "Healthy API"), row("s1", "p1", "m2", false, false, "Healthy API"),
      row("s2", "p2", "m3", true, false, "Down API"), row("s2", "p2", "m4", true, null, "Down API"),
      row("s3", "p2", null, null, null, "Empty API"),
    ] });
    const result = await database.createHealthRepository(db).getOverview();
    expect(result.totals).toEqual({ projects: 4, services: 3, monitors: 4, enabledMonitors: 3, openIncidents: 3 });
    expect(result.serviceHealth).toEqual({ healthy: 1, degraded: 0, down: 1, unknown: 1 });
    expect(result.attention).toEqual([
      { service: { id: "s2", name: "Down API", projectId: "p2" }, project: { id: "p2", name: "Project p2" }, health: {
        serviceId: "s2", state: "down", monitors: { total: 2, enabled: 2, reporting: 1, healthy: 0, unhealthy: 1, unknown: 1, disabled: 0 }, coverage: { reporting: 1, enabled: 2 },
      } },
      { service: { id: "s3", name: "Empty API", projectId: "p2" }, project: { id: "p2", name: "Project p2" }, health: {
        serviceId: "s3", state: "unknown", monitors: { total: 0, enabled: 0, reporting: 0, healthy: 0, unhealthy: 0, unknown: 0, disabled: 0 }, coverage: { reporting: 0, enabled: 0 },
      } },
    ]);
    const incidentQuery = query.mock.calls.find(([config]) => config.text.includes('from "incidents"'))!;
    expect(incidentQuery[0].text).toContain('"incidents"."status" ='); expect(incidentQuery[1]).toEqual(["open"]);
    expect(incidentQuery[0].text).not.toContain('"monitors"'); // Includes open Incidents on disabled Monitors.
    expect(query.mock.calls[0]![0].text).toBe("begin isolation level repeatable read read only");
    expect(query.mock.calls.at(-1)![0].text).toBe("commit");
  });
  it("returns zero services even when projects with no services exist", async () => {
    const { db } = fixture({ projects: "2" });
    expect(await database.createHealthRepository(db).getOverview()).toMatchObject({ totals: { projects: 2, services: 0, monitors: 0, enabledMonitors: 0, openIncidents: 0 }, attention: [] });
  });
  it("propagates read errors and rolls back the Overview snapshot", async () => {
    const { db, query } = fixture({ fail: true });
    await expect(database.createHealthRepository(db).getOverview()).rejects.toThrow();
    expect(query.mock.calls.at(-1)![0].text).toBe("rollback");
    await expect(database.createHealthRepository(db).getServiceHealth("s1")).rejects.toThrow();
  });
  it("rejects overview counts that cannot be represented safely", async () => {
    const { db } = fixture({ projects: "9007199254740992" });
    await expect(database.createHealthRepository(db).getOverview()).rejects.toThrow("safe integer");
  });
});
