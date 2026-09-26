import type { HealthCheck } from "@pulse/contracts";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "./client.js";
import {
  createMonitoringRepository,
  type NewHealthCheck,
} from "./monitoring-repository.js";

const monitorId = "019535d8-e8d3-7d5d-a8ef-11c85c7c738a";
const checkedAt = new Date("2026-01-01T12:00:00.000Z");

function databaseSelecting(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as unknown as Database, limit };
}

function databaseAggregating(row: unknown) {
  const where = vi.fn().mockResolvedValue([row]);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as unknown as Database, where };
}

describe("createMonitoringRepository", () => {
  it("returns bigint health-check identities as precision-safe decimal strings", async () => {
    const databaseId = 9_007_199_254_740_993n;
    const returning = vi.fn().mockResolvedValue([{ id: databaseId }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;
    const repository = createMonitoringRepository(db);
    const check: NewHealthCheck = {
      monitorId,
      healthy: true,
      statusCode: 204,
      latencyMs: 12,
      checkedAt,
      errorType: null,
      errorMessage: null,
    };

    const id: HealthCheck["id"] = await repository.insertHealthCheck(check);

    expect(id).toBe("9007199254740993");
    expect(typeof id).toBe("string");
    expect(values).toHaveBeenCalledWith(check);
  });

  it("returns recent Health Checks with precision-safe decimal-string IDs", async () => {
    const databaseId = 9_007_199_254_740_993n;
    const row = {
      id: databaseId,
      monitorId,
      healthy: true,
      statusCode: 204,
      latencyMs: 12,
      checkedAt,
      errorType: null,
      errorMessage: null,
    };
    const { db, limit } = databaseSelecting([row]);
    const repository = createMonitoringRepository(db);

    const result = await repository.getRecentHealthChecks(monitorId, 1);

    expect(limit).toHaveBeenCalledWith(1);
    expect(result).toEqual([{ ...row, id: "9007199254740993" }]);
  });

  it("returns open and resolved Incidents without derived presentation fields", async () => {
    const rows = [
      {
        id: "019535d8-e8d3-7d5d-a8ef-11c85c7c738b",
        monitorId,
        status: "open",
        startedAt: new Date("2026-01-02T12:00:00.000Z"),
        resolvedAt: null,
      },
      {
        id: "019535d8-e8d3-7d5d-a8ef-11c85c7c738c",
        monitorId,
        status: "resolved",
        startedAt: new Date("2026-01-01T12:00:00.000Z"),
        resolvedAt: new Date("2026-01-01T12:01:00.000Z"),
      },
    ];
    const { db, limit } = databaseSelecting(rows);
    const repository = createMonitoringRepository(db);

    const result = await repository.getRecentIncidents(monitorId, 2);

    expect(limit).toHaveBeenCalledWith(2);
    expect(result).toEqual(rows);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid repository history limit %s",
    async (limit) => {
      const repository = createMonitoringRepository({} as Database);

      await expect(repository.getRecentHealthChecks(monitorId, limit))
        .rejects.toThrow("limit must be a positive safe integer");
      await expect(repository.getRecentIncidents(monitorId, limit))
        .rejects.toThrow("limit must be a positive safe integer");
    },
  );

  it("maps PostgreSQL bigint uptime counts to safe JavaScript numbers", async () => {
    const { db } = databaseAggregating({
      totalChecks: "1440",
      healthyChecks: "1437",
    });
    const repository = createMonitoringRepository(db);
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-02T00:00:00.000Z");

    await expect(repository.getCheckBasedUptimeCounts(monitorId, from, to))
      .resolves.toEqual({ totalChecks: 1440, healthyChecks: 1437 });
  });

  it("returns zero uptime counts when the aggregate has no matching checks", async () => {
    const { db } = databaseAggregating({ totalChecks: "0", healthyChecks: "0" });
    const repository = createMonitoringRepository(db);

    await expect(repository.getCheckBasedUptimeCounts(
      monitorId,
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-02T00:00:00.000Z"),
    )).resolves.toEqual({ totalChecks: 0, healthyChecks: 0 });
  });

  it("rejects uptime counts that cannot be represented safely as numbers", async () => {
    const { db } = databaseAggregating({
      totalChecks: "9007199254740992",
      healthyChecks: "1",
    });
    const repository = createMonitoringRepository(db);

    await expect(repository.getCheckBasedUptimeCounts(
      monitorId,
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-02T00:00:00.000Z"),
    )).rejects.toThrow("uptime counts exceed JavaScript's safe integer range");
  });
});
