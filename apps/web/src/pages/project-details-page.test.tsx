import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
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
      <RouterProvider router={createAppRouter([`/projects/${project.id}`], apiClient)} />
    </ThemeProvider>,
  );
}

describe("ProjectDetailsPage", () => {
  it("shows loading while the Project request is pending", () => {
    const pending = deferred<ProjectResponse>();
    renderDetails(fakeClient({ getProject: vi.fn(() => pending.promise) }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading project");
  });

  it("renders an authoritative empty Service collection", async () => {
    renderDetails(fakeClient());
    expect(await screen.findByRole("heading", { name: "Pulse" })).toBeInTheDocument();
    expect(await screen.findByText("No services yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Service" })).toBeInTheDocument();
  });

  it("renders Project not found separately from an API failure", async () => {
    renderDetails(fakeClient({
      getProject: vi.fn().mockRejectedValue(new ApiError(404, "Project not found")),
    }));
    expect(await screen.findByRole("heading", { name: "Project not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Projects" })).toHaveAttribute("href", "/projects");
  });

  it("retries a generic Project failure", async () => {
    const getProject = vi.fn()
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error"))
      .mockResolvedValueOnce(project);
    renderDetails(fakeClient({ getProject }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Project unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Pulse" })).toBeInTheDocument();
    expect(getProject).toHaveBeenCalledTimes(2);
  });

  it("aborts Project loading when unmounted", () => {
    let signal: AbortSignal | undefined;
    const pending = deferred<ProjectResponse>();
    const getProject = vi.fn((_id, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const view = renderDetails(fakeClient({ getProject }));
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("shows Service loading after the Project loads and hides creation", async () => {
    const pending = deferred<ServiceResponse[]>();
    renderDetails(fakeClient({ listServices: vi.fn(() => pending.promise) }));
    expect(await screen.findByRole("heading", { name: "Pulse" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading services");
    expect(screen.queryByRole("button", { name: "Create Service" })).not.toBeInTheDocument();
  });

  it("renders real Services linked to their details route", async () => {
    renderDetails(fakeClient({ listServices: vi.fn().mockResolvedValue([service]) }));
    expect(await screen.findByRole("link", { name: /API/ })).toHaveAttribute(
      "href",
      `/services/${service.id}`,
    );
  });

  it("retains the Project and retries a failed Service collection", async () => {
    const listServices = vi.fn()
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error"))
      .mockResolvedValueOnce([service]);
    renderDetails(fakeClient({ listServices }));
    expect(await screen.findByRole("heading", { name: "Pulse" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Services unavailable");
    expect(screen.queryByRole("button", { name: "Create Service" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /API/ })).toBeInTheDocument();
    expect(listServices).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty trimmed Service name", async () => {
    const createService = vi.fn();
    renderDetails(fakeClient({ createService }));
    await screen.findByText("No services yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Service" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Service name" }), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create service" }));
    expect(screen.getByText("Enter a service name.")).toBeInTheDocument();
    expect(createService).not.toHaveBeenCalled();
  });

  it("guards duplicate Service submissions while pending", async () => {
    const pending = deferred<ServiceResponse>();
    const createService = vi.fn(() => pending.promise);
    renderDetails(fakeClient({ createService }));
    await screen.findByText("No services yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Service" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Service name" }), "API");
    await userEvent.click(screen.getByRole("button", { name: "Create service" }));
    expect(screen.getByRole("button", { name: "Creating service" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Service name" })).toBeDisabled();
    expect(createService).toHaveBeenCalledTimes(1);
  });

  it("prepends and deduplicates the server-returned Service", async () => {
    const createService = vi.fn().mockResolvedValue(service);
    renderDetails(fakeClient({
      listServices: vi.fn().mockResolvedValue([service]),
      createService,
    }));
    await screen.findByRole("link", { name: /API/ });
    await userEvent.click(screen.getByRole("button", { name: "Create Service" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Service name" }), "  API  ");
    await userEvent.click(screen.getByRole("button", { name: "Create service" }));
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: /API/ })).toHaveLength(1);
    });
    expect(createService).toHaveBeenCalledWith(project.id, { name: "API" });
  });

  it("preserves the Service name after a safe creation failure", async () => {
    const createService = vi.fn().mockRejectedValue(
      new ApiError(500, "Internal Server Error"),
    );
    renderDetails(fakeClient({ createService }));
    await screen.findByText("No services yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Service" }));
    const input = screen.getByRole("textbox", { name: "Service name" });
    await userEvent.type(input, "API");
    await userEvent.click(screen.getByRole("button", { name: "Create service" }));
    expect(await screen.findByText("Internal Server Error")).toBeInTheDocument();
    expect(input).toHaveValue("API");
  });

  it("aborts Service loading when unmounted", async () => {
    let signal: AbortSignal | undefined;
    const pending = deferred<ServiceResponse[]>();
    const listServices = vi.fn((_id, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const view = renderDetails(fakeClient({ listServices }));
    await screen.findByRole("heading", { name: "Pulse" });
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
