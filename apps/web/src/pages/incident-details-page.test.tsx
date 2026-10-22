import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { createPulseApiClient, type IncidentDiagnosticsResponse } from "../api/client";
import { createAppRouter } from "../router";
import { ThemeProvider } from "../theme/theme-provider";

const id = "58a5abe4-f783-46ca-b43d-b44eb8da1da5";
function fixture(): IncidentDiagnosticsResponse {
  return {
    incident: { id, monitorId: "monitor-1", status: "resolved", startedAt: "2026-09-27T12:00:00.000Z", resolvedAt: "2026-09-27T12:02:00.000Z" },
    monitor: { id: "monitor-1", serviceId: "service-1", name: "Production API", kind: "http", url: "https://example.com/health", method: "HEAD", intervalMs: 60000, timeoutMs: 10000, failureThreshold: 1, recoveryThreshold: 1, enabled: true, createdAt: "2026-01-01T00:00:00.000Z" },
    durationMs: 120000,
    evidence: {
      thresholdSource: "current_monitor",
      opening: { boundary: { match: "exact", checkId: "9007199254740993" }, sequence: { configuredThreshold: 1, returnedCount: 1, complete: true, contradictory: false, truncated: false } },
      recovery: { boundary: { match: "exact", checkId: "9007199254740994" }, sequence: { configuredThreshold: 1, returnedCount: 1, complete: true, contradictory: false, truncated: false } },
      during: { truncated: false }, gaps: [], truncated: false,
      checks: [
        { id: "9007199254740993", monitorId: "monitor-1", checkedAt: "2026-09-27T12:00:00.000Z", healthy: false, statusCode: 503, latencyMs: 42, errorType: "http_error", errorMessage: "HTTP 503", contexts: ["opening", "during_start"] },
        { id: "9007199254740994", monitorId: "monitor-1", checkedAt: "2026-09-27T12:02:00.000Z", healthy: true, statusCode: 204, latencyMs: 12, errorType: null, errorMessage: null, contexts: ["recovery"] },
      ],
    },
  };
}
function show(data = fixture(), options: { status?: number; pending?: boolean; path?: string } = {}) {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => options.pending ? new Promise<Response>(() => {}) : Promise.resolve(new Response(JSON.stringify(options.status ? { error: "private upstream failure" } : data), { status: options.status ?? 200, headers: { "content-type": "application/json" } })));
  const view = render(<ThemeProvider><RouterProvider router={createAppRouter([options.path ?? `/incidents/${id}`], createPulseApiClient({ fetchImpl }))} /></ThemeProvider>);
  return { ...view, fetchImpl };
}
async function loaded() { await screen.findByRole("heading", { name: "Incident details", level: 1 }); }

describe("M6 Incident Details", () => {
  it("shows loading and aborts on unmount", () => {
    const view = show(fixture(), { pending: true });
    expect(screen.getByRole("status")).toHaveTextContent("Loading incident diagnostics");
    const signal = view.fetchImpl.mock.calls[0]?.[1]?.signal;
    view.unmount(); expect(signal?.aborted).toBe(true);
  });
  it("renders resolved summary through the real incident endpoint", async () => {
    const { fetchImpl } = show(); await loaded();
    expect(fetchImpl).toHaveBeenCalledWith(`/api/incidents/${id}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const summary = screen.getByRole("region", { name: "Incident summary" });
    for (const text of ["Resolved", "Production API", "https://example.com/health", "HEAD", "60,000 ms", "10,000 ms", "2 min", "Opened", "Resolved at"]) expect(within(summary).getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Monitor" })).toHaveAttribute("href", "/monitors/monitor-1");
  });
  it("renders open incidents with null duration and no recovery", async () => {
    const data = fixture(); data.incident.status = "open"; data.incident.resolvedAt = null; data.durationMs = null; data.evidence.recovery = null; data.evidence.checks = data.evidence.checks.slice(0, 1);
    const { fetchImpl } = show(data); await loaded();
    expect(screen.getByText("Open")).toBeInTheDocument(); expect(screen.getByText("Duration becomes available after resolution.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recovery boundary" })).not.toBeInTheDocument(); expect(screen.queryByText("Resolved at")).not.toBeInTheDocument(); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("does not derive missing resolved duration", async () => {
    const data = fixture(); data.durationMs = null; show(data); await loaded(); expect(screen.getByText("Duration unavailable.")).toBeInTheDocument(); expect(screen.queryByText("2 min")).not.toBeInTheDocument();
  });
  it("renders chronological persisted observations with decimal-string IDs", async () => {
    show(); await loaded(); const rows = screen.getAllByTestId("diagnostic-check");
    expect(rows.map(row => row.getAttribute("data-check-id"))).toEqual(["9007199254740993", "9007199254740994"]);
    for (const text of ["Unhealthy", "503", "42 ms", "http_error", "HTTP 503"]) expect(rows[0]).toHaveTextContent(text);
    expect(rows[1]).toHaveTextContent("Healthy"); expect(rows[0]?.querySelector("time")).toHaveAttribute("datetime", "2026-09-27T12:00:00.000Z");
  });
  it("renders multiple contexts on one deduplicated check", async () => {
    show(); await loaded(); const rows = screen.getAllByTestId("diagnostic-check"); expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Opening sequence")).toBeInTheDocument(); expect(within(rows[0]!).getByText("First checks after opening")).toBeInTheDocument();
  });
  it("renders exact boundaries and complete evidence without warning emphasis", async () => {
    show(); await loaded(); const boundary = screen.getByRole("region", { name: "Opening boundary" });
    for (const text of ["Exact", "unique HealthCheck", "1 of 1 checks", "Complete"]) expect(boundary).toHaveTextContent(text);
    expect(boundary).not.toHaveClass("diagnostic-warning");
  });
  it.each(["opening", "recovery"] as const)("explains ambiguous %s boundaries", async key => {
    const data = fixture(); data.evidence[key]!.boundary = { match: "ambiguous", checkId: null }; show(data); await loaded();
    const boundary = screen.getByRole("region", { name: key === "opening" ? "Opening boundary" : "Recovery boundary" });
    for (const text of ["Ambiguous", "Multiple HealthChecks share", "cannot identify which check triggered"]) expect(boundary).toHaveTextContent(text); expect(boundary).toHaveClass("diagnostic-warning");
  });
  it.each(["opening", "recovery"] as const)("explains missing %s boundaries and incomplete evidence", async key => {
    const data = fixture(); data.evidence[key]!.boundary = { match: "missing", checkId: null }; data.evidence[key]!.sequence.complete = false; show(data); await loaded();
    const boundary = screen.getByRole("region", { name: key === "opening" ? "Opening boundary" : "Recovery boundary" });
    for (const text of ["Missing", "No persisted HealthCheck matches", "Incomplete"]) expect(boundary).toHaveTextContent(text);
  });
  it("explains bounded and truncated evidence", async () => {
    const data = fixture(); data.evidence.truncated = true; data.evidence.during.truncated = true; data.evidence.opening.sequence = { configuredThreshold: 80, returnedCount: 26, complete: false, contradictory: false, truncated: true }; show(data); await loaded();
    expect(screen.getByText(/bounded diagnostic window.*64 checks/i)).toBeInTheDocument(); expect(screen.getByText(/not the complete Monitor history/)).toBeInTheDocument();
    const boundary = screen.getByRole("region", { name: "Opening boundary" }); expect(boundary).toHaveTextContent("26 of 80 checks"); expect(boundary).toHaveTextContent("Threshold evidence truncated");
  });
  it("places explicit omitted-evidence gaps between the named adjacent checks", async () => {
    const data = fixture(); data.evidence.gaps = [{ afterCheckId: "9007199254740993", beforeCheckId: "9007199254740994" }]; data.evidence.truncated = true; show(data); await loaded();
    expect(Array.from(screen.getByRole("list", { name: "Diagnostic evidence" }).children).map(row => row.textContent)).toEqual([expect.stringContaining("Unhealthy"), expect.stringContaining("Persisted checks omitted"), expect.stringContaining("Healthy")]);
  });
  it("does not infer gaps from sparse timestamps", async () => {
    show(); await loaded(); expect(screen.queryByText(/Persisted checks omitted/)).not.toBeInTheDocument();
  });
  it.each(["opening", "recovery"] as const)("surfaces contradictory %s evidence", async key => {
    const data = fixture(); data.evidence[key]!.sequence.contradictory = true; show(data); await loaded(); expect(screen.getByRole("region", { name: key === "opening" ? "Opening boundary" : "Recovery boundary" })).toHaveTextContent("Contradictory persisted evidence");
  });
  it("treats empty evidence as a valid success", async () => {
    const data = fixture(); data.evidence.checks = []; data.evidence.recovery!.boundary = { match: "missing", checkId: null }; data.evidence.recovery!.sequence.returnedCount = 0; data.evidence.recovery!.sequence.complete = false; data.evidence.opening.boundary = { match: "missing", checkId: null }; data.evidence.opening.sequence.returnedCount = 0; data.evidence.opening.sequence.complete = false; show(data); await loaded();
    expect(screen.getByText("No persisted evidence available for this incident.")).toBeInTheDocument(); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("explains current-monitor configuration", async () => {
    show(); await loaded(); expect(screen.getByText(/thresholds are the Monitor’s current configuration.*may differ/)).toBeInTheDocument();
  });
  it.each([[400, "Invalid incident ID"], [404, "Incident not found"], [500, "Incident diagnostics unavailable"]])("handles %s safely", async (status, title) => {
    show(fixture(), { status: status as number, path: status === 400 ? "/incidents/not-a-uuid" : undefined }); expect(await screen.findByRole("alert")).toHaveTextContent(title as string); expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
  });
  it("sanitizes unexpected non-API failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("private network details"));
    render(<ThemeProvider><RouterProvider router={createAppRouter([`/incidents/${id}`], createPulseApiClient({ fetchImpl }))} /></ThemeProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Incident diagnostics unavailable");
    expect(screen.queryByText(/private network/)).not.toBeInTheDocument();
  });
  it("omits absent HTTP/error fields and preserves a zero latency observation", async () => {
    const data = fixture();
    Object.assign(data.evidence.checks[0]!, { statusCode: null, latencyMs: 0, errorType: null, errorMessage: null });
    show(data); await loaded();
    const row = screen.getAllByTestId("diagnostic-check")[0]!;
    expect(row).toHaveTextContent("0 ms");
    expect(within(row).queryByText("HTTP status")).not.toBeInTheDocument();
    expect(within(row).queryByText("Error type")).not.toBeInTheDocument();
    expect(within(row).queryByText("Error message")).not.toBeInTheDocument();
  });
  it("retries an unexpected failure", async () => {
    const { fetchImpl } = show(fixture(), { status: 500 }); await screen.findByRole("alert"); fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(fixture()), { status: 200 })); await userEvent.click(screen.getByRole("button", { name: "Try again" })); await loaded();
  });
});
