import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, inArray } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client.js";
import { requireTestDatabaseUrl } from "./integration-safety.js";
import { createMonitoringRepository } from "./monitoring-repository.js";
import { createProjectRepository } from "./project-repository.js";
import { createServiceRepository } from "./service-repository.js";
import { healthChecks, incidents, monitors, projects, services } from "./schema.js";

let db: Database;
let pool: Pool | undefined;
let repository: ReturnType<typeof createMonitoringRepository>;
let fixture: { projectId: string; serviceId: string; monitorIds: string[] } | undefined;

const migrationFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function pgErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const databaseError = error as { code?: string; cause?: { code?: string } };
  return databaseError.code ?? databaseError.cause?.code;
}

async function createMonitor(overrides: Partial<typeof monitors.$inferInsert> = {}) {
  if (!fixture) throw new Error("Test fixture is not initialized");
  const id = randomUUID();
  await db.insert(monitors).values({
    id,
    serviceId: fixture.serviceId,
    name: "Integration monitor",
    url: "https://example.invalid/health",
    createdAt: new Date(),
    ...overrides,
  });
  fixture.monitorIds.push(id);
  return id;
}

beforeAll(async () => {
  const testUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  ({ db, pool } = createDatabase(testUrl));
  repository = createMonitoringRepository(db);
  await migrate(db, { migrationsFolder: migrationFolder });
}, 60_000);

beforeEach(async () => {
  const projectId = randomUUID();
  const serviceId = randomUUID();
  fixture = { projectId, serviceId, monitorIds: [] };
  await db.insert(projects).values({ id: projectId, name: "Integration project", createdAt: new Date() });
  await db.insert(services).values({ id: serviceId, projectId, name: "Integration service", createdAt: new Date() });
});

afterEach(async () => {
  if (!fixture) return;
  const { projectId, serviceId, monitorIds } = fixture;
  if (monitorIds.length > 0) {
    await db.delete(healthChecks).where(inArray(healthChecks.monitorId, monitorIds));
    await db.delete(incidents).where(inArray(incidents.monitorId, monitorIds));
    await db.delete(monitors).where(inArray(monitors.id, monitorIds));
  }
  await db.delete(services).where(eq(services.id, serviceId));
  await db.delete(projects).where(eq(projects.id, projectId));
  fixture = undefined;
});

afterAll(async () => {
  await pool?.end();
});

describe("monitoring repository against PostgreSQL", () => {
  it("finds enabled monitors with no checks and excludes disabled monitors", async () => {
    const enabledId = await createMonitor();
    const disabledId = await createMonitor({ enabled: false });

    const dueIds = (await repository.getDueHttpMonitors(new Date())).map((monitor) => monitor.id);
    expect(dueIds).toContain(enabledId);
    expect(dueIds).not.toContain(disabledId);
  });

  it("uses the latest check and interval to decide which monitors are due", async () => {
    const monitorId = await createMonitor({ intervalMs: 60_000 });
    const asOf = new Date("2026-01-01T12:00:00.000Z");
    const result = {
      monitorId,
      healthy: true,
      statusCode: 200,
      latencyMs: 12,
      errorType: null,
      errorMessage: null,
    } as const;

    await repository.insertHealthCheck({ ...result, checkedAt: new Date(asOf.getTime() - 120_000) });
    expect((await repository.getDueHttpMonitors(asOf)).map((monitor) => monitor.id)).toContain(monitorId);

    await repository.insertHealthCheck({ ...result, checkedAt: new Date(asOf.getTime() - 30_000) });
    expect((await repository.getDueHttpMonitors(asOf)).map((monitor) => monitor.id)).not.toContain(monitorId);
  });

  it("inserts a health check with its monitor and result fields", async () => {
    const monitorId = await createMonitor();
    const checkedAt = new Date("2026-01-01T12:00:00.000Z");
    const id = await repository.insertHealthCheck({
      monitorId,
      healthy: false,
      statusCode: 503,
      latencyMs: 42,
      checkedAt,
      errorType: "http_error",
      errorMessage: "HTTP 503",
    });

    const databaseId = BigInt(id);
    const [stored] = await db
      .select()
      .from(healthChecks)
      .where(eq(healthChecks.id, databaseId));
    expect(stored).toMatchObject({
      id: databaseId, monitorId, healthy: false, statusCode: 503, latencyMs: 42,
      checkedAt, errorType: "http_error", errorMessage: "HTTP 503",
    });
  });

  it("returns limited outcomes newest first, breaking equal timestamps by descending ID", async () => {
    const monitorId = await createMonitor();
    const sharedTime = new Date("2026-01-01T12:00:00.000Z");
    const base = { monitorId, statusCode: 200, latencyMs: 1, errorType: null, errorMessage: null } as const;
    await repository.insertHealthCheck({ ...base, healthy: false, checkedAt: new Date(sharedTime.getTime() - 60_000) });
    const firstId = await repository.insertHealthCheck({ ...base, healthy: true, checkedAt: sharedTime });
    const secondId = await repository.insertHealthCheck({ ...base, healthy: false, checkedAt: sharedTime });

    expect(BigInt(secondId) > BigInt(firstId)).toBe(true);
    expect(await repository.getRecentCheckOutcomes(monitorId, 2)).toEqual([false, true]);
    expect(await repository.getRecentCheckOutcomes(monitorId, 3)).toEqual([false, true, false]);
  });

  it("finds an open incident and lets the partial unique index prevent another", async () => {
    const monitorId = await createMonitor();
    const startedAt = new Date("2026-01-01T12:00:00.000Z");
    expect(await repository.getOpenIncident(monitorId)).toBeNull();

    const opened = await repository.openIncident(monitorId, startedAt);
    expect(opened).toMatchObject({ monitorId, status: "open", startedAt, resolvedAt: null });
    expect(await repository.getOpenIncident(monitorId)).toEqual(opened);
    expect(await repository.openIncident(monitorId, startedAt)).toBeNull();

    let error: unknown;
    try {
      await db.insert(incidents).values({ id: randomUUID(), monitorId, status: "open", startedAt });
    } catch (caught) {
      error = caught;
    }
    expect(pgErrorCode(error)).toBe("23505");
    const rows = await db.select().from(incidents).where(eq(incidents.monitorId, monitorId));
    expect(rows).toHaveLength(1);
  });

  it("resolves the current open incident once and persists the resolution", async () => {
    const monitorId = await createMonitor();
    const startedAt = new Date("2026-01-01T12:00:00.000Z");
    const resolvedAt = new Date("2026-01-01T12:01:00.000Z");
    expect(await repository.resolveOpenIncident(monitorId, resolvedAt)).toBeNull();

    const opened = await repository.openIncident(monitorId, startedAt);
    const resolved = await repository.resolveOpenIncident(monitorId, resolvedAt);
    expect(resolved).toMatchObject({ id: opened?.id, monitorId, status: "resolved", startedAt, resolvedAt });
    expect(await repository.getOpenIncident(monitorId)).toBeNull();
    expect(await repository.resolveOpenIncident(monitorId, resolvedAt)).toBeNull();

    const [stored] = await db.select().from(incidents).where(eq(incidents.id, resolved!.id));
    expect(stored).toMatchObject({ status: "resolved", resolvedAt });
  });

  it("enforces selected monitor and health-check CHECK constraints", async () => {
    const monitorId = await createMonitor();
    const checkedAt = new Date("2026-01-01T12:00:00.000Z");
    let intervalError: unknown;
    try {
      await createMonitor({ intervalMs: 0 });
    } catch (caught) {
      intervalError = caught;
    }
    expect(pgErrorCode(intervalError)).toBe("23514");

    let latencyError: unknown;
    try {
      await repository.insertHealthCheck({
        monitorId, healthy: false, statusCode: null, latencyMs: -1,
        checkedAt, errorType: "timeout", errorMessage: "timeout",
      });
    } catch (caught) {
      latencyError = caught;
    }
    expect(pgErrorCode(latencyError)).toBe("23514");
  });
});

describe("project repository against PostgreSQL", () => {
  it("creates, lists, and retrieves projects", async () => {
    const projectRepository = createProjectRepository(db);
    const createdIds: string[] = [];

    try {
      const older = await projectRepository.createProject("Repository older project");
      createdIds.push(older.id);
      const newer = await projectRepository.createProject("Repository newer project");
      createdIds.push(newer.id);
      await db.update(projects)
        .set({ createdAt: new Date("2026-01-01T12:00:00.000Z") })
        .where(eq(projects.id, older.id));
      await db.update(projects)
        .set({ createdAt: new Date("2026-01-02T12:00:00.000Z") })
        .where(eq(projects.id, newer.id));

      expect(older).toMatchObject({ name: "Repository older project" });
      expect(older.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(older.createdAt).toBeInstanceOf(Date);
      expect(await projectRepository.getProjectById(older.id)).toMatchObject({
        id: older.id,
        name: older.name,
      });
      expect(await projectRepository.getProjectById(randomUUID())).toBeNull();

      const listedIds = (await projectRepository.listProjects()).map(({ id }) => id);
      expect(listedIds).toEqual(expect.arrayContaining([newer.id, older.id]));
      expect(listedIds.indexOf(newer.id)).toBeLessThan(listedIds.indexOf(older.id));
    } finally {
      if (createdIds.length > 0) {
        await db.delete(projects).where(inArray(projects.id, createdIds));
      }
    }
  });
});

describe("service repository against PostgreSQL", () => {
  it("creates, retrieves, and lists only services for the requested project", async () => {
    if (!fixture) throw new Error("Test fixture is not initialized");
    const projectRepository = createProjectRepository(db);
    const serviceRepository = createServiceRepository(db);
    const serviceIds: string[] = [];
    let otherProjectId: string | undefined;

    try {
      const otherProject = await projectRepository.createProject("Other service project");
      otherProjectId = otherProject.id;
      const older = await serviceRepository.createService(
        fixture.projectId,
        "Repository older service",
      );
      serviceIds.push(older.id);
      const newer = await serviceRepository.createService(
        fixture.projectId,
        "Repository newer service",
      );
      serviceIds.push(newer.id);
      const foreign = await serviceRepository.createService(
        otherProject.id,
        "Repository foreign service",
      );
      serviceIds.push(foreign.id);

      await db.update(services)
        .set({ createdAt: new Date("2026-01-01T12:00:00.000Z") })
        .where(eq(services.id, older.id));
      await db.update(services)
        .set({ createdAt: new Date("2026-01-02T12:00:00.000Z") })
        .where(eq(services.id, newer.id));

      expect(older).toMatchObject({
        projectId: fixture.projectId,
        name: "Repository older service",
      });
      expect(older.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(older.createdAt).toBeInstanceOf(Date);
      expect(await serviceRepository.getServiceById(older.id)).toMatchObject({
        id: older.id,
        projectId: fixture.projectId,
        name: older.name,
      });
      expect(await serviceRepository.getServiceById(randomUUID())).toBeNull();

      const listedIds = (
        await serviceRepository.listServicesByProjectId(fixture.projectId)
      ).map(({ id }) => id);
      expect(listedIds).toEqual(expect.arrayContaining([newer.id, older.id]));
      expect(listedIds).not.toContain(foreign.id);
      expect(listedIds.indexOf(newer.id)).toBeLessThan(listedIds.indexOf(older.id));
    } finally {
      if (serviceIds.length > 0) {
        await db.delete(services).where(inArray(services.id, serviceIds));
      }
      if (otherProjectId) {
        await db.delete(projects).where(eq(projects.id, otherProjectId));
      }
    }
  });
});
