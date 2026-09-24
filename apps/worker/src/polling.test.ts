import { describe, expect, it, vi } from "vitest";
import type { MonitoringCycleSummary } from "./run-monitoring-cycle.js";
import { startMonitoringPolling } from "./polling.js";

function summary(index: number): MonitoringCycleSummary {
  return {
    ranAt: new Date(index * 1_000).toISOString(),
    dueCount: 0,
    succeededCount: 0,
    failedCount: 0,
    executions: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("startMonitoringPolling", () => {
  it("runs repeated cycles using the configured interval", async () => {
    const intervals: number[] = [];
    let count = 0;
    let polling!: ReturnType<typeof startMonitoringPolling>;
    polling = startMonitoringPolling({
      intervalMs: 2_500,
      runCycle: async () => summary(++count),
      sleep: async (milliseconds) => { intervals.push(milliseconds); },
      onCycleComplete: () => {
        if (count === 3) polling.stop();
      },
    });

    await polling.done;
    expect(count).toBe(3);
    expect(intervals).toEqual([2_500, 2_500]);
  });

  it("never overlaps cycles", async () => {
    let active = 0;
    let maximumActive = 0;
    let count = 0;
    let polling!: ReturnType<typeof startMonitoringPolling>;
    polling = startMonitoringPolling({
      intervalMs: 1,
      sleep: async () => {},
      runCycle: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return summary(++count);
      },
      onCycleComplete: () => {
        if (count === 3) polling.stop();
      },
    });

    await polling.done;
    expect(maximumActive).toBe(1);
  });

  it("continues after a cycle-level failure", async () => {
    const error = new Error("discovery failed");
    const onCycleError = vi.fn();
    let count = 0;
    let polling!: ReturnType<typeof startMonitoringPolling>;
    polling = startMonitoringPolling({
      intervalMs: 1,
      sleep: async () => {},
      runCycle: vi.fn(async () => {
        count += 1;
        if (count === 1) throw error;
        return summary(count);
      }),
      onCycleError,
      onCycleComplete: () => polling.stop(),
    });

    await polling.done;
    expect(count).toBe(2);
    expect(onCycleError).toHaveBeenCalledWith(error);
  });

  it("does not begin another cycle after stop is requested", async () => {
    const runCycle = vi.fn().mockResolvedValue(summary(1));
    let polling!: ReturnType<typeof startMonitoringPolling>;
    polling = startMonitoringPolling({
      intervalMs: 1,
      runCycle,
      sleep: async () => {},
      onCycleComplete: () => polling.stop(),
    });

    await polling.done;
    expect(runCycle).toHaveBeenCalledOnce();
  });

  it("lets an active cycle settle before stopping", async () => {
    const cycle = deferred<MonitoringCycleSummary>();
    const polling = startMonitoringPolling({
      intervalMs: 1,
      runCycle: () => cycle.promise,
      sleep: async () => {},
    });
    let settled = false;
    void polling.done.then(() => { settled = true; });

    polling.stop();
    await Promise.resolve();
    expect(settled).toBe(false);

    cycle.resolve(summary(1));
    await polling.done;
    expect(settled).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid interval %s",
    (intervalMs) => {
      expect(() => startMonitoringPolling({
        intervalMs,
        runCycle: async () => summary(1),
      })).toThrow(RangeError);
    },
  );
});
