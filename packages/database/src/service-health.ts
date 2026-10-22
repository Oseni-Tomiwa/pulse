import type { Overview, ServiceHealth, ServiceHealthSummary } from "@pulse/contracts";

export type MonitorHealthObservation = {
  enabled: boolean;
  // null means no persisted HealthCheck, not an unhealthy outcome.
  latestHealthy: boolean | null;
};

export function aggregateServiceHealth(
  serviceId: string,
  observations: readonly MonitorHealthObservation[],
): ServiceHealth {
  const monitors: ServiceHealth["monitors"] = {
    total: observations.length, enabled: 0, reporting: 0,
    healthy: 0, unhealthy: 0, unknown: 0, disabled: 0,
  };
  for (const observation of observations) {
    if (!observation.enabled) {
      monitors.disabled += 1;
      continue;
    }
    monitors.enabled += 1;
    if (observation.latestHealthy === null) monitors.unknown += 1;
    else if (observation.latestHealthy) monitors.healthy += 1;
    else monitors.unhealthy += 1;
  }
  monitors.reporting = monitors.healthy + monitors.unhealthy;
  const state = monitors.enabled === 0 || monitors.reporting === 0 ? "unknown"
    : monitors.unhealthy === 0 ? "healthy"
      : monitors.healthy === 0 ? "down" : "degraded";
  return { serviceId, state, monitors, coverage: { reporting: monitors.reporting, enabled: monitors.enabled } };
}

const attentionPriority = { down: 0, degraded: 1, unknown: 2, healthy: 3 };
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function aggregateOverview(
  services: readonly ServiceHealthSummary[],
  counts: { projects: number; openIncidents: number },
): Overview {
  const result: Overview = {
    totals: { ...counts, services: services.length, monitors: 0, enabledMonitors: 0 },
    serviceHealth: { healthy: 0, degraded: 0, down: 0, unknown: 0 },
    attention: [],
  };
  for (const entry of services) {
    result.totals.monitors += entry.health.monitors.total;
    result.totals.enabledMonitors += entry.health.monitors.enabled;
    result.serviceHealth[entry.health.state] += 1;
    if (entry.health.state !== "healthy") result.attention.push(entry);
  }
  result.attention.sort((left, right) =>
    attentionPriority[left.health.state] - attentionPriority[right.health.state] ||
    compareText(left.service.name, right.service.name) ||
    compareText(left.service.id, right.service.id));
  return result;
}
