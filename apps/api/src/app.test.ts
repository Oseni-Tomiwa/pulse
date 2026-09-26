import { randomUUID } from "node:crypto";
import type { HttpMonitor, Project, Service } from "@pulse/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildApp,
  type AppRepositories,
  type MonitorRepository,
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

function repositories(
  initialProjects: Project[] = [],
  initialServices: Service[] = [],
  initialMonitors: HttpMonitor[] = [],
): AppRepositories {
  return {
    projects: fakeProjectRepository(initialProjects),
    services: fakeServiceRepository(initialServices),
    monitors: fakeMonitorRepository(initialMonitors),
  };
}

function app(dependencies: AppRepositories = repositories()) {
  const instance = buildApp(dependencies, { logger: false });
  openApps.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((instance) => instance.close()));
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
