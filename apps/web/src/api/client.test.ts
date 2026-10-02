import type {
  HealthCheck,
  HttpMonitor,
  Incident,
  MonitorUptime,
  Project,
  Service,
} from "@pulse/contracts";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createPulseApiClient } from "./client";
import type { JsonResponse } from "./types";

const project: JsonResponse<Project> = {
  id: "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
  name: "Pulse",
  createdAt: "2026-09-27T12:00:00.000Z",
};

const monitor: JsonResponse<HttpMonitor> = {
  id: "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
  serviceId: "29962974-50bb-4213-9e15-bbbe78747e22",
  name: "Production API",
  kind: "http",
  url: "https://example.com/health",
  method: "GET",
  intervalMs: 60000,
  timeoutMs: 10000,
  failureThreshold: 3,
  recoveryThreshold: 1,
  enabled: true,
  createdAt: "2026-09-27T14:00:00.000Z",
};

const healthCheck: JsonResponse<HealthCheck> = {
  id: "9007199254740993",
  monitorId: monitor.id,
  healthy: false,
  statusCode: 500,
  latencyMs: 42,
  checkedAt: "2026-09-27T15:00:00.000Z",
  errorType: "http_error",
  errorMessage: "HTTP 500",
};

const incident: JsonResponse<Incident> = {
  id: "58a5abe4-f783-46ca-b43d-b44eb8da1da5",
  monitorId: monitor.id,
  status: "open",
  startedAt: "2026-09-27T15:00:00.000Z",
  resolvedAt: null,
};

const uptime: JsonResponse<MonitorUptime> = {
  monitorId: monitor.id,
  window: "7d",
  from: "2026-09-20T15:00:00.000Z",
  to: "2026-09-27T15:00:00.000Z",
  totalChecks: 4,
  healthyChecks: 3,
  unhealthyChecks: 1,
  uptimePercentage: 75,
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


  it("lists Monitors through an encoded Service path", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([monitor]), { status: 200 }),
    );
    const signal = new AbortController().signal;
    const result = await createPulseApiClient({ fetchImpl }).listMonitors("service/id", { signal });
    expect(result).toEqual([monitor]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/services/service%2Fid/monitors",
      expect.objectContaining({ signal }),
    );
  });

  it("creates a Monitor with only the supplied optional configuration", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(monitor), { status: 201 }),
    );
    const result = await createPulseApiClient({ fetchImpl }).createMonitor(service.id, {
      name: "Production API",
      url: "https://example.com/health",
      method: "HEAD",
      timeoutMs: 5000,
      enabled: false,
    });
    expect(result).toEqual(monitor);
    expect(fetchImpl).toHaveBeenCalledWith("/api/services/" + service.id + "/monitors", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        name: "Production API",
        url: "https://example.com/health",
        method: "HEAD",
        timeoutMs: 5000,
        enabled: false,
      }),
      signal: undefined,
    });
  });

  it("gets one Monitor using an encoded ID", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(monitor), { status: 200 }),
    );
    const result = await createPulseApiClient({ fetchImpl }).getMonitor("monitor/id");
    expect(result).toEqual(monitor);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/monitors/monitor%2Fid",
      expect.any(Object),
    );
  });


  it("gets derived Monitor status without deriving it in the client", async () => {
    const status = {
      monitorId: monitor.id,
      probeStatus: "healthy" as const,
      latestCheck: { ...healthCheck, healthy: true },
      openIncident: incident,
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(status), { status: 200 }),
    );
    const signal = new AbortController().signal;

    const result = await createPulseApiClient({ fetchImpl })
      .getMonitorStatus("monitor/id", { signal });

    expect(result).toEqual(status);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/monitors/monitor%2Fid/status",
      expect.objectContaining({ signal }),
    );
  });

  it.each(["24h", "7d", "30d"] as const)(
    "gets backend check-based uptime for the %s window",
    async (window) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ ...uptime, window }), { status: 200 }),
      );

      const result = await createPulseApiClient({ fetchImpl })
        .getMonitorUptime("monitor/id", window);

      expect(result.window).toBe(window);
      expect(fetchImpl).toHaveBeenCalledWith(
        "/api/monitors/monitor%2Fid/uptime?window=" + window,
        expect.any(Object),
      );
    },
  );

  it("lists bounded Health Check history with decimal-string IDs", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([healthCheck]), { status: 200 }),
    );

    const result = await createPulseApiClient({ fetchImpl }).listHealthChecks("monitor/id");

    expect(result).toEqual([healthCheck]);
    expect(result[0]?.id).toBe("9007199254740993");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/monitors/monitor%2Fid/checks",
      expect.any(Object),
    );
  });

  it("lists bounded Incident history", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([incident]), { status: 200 }),
    );

    const result = await createPulseApiClient({ fetchImpl }).listIncidents("monitor/id");

    expect(result).toEqual([incident]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/monitors/monitor%2Fid/incidents",
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
