import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client.js";
import { requireTestDatabaseUrl } from "./integration-safety.js";
import { createMonitoringRepository } from "./monitoring-repository.js";
import { healthChecks, incidents, monitors, projects, services } from "./schema.js";

let db: Database;
let pool: Pool | undefined;
let repository: ReturnType<typeof createMonitoringRepository>;
let fixture: { projectId: string; serviceId: string; monitorIds: string[] } | undefined;

async function createMonitor(failureThreshold: number, recoveryThreshold: number) {
  if (!fixture) throw new Error("fixture not initialized");
  const id = randomUUID();
  await db.insert(monitors).values({
    id,
    serviceId: fixture.serviceId,
    name: "M6 gate monitor",
    url: "https://example.invalid/health",
    failureThreshold,
    recoveryThreshold,
    createdAt: new Date(),
  });
  fixture.monitorIds.push(id);
  return id;
}

async function createIncident(monitorId: string, startedAt: Date, resolvedAt: Date | null) {
  const id = randomUUID();
  await db.insert(incidents).values({
    id,
    monitorId,
    status: resolvedAt === null ? "open" : "resolved",
    startedAt,
    resolvedAt,
  });
  return id;
}

async function createCheck(monitorId: string, checkedAt: Date, healthy: boolean) {
  return repository.insertHealthCheck({
    monitorId,
    healthy,
    statusCode: healthy ? 204 : 500,
    latencyMs: 10,
    checkedAt,
    errorType: healthy ? null : "http_error",
    errorMessage: healthy ? null : "HTTP 500",
  });
}

beforeAll(() => {
  const testUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  ({ db, pool } = createDatabase(testUrl));
  repository = createMonitoringRepository(db);
});

beforeEach(async () => {
  const projectId = randomUUID();
  const serviceId = randomUUID();
  fixture = { projectId, serviceId, monitorIds: [] };
  await db.insert(projects).values({ id: projectId, name: "M6 gate project", createdAt: new Date() });
  await db.insert(services).values({ id: serviceId, projectId, name: "M6 gate service", createdAt: new Date() });
});

afterEach(async () => {
  if (!fixture) return;
  if (fixture.monitorIds.length > 0) {
    await db.delete(healthChecks).where(inArray(healthChecks.monitorId, fixture.monitorIds));
    await db.delete(incidents).where(inArray(incidents.monitorId, fixture.monitorIds));
    await db.delete(monitors).where(inArray(monitors.id, fixture.monitorIds));
  }
  await db.delete(services).where(eq(services.id, fixture.serviceId));
  await db.delete(projects).where(eq(projects.id, fixture.projectId));
  fixture = undefined;
});

afterAll(async () => {
  await pool?.end();
});

describe("M6 PostgreSQL verification gate", () => {
  it("derives complete, incomplete, contradictory, and missing-boundary threshold integrity", async () => {
    const base = Date.parse("2026-07-01T12:00:00.000Z");

    const completeOpeningMonitor = await createMonitor(2, 1);
    await createCheck(completeOpeningMonitor, new Date(base - 1_000), false);
    await createCheck(completeOpeningMonitor, new Date(base), false);
    const completeOpeningIncident = await createIncident(completeOpeningMonitor, new Date(base), null);
    expect((await repository.getIncidentDiagnosticsById(completeOpeningIncident))?.evidence.opening.sequence)
      .toMatchObject({ returnedCount: 2, complete: true, contradictory: false, truncated: false });

    const incompleteOpeningMonitor = await createMonitor(3, 1);
    await createCheck(incompleteOpeningMonitor, new Date(base), false);
    const incompleteOpeningIncident = await createIncident(incompleteOpeningMonitor, new Date(base), null);
    expect((await repository.getIncidentDiagnosticsById(incompleteOpeningIncident))?.evidence.opening.sequence)
      .toMatchObject({ returnedCount: 1, complete: false, contradictory: false, truncated: false });

    const contradictoryOpeningMonitor = await createMonitor(2, 1);
    await createCheck(contradictoryOpeningMonitor, new Date(base - 1_000), true);
    await createCheck(contradictoryOpeningMonitor, new Date(base), false);
    const contradictoryOpeningIncident = await createIncident(contradictoryOpeningMonitor, new Date(base), null);
    expect((await repository.getIncidentDiagnosticsById(contradictoryOpeningIncident))?.evidence.opening.sequence)
      .toMatchObject({ returnedCount: 2, complete: true, contradictory: true, truncated: false });

    const completeRecoveryMonitor = await createMonitor(1, 2);
    await createCheck(completeRecoveryMonitor, new Date(base), false);
    await createCheck(completeRecoveryMonitor, new Date(base + 1_000), true);
    await createCheck(completeRecoveryMonitor, new Date(base + 2_000), true);
    const completeRecoveryIncident = await createIncident(
      completeRecoveryMonitor,
      new Date(base),
      new Date(base + 2_000),
    );
    expect((await repository.getIncidentDiagnosticsById(completeRecoveryIncident))?.evidence.recovery?.sequence)
      .toMatchObject({ returnedCount: 2, complete: true, contradictory: false, truncated: false });

    const incompleteRecoveryMonitor = await createMonitor(1, 3);
    await createCheck(incompleteRecoveryMonitor, new Date(base + 2_000), true);
    const incompleteRecoveryIncident = await createIncident(
      incompleteRecoveryMonitor,
      new Date(base),
      new Date(base + 2_000),
    );
    expect((await repository.getIncidentDiagnosticsById(incompleteRecoveryIncident))?.evidence.recovery?.sequence)
      .toMatchObject({ returnedCount: 1, complete: false, contradictory: false, truncated: false });

    const contradictoryRecoveryMonitor = await createMonitor(1, 2);
    await createCheck(contradictoryRecoveryMonitor, new Date(base + 1_000), false);
    await createCheck(contradictoryRecoveryMonitor, new Date(base + 2_000), true);
    const contradictoryRecoveryIncident = await createIncident(
      contradictoryRecoveryMonitor,
      new Date(base),
      new Date(base + 2_000),
    );
    expect((await repository.getIncidentDiagnosticsById(contradictoryRecoveryIncident))?.evidence.recovery?.sequence)
      .toMatchObject({ returnedCount: 2, complete: true, contradictory: true, truncated: false });

    const missingBoundaryMonitor = await createMonitor(1, 2);
    await createCheck(missingBoundaryMonitor, new Date(base + 1_000), true);
    await createCheck(missingBoundaryMonitor, new Date(base + 2_000), true);
    const missingBoundaryIncident = await createIncident(
      missingBoundaryMonitor,
      new Date(base),
      new Date(base + 3_000),
    );
    const missingBoundary = await repository.getIncidentDiagnosticsById(missingBoundaryIncident);
    expect(missingBoundary?.evidence.recovery).toMatchObject({
      boundary: { match: "missing", checkId: null },
      sequence: { returnedCount: 2, complete: false, contradictory: false, truncated: false },
    });
  });

  it("returns valid empty evidence and labels current, non-historical monitor thresholds", async () => {
    const startedAt = new Date("2026-07-02T12:00:00.000Z");
    const monitorId = await createMonitor(1, 1);
    const incidentId = await createIncident(monitorId, startedAt, null);
    await db.update(monitors).set({ failureThreshold: 4, recoveryThreshold: 5 })
      .where(eq(monitors.id, monitorId));

    const result = await repository.getIncidentDiagnosticsById(incidentId);

    expect(result?.monitor).toMatchObject({ failureThreshold: 4, recoveryThreshold: 5 });
    expect(result?.evidence).toMatchObject({
      thresholdSource: "current_monitor",
      opening: {
        boundary: { match: "missing", checkId: null },
        sequence: { configuredThreshold: 4, returnedCount: 0, complete: false },
      },
      recovery: null,
      checks: [],
      gaps: [],
      truncated: false,
    });
  });
});
