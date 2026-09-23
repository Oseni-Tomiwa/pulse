import type { HttpMonitor } from "@pulse/contracts";
import { describe, expect, it, vi } from "vitest";
import { runMonitoringCycle, type MonitorExecutionResult } from "./run-monitoring-cycle.js";

function monitor(id: string): HttpMonitor {
  return {
    id,
    serviceId: "service-1",
    name: id,
    kind: "http",
    url: `https://example.invalid/${id}`,
    method: "GET",
    intervalMs: 60_000,
    timeoutMs: 10_000,
    failureThreshold: 3,
    recoveryThreshold: 1,
    enabled: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function execution(healthy = true): MonitorExecutionResult {
  return {
    healthCheck: {
      healthy,
      statusCode: healthy ? 200 : 503,
      latencyMs: 15,
      checkedAt: new Date("2026-01-01T12:00:01.000Z"),
      errorType: healthy ? null : "http_error",
      errorMessage: healthy ? null : "HTTP 503",
    },
    incidentDecision: "none",
    incidentWritten: false,
  };
}

const ranAt = new Date("2026-01-01T12:00:00.000Z");

describe("runMonitoringCycle", () => {
  it("returns an empty summary when no monitors are due", async () => {
    const summary = await runMonitoringCycle({
      now: () => ranAt,
      getDueHttpMonitors: vi.fn().mockResolvedValue([]),
      executeHttpMonitor: vi.fn(),
    });

    expect(summary).toEqual({ ranAt: ranAt.toISOString(), dueCount: 0, succeededCount: 0, failedCount: 0, executions: [] });
  });

  it("executes one due monitor once and reports success", async () => {
    const due = monitor("monitor-1");
    const result = execution();
    const executeHttpMonitor = vi.fn().mockResolvedValue(result);
    const summary = await runMonitoringCycle({
      now: () => ranAt,
      getDueHttpMonitors: vi.fn().mockResolvedValue([due]),
      executeHttpMonitor,
    });

    expect(executeHttpMonitor).toHaveBeenCalledOnce();
    expect(executeHttpMonitor).toHaveBeenCalledWith(due);
    expect(summary).toEqual({
      ranAt: ranAt.toISOString(), dueCount: 1, succeededCount: 1, failedCount: 0,
      executions: [{ monitorId: due.id, status: "succeeded", result }],
    });
  });

  it("passes the captured current time to due-monitor discovery", async () => {
    const getDueHttpMonitors = vi.fn().mockResolvedValue([]);
    await runMonitoringCycle({ now: () => ranAt, getDueHttpMonitors, executeHttpMonitor: vi.fn() });
    expect(getDueHttpMonitors).toHaveBeenCalledWith(ranAt);
  });

  it("executes multiple monitors sequentially in discovery order", async () => {
    const monitors = [monitor("monitor-1"), monitor("monitor-2"), monitor("monitor-3")];
    const calls: string[] = [];
    const executeHttpMonitor = vi.fn(async (current: HttpMonitor) => {
      calls.push(`start:${current.id}`);
      await Promise.resolve();
      calls.push(`end:${current.id}`);
      return execution();
    });

    const summary = await runMonitoringCycle({
      now: () => ranAt,
      getDueHttpMonitors: vi.fn().mockResolvedValue(monitors),
      executeHttpMonitor,
    });

    expect(calls).toEqual([
      "start:monitor-1", "end:monitor-1",
      "start:monitor-2", "end:monitor-2",
      "start:monitor-3", "end:monitor-3",
    ]);
    expect(summary.succeededCount).toBe(3);
  });

  it("records a thrown execution as a serializable failure", async () => {
    const due = monitor("monitor-1");
    const summary = await runMonitoringCycle({
      now: () => ranAt,
      getDueHttpMonitors: vi.fn().mockResolvedValue([due]),
      executeHttpMonitor: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });

    expect(summary).toEqual({
      ranAt: ranAt.toISOString(), dueCount: 1, succeededCount: 0, failedCount: 1,
      executions: [{ monitorId: due.id, status: "failed", error: { name: "Error", message: "database unavailable" } }],
    });
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it("continues with later monitors after one execution fails", async () => {
    const monitors = [monitor("monitor-1"), monitor("monitor-2")];
    const executeHttpMonitor = vi.fn()
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce(execution());

    const summary = await runMonitoringCycle({
      now: () => ranAt,
      getDueHttpMonitors: vi.fn().mockResolvedValue(monitors),
      executeHttpMonitor,
    });

    expect(executeHttpMonitor).toHaveBeenCalledTimes(2);
    expect(summary.succeededCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.executions.map((item) => item.monitorId)).toEqual(["monitor-1", "monitor-2"]);
  });

  it("counts an unhealthy non-throwing execution as succeeded", async () => {
    const summary = await runMonitoringCycle({
      now: () => ranAt,
      getDueHttpMonitors: vi.fn().mockResolvedValue([monitor("monitor-1")]),
      executeHttpMonitor: vi.fn().mockResolvedValue(execution(false)),
    });

    expect(summary.succeededCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    expect(summary.executions[0]?.status).toBe("succeeded");
  });

  it("normalizes non-Error thrown values", async () => {
    const summary = await runMonitoringCycle({
      now: () => ranAt,
      getDueHttpMonitors: vi.fn().mockResolvedValue([monitor("monitor-1")]),
      executeHttpMonitor: vi.fn().mockRejectedValue("unavailable"),
    });
    expect(summary.executions[0]).toMatchObject({ error: { name: "UnknownError", message: "unavailable" } });
  });

  it("propagates due-monitor discovery failure", async () => {
    const failure = new Error("discovery failed");
    const executeHttpMonitor = vi.fn();
    await expect(runMonitoringCycle({
      now: () => ranAt,
      getDueHttpMonitors: vi.fn().mockRejectedValue(failure),
      executeHttpMonitor,
    })).rejects.toBe(failure);
    expect(executeHttpMonitor).not.toHaveBeenCalled();
  });
});
