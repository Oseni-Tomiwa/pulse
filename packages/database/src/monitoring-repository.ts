import { randomUUID } from "node:crypto";
import type { HealthCheck, HttpMonitor, Incident } from "@pulse/contracts";
import { and, desc, eq, gt, gte, lt, notExists, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { healthChecks, incidents, monitors } from "./schema.js";

export type NewHealthCheck = Omit<HealthCheck, "id">;

function validateHistoryLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive safe integer");
  }
}

function toSafeCount(value: string | bigint | number): number {
  const count = BigInt(value);
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("uptime counts exceed JavaScript's safe integer range");
  }
  return Number(count);
}

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

    async insertHealthCheck(check: NewHealthCheck): Promise<HealthCheck["id"]> {
      const [inserted] = await db
        .insert(healthChecks)
        .values(check)
        .returning({ id: healthChecks.id });

      return inserted.id.toString();
    },

    async getRecentHealthChecks(
      monitorId: string,
      limit: number,
    ): Promise<HealthCheck[]> {
      validateHistoryLimit(limit);
      const rows = await db
        .select()
        .from(healthChecks)
        .where(eq(healthChecks.monitorId, monitorId))
        .orderBy(desc(healthChecks.checkedAt), desc(healthChecks.id))
        .limit(limit);

      return rows.map((row) => ({
        ...row,
        id: row.id.toString(),
        errorType: row.errorType as HealthCheck["errorType"],
      }));
    },

    async getRecentIncidents(
      monitorId: string,
      limit: number,
    ): Promise<Incident[]> {
      validateHistoryLimit(limit);
      const rows = await db
        .select()
        .from(incidents)
        .where(eq(incidents.monitorId, monitorId))
        .orderBy(desc(incidents.startedAt), desc(incidents.id))
        .limit(limit);

      return rows.map((row) => ({
        ...row,
        status: row.status as Incident["status"],
      }));
    },

    async getCheckBasedUptimeCounts(
      monitorId: string,
      from: Date,
      to: Date,
    ): Promise<{ totalChecks: number; healthyChecks: number }> {
      const [row] = await db
        .select({
          totalChecks: sql<string>`count(*)`,
          healthyChecks: sql<string>`count(*) filter (where ${healthChecks.healthy})`,
        })
        .from(healthChecks)
        .where(and(
          eq(healthChecks.monitorId, monitorId),
          gte(healthChecks.checkedAt, from),
          lt(healthChecks.checkedAt, to),
        ));

      return {
        totalChecks: toSafeCount(row.totalChecks),
        healthyChecks: toSafeCount(row.healthyChecks),
      };
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
