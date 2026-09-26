import { randomUUID } from "node:crypto";
import type { HttpMonitor } from "@pulse/contracts";
import { desc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { monitors } from "./schema.js";

export type CreateMonitorInput = {
  serviceId: string;
  name: string;
  url: string;
  method?: HttpMonitor["method"];
  intervalMs?: number;
  timeoutMs?: number;
  failureThreshold?: number;
  recoveryThreshold?: number;
  enabled?: boolean;
};

function toHttpMonitor(row: typeof monitors.$inferSelect): HttpMonitor {
  return {
    ...row,
    kind: row.kind as HttpMonitor["kind"],
    method: row.method as HttpMonitor["method"],
  };
}

export function createMonitorRepository(db: Database) {
  return {
    async createMonitor(input: CreateMonitorInput): Promise<HttpMonitor> {
      const values: typeof monitors.$inferInsert = {
        id: randomUUID(),
        serviceId: input.serviceId,
        name: input.name,
        url: input.url,
        createdAt: new Date(),
      };

      if (input.method !== undefined) values.method = input.method;
      if (input.intervalMs !== undefined) values.intervalMs = input.intervalMs;
      if (input.timeoutMs !== undefined) values.timeoutMs = input.timeoutMs;
      if (input.failureThreshold !== undefined) {
        values.failureThreshold = input.failureThreshold;
      }
      if (input.recoveryThreshold !== undefined) {
        values.recoveryThreshold = input.recoveryThreshold;
      }
      if (input.enabled !== undefined) values.enabled = input.enabled;

      const [created] = await db.insert(monitors).values(values).returning();
      return toHttpMonitor(created);
    },

    async listMonitorsByServiceId(serviceId: string): Promise<HttpMonitor[]> {
      const rows = await db
        .select()
        .from(monitors)
        .where(eq(monitors.serviceId, serviceId))
        .orderBy(desc(monitors.createdAt), desc(monitors.id));

      return rows.map(toHttpMonitor);
    },

    async getMonitorById(id: string): Promise<HttpMonitor | null> {
      const [row] = await db
        .select()
        .from(monitors)
        .where(eq(monitors.id, id))
        .limit(1);

      return row ? toHttpMonitor(row) : null;
    },
  };
}
