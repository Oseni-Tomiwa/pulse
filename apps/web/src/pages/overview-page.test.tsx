import { transferableAbortController } from "node:util";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { createPulseApiClient } from "../api/client";
import { createAppRouter } from "../router";
import { emptyHealth, emptyOverview, m7Service, overviewFixture } from "../test/m7-fixtures";
import { ThemeProvider } from "../theme/theme-provider";

function show(data = overviewFixture(), options: { pending?: boolean; error?: boolean } = {}) {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation((url) => {
    if (String(url) === "/api/overview") {
      if (options.pending) return new Promise<Response>(() => {});
      return Promise.resolve(new Response(JSON.stringify(options.error ? { error: "private upstream details" } : data), { status: options.error ? 500 : 200, headers: { "content-type": "application/json" } }));
    }
    const body = String(url).endsWith("/health") ? emptyHealth() : String(url).endsWith("/monitors") ? [] : m7Service;
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  const view = render(<ThemeProvider><RouterProvider router={createAppRouter(["/"], createPulseApiClient({ fetchImpl }))} /></ThemeProvider>);
  return { ...view, fetchImpl };
}
async function loaded() { return screen.findByRole("region", { name: "Workspace totals" }); }

describe("M7 Overview", () => {
  it("renders actual totals and all four Service Health counts", async () => {
    show(); const totals = await loaded();
    for (const [label, value] of [["Projects", "3"], ["Services", "8"], ["Monitors", "15"], ["Open incidents", "1"]]) {
      const card = within(totals).getByText(label!).closest("div")!; expect(card).toHaveTextContent(value!);
    }
    const health = screen.getByRole("region", { name: "Service health" });
    for (const [label, value] of [["Healthy", "5"], ["Degraded", "1"], ["Down", "1"], ["Unknown", "1"]]) {
      expect(within(health).getByText(label!).closest("div")).toHaveTextContent(value!);
    }
  });
  it("renders only supplied attention entries with Project identity, state, coverage and links", async () => {
    const data = overviewFixture(); show(data); await loaded();
    const list = screen.getByRole("list", { name: "Services needing attention" });
    const links = within(list).getAllByRole("link"); expect(links).toHaveLength(3);
    expect(links.map(link => link.getAttribute("href"))).toEqual(data.attention.map(entry => "/services/" + entry.service.id));
    for (const [index, name, project, state, coverage] of [[0,"Payments API","Commerce","Down","2 of 3"], [1,"API","ResolveAI","Degraded","2 of 3"], [2,"Background Jobs","DevStride","Unknown","0 of 3"]] as const) {
      for (const text of [name, project, state, coverage]) expect(links[index]).toHaveTextContent(text);
    }
    expect(within(list).queryByText("Healthy")).not.toBeInTheDocument();
  });
  it("preserves attention order supplied by the server", async () => {
    const data = overviewFixture(); data.attention.reverse(); show(data); await loaded();
    const links = within(screen.getByRole("list", { name: "Services needing attention" })).getAllByRole("link");
    expect(links[0]).toHaveTextContent("Background Jobs"); expect(links[2]).toHaveTextContent("Payments API");
  });
  it("activates attention navigation to Service Details", async () => {
    vi.stubGlobal("AbortController", transferableAbortController);
    try {
      const view = show(); await loaded();
      await userEvent.click(screen.getByRole("link", { name: /Payments API/ }));
      expect(await screen.findByRole("heading", { level: 1, name: "Payments API" })).toBeInTheDocument(); view.unmount();
    } finally { vi.unstubAllGlobals(); }
  });
  it("explains fresh-only health and current coverage without rewriting history", async () => {
    show(); await loaded(); expect(screen.getByText("Current health uses fresh observations only")).toBeInTheDocument();
    expect(screen.getByText(/Freshness is separate from health/)).toBeInTheDocument(); expect(screen.getByText(/Current coverage counts enabled monitors with fresh observations/)).toBeInTheDocument();
    expect(screen.queryByText("Critical Services")).not.toBeInTheDocument();
  });
  it("shows a positive empty attention state", async () => {
    const data = overviewFixture(); data.attention = []; show(data); await loaded();
    expect(screen.getByText("No services need attention")).toBeInTheDocument(); expect(screen.queryByRole("list", { name: "Services needing attention" })).not.toBeInTheDocument();
  });
  it("renders a zero-data workspace without inventing Services", async () => {
    show(emptyOverview); const totals = await loaded();
    expect(within(totals).getAllByText("0")).toHaveLength(4); expect(screen.getByText("No services yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Projects" })).toHaveAttribute("href", "/projects");
  });
  it("keeps the shell and Overview heading while loading and aborts on unmount", () => {
    const view = show(overviewFixture(), { pending: true });
    expect(screen.getByRole("status")).toHaveTextContent("Loading overview"); expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    const signal = view.fetchImpl.mock.calls[0]?.[1]?.signal; view.unmount(); expect(signal?.aborted).toBe(true);
  });
  it("shows a safe retryable API failure inside the shell", async () => {
    const view = show(overviewFixture(), { error: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Overview unavailable"); expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument(); expect(screen.getByRole("banner")).toBeInTheDocument();
    view.fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(emptyOverview)));
    await userEvent.click(screen.getByRole("button", { name: "Try again" })); await loaded();
  });
});
