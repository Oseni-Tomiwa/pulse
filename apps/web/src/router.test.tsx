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
    ["/services/456", "Service Details"],
    ["/monitors/789", "Monitor Details"],
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
