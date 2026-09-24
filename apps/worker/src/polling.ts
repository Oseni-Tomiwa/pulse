import type { MonitoringCycleSummary } from "./run-monitoring-cycle.js";

export const DEFAULT_POLLING_INTERVAL_MS = 10_000;

export type MonitoringPollingOptions = {
  runCycle(): Promise<MonitoringCycleSummary>;
  intervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onCycleComplete?: (summary: MonitoringCycleSummary) => void;
  onCycleError?: (error: unknown) => void;
};

export type MonitoringPollingController = {
  stop(): void;
  done: Promise<void>;
};

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function startMonitoringPolling({
  runCycle,
  intervalMs = DEFAULT_POLLING_INTERVAL_MS,
  sleep = defaultSleep,
  onCycleComplete,
  onCycleError,
}: MonitoringPollingOptions): MonitoringPollingController {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("polling interval must be a positive finite number");
  }

  let stopped = false;
  let resolveStop!: () => void;
  const stopRequested = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  const done = (async () => {
    while (!stopped) {
      try {
        const summary = await runCycle();
        onCycleComplete?.(summary);
      } catch (error) {
        onCycleError?.(error);
      }

      if (stopped) break;
      await Promise.race([sleep(intervalMs), stopRequested]);
    }
  })();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      resolveStop();
    },
    done,
  };
}
