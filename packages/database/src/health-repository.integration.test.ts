import { randomInt, randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient, QueryConfig } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client.js";
import { createHealthRepository } from "./health-repository.js";
import { requireTestDatabaseUrl } from "./integration-safety.js";
import { createMonitoringRepository } from "./monitoring-repository.js";
import { healthChecks, incidents, monitors, projects, services } from "./schema.js";

let db: Database;
let pool: Pool | undefined;
let fixture: { projects: string[]; services: string[]; monitors: string[] };
const base = Date.parse("2026-10-01T12:00:00.000Z");
type Kind = "healthy" | "unhealthy" | "unknown" | "disabled";

function requireM8TestDatabaseUrl(): string {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
  if (process.env.DATABASE_URL !== undefined) throw new Error("DATABASE_URL must be absent");
  const url = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  let database: string;
  try { database = decodeURIComponent(new URL(url).pathname.slice(1)); }
  catch { throw new Error("Test database URL parsing failed"); }
  if (new URL(url).search) throw new Error("Test database URL parameters are forbidden");
  if (database !== "pulse_test") throw new Error("Test database must be exactly pulse_test");
  return url;
}

beforeAll(async () => {
  ({ db, pool } = createDatabase(requireM8TestDatabaseUrl()));
  const result = await pool.query("select current_database() as database");
  expect(result.rows[0].database).toBe("pulse_test");
});
beforeEach(() => { fixture = { projects: [], services: [], monitors: [] }; });

afterEach(async () => {
  if (!db || !fixture) return;
  // Recheck the guard immediately before cleanup; never truncate shared tables.
  requireM8TestDatabaseUrl();
  if (fixture.monitors.length) {
    await db.delete(healthChecks).where(inArray(healthChecks.monitorId, fixture.monitors));
    await db.delete(incidents).where(inArray(incidents.monitorId, fixture.monitors));
    await db.delete(monitors).where(inArray(monitors.id, fixture.monitors));
    const [remaining] = await db.select({ count: sql<string>`count(*)` }).from(monitors).where(inArray(monitors.id, fixture.monitors));
    expect(Number(remaining.count)).toBe(0);
  }
  if (fixture.services.length) await db.delete(services).where(inArray(services.id, fixture.services));
  if (fixture.projects.length) {
    await db.delete(projects).where(inArray(projects.id, fixture.projects));
    const [remaining] = await db.select({ count: sql<string>`count(*)` }).from(projects).where(inArray(projects.id, fixture.projects));
    expect(Number(remaining.count)).toBe(0);
  }
});
afterAll(async () => { await pool?.end(); });

async function project(name = "M8 PostgreSQL gate Project") {
  const id = randomUUID(); fixture.projects.push(id);
  await db.insert(projects).values({ id, name, createdAt: new Date(base) });
  return id;
}
async function service(projectId: string, name = "M8 PostgreSQL gate Service") {
  const id = randomUUID(); fixture.services.push(id);
  await db.insert(services).values({ id, projectId, name, createdAt: new Date(base) });
  return id;
}
async function monitor(serviceId: string, kind: Kind) {
  const id = randomUUID(); fixture.monitors.push(id);
  await db.insert(monitors).values({ id, serviceId, name: "M8 PostgreSQL gate Monitor", url: "https://example.invalid/m7", enabled: kind !== "disabled", createdAt: new Date(base) });
  // Disabled Monitors intentionally retain an unhealthy persisted observation.
  if (kind !== "unknown") await check(id, kind === "healthy", base);
  return id;
}
async function check(monitorId: string, healthy: boolean, timestamp: number) {
  return createMonitoringRepository(db).insertHealthCheck({ monitorId, healthy, statusCode: healthy ? 204 : 503, latencyMs: 12,
    checkedAt: new Date(timestamp), errorType: healthy ? null : "http_error", errorMessage: healthy ? null : "HTTP 503" });
}
async function incident(monitorId: string, resolved: boolean) {
  const id = randomUUID();
  await db.insert(incidents).values({ id, monitorId, status: resolved ? "resolved" : "open", startedAt: new Date(base), resolvedAt: resolved ? new Date(base + 60000) : null });
  return id;
}

describe("M8 Service Health against PostgreSQL", () => {
  it.each<{ name: string; kinds: Kind[]; state: string; counts: number[] }>([
    { name: "zero Monitors", kinds: [], state: "unknown", counts: [0,0,0,0,0,0,0] },
    { name: "disabled with persisted checks", kinds: ["disabled"], state: "unknown", counts: [1,0,0,0,0,0,1] },
    { name: "enabled without a check", kinds: ["unknown"], state: "unknown", counts: [1,1,0,0,0,1,0] },
    { name: "healthy", kinds: ["healthy"], state: "healthy", counts: [1,1,1,1,0,0,0] },
    { name: "unhealthy", kinds: ["unhealthy"], state: "down", counts: [1,1,1,0,1,0,0] },
    { name: "two healthy", kinds: ["healthy","healthy"], state: "healthy", counts: [2,2,2,2,0,0,0] },
    { name: "two unhealthy", kinds: ["unhealthy","unhealthy"], state: "down", counts: [2,2,2,0,2,0,0] },
    { name: "healthy and unhealthy", kinds: ["healthy","unhealthy"], state: "degraded", counts: [2,2,2,1,1,0,0] },
    { name: "healthy partial coverage", kinds: ["healthy","unknown"], state: "healthy", counts: [2,2,1,1,0,1,0] },
    { name: "down partial coverage", kinds: ["unhealthy","unknown"], state: "down", counts: [2,2,1,0,1,1,0] },
    { name: "degraded partial coverage", kinds: ["healthy","unhealthy","unknown"], state: "degraded", counts: [3,3,2,1,1,1,0] },
    { name: "healthy and disabled", kinds: ["healthy","disabled"], state: "healthy", counts: [2,1,1,1,0,0,1] },
    { name: "down and disabled", kinds: ["unhealthy","disabled"], state: "down", counts: [2,1,1,0,1,0,1] },
    { name: "unknown and disabled", kinds: ["unknown","disabled"], state: "unknown", counts: [2,1,0,0,0,1,1] },
  ])("$name", async ({ kinds, state, counts }) => {
    const serviceId = await service(await project());
    for (const kind of kinds) await monitor(serviceId, kind);
    const [total, enabled, reporting, healthy, unhealthy, unknown, disabled] = counts;
    expect(await createHealthRepository(db, () => new Date(base + 1000)).getServiceHealth(serviceId)).toEqual({ serviceId, state,
      monitors: { total, enabled, reporting, healthy, unhealthy, unknown, disabled, stale: 0 }, coverage: { reporting, enabled } });
  });

  it("expires observations exactly at the deadline while retaining persisted evidence", async () => {
    const serviceId = await service(await project());
    const id = await monitor(serviceId, "healthy");
    const repository = createHealthRepository(db, () => new Date(base + 1000));
    // Defaults: 60s interval + 10s timeout + 60s grace.
    expect((await repository.getServiceHealth(serviceId, new Date(base + 129999)))?.monitors).toMatchObject({ reporting: 1, healthy: 1, stale: 0 });
    expect(await repository.getServiceHealth(serviceId, new Date(base + 130000))).toMatchObject({ state: "unknown", monitors: { reporting: 0, healthy: 0, unknown: 0, stale: 1 }, coverage: { reporting: 0, enabled: 1 } });
    const latest = (await createMonitoringRepository(db).getRecentHealthChecks(id, 1))[0]!;
    expect(latest.healthy).toBe(true);
    expect(latest.statusCode).toBe(204);
    expect(latest.latencyMs).toBe(12);
  });

  it("includes healthy Services with stale or never-observed coverage in attention", async () => {
    const serviceId = await service(await project());
    await monitor(serviceId, "healthy");
    const stale = await monitor(serviceId, "unknown");
    await check(stale, false, base - 130000);
    await monitor(serviceId, "unknown");
    const repository = createHealthRepository(db, () => new Date(base + 1000));
    const health = await repository.getServiceHealth(serviceId);
    expect(health).toMatchObject({ state: "healthy", monitors: { total: 3, reporting: 1, healthy: 1, unhealthy: 0, unknown: 1, stale: 1 }, coverage: { reporting: 1, enabled: 3 } });
    const overview = await repository.getOverview();
    expect(overview.attention.find(entry => entry.service.id === serviceId)?.health).toEqual(health);
  });

  it("returns null for an absent Service", async () => {
    expect(await createHealthRepository(db, () => new Date(base + 1000)).getServiceHealth(randomUUID())).toBeNull();
  });

  it("selects newest timestamps then numeric bigint IDs without unsafe number conversion", async () => {
    const serviceId = await service(await project());
    const monitorId = await monitor(serviceId, "unknown");
    const first = await check(monitorId, true, base + 1000);
    // A later insert with an older timestamp must not replace the latest observation.
    await check(monitorId, false, base);
    const repository = createHealthRepository(db, () => new Date(base + 1000));
    expect((await repository.getServiceHealth(serviceId))?.state).toBe("healthy");
    expect((await createMonitoringRepository(db).getRecentHealthChecks(monitorId, 1))[0]?.id).toBe(first);
    const second = await check(monitorId, false, base + 1000);
    expect(typeof second).toBe("string"); expect(second).toMatch(/^\d+$/);
    expect(BigInt(second)).toBeGreaterThan(BigInt(first));
    expect((await repository.getServiceHealth(serviceId))?.state).toBe("down");
    const third = await check(monitorId, true, base + 1000);
    expect(BigInt(third)).toBeGreaterThan(BigInt(second));
    expect((await repository.getServiceHealth(serviceId))?.state).toBe("healthy");
    const latest = (await createMonitoringRepository(db).getRecentHealthChecks(monitorId, 1))[0]!;
    expect(latest.id).toBe(third); expect(latest.healthy).toBe(true);
    // PostgreSQL type inspection verifies the ordering column is bigint, not text.
    const type = await db.execute(sql`select pg_typeof(${healthChecks.id})::text as type from ${healthChecks} where ${healthChecks.monitorId} = ${monitorId} limit 1`);
    expect(type.rows[0]?.type).toBe("bigint");
  });

  it("orders bigint IDs numerically across a digit boundary and above JavaScript safe integers", async () => {
    const serviceId = await service(await project());
    const monitorId = await monitor(serviceId, "unknown");
    // Explicit fixture identities do not advance/reset the shared identity sequence.
    // These straddle a decimal digit boundary: text ordering would select the wrong row.
    const lowerId = 100000000000000000n - BigInt(randomInt(1000, 1000000));
    const higherId = 100000000000000000n + BigInt(randomInt(1000, 1000000));
    const timestamp = new Date(base);
    await db.execute(sql`insert into ${healthChecks}
      (id, monitor_id, healthy, status_code, latency_ms, checked_at)
      overriding system value values
      (${lowerId.toString()}::bigint, ${monitorId}::uuid, true, 204, 12, ${timestamp}),
      (${higherId.toString()}::bigint, ${monitorId}::uuid, false, 503, 12, ${timestamp})`);
    expect(lowerId).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(lowerId.toString() > higherId.toString()).toBe(true);
    const latest = (await createMonitoringRepository(db).getRecentHealthChecks(monitorId, 1))[0]!;
    expect(latest.id).toBe(higherId.toString()); expect(latest.healthy).toBe(false);
    expect((await createHealthRepository(db, () => new Date(base + 1000)).getServiceHealth(serviceId))?.state).toBe("down");
  });

  it("isolates Services/Projects and ignores checks on disabled Monitors", async () => {
    const targetService = await service(await project("M8 gate Target Project"));
    const disabled = await monitor(targetService, "disabled");
    const target = await monitor(targetService, "healthy");
    const otherService = await service(await project("M8 gate Other Project"));
    await monitor(otherService, "unhealthy");
    await check(disabled, false, base + 999000);
    await incident(target, false); // Open Incident does not override a healthy latest check.
    expect(await createHealthRepository(db, () => new Date(base + 1000)).getServiceHealth(targetService)).toMatchObject({ state: "healthy",
      monitors: { total: 2, enabled: 1, reporting: 1, healthy: 1, unhealthy: 0, unknown: 0, disabled: 1 } });
    expect((await createHealthRepository(db, () => new Date(base + 1000)).getServiceHealth(otherService))?.state).toBe("down");
  });
});

describe("M8 Overview against PostgreSQL", () => {
  it("counts all resources, filters/orders attention, and preserves Project identities", async () => {
    const repository = createHealthRepository(db, () => new Date(base + 1000));
    const baseline = await repository.getOverview();
    const p1 = await project("M8 gate Project One"); const p2 = await project("M8 gate Project Two");
    await project("M8 gate Project Without Services");
    const h = await service(p1, "M8 Healthy"); const g = await service(p1, "M8 Degraded");
    const b = await service(p2, "M8 Beta"); const a1 = await service(p1, "M8 Alpha"); const a2 = await service(p2, "M8 Alpha");
    const u = await service(p2, "M8 Unknown Empty");
    const hm = await monitor(h, "healthy");
    const gm = await monitor(g, "healthy"); await monitor(g, "unhealthy");
    const bm = await monitor(b, "unhealthy"); const disabled = await monitor(b, "disabled");
    const am = await monitor(a1, "unhealthy"); await monitor(a2, "unhealthy");
    await incident(hm, false); await incident(disabled, false); await incident(am, false);
    await incident(bm, true); await incident(gm, true);
    const result = await repository.getOverview();
    expect(result.totals).toEqual({ projects: baseline.totals.projects + 3, services: baseline.totals.services + 6,
      monitors: baseline.totals.monitors + 7, enabledMonitors: baseline.totals.enabledMonitors + 6, openIncidents: baseline.totals.openIncidents + 3 });
    expect(result.serviceHealth).toEqual({ healthy: baseline.serviceHealth.healthy + 1, degraded: baseline.serviceHealth.degraded + 1,
      down: baseline.serviceHealth.down + 3, unknown: baseline.serviceHealth.unknown + 1 });
    expect(result.attention.every(entry => entry.health.state !== "healthy")).toBe(true);
    const owned = result.attention.filter(entry => fixture.services.includes(entry.service.id));
    expect(owned.map(entry => entry.service.id)).toEqual([...([a1,a2].sort()), b, g, u]);
    const priority = { down: 0, degraded: 1, unknown: 2, healthy: 3 };
    const ranks = result.attention.map(entry => priority[entry.health.state]);
    expect(ranks).toEqual([...ranks].sort((left,right) => left-right));
    for (const [id, projectId, projectName, name] of [
      [a1,p1,"M8 gate Project One","M8 Alpha"], [a2,p2,"M8 gate Project Two","M8 Alpha"],
      [b,p2,"M8 gate Project Two","M8 Beta"], [g,p1,"M8 gate Project One","M8 Degraded"], [u,p2,"M8 gate Project Two","M8 Unknown Empty"],
    ]) {
      const entry = owned.find(item => item.service.id === id)!;
      expect(entry.service).toEqual({ id, projectId, name });
      expect(entry.project).toEqual({ id: projectId, name: projectName });
      expect(entry.health).toEqual(await repository.getServiceHealth(id!));
    }
    expect(owned.find(entry => entry.service.id === u)?.health.monitors.total).toBe(0);
  });

  it("uses a real read-only repeatable-read snapshot across concurrent committed writes", async () => {
    const serviceId = await service(await project()); const monitorId = await monitor(serviceId, "healthy");
    const repository = createHealthRepository(db, () => new Date(base + 1000));
    const before = await repository.getOverview();
    const client = await pool!.connect();
    let injected = false;
    const settings: string[][] = [];
    // Intercept only this test's real connection after its first SELECT completes.
    // All intercepted SQL is still executed by PostgreSQL; writes use another connection.
    const intercepted = new Proxy(client, {
      get(target, property) {
        if (property !== "query") return Reflect.get(target, property, target);
        return async (config: QueryConfig, values?: unknown[]) => {
          const result = await target.query(config, values);
          if (!injected && config.text.includes('from "services"')) {
            injected = true;
            const isolation = await target.query("show transaction_isolation");
            const readOnly = await target.query("show transaction_read_only");
            settings.push([isolation.rows[0].transaction_isolation, readOnly.rows[0].transaction_read_only]);
            await project("M8 gate Concurrent Project");
            await check(monitorId, false, base + 1000);
            await incident(monitorId, false);
          }
          return result;
        };
      },
    }) as PoolClient;
    try {
      const during = await createHealthRepository(drizzle({ client: intercepted }) as unknown as Database, () => new Date(base + 1000)).getOverview();
      expect(injected).toBe(true); expect(settings).toEqual([["repeatable read", "on"]]);
      expect(during).toEqual(before);
      const after = await repository.getOverview();
      expect(after.totals.projects).toBe(before.totals.projects + 1);
      expect(after.totals.openIncidents).toBe(before.totals.openIncidents + 1);
      expect(after.serviceHealth.healthy).toBe(before.serviceHealth.healthy - 1);
      expect(after.serviceHealth.down).toBe(before.serviceHealth.down + 1);
      expect(after.attention.find(entry => entry.service.id === serviceId)?.health.state).toBe("down");
    } finally { client.release(); }
  });

  it("returns an empty Overview only when the shared test database is already empty", async context => {
    const result = await createHealthRepository(db, () => new Date(base + 1000)).getOverview();
    if (result.totals.projects !== 0 || result.totals.services !== 0 || result.totals.monitors !== 0 || result.totals.openIncidents !== 0) {
      context.skip(); // Never delete unrelated data to manufacture an empty database.
      return;
    }
    expect(result).toEqual({ totals: { projects: 0, services: 0, monitors: 0, enabledMonitors: 0, openIncidents: 0 },
      serviceHealth: { healthy: 0, degraded: 0, down: 0, unknown: 0 }, attention: [] });
  });
});
