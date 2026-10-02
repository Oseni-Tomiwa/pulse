import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type HealthCheckResponse,
  type IncidentResponse,
  type MonitorResponse,
  type MonitorStatusResponse,
  type MonitorUptimeResponse,
  type PulseApiClient,
} from "../api/client";
import { createAppRouter } from "../router";
import { ThemeProvider } from "../theme/theme-provider";

const monitor: MonitorResponse = {
  id: "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
  serviceId: "29962974-50bb-4213-9e15-bbbe78747e22",
  name: "Production API",
  kind: "http",
  url: "https://example.com/health",
  method: "HEAD",
  intervalMs: 60000,
  timeoutMs: 10000,
  failureThreshold: 3,
  recoveryThreshold: 1,
  enabled: false,
  createdAt: "2026-09-27T14:00:00.000Z",
};

const healthyCheck: HealthCheckResponse = {
  id: "9007199254740993",
  monitorId: monitor.id,
  healthy: true,
  statusCode: 204,
  latencyMs: 12,
  checkedAt: "2026-09-27T15:00:00.000Z",
  errorType: null,
  errorMessage: null,
};

const failedCheck: HealthCheckResponse = {
  id: "9007199254740992",
  monitorId: monitor.id,
  healthy: false,
  statusCode: 500,
  latencyMs: 42,
  checkedAt: "2026-09-27T14:59:00.000Z",
  errorType: "http_error",
  errorMessage: "HTTP 500",
};

const openIncident: IncidentResponse = {
  id: "58a5abe4-f783-46ca-b43d-b44eb8da1da5",
  monitorId: monitor.id,
  status: "open",
  startedAt: "2026-09-27T14:58:00.000Z",
  resolvedAt: null,
};

const resolvedIncident: IncidentResponse = {
  ...openIncident,
  id: "68a5abe4-f783-46ca-b43d-b44eb8da1da5",
  status: "resolved",
  startedAt: "2026-09-26T14:00:00.000Z",
  resolvedAt: "2026-09-26T14:05:00.000Z",
};

const status: MonitorStatusResponse = {
  monitorId: monitor.id,
  probeStatus: "healthy",
  latestCheck: healthyCheck,
  openIncident,
};

const uptime: MonitorUptimeResponse = {
  monitorId: monitor.id,
  window: "24h",
  from: "2026-09-26T15:00:00.000Z",
  to: "2026-09-27T15:00:00.000Z",
  totalChecks: 4,
  healthyChecks: 3,
  unhealthyChecks: 1,
  uptimePercentage: 75,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function fakeClient(overrides: Partial<PulseApiClient> = {}): PulseApiClient {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn(),
    createProject: vi.fn(),
    listServices: vi.fn().mockResolvedValue([]),
    createService: vi.fn(),
    getService: vi.fn(),
    listMonitors: vi.fn().mockResolvedValue([]),
    createMonitor: vi.fn(),
    getMonitor: vi.fn().mockResolvedValue(monitor),
    getMonitorStatus: vi.fn().mockResolvedValue(status),
    getMonitorUptime: vi.fn().mockResolvedValue(uptime),
    listHealthChecks: vi.fn().mockResolvedValue([healthyCheck, failedCheck]),
    listIncidents: vi.fn().mockResolvedValue([openIncident, resolvedIncident]),
    ...overrides,
  };
}

function renderDetails(apiClient: PulseApiClient) {
  return render(
    <ThemeProvider>
      <RouterProvider router={createAppRouter(["/monitors/" + monitor.id], apiClient)} />
    </ThemeProvider>,
  );
}

describe("MonitorDetailsPage", () => {
  it("shows loading while the Monitor request is pending", () => {
    const pending = deferred<MonitorResponse>();
    renderDetails(fakeClient({ getMonitor: vi.fn(() => pending.promise) }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading monitor");
  });

  it("renders stored Monitor configuration and parent Service navigation", async () => {
    renderDetails(fakeClient());
    expect(await screen.findByRole("heading", { name: "Production API" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Service" })).toHaveAttribute(
      "href",
      "/services/" + monitor.serviceId,
    );
    expect(screen.getByText("https://example.com/health")).toBeInTheDocument();
    expect(screen.getByText("HEAD")).toBeInTheDocument();
    expect(screen.getByText("Monitoring disabled")).toBeInTheDocument();
    expect(screen.getByText("60,000 ms")).toBeInTheDocument();
  });

  it("renders Monitor not found separately", async () => {
    renderDetails(fakeClient({
      getMonitor: vi.fn().mockRejectedValue(new ApiError(404, "Monitor not found")),
    }));
    expect(await screen.findByRole("heading", { name: "Monitor not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Projects" })).toHaveAttribute("href", "/projects");
  });

  it("retries a generic Monitor failure", async () => {
    const getMonitor = vi.fn()
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error"))
      .mockResolvedValueOnce(monitor);
    renderDetails(fakeClient({ getMonitor }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Monitor unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Production API" })).toBeInTheDocument();
    expect(getMonitor).toHaveBeenCalledTimes(2);
  });

  it("aborts Monitor loading when unmounted", () => {
    let signal: AbortSignal | undefined;
    const pending = deferred<MonitorResponse>();
    const getMonitor = vi.fn((_id, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const view = renderDetails(fakeClient({ getMonitor }));
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("keeps scheduling configuration, probe status, and open Incident independent", async () => {
    renderDetails(fakeClient());
    expect(await screen.findByText("Monitoring disabled")).toBeInTheDocument();
    expect((await screen.findAllByText("Healthy")).length).toBeGreaterThan(0);
    expect(screen.getByText("Open incident")).toBeInTheDocument();
  });

  it("renders unknown only from the backend status response", async () => {
    renderDetails(fakeClient({
      getMonitorStatus: vi.fn().mockResolvedValue({
        monitorId: monitor.id,
        probeStatus: "unknown",
        latestCheck: null,
        openIncident: null,
      }),
    }));
    expect(await screen.findByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("No Health Check evidence yet.")).toBeInTheDocument();
    expect(screen.getByText("No open incident")).toBeInTheDocument();
  });

  it("defaults check-based uptime to 24h and switches windows", async () => {
    const getMonitorUptime = vi.fn().mockImplementation((_id, window) =>
      Promise.resolve({ ...uptime, window }),
    );
    renderDetails(fakeClient({ getMonitorUptime }));
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(getMonitorUptime).toHaveBeenCalledWith(monitor.id, "24h", expect.any(Object));
    await userEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(getMonitorUptime).toHaveBeenCalledWith(monitor.id, "7d", expect.any(Object));
    await userEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(getMonitorUptime).toHaveBeenCalledWith(monitor.id, "30d", expect.any(Object));
  });

  it("aborts a stale uptime request when the selected window changes", async () => {
    const pending = deferred<MonitorUptimeResponse>();
    const signals: AbortSignal[] = [];
    const getMonitorUptime = vi.fn((_id, window, options) => {
      if (options?.signal) signals.push(options.signal);
      return window === "24h" ? pending.promise : Promise.resolve({ ...uptime, window });
    });
    renderDetails(fakeClient({ getMonitorUptime }));
    await screen.findByRole("button", { name: "7d" });
    await userEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(signals[0]?.aborted).toBe(true);
    expect(await screen.findByText("75%")).toBeInTheDocument();
  });

  it("renders no uptime percentage when the selected window has no evidence", async () => {
    renderDetails(fakeClient({
      getMonitorUptime: vi.fn().mockResolvedValue({
        ...uptime,
        totalChecks: 0,
        healthyChecks: 0,
        unhealthyChecks: 0,
        uptimePercentage: null,
      }),
    }));
    expect(await screen.findByText("No checks in this window.")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("renders Health Check evidence in backend order without converting IDs", async () => {
    renderDetails(fakeClient());
    const rows = await screen.findAllByTestId("health-check");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Healthy");
    expect(rows[0]).toHaveTextContent("204");
    expect(rows[0]).toHaveTextContent("12 ms");
    expect(rows[1]).toHaveTextContent("Unhealthy");
    expect(rows[1]).toHaveTextContent("http_error");
    expect(rows[1]).toHaveTextContent("HTTP 500");
    expect(rows[1]).toHaveAttribute("data-check-id", "9007199254740992");
  });

  it("renders empty Health Check and Incident histories independently", async () => {
    renderDetails(fakeClient({
      listHealthChecks: vi.fn().mockResolvedValue([]),
      listIncidents: vi.fn().mockResolvedValue([]),
    }));
    expect(await screen.findByText("No Health Checks yet.")).toBeInTheDocument();
    expect(await screen.findByText("No incidents yet.")).toBeInTheDocument();
  });

  it("renders Incident history in backend order without inferred details", async () => {
    renderDetails(fakeClient());
    const rows = await screen.findAllByTestId("incident");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Open");
    expect(rows[0]).not.toHaveTextContent("Resolved at");
    expect(rows[1]).toHaveTextContent("Resolved");
    expect(rows[1]).toHaveTextContent("Resolved at");
    expect(screen.queryByText(/severity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/root cause/i)).not.toBeInTheDocument();
  });

  it("isolates section failures and retries only the failed resource", async () => {
    const getMonitorUptime = vi.fn()
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error"))
      .mockResolvedValueOnce(uptime);
    renderDetails(fakeClient({ getMonitorUptime }));
    expect(await screen.findByRole("heading", { name: "Production API" })).toBeInTheDocument();
    expect((await screen.findAllByText("Healthy")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Uptime unavailable")).toBeInTheDocument();
    expect(screen.getAllByTestId("health-check")).toHaveLength(2);
    expect(screen.getAllByTestId("incident")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Retry uptime" }));
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(getMonitorUptime).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["Status unavailable", "Retry status", "getMonitorStatus"],
    ["Health Checks unavailable", "Retry Health Checks", "listHealthChecks"],
    ["Incidents unavailable", "Retry incidents", "listIncidents"],
  ])("retries an independently failed %s section", async (message, retryLabel, method) => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error"))
      .mockResolvedValueOnce(
        method === "getMonitorStatus" ? status :
          method === "listHealthChecks" ? [healthyCheck] : [resolvedIncident],
      );
    renderDetails(fakeClient({ [method]: operation }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: retryLabel }));
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("aborts every operational request when Monitor Details unmounts", async () => {
    const signals: AbortSignal[] = [];
    const pending = new Promise<never>(() => {});
    const operation = vi.fn((options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal);
      return pending;
    });
    const view = renderDetails(fakeClient({
      getMonitorStatus: (_id, options) => operation(options),
      getMonitorUptime: (_id, _window, options) => operation(options),
      listHealthChecks: (_id, options) => operation(options),
      listIncidents: (_id, options) => operation(options),
    }));
    await screen.findByRole("heading", { name: "Production API" });
    view.unmount();
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
