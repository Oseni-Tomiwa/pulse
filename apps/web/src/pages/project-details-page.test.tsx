import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type ProjectResponse, type PulseApiClient } from "../api/client";
import { createAppRouter } from "../router";
import { ThemeProvider } from "../theme/theme-provider";

const project: ProjectResponse = {
  id: "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
  name: "Pulse",
  createdAt: "2026-09-27T12:00:00.000Z",
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

  it("renders the server-returned Project without fake Services", async () => {
    renderDetails(fakeClient());
    expect(await screen.findByRole("heading", { name: "Pulse" })).toBeInTheDocument();
    expect(screen.getByText("Services will appear here when that workflow is available.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /service/i })).not.toBeInTheDocument();
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
});
