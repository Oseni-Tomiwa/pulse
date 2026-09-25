import { randomUUID } from "node:crypto";
import type { Project, Service } from "@pulse/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildApp,
  type AppRepositories,
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

function repositories(
  initialProjects: Project[] = [],
  initialServices: Service[] = [],
): AppRepositories {
  return {
    projects: fakeProjectRepository(initialProjects),
    services: fakeServiceRepository(initialServices),
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
