import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, LoadingState } from "./async-states";

describe("async state primitives", () => {
  it("announces loading state", () => {
    render(<LoadingState label="Loading projects" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects");
  });

  it("renders an actionable error", async () => {
    const retry = vi.fn();
    render(<ErrorState title="Projects unavailable" onRetry={retry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Projects unavailable");
    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders an empty state with optional supporting text", () => {
    render(<EmptyState title="No projects" description="Create a Project to begin." />);
    expect(screen.getByText("No projects")).toBeInTheDocument();
    expect(screen.getByText("Create a Project to begin.")).toBeInTheDocument();
  });
});
