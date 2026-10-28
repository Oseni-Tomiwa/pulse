import { transferableAbortController } from "node:util";
import { act, render, screen, within } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPulseApiClient } from "../api/client";
import { createAppRouter } from "../router";
import { healthFixture, m7Monitor, m7Service, overviewFixture } from "../test/m7-fixtures";
import { observationFixture } from "../test/m8-fixtures";
import { ThemeProvider } from "../theme/theme-provider";

async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
function show(route: string, status = observationFixture(), enabled = true, monitorCount = 1) {
  let fail = false;
  const overview = overviewFixture();
  overview.attention.push({ service: { ...m7Service, id: "partial", name: "Search" }, project: { id: "p", name: "Product" }, health: { ...healthFixture("healthy"), coverage: { reporting: 1, enabled: 2 } } });
  const fetchImpl = vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (fail) return new Response(JSON.stringify({ error: "private upstream details" }), { status: 500, headers: { "content-type": "application/json" } });
    const data = url.endsWith("/overview") ? overview
      : url.endsWith("/health") ? { ...healthFixture("healthy"), monitors: { ...healthFixture("healthy").monitors, stale: 1 } }
      : url.endsWith("/monitors") ? Array.from({ length: monitorCount }, (_, index) => ({ ...m7Monitor, id: index === 0 ? m7Monitor.id : "monitor-" + index, enabled }))
      : url.endsWith("/status") ? status
      : url.includes("/uptime") ? { monitorId: m7Monitor.id, window: "24h", from: "2026-10-27T12:00:00Z", to: "2026-10-28T12:00:00Z", totalChecks: 2, healthyChecks: 1, unhealthyChecks: 1, uptimePercentage: 50 }
      : url.endsWith("/checks") ? [observationFixture().latestCheck]
      : url.endsWith("/incidents") ? []
      : url.includes("/monitors/") ? { ...m7Monitor, enabled }
      : m7Service;
    return new Response(JSON.stringify(data));
  });
  const router = createAppRouter([route], createPulseApiClient({ fetchImpl }));
  const view = render(<ThemeProvider><RouterProvider router={router} /></ThemeProvider>);
  return { ...view, fetchImpl, router, setFailure(value: boolean) { fail = value; } };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("M8 frontend", () => {
  it("shows fresh-only health and current coverage while keeping partial Healthy attention Healthy", async () => {
    show("/"); await flush();
    expect(screen.getByText("Current health uses fresh observations only")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Services needing attention" });
    const rows = within(list).getAllByRole("link");
    expect(rows.map(row => row.getAttribute("href"))).toEqual([`/services/${m7Service.id}`, "/services/39962974-50bb-4213-9e15-bbbe78747e22", "/services/49962974-50bb-4213-9e15-bbbe78747e22", "/services/partial"]);
    expect(rows[3]).toHaveTextContent("Healthy"); expect(rows[3]).toHaveTextContent("1 of 2 current");
    expect(rows[3]).toHaveTextContent("Incomplete current coverage"); expect(rows[3]).not.toHaveTextContent("Degraded");
  });
  it.each(["healthy", "unhealthy"] as const)("preserves last observed %s separately from Fresh and Stale on Service Details", async health => {
    const status = observationFixture(health, "stale");
    const view = show(`/services/${m7Service.id}`, status); await flush();
    const card = screen.getByRole("link", { name: /Production API/ });
    expect(card).toHaveTextContent(health === "healthy" ? "Healthy" : "Unhealthy");
    expect(card).toHaveTextContent("Last observed"); expect(card).toHaveTextContent("Stale");
    expect(card).toHaveTextContent("Excluded from current health"); expect(card).toHaveTextContent("42 ms");
    expect(card).toHaveTextContent("Checked 18 sec ago");
    expect(screen.getByText("Current coverage")).toBeInTheDocument();
    status.freshness = { state: "fresh", staleAt: "2026-10-28T12:02:00Z" };
    await act(async () => { vi.advanceTimersByTime(15_000); }); await flush();
    expect(card).toHaveTextContent("Fresh"); expect(card).not.toHaveTextContent("Excluded from current health");
    if (health === "unhealthy") expect(card).toHaveTextContent("Incident open");
    view.unmount();
  });
  it("shows no observation separately from disabled exclusion", async () => {
    const view = show(`/services/${m7Service.id}`, observationFixture("healthy", "no_observation")); await flush();
    expect(screen.getByRole("link", { name: /Production API/ })).toHaveTextContent("No observation"); view.unmount();
    show(`/services/${m7Service.id}`, observationFixture("healthy", "excluded"), false); await flush();
    expect(screen.getByRole("link", { name: /Production API/ })).toHaveTextContent("Disabled · excluded");
  });
  it.each(["fresh", "stale", "no_observation", "excluded"] as const)("presents Monitor freshness %s with independent historical rows", async freshness => {
    show(`/monitors/${m7Monitor.id}`, observationFixture("unhealthy", freshness), freshness !== "excluded"); await flush();
    const latest = screen.getByRole("region", { name: "Current state" });
    expect(latest).toHaveTextContent({ fresh: "Fresh", stale: "Stale", no_observation: "No observation", excluded: "Excluded" }[freshness]);
    if (freshness !== "no_observation") {
      expect(latest).toHaveTextContent("Unhealthy"); expect(latest).toHaveTextContent("HTTP 503"); expect(latest).toHaveTextContent("42 ms"); expect(latest).toHaveTextContent("Checked 18 sec ago");
    }
    expect(latest).toHaveTextContent("Open incident");
    if (freshness === "stale") expect(latest).toHaveTextContent("historical evidence");
    const history = screen.getByTestId("health-check"); expect(history).toHaveTextContent("Healthy"); expect(history).not.toHaveTextContent("Stale");
  });
  it.each(["/", `/services/${m7Service.id}`, `/monitors/${m7Monitor.id}`])("polls %s without losing data on background failure", async route => {
    const view = show(route); await flush(); const heading = screen.getByRole("heading", { level: 1 }).textContent;
    const initialCount = view.fetchImpl.mock.calls.length;
    view.setFailure(true); await act(async () => { vi.advanceTimersByTime(15_000); }); await flush();
    expect(view.fetchImpl.mock.calls.length).toBeGreaterThan(initialCount);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(heading!);
    expect(screen.getAllByText(/Showing last loaded data/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
    view.setFailure(false); await act(async () => { vi.advanceTimersByTime(15_000); }); await flush();
    expect(screen.queryByText(/Showing last loaded data/)).not.toBeInTheDocument();
  });
  it.each(["/", `/services/${m7Service.id}`, `/monitors/${m7Monitor.id}`])("pauses %s while hidden and refreshes on return", async route => {
    const view = show(route); await flush(); const initialCount = view.fetchImpl.mock.calls.length;
    const visibility = vi.spyOn(document, "visibilityState", "get");
    act(() => { visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { vi.advanceTimersByTime(60_000); }); await flush();
    expect(view.fetchImpl).toHaveBeenCalledTimes(initialCount);
    act(() => { visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange")); }); await flush();
    expect(view.fetchImpl.mock.calls.length).toBeGreaterThan(initialCount);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it("coordinates multiple Monitor rows with one network timer and one local clock", async () => {
    const view = show(`/services/${m7Service.id}`, observationFixture(), true, 3); await flush();
    expect(vi.getTimerCount()).toBe(2);
    expect(view.fetchImpl).toHaveBeenCalledTimes(6);
    await act(async () => { vi.advanceTimersByTime(1_000); }); await flush();
    expect(view.fetchImpl).toHaveBeenCalledTimes(6);
    await act(async () => { vi.advanceTimersByTime(14_000); }); await flush();
    expect(view.fetchImpl).toHaveBeenCalledTimes(12);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not let an older page refresh overwrite another Service", async () => {
    vi.stubGlobal("AbortController", transferableAbortController);
    const view = show(`/services/${m7Service.id}`); await flush();
    let resolveOld!: (response: Response) => void;
    view.fetchImpl.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    await act(async () => { vi.advanceTimersByTime(15_000); });
    await act(async () => { await view.router.navigate("/services/new-service"); }); await flush();
    await act(async () => { resolveOld(new Response(JSON.stringify({ ...m7Service, name: "Obsolete Service" }))); });
    expect(screen.queryByText("Obsolete Service")).not.toBeInTheDocument();
  });
});
