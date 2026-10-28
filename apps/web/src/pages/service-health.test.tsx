import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { createPulseApiClient, type MonitorResponse } from "../api/client";
import { ServiceHealthPanel } from "./service-health-panel";
import { createAppRouter } from "../router";
import { emptyHealth, healthFixture, m7Monitor, m7Service } from "../test/m7-fixtures";
import { ThemeProvider } from "../theme/theme-provider";

function show(health = healthFixture(), options: { monitors?: MonitorResponse[]; pending?: boolean; error?: boolean } = {}) {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation((url) => {
    const path = String(url);
    if (path.endsWith("/health")) {
      if (options.pending) return new Promise<Response>(() => {});
      return Promise.resolve(new Response(JSON.stringify(options.error ? { error: "private health details" } : health), { status: options.error ? 500 : 200, headers: { "content-type": "application/json" } }));
    }
    const body = path.endsWith("/monitors") ? options.monitors ?? [] : path.endsWith("/status")
      ? { monitorId: m7Monitor.id, probeStatus: "unknown", freshness: { state: "no_observation", staleAt: null }, latestCheck: null, openIncident: null } : m7Service;
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  const view = render(<ThemeProvider><RouterProvider router={createAppRouter([`/services/${m7Service.id}`], createPulseApiClient({ fetchImpl }))} /></ThemeProvider>);
  return { ...view, fetchImpl };
}

describe("M7 Service Health presentation", () => {
  it.each(["healthy", "degraded", "down", "unknown"] as const)("renders server-derived %s health and counts", async state => {
    const data = healthFixture(state); show(data);
    const region = await screen.findByRole("region", { name: "Service health" });
    expect(await within(region).findByText(state[0]!.toUpperCase() + state.slice(1), { exact: true, selector: "strong" })).toBeInTheDocument();
    const counts = within(region).getByRole("list", { name: "Monitor health counts" });
    for (const [label, count] of [["Total monitors", 4], ["Fresh observations", data.monitors.reporting], ["Stale observations", data.monitors.stale ?? 0], ["No observation", data.monitors.unknown]] as const) {
      const card = within(counts).getByText(label).closest("li")!; expect(card).toHaveTextContent(String(count));
    }
  });
  it("uses server coverage separately from Service state and Monitor collection", async () => {
    show(healthFixture("healthy"), { monitors: [] });
    const region = await screen.findByRole("region", { name: "Service health" });
    expect(await within(region).findByText("2 / 3")).toBeInTheDocument(); expect(region).toHaveTextContent("Healthy");
    expect(region).toHaveTextContent("1 disabled"); expect(screen.getByText(/Coverage is separate from health/)).toBeInTheDocument();
  });
  it("renders zero Monitors as valid Unknown with zero coverage", async () => {
    show(emptyHealth());
    expect(await screen.findByText("0 / 0")).toBeInTheDocument(); expect(screen.getByText("No monitors yet")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Service health" })).toHaveTextContent("Unknown");
  });
  it("shows disabled/excluded separately from an enabled unknown Monitor and preserves links", async () => {
    const disabled = { ...m7Monitor, id: "disabled-monitor", name: "Legacy Ping", enabled: false };
    const { fetchImpl } = show(healthFixture("unknown"), { monitors: [m7Monitor, disabled] });
    const unknown = await screen.findByRole("link", { name: /Production API/ });
    expect(await within(unknown).findByText("No observation")).toBeInTheDocument(); expect(unknown).toHaveAttribute("href", "/monitors/" + m7Monitor.id);
    const excluded = screen.getByRole("link", { name: /Legacy Ping/ }); expect(excluded).toHaveTextContent("Disabled · excluded"); expect(within(excluded).queryByText("Unknown")).not.toBeInTheDocument();
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("disabled-monitor/status"))).toBe(false);
  });
  it.each(["healthy", "unhealthy"] as const)("shows an enabled Monitor's server-reported %s state", async state => {
    const view = show(healthFixture(), { monitors: [m7Monitor] });
    view.fetchImpl.mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith("/status") ? { monitorId: m7Monitor.id, probeStatus: state, latestCheck: null, openIncident: null } : String(url).endsWith("/monitors") ? [m7Monitor] : String(url).endsWith("/health") ? healthFixture() : m7Service)));
    const card = await screen.findByRole("link", { name: /Production API/ }); expect(await within(card).findByText(state === "healthy" ? "Healthy" : "Unhealthy")).toBeInTheDocument();
  });
  it("does not turn an observation request failure into Unknown or Unhealthy", async () => {
    const view = show(healthFixture(), { monitors: [m7Monitor] });
    view.fetchImpl.mockImplementation(async url => {
      if (String(url).endsWith("/status")) return new Response("upstream details", { status: 500 });
      return new Response(JSON.stringify(String(url).endsWith("/monitors") ? [m7Monitor] : String(url).endsWith("/health") ? healthFixture() : m7Service));
    });
    const card = await screen.findByRole("link", { name: /Production API/ });
    expect(await within(card).findByText("Observation unavailable")).toBeInTheDocument();
    expect(within(card).queryByText("Unknown")).not.toBeInTheDocument();
    expect(within(card).queryByText("Unhealthy")).not.toBeInTheDocument();
  });
  it("keeps Service Details and Monitor creation available while health loads", async () => {
    const view = show(healthFixture(), { pending: true });
    expect(await screen.findByRole("heading", { name: "Payments API" })).toBeInTheDocument(); expect(within(screen.getByRole("region", { name: "Service health" })).getByRole("status")).toHaveTextContent("Loading service health");
    expect(await screen.findByRole("button", { name: "Create Monitor" })).toBeInTheDocument(); expect(screen.getByRole("banner")).toBeInTheDocument();
    const call = view.fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/health")); view.unmount(); expect(call?.[1]?.signal?.aborted).toBe(true);
  });
  it("ignores an obsolete health response after the selected Service changes", async () => {
    let resolveOld!: (data: ReturnType<typeof healthFixture>) => void;
    const pending = new Promise<ReturnType<typeof healthFixture>>(resolve => { resolveOld = resolve; });
    const api = createPulseApiClient();
    const getServiceHealth = vi.spyOn(api, "getServiceHealth").mockImplementation(async id => id === "old-service" ? pending : { ...healthFixture("healthy"), serviceId: id });
    const view = render(<ServiceHealthPanel apiClient={api} serviceId="old-service" refreshVersion={0} />);
    const signal = getServiceHealth.mock.calls[0]?.[1]?.signal;
    view.rerender(<ServiceHealthPanel apiClient={api} serviceId="new-service" refreshVersion={0} />);
    expect(await screen.findByText("Healthy", { selector: "strong" })).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolveOld(healthFixture("degraded")); await pending; });
    expect(screen.queryByText("Degraded", { selector: "strong" })).not.toBeInTheDocument();
    expect(screen.getByText("Healthy", { selector: "strong" })).toBeInTheDocument();
  });

  it("isolates a sanitized health failure and retries only health", async () => {
    const view = show(healthFixture(), { error: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Service health unavailable"); expect(screen.queryByText(/private health/)).not.toBeInTheDocument(); expect(screen.getByText("No monitors yet")).toBeInTheDocument();
    view.fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(healthFixture())));
    await userEvent.click(screen.getByRole("button", { name: "Try again" })); expect(await screen.findByText("2 / 3")).toBeInTheDocument();
    expect(view.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/monitors"))).toHaveLength(1);
  });
});
