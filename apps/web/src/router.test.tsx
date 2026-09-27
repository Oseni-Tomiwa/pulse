import { render, screen } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "./router";
import { ThemeProvider } from "./theme/theme-provider";

function renderRoute(path: string) {
  return render(
    <ThemeProvider>
      <RouterProvider router={createAppRouter([path])} />
    </ThemeProvider>,
  );
}

describe("application routing", () => {
  it.each([
    ["/", "Overview"],
    ["/projects", "Projects"],
    ["/projects/123", "Project Details"],
    ["/services/456", "Service Details"],
    ["/monitors/789", "Monitor Details"],
  ])("renders %s inside the application shell", (path, heading) => {
    renderRoute(path);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pulse overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
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
