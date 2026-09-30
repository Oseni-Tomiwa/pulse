import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type MonitorResponse, type PulseApiClient } from "../api/client";
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
    expect(screen.queryByText(/uptime/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/incident/i)).not.toBeInTheDocument();
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
});
