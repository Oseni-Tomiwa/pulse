import { randomUUID } from "node:crypto";
import type {
  HealthCheck,
  HttpMonitor,
  Incident,
  Project,
  Service,
} from "@pulse/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildApp,
  type AppRepositories,
  type MonitorRepository,
  type MonitoringReadRepository,
  type ProjectRepository,
  type ServiceRepository,
} from "./app.js";

const openApps: ReturnType<typeof buildApp>[] = [];

function project(name: string, createdAt = new Date("2026-01-01T12:00:00.000Z")): Project {
  return { id: randomUUID(), name, createdAt };
}

function fakeProjectRepository(initialProjects: Project[] = []): ProjectRepository {
  const stored = [...initialProjects];
  return {
    async createProject(name) {
      const created = project(name);
      stored.unshift(created);
      return created;
    },
    async listProjects() {
      return [...stored];
    },
    async getProjectById(id) {
      return stored.find((candidate) => candidate.id === id) ?? null;
    },
  };
}

function service(
  projectId: string,
  name: string,
  createdAt = new Date("2026-01-01T12:00:00.000Z"),
): Service {
  return { id: randomUUID(), projectId, name, createdAt };
}

function fakeServiceRepository(initialServices: Service[] = []): ServiceRepository {
  const stored = [...initialServices];
  return {
    async createService(projectId, name) {
      const created = service(projectId, name);
      stored.unshift(created);
      return created;
    },
    async listServicesByProjectId(projectId) {
      return stored.filter((candidate) => candidate.projectId === projectId);
    },
    async getServiceById(id) {
      return stored.find((candidate) => candidate.id === id) ?? null;
    },
  };
}

function monitor(
  serviceId: string,
  name: string,
  overrides: Partial<HttpMonitor> = {},
): HttpMonitor {
  return {
    id: randomUUID(),
    serviceId,
    name,
    kind: "http",
    url: "https://example.com/health",
    method: "GET",
    intervalMs: 60_000,
    timeoutMs: 10_000,
    failureThreshold: 3,
    recoveryThreshold: 1,
    enabled: true,
    createdAt: new Date("2026-01-01T12:00:00.000Z"),
    ...overrides,
  };
}

function fakeMonitorRepository(initialMonitors: HttpMonitor[] = []): MonitorRepository {
  const stored = [...initialMonitors];
  return {
    async createMonitor(input) {
      const overrides: Partial<HttpMonitor> = { url: input.url };
      if (input.method !== undefined) overrides.method = input.method;
      if (input.intervalMs !== undefined) overrides.intervalMs = input.intervalMs;
      if (input.timeoutMs !== undefined) overrides.timeoutMs = input.timeoutMs;
      if (input.failureThreshold !== undefined) {
        overrides.failureThreshold = input.failureThreshold;
      }
      if (input.recoveryThreshold !== undefined) {
        overrides.recoveryThreshold = input.recoveryThreshold;
      }
      if (input.enabled !== undefined) overrides.enabled = input.enabled;
      const created = monitor(input.serviceId, input.name, overrides);
      stored.unshift(created);
      return created;
    },
    async listMonitorsByServiceId(serviceId) {
      return stored.filter((candidate) => candidate.serviceId === serviceId);
    },
    async getMonitorById(id) {
      return stored.find((candidate) => candidate.id === id) ?? null;
    },
  };
}

function healthCheck(
  monitorId: string,
  id: string,
  healthy: boolean,
  checkedAt = new Date("2026-01-01T12:00:00.000Z"),
): HealthCheck {
  return {
    id,
    monitorId,
    healthy,
    statusCode: healthy ? 204 : 500,
    latencyMs: 12,
    checkedAt,
    errorType: healthy ? null : "http_error",
    errorMessage: healthy ? null : "HTTP 500",
  };
}

function incident(
  monitorId: string,
  status: Incident["status"],
  startedAt = new Date("2026-01-01T12:00:00.000Z"),
): Incident {
  return {
    id: randomUUID(),
    monitorId,
    status,
    startedAt,
    resolvedAt: status === "resolved"
      ? new Date(startedAt.getTime() + 60_000)
      : null,
  };
}

function fakeMonitoringReadRepository(
  initialChecks: HealthCheck[] = [],
  initialIncidents: Incident[] = [],
  uptimeCounts = { totalChecks: 0, healthyChecks: 0 },
): MonitoringReadRepository {
  return {
    async getRecentHealthChecks(monitorId, limit) {
      return initialChecks
        .filter((check) => check.monitorId === monitorId)
        .slice(0, limit);
    },
    async getRecentIncidents(monitorId, limit) {
      return initialIncidents
        .filter((candidate) => candidate.monitorId === monitorId)
        .slice(0, limit);
    },
    async getOpenIncident(monitorId) {
      return initialIncidents.find(
        (candidate) => candidate.monitorId === monitorId && candidate.status === "open",
      ) ?? null;
    },
    async getCheckBasedUptimeCounts() {
      return uptimeCounts;
    },
  };
}

function repositories(
  initialProjects: Project[] = [],
  initialServices: Service[] = [],
  initialMonitors: HttpMonitor[] = [],
  initialChecks: HealthCheck[] = [],
  initialIncidents: Incident[] = [],
  uptimeCounts = { totalChecks: 0, healthyChecks: 0 },
): AppRepositories {
  return {
    projects: fakeProjectRepository(initialProjects),
    services: fakeServiceRepository(initialServices),
    monitors: fakeMonitorRepository(initialMonitors),
    monitoring: fakeMonitoringReadRepository(
      initialChecks,
      initialIncidents,
      uptimeCounts,
    ),
  };
}

function app(
  dependencies: AppRepositories = repositories(),
  now: () => Date = () => new Date(),
) {
  const instance = buildApp(dependencies, { logger: false }, now);
  openApps.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((instance) => instance.close()));
});

describe("check-based uptime route", () => {
  const fixedTo = new Date("2026-09-26T15:00:00.000Z");

  it("defaults to an exact trailing 24-hour window and captures time once", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const dependencies = repositories(
      [parentProject], [parentService], [existing], [], [],
      { totalChecks: 4, healthyChecks: 3 },
    );
    let nowCalls = 0;
    let observed: { monitorId: string; from: Date; to: Date } | undefined;
    dependencies.monitoring.getCheckBasedUptimeCounts = async (monitorId, from, to) => {
      observed = { monitorId, from, to };
      return { totalChecks: 4, healthyChecks: 3 };
    };

    const response = await app(dependencies, () => {
      nowCalls += 1;
      return fixedTo;
    }).inject({ method: "GET", url: `/monitors/${existing.id}/uptime` });

    expect(response.statusCode).toBe(200);
    expect(nowCalls).toBe(1);
    expect(observed).toEqual({
      monitorId: existing.id,
      from: new Date("2026-09-25T15:00:00.000Z"),
      to: fixedTo,
    });
    expect(response.json()).toEqual({
      monitorId: existing.id,
      window: "24h",
      from: "2026-09-25T15:00:00.000Z",
      to: "2026-09-26T15:00:00.000Z",
      totalChecks: 4,
      healthyChecks: 3,
      unhealthyChecks: 1,
      uptimePercentage: 75,
    });
  });

  it.each([
    ["24h", "2026-09-25T15:00:00.000Z"],
    ["7d", "2026-09-19T15:00:00.000Z"],
    ["30d", "2026-08-27T15:00:00.000Z"],
  ])("supports the %s elapsed window", async (window, expectedFrom) => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const response = await app(
      repositories([parentProject], [parentService], [existing]),
      () => fixedTo,
    ).inject({
      method: "GET",
      url: `/monitors/${existing.id}/uptime?window=${window}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      window,
      from: expectedFrom,
      to: fixedTo.toISOString(),
    });
  });

  it.each([
    [3, 3, 100],
    [4, 3, 75],
    [3, 0, 0],
    [3, 1, 33.3333],
    [1440, 1437, 99.7917],
    [0, 0, null],
  ])(
    "derives %s total and %s healthy as %s percent",
    async (totalChecks, healthyChecks, uptimePercentage) => {
      const parentProject = project("Pulse");
      const parentService = service(parentProject.id, "API");
      const existing = monitor(parentService.id, "API health");
      const response = await app(
        repositories(
          [parentProject], [parentService], [existing], [], [],
          { totalChecks, healthyChecks },
        ),
        () => fixedTo,
      ).inject({ method: "GET", url: `/monitors/${existing.id}/uptime` });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        totalChecks,
        healthyChecks,
        unhealthyChecks: totalChecks - healthyChecks,
        uptimePercentage,
      });
    },
  );

  it.each(["1h", "24H", "", "custom"])(
    "rejects invalid uptime window %j",
    async (window) => {
      const parentProject = project("Pulse");
      const parentService = service(parentProject.id, "API");
      const existing = monitor(parentService.id, "API health");
      const response = await app(repositories(
        [parentProject], [parentService], [existing],
      )).inject({
        method: "GET",
        url: `/monitors/${existing.id}/uptime?window=${window}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "window must be 24h, 7d, or 30d" });
    },
  );

  it("rejects a repeated uptime window", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const response = await app(repositories(
      [parentProject], [parentService], [existing],
    )).inject({
      method: "GET",
      url: `/monitors/${existing.id}/uptime?window=24h&window=7d`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "window must be 24h, 7d, or 30d" });
  });

  it("returns 400 for an invalid Monitor ID", async () => {
    const response = await app().inject({ method: "GET", url: "/monitors/not-a-uuid/uptime" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid monitor ID" });
  });

  it("returns 404 before aggregating an unknown Monitor", async () => {
    const dependencies = repositories();
    let aggregateCalls = 0;
    dependencies.monitoring.getCheckBasedUptimeCounts = async () => {
      aggregateCalls += 1;
      return { totalChecks: 0, healthyChecks: 0 };
    };
    const response = await app(dependencies).inject({
      method: "GET",
      url: `/monitors/${randomUUID()}/uptime`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Monitor not found" });
    expect(aggregateCalls).toBe(0);
  });

  it("sanitizes uptime repository failures", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const dependencies = repositories([parentProject], [parentService], [existing]);
    dependencies.monitoring.getCheckBasedUptimeCounts = async () => {
      throw new Error("postgresql://admin:secret@example.invalid/pulse");
    };
    const response = await app(dependencies).inject({
      method: "GET",
      url: `/monitors/${existing.id}/uptime`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal Server Error" });
    expect(response.body).not.toContain("secret");
  });
});

describe("monitoring read routes", () => {
  it("returns the newest 50 Health Checks by default with decimal-string IDs", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const checks = Array.from({ length: 55 }, (_, index) =>
      healthCheck(existing.id, String(9_007_199_254_740_993n - BigInt(index)), index % 2 === 0),
    );
    const response = await app(repositories(
      [parentProject], [parentService], [existing], checks,
    )).inject({ method: "GET", url: `/monitors/${existing.id}/checks` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(50);
    expect(response.json()[0].id).toBe("9007199254740993");
    expect(typeof response.json()[0].id).toBe("string");
  });

  it("respects an explicit Health Check limit", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const checks = [
      healthCheck(existing.id, "3", true),
      healthCheck(existing.id, "2", false),
      healthCheck(existing.id, "1", true),
    ];
    const response = await app(repositories(
      [parentProject], [parentService], [existing], checks,
    )).inject({ method: "GET", url: `/monitors/${existing.id}/checks?limit=2` });

    expect(response.statusCode).toBe(200);
    expect(response.json().map(({ id }: { id: string }) => id)).toEqual(["3", "2"]);
  });

  it("returns an empty Health Check history when no evidence exists", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const response = await app(repositories(
      [parentProject], [parentService], [existing],
    )).inject({ method: "GET", url: `/monitors/${existing.id}/checks` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it.each(["0", "-1", "1.5", "201", "9007199254740992", "abc", "01"])(
    "rejects invalid history limit %s",
    async (limit) => {
      const parentProject = project("Pulse");
      const parentService = service(parentProject.id, "API");
      const existing = monitor(parentService.id, "API health");
      const response = await app(repositories(
        [parentProject], [parentService], [existing],
      )).inject({
        method: "GET",
        url: `/monitors/${existing.id}/checks?limit=${limit}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "limit must be an integer between 1 and 200" });
    },
  );

  it("rejects a repeated history limit", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const response = await app(repositories(
      [parentProject], [parentService], [existing],
    )).inject({
      method: "GET",
      url: `/monitors/${existing.id}/checks?limit=1&limit=2`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "limit must be an integer between 1 and 200" });
  });

  it("returns bounded Incident history in repository order", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const open = incident(existing.id, "open", new Date("2026-01-02T12:00:00Z"));
    const resolved = incident(existing.id, "resolved", new Date("2026-01-01T12:00:00Z"));
    const older = incident(existing.id, "resolved", new Date("2025-12-31T12:00:00Z"));
    const response = await app(repositories(
      [parentProject], [parentService], [existing], [], [open, resolved, older],
    )).inject({ method: "GET", url: `/monitors/${existing.id}/incidents?limit=2` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        ...open,
        startedAt: open.startedAt.toISOString(),
        resolvedAt: null,
      },
      {
        ...resolved,
        startedAt: resolved.startedAt.toISOString(),
        resolvedAt: resolved.resolvedAt?.toISOString(),
      },
    ]);
  });

  it("returns an empty Incident history when none exists", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const response = await app(repositories(
      [parentProject], [parentService], [existing],
    )).inject({ method: "GET", url: `/monitors/${existing.id}/incidents` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("returns unknown status only when no Health Check exists", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const response = await app(repositories(
      [parentProject], [parentService], [existing],
    )).inject({ method: "GET", url: `/monitors/${existing.id}/status` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      monitorId: existing.id,
      probeStatus: "unknown",
      latestCheck: null,
      openIncident: null,
    });
  });

  it("reports an unhealthy probe without implying an Incident is open", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const latest = healthCheck(existing.id, "1", false);
    const response = await app(repositories(
      [parentProject], [parentService], [existing], [latest],
    )).inject({ method: "GET", url: `/monitors/${existing.id}/status` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      probeStatus: "unhealthy",
      latestCheck: { id: "1", healthy: false },
      openIncident: null,
    });
  });

  it("preserves a healthy latest probe alongside an open Incident", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health", { recoveryThreshold: 2 });
    const latest = healthCheck(existing.id, "2", true);
    const open = incident(existing.id, "open");
    const response = await app(repositories(
      [parentProject], [parentService], [existing], [latest], [open],
    )).inject({ method: "GET", url: `/monitors/${existing.id}/status` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      probeStatus: "healthy",
      latestCheck: { id: "2", healthy: true },
      openIncident: { id: open.id, status: "open" },
    });
  });

  it.each(["checks", "incidents", "status"])(
    "returns 404 before querying %s evidence for an unknown Monitor",
    async (resource) => {
      const response = await app().inject({
        method: "GET",
        url: `/monitors/${randomUUID()}/${resource}`,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Monitor not found" });
    },
  );

  it("returns 400 for an invalid Monitor ID", async () => {
    const response = await app().inject({ method: "GET", url: "/monitors/not-a-uuid/checks" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid monitor ID" });
  });

  it("sanitizes monitoring read repository errors", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const dependencies = repositories([parentProject], [parentService], [existing]);
    dependencies.monitoring.getRecentHealthChecks = async () => {
      throw new Error("postgresql://admin:secret@example.invalid/pulse");
    };
    const response = await app(dependencies).inject({
      method: "GET",
      url: `/monitors/${existing.id}/checks`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal Server Error" });
    expect(response.body).not.toContain("secret");
  });
});

describe("monitor routes", () => {
  it("creates an HTTP monitor with explicit configuration", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const response = await app(repositories([parentProject], [parentService])).inject({
      method: "POST",
      url: `/services/${parentService.id}/monitors`,
      payload: {
        name: "Production API",
        url: "https://example.com/health",
        method: "HEAD",
        intervalMs: 30_000,
        timeoutMs: 5_000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        enabled: false,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      serviceId: parentService.id,
      name: "Production API",
      kind: "http",
      url: "https://example.com/health",
      method: "HEAD",
      intervalMs: 30_000,
      timeoutMs: 5_000,
      failureThreshold: 2,
      recoveryThreshold: 2,
      enabled: false,
    });
  });

  it("uses persistence defaults when optional configuration is omitted", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const response = await app(repositories([parentProject], [parentService])).inject({
      method: "POST",
      url: `/services/${parentService.id}/monitors`,
      payload: { name: "API health", url: "https://example.com/health" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      method: "GET",
      intervalMs: 60_000,
      timeoutMs: 10_000,
      failureThreshold: 3,
      recoveryThreshold: 1,
      enabled: true,
    });
  });

  it("trims the monitor name and URL", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const dependencies = repositories([parentProject], [parentService]);
    const response = await app(dependencies).inject({
      method: "POST",
      url: `/services/${parentService.id}/monitors`,
      payload: { name: "  API health  ", url: "  https://example.com/health  " },
    });

    expect(response.statusCode).toBe(201);
    expect((await dependencies.monitors.listMonitorsByServiceId(parentService.id))[0])
      .toMatchObject({ name: "API health", url: "https://example.com/health" });
  });

  it.each(["GET", "HEAD"])("accepts the %s method", async (method) => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const response = await app(repositories([parentProject], [parentService])).inject({
      method: "POST",
      url: `/services/${parentService.id}/monitors`,
      payload: { name: "API", url: "https://example.com", method },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().method).toBe(method);
  });

  it.each([undefined, null, 42, { value: "API" }, "   "])(
    "rejects an invalid monitor name: %j",
    async (name) => {
      const parentProject = project("Pulse");
      const parentService = service(parentProject.id, "API");
      const response = await app(repositories([parentProject], [parentService])).inject({
        method: "POST",
        url: `/services/${parentService.id}/monitors`,
        payload: { name, url: "https://example.com" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Monitor name must be a non-empty string" });
    },
  );

  it.each([
    ["not a URL", "Monitor URL must be a valid HTTP or HTTPS URL"],
    ["ftp://example.com/health", "Monitor URL must be a valid HTTP or HTTPS URL"],
    [42, "Monitor URL must be a valid HTTP or HTTPS URL"],
  ])("rejects invalid monitor URL %j", async (url, error) => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const response = await app(repositories([parentProject], [parentService])).inject({
      method: "POST",
      url: `/services/${parentService.id}/monitors`,
      payload: { name: "API", url },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
  });

  it.each(["POST", "get", 42])("rejects invalid monitor method %j", async (method) => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const response = await app(repositories([parentProject], [parentService])).inject({
      method: "POST",
      url: `/services/${parentService.id}/monitors`,
      payload: { name: "API", url: "https://example.com", method },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Monitor method must be GET or HEAD" });
  });

  it.each(["intervalMs", "timeoutMs", "failureThreshold", "recoveryThreshold"])(
    "requires %s to be a positive safe integer when provided",
    async (field) => {
      const parentProject = project("Pulse");
      const parentService = service(parentProject.id, "API");
      for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
        const response = await app(repositories([parentProject], [parentService])).inject({
          method: "POST",
          url: `/services/${parentService.id}/monitors`,
          payload: { name: "API", url: "https://example.com", [field]: value },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: `${field} must be a positive safe integer`,
        });
      }
    },
  );

  it.each(["true", 1, null])("rejects invalid enabled value %j", async (enabled) => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const response = await app(repositories([parentProject], [parentService])).inject({
      method: "POST",
      url: `/services/${parentService.id}/monitors`,
      payload: { name: "API", url: "https://example.com", enabled },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Monitor enabled must be a boolean" });
  });

  it("rejects an invalid Service UUID", async () => {
    const response = await app().inject({
      method: "POST",
      url: "/services/not-a-uuid/monitors",
      payload: { name: "API", url: "https://example.com" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid service ID" });
  });

  it("returns 404 when creating under an unknown Service", async () => {
    const response = await app().inject({
      method: "POST",
      url: `/services/${randomUUID()}/monitors`,
      payload: { name: "API", url: "https://example.com" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Service not found" });
  });

  it("lists only monitors belonging to the requested Service", async () => {
    const parentProject = project("Pulse");
    const requested = service(parentProject.id, "API");
    const other = service(parentProject.id, "Worker");
    const newest = monitor(requested.id, "Newest", { createdAt: new Date("2026-01-02T00:00:00Z") });
    const older = monitor(requested.id, "Older", { createdAt: new Date("2026-01-01T00:00:00Z") });
    const foreign = monitor(other.id, "Foreign");
    const response = await app(repositories(
      [parentProject], [requested, other], [newest, older, foreign],
    )).inject({ method: "GET", url: `/services/${requested.id}/monitors` });

    expect(response.statusCode).toBe(200);
    expect(response.json().map(({ name }: { name: string }) => name)).toEqual(["Newest", "Older"]);
  });

  it("returns 404 when listing monitors for an unknown Service", async () => {
    const response = await app().inject({
      method: "GET",
      url: `/services/${randomUUID()}/monitors`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Service not found" });
  });

  it("retrieves an existing Monitor", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const existing = monitor(parentService.id, "API health");
    const response = await app(repositories(
      [parentProject], [parentService], [existing],
    )).inject({ method: "GET", url: `/monitors/${existing.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ...existing,
      createdAt: existing.createdAt.toISOString(),
    });
  });

  it("returns 404 for an unknown Monitor", async () => {
    const response = await app().inject({ method: "GET", url: `/monitors/${randomUUID()}` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Monitor not found" });
  });

  it("returns 400 for an invalid Monitor UUID", async () => {
    const response = await app().inject({ method: "GET", url: "/monitors/not-a-uuid" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid monitor ID" });
  });

  it("does not expose Monitor repository errors", async () => {
    const parentProject = project("Pulse");
    const parentService = service(parentProject.id, "API");
    const dependencies = repositories([parentProject], [parentService]);
    dependencies.monitors.listMonitorsByServiceId = async () => {
      throw new Error("postgresql://admin:secret@example.invalid/pulse");
    };
    const response = await app(dependencies).inject({
      method: "GET",
      url: `/services/${parentService.id}/monitors`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal Server Error" });
    expect(response.body).not.toContain("secret");
  });
});

describe("project routes", () => {
  it("creates a project", async () => {
    const response = await app().inject({
      method: "POST",
      url: "/projects",
      payload: { name: "My Project" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "My Project" });
    expect(response.json().id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.json().createdAt).toBe("2026-01-01T12:00:00.000Z");
  });

  it("trims a project name before persistence", async () => {
    const dependencies = repositories();
    const response = await app(dependencies).inject({
      method: "POST",
      url: "/projects",
      payload: { name: "  My Project  " },
    });

    expect(response.statusCode).toBe(201);
    expect((await dependencies.projects.listProjects())[0].name).toBe("My Project");
  });

  it("rejects an empty project name", async () => {
    const response = await app().inject({
      method: "POST",
      url: "/projects",
      payload: { name: "   " },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Project name must be a non-empty string" });
  });

  it.each([
    undefined,
    null,
    42,
    { value: "My Project" },
  ])("rejects a missing or invalid project name: %j", async (name) => {
    const response = await app().inject({
      method: "POST",
      url: "/projects",
      payload: name === undefined ? {} : { name },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Project name must be a non-empty string" });
  });

  it("lists projects in repository order", async () => {
    const newest = project("Newest", new Date("2026-01-02T12:00:00.000Z"));
    const older = project("Older", new Date("2026-01-01T12:00:00.000Z"));
    const response = await app(repositories([newest, older])).inject({
      method: "GET",
      url: "/projects",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map(({ name }: { name: string }) => name)).toEqual(["Newest", "Older"]);
  });

  it("retrieves an existing project", async () => {
    const existing = project("Existing");
    const response = await app(repositories([existing])).inject({
      method: "GET",
      url: `/projects/${existing.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ...existing,
      createdAt: existing.createdAt.toISOString(),
    });
  });

  it("returns 404 for an unknown project", async () => {
    const response = await app().inject({
      method: "GET",
      url: `/projects/${randomUUID()}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Project not found" });
  });

  it("returns 400 for an invalid project ID", async () => {
    const response = await app().inject({ method: "GET", url: "/projects/not-a-uuid" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid project ID" });
  });

  it("does not expose persistence errors", async () => {
    const dependencies = repositories();
    dependencies.projects.listProjects = async () => {
      throw new Error("postgresql://admin:secret@example.invalid/pulse");
    };
    const response = await app(dependencies).inject({ method: "GET", url: "/projects" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal Server Error" });
    expect(response.body).not.toContain("secret");
  });
});

describe("service routes", () => {
  it("creates a service under an existing project", async () => {
    const parent = project("Pulse");
    const response = await app(repositories([parent])).inject({
      method: "POST",
      url: `/projects/${parent.id}/services`,
      payload: { name: "API" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ projectId: parent.id, name: "API" });
    expect(response.json().id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.json().createdAt).toBe("2026-01-01T12:00:00.000Z");
  });

  it("trims a service name before persistence", async () => {
    const parent = project("Pulse");
    const dependencies = repositories([parent]);
    const response = await app(dependencies).inject({
      method: "POST",
      url: `/projects/${parent.id}/services`,
      payload: { name: "  API  " },
    });

    expect(response.statusCode).toBe(201);
    expect((await dependencies.services.listServicesByProjectId(parent.id))[0].name).toBe("API");
  });

  it.each([
    undefined,
    null,
    42,
    { value: "API" },
    "   ",
  ])("rejects an invalid service name: %j", async (name) => {
    const parent = project("Pulse");
    const response = await app(repositories([parent])).inject({
      method: "POST",
      url: `/projects/${parent.id}/services`,
      payload: name === undefined ? {} : { name },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Service name must be a non-empty string" });
  });

  it("rejects an invalid project ID when creating a service", async () => {
    const response = await app().inject({
      method: "POST",
      url: "/projects/not-a-uuid/services",
      payload: { name: "API" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid project ID" });
  });

  it("rejects an invalid project ID when listing services", async () => {
    const response = await app().inject({
      method: "GET",
      url: "/projects/not-a-uuid/services",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid project ID" });
  });

  it("returns 404 when creating a service under an unknown project", async () => {
    const response = await app().inject({
      method: "POST",
      url: `/projects/${randomUUID()}/services`,
      payload: { name: "API" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Project not found" });
  });

  it("lists services for an existing project", async () => {
    const parent = project("Pulse");
    const newest = service(parent.id, "Worker", new Date("2026-01-02T12:00:00.000Z"));
    const older = service(parent.id, "API", new Date("2026-01-01T12:00:00.000Z"));
    const response = await app(repositories([parent], [newest, older])).inject({
      method: "GET",
      url: `/projects/${parent.id}/services`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map(({ name }: { name: string }) => name)).toEqual(["Worker", "API"]);
  });

  it("returns 404 when listing services for an unknown project", async () => {
    const response = await app().inject({
      method: "GET",
      url: `/projects/${randomUUID()}/services`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Project not found" });
  });

  it("lists only services belonging to the requested project", async () => {
    const requested = project("Requested");
    const other = project("Other");
    const response = await app(repositories(
      [requested, other],
      [service(requested.id, "Requested API"), service(other.id, "Other API")],
    )).inject({
      method: "GET",
      url: `/projects/${requested.id}/services`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0]).toMatchObject({
      projectId: requested.id,
      name: "Requested API",
    });
  });

  it("retrieves an existing service", async () => {
    const parent = project("Pulse");
    const existing = service(parent.id, "API");
    const response = await app(repositories([parent], [existing])).inject({
      method: "GET",
      url: `/services/${existing.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ...existing,
      createdAt: existing.createdAt.toISOString(),
    });
  });

  it("returns 404 for an unknown service", async () => {
    const response = await app().inject({
      method: "GET",
      url: `/services/${randomUUID()}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Service not found" });
  });

  it("returns 400 for an invalid service ID", async () => {
    const response = await app().inject({ method: "GET", url: "/services/not-a-uuid" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid service ID" });
  });

  it("does not expose service repository errors", async () => {
    const parent = project("Pulse");
    const dependencies = repositories([parent]);
    dependencies.services.listServicesByProjectId = async () => {
      throw new Error("postgresql://admin:secret@example.invalid/pulse");
    };
    const response = await app(dependencies).inject({
      method: "GET",
      url: `/projects/${parent.id}/services`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal Server Error" });
    expect(response.body).not.toContain("secret");
  });
});

describe("health route", () => {
  it("still reports API health without PostgreSQL", async () => {
    const response = await app().inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "pulse-api" });
  });
});
