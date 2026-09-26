import { randomUUID } from "node:crypto";
import type { HttpMonitor } from "@pulse/contracts";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "./client.js";
import {
  createMonitorRepository,
  type CreateMonitorInput,
} from "./monitor-repository.js";

const serviceId = randomUUID();
const returnedMonitor: HttpMonitor = {
  id: randomUUID(),
  serviceId,
  name: "API health",
  kind: "http",
  url: "https://example.com/health",
  method: "GET",
  intervalMs: 60_000,
  timeoutMs: 10_000,
  failureThreshold: 3,
  recoveryThreshold: 1,
  enabled: true,
  createdAt: new Date("2026-01-01T12:00:00.000Z"),
};

function databaseReturning(row: typeof returnedMonitor) {
  const returning = vi.fn().mockResolvedValue([row]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as unknown as Database, values };
}

describe("createMonitorRepository", () => {
  it("omits undefined configuration so PostgreSQL applies its defaults", async () => {
    const { db, values } = databaseReturning(returnedMonitor);
    const repository = createMonitorRepository(db);
    const input: CreateMonitorInput = {
      serviceId,
      name: "API health",
      url: "https://example.com/health",
    };

    const created = await repository.createMonitor(input);

    expect(created).toEqual(returnedMonitor);
    const inserted = values.mock.calls[0][0];
    expect(inserted).toMatchObject(input);
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted.createdAt).toBeInstanceOf(Date);
    for (const field of [
      "kind",
      "method",
      "intervalMs",
      "timeoutMs",
      "failureThreshold",
      "recoveryThreshold",
      "enabled",
    ]) {
      expect(inserted).not.toHaveProperty(field);
    }
  });

  it("includes explicitly provided configuration in the insert", async () => {
    const configured = { ...returnedMonitor, method: "HEAD" as const, enabled: false };
    const { db, values } = databaseReturning(configured);
    const repository = createMonitorRepository(db);
    const input: CreateMonitorInput = {
      serviceId,
      name: "API health",
      url: "https://example.com/health",
      method: "HEAD",
      intervalMs: 30_000,
      timeoutMs: 5_000,
      failureThreshold: 2,
      recoveryThreshold: 2,
      enabled: false,
    };

    await repository.createMonitor(input);

    expect(values.mock.calls[0][0]).toMatchObject(input);
  });
});
