import { randomUUID } from "node:crypto";
import type { HealthCheck, HttpMonitor, Incident } from "@pulse/contracts";
import { and, desc, eq, gt, notExists, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { healthChecks, incidents, monitors } from "./schema.js";

export type NewHealthCheck = Omit<HealthCheck, "id">;

export function createMonitoringRepository(db: Database) {
  return {
    async getDueHttpMonitors(asOf: Date): Promise<HttpMonitor[]> {
      const recentCheck = db
        .select({ id: healthChecks.id })
        .from(healthChecks)
        .where(
          and(
            eq(healthChecks.monitorId, monitors.id),
            gt(
              healthChecks.checkedAt,
              sql`${asOf}::timestamptz - (${monitors.intervalMs} * interval '1 millisecond')`,
            ),
          ),
        );

      const rows = await db
        .select()
        .from(monitors)
        .where(
          and(
            eq(monitors.enabled, true),
            eq(monitors.kind, "http"),
            notExists(recentCheck),
          ),
        );

      return rows.map((row) => ({
        ...row,
        kind: "http" as const,
        method: row.method as HttpMonitor["method"],
      }));
    },

    async insertHealthCheck(check: NewHealthCheck): Promise<bigint> {
      const [inserted] = await db
        .insert(healthChecks)
        .values(check)
        .returning({ id: healthChecks.id });

      return inserted.id;
    },

    async getRecentCheckOutcomes(monitorId: string, limit: number): Promise<boolean[]> {
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new RangeError("limit must be a positive integer");
      }

      const rows = await db
        .select({ healthy: healthChecks.healthy })
        .from(healthChecks)
        .where(eq(healthChecks.monitorId, monitorId))
        .orderBy(desc(healthChecks.checkedAt), desc(healthChecks.id))
        .limit(limit);

      return rows.map((row) => row.healthy);
    },

    async getOpenIncident(monitorId: string): Promise<Incident | null> {
      const [row] = await db
        .select()
        .from(incidents)
        .where(and(eq(incidents.monitorId, monitorId), eq(incidents.status, "open")))
        .limit(1);

      return row ? { ...row, status: "open" } : null;
    },

    async openIncident(monitorId: string, startedAt: Date): Promise<Incident | null> {
      const [row] = await db
        .insert(incidents)
        .values({
          id: randomUUID(),
          monitorId,
          status: "open",
          startedAt,
          resolvedAt: null,
        })
        .onConflictDoNothing({
          target: incidents.monitorId,
          where: sql`status = 'open'`,
        })
        .returning();

      return row ? { ...row, status: "open" } : null;
    },

    async resolveOpenIncident(monitorId: string, resolvedAt: Date): Promise<Incident | null> {
      const [row] = await db
        .update(incidents)
        .set({ status: "resolved", resolvedAt })
        .where(and(eq(incidents.monitorId, monitorId), eq(incidents.status, "open")))
        .returning();

      return row ? { ...row, status: "resolved" } : null;
    },
  };
}
