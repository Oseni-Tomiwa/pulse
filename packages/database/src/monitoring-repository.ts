import { randomUUID } from "node:crypto";
import type {
  HealthCheck,
  HttpMonitor,
  Incident,
  IncidentDiagnostics,
} from "@pulse/contracts";
import { and, asc, desc, eq, gt, gte, lt, lte, notExists, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  assembleIncidentEvidence,
  isThresholdSequenceComplete,
  type IncidentEvidenceParts,
} from "./incident-diagnostics.js";
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

function mapHealthCheck(row: typeof healthChecks.$inferSelect): HealthCheck {
  return {
    ...row,
    id: row.id.toString(),
    errorType: row.errorType as HealthCheck["errorType"],
  };
}

function allocateResolvedSequenceLimits(
  failureThreshold: number,
  recoveryThreshold: number,
): { opening: number; recovery: number } {
  const capacity = 52;
  if (failureThreshold + recoveryThreshold <= capacity) {
    return { opening: failureThreshold, recovery: recoveryThreshold };
  }
  const half = capacity / 2;
  if (failureThreshold <= half) {
    return { opening: failureThreshold, recovery: capacity - failureThreshold };
  }
  if (recoveryThreshold <= half) {
    return { opening: capacity - recoveryThreshold, recovery: recoveryThreshold };
  }
  return { opening: half, recovery: half };
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

    async getIncidentDiagnosticsById(
      incidentId: string,
    ): Promise<IncidentDiagnostics | null> {
      const [detail] = await db
        .select({ incident: incidents, monitor: monitors })
        .from(incidents)
        .innerJoin(monitors, eq(incidents.monitorId, monitors.id))
        .where(eq(incidents.id, incidentId))
        .limit(1);
      if (!detail) return null;

      const incident: Incident = {
        ...detail.incident,
        status: detail.incident.status as Incident["status"],
      };
      const monitor: HttpMonitor = {
        ...detail.monitor,
        kind: "http",
        method: detail.monitor.method as HttpMonitor["method"],
      };
      const monitorCondition = eq(healthChecks.monitorId, monitor.id);
      const readChecks = async (
        condition: SQL<unknown>,
        direction: "asc" | "desc",
        limit: number,
      ): Promise<HealthCheck[]> => {
        if (limit <= 0) return [];
        const rows = await db
          .select()
          .from(healthChecks)
          .where(and(monitorCondition, condition))
          .orderBy(
            direction === "asc" ? asc(healthChecks.checkedAt) : desc(healthChecks.checkedAt),
            direction === "asc" ? asc(healthChecks.id) : desc(healthChecks.id),
          )
          .limit(limit);
        return rows.map(mapHealthCheck);
      };
      const countChecks = async (condition: SQL<unknown>): Promise<bigint> => {
        const [row] = await db
          .select({ count: sql<string>`count(*)` })
          .from(healthChecks)
          .where(and(monitorCondition, condition));
        return BigInt(row.count);
      };
      const beforeTuple = (candidate: HealthCheck): SQL<unknown> =>
        sql`(${healthChecks.checkedAt}, ${healthChecks.id}) < (${candidate.checkedAt}, ${BigInt(candidate.id)})`;
      const atOrBeforeTuple = (candidate: HealthCheck): SQL<unknown> =>
        sql`(${healthChecks.checkedAt}, ${healthChecks.id}) <= (${candidate.checkedAt}, ${BigInt(candidate.id)})`;

      const openingBoundaryCandidates = await readChecks(
        eq(healthChecks.checkedAt, incident.startedAt),
        "asc",
        2,
      );
      const resolved = incident.status === "resolved" && incident.resolvedAt !== null;
      const limits = resolved
        ? allocateResolvedSequenceLimits(
            monitor.failureThreshold,
            monitor.recoveryThreshold,
          )
        : { opening: Math.min(monitor.failureThreshold, 53), recovery: 0 };
      const openingTruncated = limits.opening < monitor.failureThreshold;
      const openingAnchor = openingBoundaryCandidates.length === 1
        ? openingBoundaryCandidates[0]!
        : null;
      const openingSequence = (await readChecks(
        openingAnchor
          ? atOrBeforeTuple(openingAnchor)
          : lte(healthChecks.checkedAt, incident.startedAt),
        "desc",
        limits.opening,
      )).reverse();
      const openingComplete = isThresholdSequenceComplete(
        openingSequence.length,
        monitor.failureThreshold,
        openingTruncated,
        openingBoundaryCandidates.length > 0,
      );
      const openingPredecessor = openingComplete && openingSequence[0]
        ? (await readChecks(beforeTuple(openingSequence[0]), "desc", 1))[0] ?? null
        : null;

      const parts: IncidentEvidenceParts = {
        openingBoundaryCandidates,
        openingSequence,
        openingPredecessor,
        openingThreshold: monitor.failureThreshold,
        openingTruncated,
        duringFirst: [],
        duringLast: [],
        duringTruncated: false,
        recoveryBoundaryCandidates: null,
        recoverySequence: null,
        recoveryThreshold: null,
        recoveryTruncated: false,
        postRecovery: null,
        gapBeforeIds: [],
      };

      if (!resolved) {
        parts.duringFirst = await readChecks(
          gt(healthChecks.checkedAt, incident.startedAt),
          "asc",
          5,
        );
        parts.duringLast = (await readChecks(
          gt(healthChecks.checkedAt, incident.startedAt),
          "desc",
          5,
        )).reverse();
        const selectedDuringIds = new Set([
          ...parts.duringFirst,
          ...parts.duringLast,
        ].map(({ id }) => id));
        const duringCount = await countChecks(gt(healthChecks.checkedAt, incident.startedAt));
        parts.duringTruncated = duringCount > BigInt(selectedDuringIds.size);
        const firstLate = parts.duringLast.find(
          ({ id }) => !parts.duringFirst.some((check) => check.id === id),
        );
        if (parts.duringTruncated && firstLate) {
          parts.gapBeforeIds.push(firstLate.id);
        }
      } else {
        const resolvedAt = incident.resolvedAt!;
        parts.recoveryBoundaryCandidates = await readChecks(
          eq(healthChecks.checkedAt, resolvedAt),
          "asc",
          2,
        );
        const recoveryAnchor = parts.recoveryBoundaryCandidates.length === 1
          ? parts.recoveryBoundaryCandidates[0]!
          : null;
        parts.recoveryTruncated = limits.recovery < monitor.recoveryThreshold;
        parts.recoverySequence = (await readChecks(
          and(
            gte(healthChecks.checkedAt, incident.startedAt),
            recoveryAnchor
              ? atOrBeforeTuple(recoveryAnchor)
              : lte(healthChecks.checkedAt, resolvedAt),
          )!,
          "desc",
          limits.recovery,
        )).reverse();
        parts.recoveryThreshold = monitor.recoveryThreshold;

        const recoveryStart = parts.recoverySequence[0] ?? null;
        const duringCondition = and(
          gt(healthChecks.checkedAt, incident.startedAt),
          recoveryStart
            ? beforeTuple(recoveryStart)
            : lt(healthChecks.checkedAt, resolvedAt),
        )!;
        parts.duringFirst = await readChecks(duringCondition, "asc", 5);
        const recoveryComplete = isThresholdSequenceComplete(
          parts.recoverySequence.length,
          monitor.recoveryThreshold,
          parts.recoveryTruncated,
          parts.recoveryBoundaryCandidates.length > 0,
        );
        parts.duringLast = recoveryComplete
          ? (await readChecks(duringCondition, "desc", 5)).reverse()
          : [];
        const selectedDuringIds = new Set([
          ...parts.duringFirst,
          ...parts.duringLast,
        ].map(({ id }) => id));
        const duringCount = await countChecks(duringCondition);
        parts.duringTruncated = duringCount > BigInt(selectedDuringIds.size) ||
          parts.recoveryTruncated;
        const firstLate = parts.duringLast.find(
          ({ id }) => !parts.duringFirst.some((check) => check.id === id),
        );
        if (duringCount > BigInt(selectedDuringIds.size) && firstLate) {
          parts.gapBeforeIds.push(firstLate.id);
        }
        if (parts.recoveryTruncated && recoveryStart) {
          parts.gapBeforeIds.push(recoveryStart.id);
        }
        parts.postRecovery = (await readChecks(
          gt(healthChecks.checkedAt, resolvedAt),
          "asc",
          1,
        ))[0] ?? null;
      }

      return {
        incident,
        monitor,
        durationMs: incident.resolvedAt === null
          ? null
          : incident.resolvedAt.getTime() - incident.startedAt.getTime(),
        evidence: assembleIncidentEvidence(parts),
      };
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
