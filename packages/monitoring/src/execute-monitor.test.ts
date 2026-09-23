import type { HttpMonitor } from "@pulse/contracts";
import { describe, expect, it, vi } from "vitest";
import type { HttpCheckResult } from "./check-http.js";
import { executeHttpMonitor } from "./execute-monitor.js";

const monitor: HttpMonitor = {
  id: "monitor-1",
  serviceId: "service-1",
  name: "API health",
  kind: "http",
  url: "https://example.invalid/health",
  method: "GET",
  intervalMs: 60_000,
  timeoutMs: 10_000,
  failureThreshold: 3,
  recoveryThreshold: 1,
  enabled: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const healthyResult: HttpCheckResult = {
  healthy: true,
  statusCode: 200,
  latencyMs: 12,
  checkedAt: new Date("2026-01-01T12:00:00.000Z"),
  errorType: null,
  errorMessage: null,
};

const unhealthyResult: HttpCheckResult = {
  healthy: false,
  statusCode: 503,
  latencyMs: 20,
  checkedAt: new Date("2026-01-01T12:00:00.000Z"),
  errorType: "http_error",
  errorMessage: "HTTP 503",
};

function setup(options: {
  checkResult?: HttpCheckResult;
  outcomes?: boolean[];
  incidentOpen?: boolean;
  openWritten?: boolean;
  resolveWritten?: boolean;
} = {}) {
  const checkHttp = vi.fn().mockResolvedValue(options.checkResult ?? healthyResult);
  const persistence = {
    insertHealthCheck: vi.fn().mockResolvedValue(41n),
    getRecentCheckOutcomes: vi.fn().mockResolvedValue(options.outcomes ?? [true]),
    getOpenIncident: vi.fn().mockResolvedValue(options.incidentOpen ? { id: "incident-1" } : null),
    openIncident: vi.fn().mockResolvedValue(options.openWritten === false ? null : { id: "incident-1" }),
    resolveOpenIncident: vi.fn().mockResolvedValue(options.resolveWritten === false ? null : { id: "incident-1" }),
  };
  return { checkHttp, persistence };
}

describe("executeHttpMonitor", () => {
  it("runs and persists a healthy check", async () => {
    const dependencies = setup();
    const result = await executeHttpMonitor(monitor, dependencies);

    expect(dependencies.checkHttp).toHaveBeenCalledWith(monitor.url, monitor.timeoutMs);
    expect(dependencies.persistence.insertHealthCheck).toHaveBeenCalledWith({ monitorId: monitor.id, ...healthyResult });
    expect(result).toEqual({ healthCheck: healthyResult, incidentDecision: "none", incidentWritten: false });
  });

  it("persists an unhealthy HTTP result without throwing", async () => {
    const dependencies = setup({ checkResult: unhealthyResult, outcomes: [false] });
    const result = await executeHttpMonitor(monitor, dependencies);

    expect(dependencies.persistence.insertHealthCheck).toHaveBeenCalledWith({ monitorId: monitor.id, ...unhealthyResult });
    expect(result.healthCheck).toBe(unhealthyResult);
  });

  it("requests an incident open on the third consecutive failure", async () => {
    const dependencies = setup({ checkResult: unhealthyResult, outcomes: [false, false, false] });
    const result = await executeHttpMonitor(monitor, dependencies);

    expect(dependencies.persistence.openIncident).toHaveBeenCalledWith(monitor.id, unhealthyResult.checkedAt);
    expect(result).toEqual({ healthCheck: unhealthyResult, incidentDecision: "open", incidentWritten: true });
  });

  it("does not open below the failure threshold", async () => {
    const dependencies = setup({ checkResult: unhealthyResult, outcomes: [false, false] });
    const result = await executeHttpMonitor(monitor, dependencies);

    expect(result.incidentDecision).toBe("none");
    expect(dependencies.persistence.openIncident).not.toHaveBeenCalled();
  });

  it("does not request a duplicate open incident", async () => {
    const dependencies = setup({ checkResult: unhealthyResult, outcomes: [false, false, false, false], incidentOpen: true });
    const result = await executeHttpMonitor(monitor, dependencies);

    expect(result.incidentDecision).toBe("none");
    expect(dependencies.persistence.openIncident).not.toHaveBeenCalled();
  });

  it("resolves an open incident after a successful recovery", async () => {
    const dependencies = setup({ outcomes: [true], incidentOpen: true });
    const result = await executeHttpMonitor(monitor, dependencies);

    expect(dependencies.persistence.resolveOpenIncident).toHaveBeenCalledWith(monitor.id, healthyResult.checkedAt);
    expect(result).toEqual({ healthCheck: healthyResult, incidentDecision: "resolve", incidentWritten: true });
  });

  it("respects a recovery threshold greater than one", async () => {
    const configured = { ...monitor, recoveryThreshold: 2 };
    const waiting = setup({ outcomes: [true, false], incidentOpen: true });
    expect((await executeHttpMonitor(configured, waiting)).incidentDecision).toBe("none");

    const recovered = setup({ outcomes: [true, true], incidentOpen: true });
    expect((await executeHttpMonitor(configured, recovered)).incidentDecision).toBe("resolve");
  });

  it("persists the current check before loading decision inputs", async () => {
    const dependencies = setup({ checkResult: unhealthyResult, outcomes: [false, false, false] });
    const calls: string[] = [];
    dependencies.persistence.insertHealthCheck.mockImplementation(async () => { calls.push("insert"); return 41n; });
    dependencies.persistence.getRecentCheckOutcomes.mockImplementation(async () => { calls.push("outcomes"); return [false, false, false]; });
    dependencies.persistence.getOpenIncident.mockImplementation(async () => { calls.push("incident"); return null; });

    await executeHttpMonitor(monitor, dependencies);
    expect(calls).toEqual(["insert", "outcomes", "incident"]);
  });

  it("performs no incident mutation for a none decision", async () => {
    const dependencies = setup({ outcomes: [true], incidentOpen: false });
    const result = await executeHttpMonitor(monitor, dependencies);

    expect(result.incidentWritten).toBe(false);
    expect(dependencies.persistence.openIncident).not.toHaveBeenCalled();
    expect(dependencies.persistence.resolveOpenIncident).not.toHaveBeenCalled();
  });

  it("reports when a concurrent incident write did not occur", async () => {
    const dependencies = setup({ checkResult: unhealthyResult, outcomes: [false, false, false], openWritten: false });
    const result = await executeHttpMonitor(monitor, dependencies);
    expect(result).toEqual({ healthCheck: unhealthyResult, incidentDecision: "open", incidentWritten: false });
  });

  it("propagates repository failures and stops later operations", async () => {
    const dependencies = setup();
    const failure = new Error("database unavailable");
    dependencies.persistence.insertHealthCheck.mockRejectedValue(failure);

    await expect(executeHttpMonitor(monitor, dependencies)).rejects.toBe(failure);
    expect(dependencies.persistence.getRecentCheckOutcomes).not.toHaveBeenCalled();
    expect(dependencies.persistence.getOpenIncident).not.toHaveBeenCalled();
  });
});
