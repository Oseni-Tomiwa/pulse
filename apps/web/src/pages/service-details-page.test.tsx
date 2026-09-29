import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText("Monitor management is coming in a later milestone."))
      .toBeInTheDocument();
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
});
