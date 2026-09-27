import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider, ThemeToggle } from "./theme-provider";

describe("ThemeProvider", () => {
  it("uses the system preference on first load", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    vi.unstubAllGlobals();
  });

  it("toggles and persists the selected theme", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Use dark theme" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("pulse-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Use light theme" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
