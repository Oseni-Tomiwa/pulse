import type { Project, Service } from "@pulse/contracts";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createPulseApiClient } from "./client";
import type { JsonResponse } from "./types";

const project: JsonResponse<Project> = {
  id: "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
  name: "Pulse",
  createdAt: "2026-09-27T12:00:00.000Z",
};

const service: JsonResponse<Service> = {
  id: "29962974-50bb-4213-9e15-bbbe78747e22",
  projectId: project.id,
  name: "API",
  createdAt: "2026-09-27T13:00:00.000Z",
};

describe("createPulseApiClient", () => {
  it("lists Projects through the default /api boundary", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([project]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await createPulseApiClient({ fetchImpl }).listProjects();

    expect(result).toEqual([project]);
    expect(fetchImpl).toHaveBeenCalledWith("/api/projects", expect.objectContaining({
      headers: { accept: "application/json" },
    }));
  });

  it("gets one Project using an encoded ID and custom base URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(project), { status: 200 }),
    );
    const client = createPulseApiClient({ baseUrl: "https://pulse.test/api/", fetchImpl });

    await client.getProject("project/id");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://pulse.test/api/projects/project%2Fid",
      expect.any(Object),
    );
  });

  it("creates a Project with JSON and returns the server representation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(project), { status: 201 }),
    );
    const signal = new AbortController().signal;

    const result = await createPulseApiClient({ fetchImpl }).createProject(
      { name: "Pulse" },
      { signal },
    );

    expect(result).toEqual(project);
    expect(fetchImpl).toHaveBeenCalledWith("/api/projects", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Pulse" }),
      signal,
    });
  });

  it("forwards an AbortSignal", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([project]), { status: 200 }),
    );
    const signal = new AbortController().signal;

    await createPulseApiClient({ fetchImpl }).listProjects({ signal });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ signal }),
    );
  });

  it("lists Services through an encoded Project path", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([service]), { status: 200 }),
    );
    const signal = new AbortController().signal;
    const result = await createPulseApiClient({ fetchImpl })
      .listServices("project/id", { signal });

    expect(result).toEqual([service]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/projects/project%2Fid/services",
      expect.objectContaining({ signal }),
    );
  });

  it("creates a Service under a Project with JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(service), { status: 201 }),
    );
    const result = await createPulseApiClient({ fetchImpl })
      .createService(project.id, { name: "API" });

    expect(result).toEqual(service);
    expect(fetchImpl).toHaveBeenCalledWith(`/api/projects/${project.id}/services`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ name: "API" }),
      signal: undefined,
    });
  });

  it("gets one Service using an encoded ID", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(service), { status: 200 }),
    );
    const result = await createPulseApiClient({ fetchImpl }).getService("service/id");

    expect(result).toEqual(service);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/services/service%2Fid",
      expect.any(Object),
    );
  });

  it("throws a safe ApiError from a JSON API error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(createPulseApiClient({ fetchImpl }).getProject("missing"))
      .rejects.toEqual(new ApiError(404, "Project not found"));
  });

  it("uses a generic message for non-JSON failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("postgresql://secret", { status: 500 }),
    );

    await expect(createPulseApiClient({ fetchImpl }).listProjects())
      .rejects.toEqual(new ApiError(500, "Request failed"));
  });

  it("uses a generic message for malformed JSON failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{not-json", {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(createPulseApiClient({ fetchImpl }).listProjects())
      .rejects.toEqual(new ApiError(502, "Request failed"));
  });
});
