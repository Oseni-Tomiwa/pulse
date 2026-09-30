import { render, screen } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { PulseApiClient } from "./api/client";
import { createAppRouter } from "./router";
import { ThemeProvider } from "./theme/theme-provider";

const apiClient: PulseApiClient = {
  listProjects: async () => [],
  getProject: async () => ({
    id: "123",
    name: "Pulse",
    createdAt: "2026-09-27T12:00:00.000Z",
  }),
  createProject: async () => {
    throw new Error("createProject is not used in router tests");
  },
  listServices: async () => [],
  createService: async () => {
    throw new Error("createService is not used in router tests");
  },
  getService: async () => ({
    id: "456",
    projectId: "123",
    name: "API",
    createdAt: "2026-09-27T13:00:00.000Z",
  }),
  listMonitors: async () => [],
  createMonitor: async () => { throw new Error("not used"); },
  getMonitor: async () => ({
    id: "789", serviceId: "456", name: "Production API", kind: "http",
    url: "https://example.com/health", method: "GET", intervalMs: 60000,
    timeoutMs: 10000, failureThreshold: 3, recoveryThreshold: 1,
    enabled: true, createdAt: "2026-09-27T14:00:00.000Z",
  }),
};

function renderRoute(path: string) {
  return render(
    <ThemeProvider>
      <RouterProvider router={createAppRouter([path], apiClient)} />
    </ThemeProvider>,
  );
}

describe("application routing", () => {
  it.each([
    ["/", "Overview"],
    ["/projects", "Projects"],
    ["/projects/123", "Pulse"],
    ["/services/456", "API"],
    ["/monitors/789", "Production API"],
  ])("renders %s inside the application shell", async (path, heading) => {
    renderRoute(path);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pulse overview" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("marks persistent navigation links active", () => {
    renderRoute("/projects");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });

  it("renders a not-found page", () => {
    renderRoute("/missing");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
