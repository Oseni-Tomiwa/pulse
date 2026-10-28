import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveRefresh, useLiveResource } from "./live-refresh";

async function settle() { await act(async () => { await Promise.resolve(); }); }
function Resource({ load, resourceKey = "one" }: { load: (signal: AbortSignal) => Promise<string>; resourceKey?: string }) {
  const state = useLiveResource(load, resourceKey);
  return <div><button onClick={() => state.setData(value => value + " + created")}>Add result</button>{state.status === "success" ? <>{state.data}{state.refreshFailed ? " Refresh failed" : ""}</> : state.status}</div>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("coordinated live resources", () => {
  it("loads once, refreshes every 15 seconds, retains data on failure, and recovers", async () => {
    const load = vi.fn().mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("private details")).mockResolvedValue("latest");
    render(<LiveRefresh><Resource load={load} /></LiveRefresh>); await settle();
    expect(screen.getByText("first")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(screen.getByText("first Refresh failed")).toBeInTheDocument();
    expect(screen.queryByText(/private/)).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(screen.getByText("latest")).toBeInTheDocument(); expect(load).toHaveBeenCalledTimes(3);
  });
  it("pauses while hidden, aborts requests, immediately refreshes on return and cleans up", async () => {
    const load = vi.fn().mockResolvedValue("data");
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const view = render(<LiveRefresh><Resource load={load} /><Resource load={load} resourceKey="two" /></LiveRefresh>);
    await settle(); expect(load).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(1);
    act(() => { visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange")); });
    expect(load.mock.calls[0]![0].aborted).toBe(true);
    await act(async () => { vi.advanceTimersByTime(60_000); }); expect(load).toHaveBeenCalledTimes(2);
    act(() => { visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange")); }); await settle();
    expect(load).toHaveBeenCalledTimes(4); expect(vi.getTimerCount()).toBe(1);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); }); expect(load).toHaveBeenCalledTimes(4);
  });
  it("ignores an aborted older response after resource identity changes", async () => {
    let resolveOld!: (value: string) => void;
    const old = vi.fn((_signal: AbortSignal) => new Promise<string>(resolve => { resolveOld = resolve; }));
    const next = vi.fn().mockResolvedValue("new service");
    const view = render(<LiveRefresh><Resource load={old} resourceKey="old" /></LiveRefresh>);
    view.rerender(<LiveRefresh><Resource load={next} resourceKey="new" /></LiveRefresh>); await settle();
    await act(async () => { resolveOld("old service"); });
    expect(screen.getByText("new service")).toBeInTheDocument(); expect(screen.queryByText("old service")).not.toBeInTheDocument();
    expect(old.mock.calls[0]![0].aborted).toBe(true);
  });
  it("prevents a list request started before a creation from overwriting the created item", async () => {
    let resolveOld!: (value: string) => void;
    const load = vi.fn().mockResolvedValueOnce("initial").mockImplementationOnce(() => new Promise<string>(resolve => { resolveOld = resolve; }));
    render(<LiveRefresh><Resource load={load} /></LiveRefresh>); await settle();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    fireEvent.click(screen.getByRole("button", { name: "Add result" }));
    await act(async () => { resolveOld("before creation"); });
    expect(screen.getByText("initial + created")).toBeInTheDocument();
    expect(screen.queryByText("before creation")).not.toBeInTheDocument();
  });
  it("lets a slow request finish across polling ticks without overlaps or starvation", async () => {
    let resolveSlow!: (value: string) => void;
    const load = vi.fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce(() => new Promise(resolve => { resolveSlow = resolve; }))
      .mockResolvedValue("next snapshot");
    render(<LiveRefresh><Resource load={load} /></LiveRefresh>);
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(load).toHaveBeenCalledTimes(1); expect(load.mock.calls[0]![0].aborted).toBe(false);
    await act(async () => { resolveSlow("slow snapshot"); });
    expect(screen.getByText("slow snapshot")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(load).toHaveBeenCalledTimes(2); expect(screen.getByText("next snapshot")).toBeInTheDocument();
  });
  it("keeps an initial error separate from a background failure and retries on cadence", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("initial")).mockResolvedValue("recovered");
    render(<LiveRefresh><Resource load={load} /></LiveRefresh>); await settle(); expect(screen.getByText("error")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(15_000); }); expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});
