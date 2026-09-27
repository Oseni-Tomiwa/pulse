import type { Project } from "@pulse/contracts";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createPulseApiClient } from "./client";
import type { JsonResponse } from "./types";

const project: JsonResponse<Project> = {
  id: "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
  name: "Pulse",
  createdAt: "2026-09-27T12:00:00.000Z",
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
