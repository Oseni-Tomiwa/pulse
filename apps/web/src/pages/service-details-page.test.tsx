import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type MonitorResponse,
  type ProjectResponse,
  type PulseApiClient,
  type ServiceResponse,
} from "../api/client";
import { createAppRouter } from "../router";
import { ThemeProvider } from "../theme/theme-provider";

const project: ProjectResponse = {
  id: "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
  name: "Pulse",
  createdAt: "2026-09-27T12:00:00.000Z",
};
const service: ServiceResponse = {
  id: "29962974-50bb-4213-9e15-bbbe78747e22",
  projectId: project.id,
  name: "API",
  createdAt: "2026-09-27T13:00:00.000Z",
};

const monitor: MonitorResponse = {
  id: "30e4a63a-cd17-4c64-b10a-9e70b468b66e",
  serviceId: service.id,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function fakeClient(overrides: Partial<PulseApiClient> = {}): PulseApiClient {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue(project),
    createProject: vi.fn().mockResolvedValue(project),
    listServices: vi.fn().mockResolvedValue([]),
    createService: vi.fn().mockResolvedValue(service),
    getService: vi.fn().mockResolvedValue(service),
    listMonitors: vi.fn().mockResolvedValue([]),
    createMonitor: vi.fn(),
    getMonitor: vi.fn(),
    ...overrides,
  };
}

function renderDetails(apiClient: PulseApiClient) {
  return render(
    <ThemeProvider>
      <RouterProvider router={createAppRouter([`/services/${service.id}`], apiClient)} />
    </ThemeProvider>,
  );
}

describe("ServiceDetailsPage", () => {
  it("shows loading while the Service request is pending", () => {
    const pending = deferred<ServiceResponse>();
    renderDetails(fakeClient({ getService: vi.fn(() => pending.promise) }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading service");
  });

  it("renders real Service data and parent Project navigation", async () => {
    renderDetails(fakeClient());
    expect(await screen.findByRole("heading", { name: "API" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Project" })).toHaveAttribute(
      "href",
      `/projects/${project.id}`,
    );
  });

  it("renders Service not found separately", async () => {
    renderDetails(fakeClient({
      getService: vi.fn().mockRejectedValue(new ApiError(404, "Service not found")),
    }));
    expect(await screen.findByRole("heading", { name: "Service not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  it("retries a generic Service failure", async () => {
    const getService = vi.fn()
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error"))
      .mockResolvedValueOnce(service);
    renderDetails(fakeClient({ getService }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "API" })).toBeInTheDocument();
    expect(getService).toHaveBeenCalledTimes(2);
  });

  it("aborts Service loading when unmounted", () => {
    let signal: AbortSignal | undefined;
    const pending = deferred<ServiceResponse>();
    const getService = vi.fn((_id, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const view = renderDetails(fakeClient({ getService }));
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("shows an authoritative empty Monitor collection", async () => {
    renderDetails(fakeClient());
    expect(await screen.findByText("No monitors yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Monitor" })).toBeInTheDocument();
  });

  it("shows Monitor loading after the Service loads and hides creation", async () => {
    const pending = deferred<MonitorResponse[]>();
    renderDetails(fakeClient({ listMonitors: vi.fn(() => pending.promise) }));
    expect(await screen.findByRole("heading", { name: "API" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading monitors");
    expect(screen.queryByRole("button", { name: "Create Monitor" })).not.toBeInTheDocument();
  });

  it("renders real Monitors linked to their detail route", async () => {
    renderDetails(fakeClient({ listMonitors: vi.fn().mockResolvedValue([monitor]) }));
    const link = await screen.findByRole("link", { name: /Production API/ });
    expect(link).toHaveAttribute("href", "/monitors/" + monitor.id);
    expect(link).toHaveTextContent("GET");
    expect(link).toHaveTextContent("Monitoring enabled");
  });

  it("retains the Service and retries a failed Monitor collection", async () => {
    const listMonitors = vi.fn().mockRejectedValueOnce(new ApiError(500, "Internal Server Error")).mockResolvedValueOnce([monitor]);
    renderDetails(fakeClient({ listMonitors }));
    expect(await screen.findByRole("heading", { name: "API" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Monitors unavailable");
    expect(screen.queryByRole("button", { name: "Create Monitor" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Production API/ })).toBeInTheDocument();
    expect(listMonitors).toHaveBeenCalledTimes(2);
  });

  it("validates required Monitor fields and URL protocol", async () => {
    const createMonitor = vi.fn();
    renderDetails(fakeClient({ createMonitor }));
    await screen.findByText("No monitors yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Monitor" }));
    await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a monitor name.");
    await userEvent.type(screen.getByRole("textbox", { name: "Monitor name" }), "API");
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "ftp://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an absolute HTTP or HTTPS URL.");
    expect(createMonitor).not.toHaveBeenCalled();
  });

  it("requires optional numeric settings to be positive safe integers", async () => {
    const createMonitor = vi.fn();
    renderDetails(fakeClient({ createMonitor }));
    await screen.findByText("No monitors yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Monitor" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Monitor name" }), "API");
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "https://example.com");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Interval (ms)" }), "1.5");
    await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Interval must be a positive safe integer.");
    expect(createMonitor).not.toHaveBeenCalled();
  });

  it("omits untouched database defaults and prepends the returned Monitor", async () => {
    const createMonitor = vi.fn().mockResolvedValue(monitor);
    renderDetails(fakeClient({ createMonitor }));
    await screen.findByText("No monitors yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Monitor" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Monitor name" }), "  Production API  ");
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "  https://example.com/health  ");
    await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    expect(await screen.findByRole("link", { name: /Production API/ })).toBeInTheDocument();
    expect(createMonitor).toHaveBeenCalledWith(service.id, { name: "Production API", url: "https://example.com/health" });
  });

  it("submits explicit configuration and deduplicates the server Monitor", async () => {
    const createMonitor = vi.fn().mockResolvedValue(monitor);
    renderDetails(fakeClient({ listMonitors: vi.fn().mockResolvedValue([monitor]), createMonitor }));
    await screen.findByRole("link", { name: /Production API/ });
    await userEvent.click(screen.getByRole("button", { name: "Create Monitor" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Monitor name" }), "Production API");
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "https://example.com/health");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "HTTP method" }), "HEAD");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Timeout (ms)" }), "5000");
    await userEvent.click(screen.getByRole("checkbox", { name: "Monitoring enabled" }));
    await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    await waitFor(() => expect(screen.getAllByRole("link", { name: /Production API/ })).toHaveLength(1));
    expect(createMonitor).toHaveBeenCalledWith(service.id, {
      name: "Production API", url: "https://example.com/health", method: "HEAD", timeoutMs: 5000, enabled: false,
    });
  });

  it("guards duplicate Monitor submissions while pending", async () => {
    const pending = deferred<MonitorResponse>();
    const createMonitor = vi.fn(() => pending.promise);
    renderDetails(fakeClient({ createMonitor }));
    await screen.findByText("No monitors yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Monitor" }));
    const name = screen.getByRole("textbox", { name: "Monitor name" });
    await userEvent.type(name, "Production API");
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    expect(screen.getByRole("button", { name: "Creating monitor" })).toBeDisabled();
    expect(name).toBeDisabled();
    expect(createMonitor).toHaveBeenCalledTimes(1);
  });

  it("shows a safe creation failure without clearing Monitor inputs", async () => {
    const createMonitor = vi.fn().mockRejectedValue(new ApiError(500, "Internal Server Error"));
    renderDetails(fakeClient({ createMonitor }));
    await screen.findByText("No monitors yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Monitor" }));
    const name = screen.getByRole("textbox", { name: "Monitor name" });
    await userEvent.type(name, "Production API");
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    expect(await screen.findByText("Internal Server Error")).toBeInTheDocument();
    expect(name).toHaveValue("Production API");
  });

  it("aborts Monitor collection loading when unmounted", async () => {
    let signal: AbortSignal | undefined;
    const pending = deferred<MonitorResponse[]>();
    const listMonitors = vi.fn((_id, options) => { signal = options?.signal; return pending.promise; });
    const view = renderDetails(fakeClient({ listMonitors }));
    await screen.findByRole("heading", { name: "API" });
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
