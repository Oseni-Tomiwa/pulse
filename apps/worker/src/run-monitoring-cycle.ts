import type { HealthCheckErrorType, HttpMonitor } from "@pulse/contracts";

export type MonitorExecutionResult = {
  healthCheck: {
    healthy: boolean;
    statusCode: number | null;
    latencyMs: number;
    checkedAt: Date;
    errorType: HealthCheckErrorType | null;
    errorMessage: string | null;
  };
  incidentDecision: "none" | "open" | "resolve";
  incidentWritten: boolean;
};

export type MonitoringCycleDependencies = {
  now(): Date;
  getDueHttpMonitors(asOf: Date): Promise<HttpMonitor[]>;
  executeHttpMonitor(monitor: HttpMonitor): Promise<MonitorExecutionResult>;
};

type SerializableError = {
  name: string;
  message: string;
};

export type MonitorCycleExecution =
  | {
      monitorId: string;
      status: "succeeded";
      result: MonitorExecutionResult;
    }
  | {
      monitorId: string;
      status: "failed";
      error: SerializableError;
    };

export type MonitoringCycleSummary = {
  ranAt: string;
  dueCount: number;
  succeededCount: number;
  failedCount: number;
  executions: MonitorCycleExecution[];
};

function serializeError(error: unknown): SerializableError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  return { name: "UnknownError", message: String(error) };
}

export async function runMonitoringCycle({
  now,
  getDueHttpMonitors,
  executeHttpMonitor,
}: MonitoringCycleDependencies): Promise<MonitoringCycleSummary> {
  const ranAt = now();
  const dueMonitors = await getDueHttpMonitors(ranAt);
  const executions: MonitorCycleExecution[] = [];

  for (const monitor of dueMonitors) {
    try {
      const result = await executeHttpMonitor(monitor);
      executions.push({ monitorId: monitor.id, status: "succeeded", result });
    } catch (error) {
      executions.push({
        monitorId: monitor.id,
        status: "failed",
        error: serializeError(error),
      });
    }
  }

  const failedCount = executions.filter(
    (execution) => execution.status === "failed",
  ).length;

  return {
    ranAt: ranAt.toISOString(),
    dueCount: dueMonitors.length,
    succeededCount: executions.length - failedCount,
    failedCount,
    executions,
  };
}
