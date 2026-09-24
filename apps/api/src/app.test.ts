import { randomUUID } from "node:crypto";
import type { Project } from "@pulse/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type ProjectRepository } from "./app.js";

const openApps: ReturnType<typeof buildApp>[] = [];

function project(name: string, createdAt = new Date("2026-01-01T12:00:00.000Z")): Project {
  return { id: randomUUID(), name, createdAt };
}

function fakeRepository(initialProjects: Project[] = []): ProjectRepository {
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

function app(repository: ProjectRepository = fakeRepository()) {
  const instance = buildApp(repository, { logger: false });
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
    const repository = fakeRepository();
    const response = await app(repository).inject({
      method: "POST",
      url: "/projects",
      payload: { name: "  My Project  " },
    });

    expect(response.statusCode).toBe(201);
    expect((await repository.listProjects())[0].name).toBe("My Project");
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
    const response = await app(fakeRepository([newest, older])).inject({
      method: "GET",
      url: "/projects",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map(({ name }: { name: string }) => name)).toEqual(["Newest", "Older"]);
  });

  it("retrieves an existing project", async () => {
    const existing = project("Existing");
    const response = await app(fakeRepository([existing])).inject({
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
    const repository = fakeRepository();
    repository.listProjects = async () => {
      throw new Error("postgresql://admin:secret@example.invalid/pulse");
    };
    const response = await app(repository).inject({ method: "GET", url: "/projects" });

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
