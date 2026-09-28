import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type ProjectResponse, type PulseApiClient } from "../api/client";
import { createAppRouter } from "../router";
import { ThemeProvider } from "../theme/theme-provider";

const existing: ProjectResponse = {
  id: "d92a0809-c7cb-4925-9fab-16ecdf0cc48a",
  name: "Existing Project",
  createdAt: "2026-09-27T12:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeClient(overrides: Partial<PulseApiClient> = {}): PulseApiClient {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue(existing),
    createProject: vi.fn().mockResolvedValue(existing),
    ...overrides,
  };
}

function renderProjects(apiClient: PulseApiClient) {
  const router = createAppRouter(["/projects"], apiClient);
  return {
    ...render(
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>,
    ),
    router,
  };
}

describe("ProjectsPage", () => {
  it("shows loading while Projects are unknown and hides creation", () => {
    const pending = deferred<ProjectResponse[]>();
    renderProjects(fakeClient({ listProjects: vi.fn(() => pending.promise) }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading projects");
    expect(screen.queryByRole("button", { name: "Create Project" })).not.toBeInTheDocument();
  });

  it("renders the real Project collection", async () => {
    renderProjects(fakeClient({ listProjects: vi.fn().mockResolvedValue([existing]) }));

    expect(await screen.findByRole("link", { name: /Existing Project/ })).toHaveAttribute(
      "href",
      `/projects/${existing.id}`,
    );
    expect(screen.getByRole("button", { name: "Create Project" })).toBeInTheDocument();
  });

  it("renders a strong empty state after a successful empty response", async () => {
    renderProjects(fakeClient());

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Project" })).toBeInTheDocument();
  });

  it("retries a failed list without offering creation while contents are unknown", async () => {
    const listProjects = vi.fn()
      .mockRejectedValueOnce(new ApiError(500, "Internal Server Error"))
      .mockResolvedValueOnce([existing]);
    renderProjects(fakeClient({ listProjects }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Projects unavailable");
    expect(screen.queryByRole("button", { name: "Create Project" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Existing Project")).toBeInTheDocument();
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  it("links a selected Project to its details route", async () => {
    const getProject = vi.fn().mockResolvedValue(existing);
    renderProjects(fakeClient({
      listProjects: vi.fn().mockResolvedValue([existing]),
      getProject,
    }));

    expect(await screen.findByRole("link", { name: /Existing Project/ })).toHaveAttribute(
      "href",
      `/projects/${existing.id}`,
    );
    expect(getProject).not.toHaveBeenCalled();
  });

  it("rejects an empty trimmed Project name without calling the API", async () => {
    const createProject = vi.fn();
    renderProjects(fakeClient({ createProject }));
    await screen.findByText("No projects yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Project name" }), "   ");

    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(screen.getByText("Enter a project name.")).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("guards duplicate submissions while creation is pending", async () => {
    const pending = deferred<ProjectResponse>();
    const createProject = vi.fn(() => pending.promise);
    renderProjects(fakeClient({ createProject }));
    await screen.findByText("No projects yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Project name" }), "New Project");

    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(screen.getByRole("button", { name: "Creating project" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Project name" })).toBeDisabled();
    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it("prepends the server-returned Project without reloading the collection", async () => {
    const created: ProjectResponse = {
      id: "4f605077-adfc-46f0-b70e-7438f721c575",
      name: "Trimmed Project",
      createdAt: "2026-09-27T13:00:00.000Z",
    };
    const listProjects = vi.fn().mockResolvedValue([existing]);
    const createProject = vi.fn().mockResolvedValue(created);
    renderProjects(fakeClient({ listProjects, createProject }));
    await screen.findByText("Existing Project");
    await userEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Project name" }), "  Trimmed Project  ");

    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Trimmed Project/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Existing Project/ })).toBeInTheDocument();
    });
    expect(createProject).toHaveBeenCalledWith({ name: "Trimmed Project" });
    expect(listProjects).toHaveBeenCalledOnce();
    const projectLinks = screen.getAllByRole("link").filter((link) =>
      link.classList.contains("project-card"));
    expect(projectLinks).toHaveLength(2);
    expect(projectLinks[0]).toHaveTextContent("Trimmed Project");
  });

  it("keeps the form value and shows a safe creation error", async () => {
    const createProject = vi.fn().mockRejectedValue(
      new ApiError(500, "Internal Server Error"),
    );
    renderProjects(fakeClient({ createProject }));
    await screen.findByText("No projects yet");
    await userEvent.click(screen.getByRole("button", { name: "Create Project" }));
    const input = screen.getByRole("textbox", { name: "Project name" });
    await userEvent.type(input, "New Project");

    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("Internal Server Error")).toBeInTheDocument();
    expect(input).toHaveValue("New Project");
  });

  it("aborts list loading when unmounted", () => {
    let signal: AbortSignal | undefined;
    const pending = deferred<ProjectResponse[]>();
    const listProjects = vi.fn((options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const view = renderProjects(fakeClient({ listProjects }));

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });
});
