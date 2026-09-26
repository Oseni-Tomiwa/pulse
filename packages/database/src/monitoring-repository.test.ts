import type { HealthCheck } from "@pulse/contracts";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "./client.js";
import {
  createMonitoringRepository,
  type NewHealthCheck,
} from "./monitoring-repository.js";

describe("createMonitoringRepository", () => {
  it("returns bigint health-check identities as precision-safe decimal strings", async () => {
    const databaseId = 9_007_199_254_740_993n;
    const returning = vi.fn().mockResolvedValue([{ id: databaseId }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;
    const repository = createMonitoringRepository(db);
    const check: NewHealthCheck = {
      monitorId: "019535d8-e8d3-7d5d-a8ef-11c85c7c738a",
      healthy: true,
      statusCode: 204,
      latencyMs: 12,
      checkedAt: new Date("2026-01-01T12:00:00.000Z"),
      errorType: null,
      errorMessage: null,
    };

    const id: HealthCheck["id"] = await repository.insertHealthCheck(check);

    expect(id).toBe("9007199254740993");
    expect(typeof id).toBe("string");
    expect(values).toHaveBeenCalledWith(check);
  });
});
