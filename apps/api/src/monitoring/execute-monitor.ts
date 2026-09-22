import type { HttpMonitor } from "@pulse/contracts";
import type { HttpCheckResult } from "./check-http.js";
import {
  decideIncidentAction,
  type IncidentAction,
  type IncidentDecisionInput,
} from "./decide-incident.js";

type IncidentRecord = { id: string };

export type MonitorPersistence = {
  insertHealthCheck(check: { monitorId: string } & HttpCheckResult): Promise<bigint>;
  getRecentCheckOutcomes(monitorId: string, limit: number): Promise<boolean[]>;
  getOpenIncident(monitorId: string): Promise<IncidentRecord | null>;
  openIncident(monitorId: string, startedAt: Date): Promise<IncidentRecord | null>;
  resolveOpenIncident(monitorId: string, resolvedAt: Date): Promise<IncidentRecord | null>;
};

export type ExecuteHttpMonitorDependencies = {
  checkHttp(url: string, timeoutMs: number): Promise<HttpCheckResult>;
  persistence: MonitorPersistence;
  decideIncident?: (input: IncidentDecisionInput) => IncidentAction;
};

export type MonitorExecutionResult = {
  healthCheck: HttpCheckResult;
  incidentDecision: IncidentAction;
  incidentWritten: boolean;
};

export async function executeHttpMonitor(
  monitor: HttpMonitor,
  {
    checkHttp,
    persistence,
    decideIncident = decideIncidentAction,
  }: ExecuteHttpMonitorDependencies,
): Promise<MonitorExecutionResult> {
  const healthCheck = await checkHttp(monitor.url, monitor.timeoutMs);

  await persistence.insertHealthCheck({
    monitorId: monitor.id,
    ...healthCheck,
  });

  const historyLimit = Math.max(
    monitor.failureThreshold,
    monitor.recoveryThreshold,
  );
  const recentChecks = await persistence.getRecentCheckOutcomes(
    monitor.id,
    historyLimit,
  );
  const openIncident = await persistence.getOpenIncident(monitor.id);
  const incidentDecision = decideIncident({
    recentChecks,
    incidentOpen: openIncident !== null,
    failureThreshold: monitor.failureThreshold,
    recoveryThreshold: monitor.recoveryThreshold,
  });

  let incidentWritten = false;
  if (incidentDecision === "open") {
    incidentWritten =
      (await persistence.openIncident(monitor.id, healthCheck.checkedAt)) !== null;
  } else if (incidentDecision === "resolve") {
    incidentWritten =
      (await persistence.resolveOpenIncident(monitor.id, healthCheck.checkedAt)) !== null;
  }

  return { healthCheck, incidentDecision, incidentWritten };
}
