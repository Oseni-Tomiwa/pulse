import type { Overview, ServiceHealth, ServiceHealthSummary } from "@pulse/contracts";
import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { healthChecks, incidents, monitors, projects, services } from "./schema.js";
import { aggregateOverview, aggregateServiceHealth, type MonitorHealthObservation } from "./service-health.js";

// A transaction can supply the same select interface as the database.
type HealthReader = Pick<Database, "select">;

async function readServiceSummaries(reader: HealthReader, now: Date, serviceId?: string): Promise<ServiceHealthSummary[]> {
  // Same deterministic ordering as getRecentHealthChecks(monitorId, 1), used by
  // GET /monitors/:monitorId/status. PostgreSQL compares the bigint ID numerically.
  const latestCheck = reader.select({ healthy: healthChecks.healthy })
    .from(healthChecks)
    .where(eq(healthChecks.monitorId, monitors.id))
    .orderBy(desc(healthChecks.checkedAt), desc(healthChecks.id))
    .limit(1);
  const latestCheckedAt = reader.select({ checkedAt: healthChecks.checkedAt })
    .from(healthChecks)
    .where(eq(healthChecks.monitorId, monitors.id))
    .orderBy(desc(healthChecks.checkedAt), desc(healthChecks.id))
    .limit(1);
  const rows = await reader.select({
    serviceId: services.id,
    serviceName: services.name,
    projectId: services.projectId,
    projectName: projects.name,
    monitorId: monitors.id,
    enabled: monitors.enabled,
    latestHealthy: sql<boolean | null>`case when ${monitors.enabled} then (${latestCheck}) else null end`,
    checkedAt: sql<Date | null>`case when ${monitors.enabled} then (${latestCheckedAt}) else null end`.mapWith(healthChecks.checkedAt),
    intervalMs: monitors.intervalMs,
    timeoutMs: monitors.timeoutMs,
  })
    .from(services)
    .innerJoin(projects, eq(projects.id, services.projectId))
    .leftJoin(monitors, eq(monitors.serviceId, services.id))
    .where(serviceId === undefined ? undefined : eq(services.id, serviceId));

  const grouped = new Map<string, {
    service: ServiceHealthSummary["service"];
    project: ServiceHealthSummary["project"];
    observations: MonitorHealthObservation[];
  }>();
  for (const row of rows) {
    let group = grouped.get(row.serviceId);
    if (!group) {
      group = {
        service: { id: row.serviceId, name: row.serviceName, projectId: row.projectId },
        project: { id: row.projectId, name: row.projectName },
        observations: [],
      };
      grouped.set(row.serviceId, group);
    }
    if (row.monitorId !== null) {
      group.observations.push({
        enabled: row.enabled === true, latestHealthy: row.latestHealthy, checkedAt: row.checkedAt,
        intervalMs: row.intervalMs!, timeoutMs: row.timeoutMs!,
      });
    }
  }
  return [...grouped.values()].map(({ service, project, observations }) => ({
    service, project, health: aggregateServiceHealth(service.id, observations, now),
  }));
}

function safeCount(value: string): number {
  const count = BigInt(value);
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Overview count exceeds the safe integer range");
  }
  return Number(count);
}

export function createHealthRepository(db: Database, clock: () => Date = () => new Date()) {
  return {
    async getServiceHealth(serviceId: string, now = clock()): Promise<ServiceHealth | null> {
      const summaries = await readServiceSummaries(db, now, serviceId);
      return summaries[0]?.health ?? null;
    },

    async getOverview(now = clock()): Promise<Overview> {
      // All counts and observations belong to one snapshot even if worker writes
      // or resource creation occur during this multi-query read.
      return db.transaction(async tx => {
        const summaries = await readServiceSummaries(tx, now);
        const [projectCount] = await tx.select({ count: sql<string>`count(*)` }).from(projects);
        const [incidentCount] = await tx.select({ count: sql<string>`count(*)` })
          .from(incidents).where(eq(incidents.status, "open"));
        return aggregateOverview(summaries, {
          projects: safeCount(projectCount.count), openIncidents: safeCount(incidentCount.count),
        });
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
  };
}
