import { createDatabase, createMonitoringRepository } from "@pulse/database";
import { checkHttp, executeHttpMonitor } from "@pulse/monitoring";
import { loadWorkerConfig } from "./config.js";
import { startMonitoringPolling } from "./polling.js";
import { runMonitoringCycle } from "./run-monitoring-cycle.js";

type LogLevel = "info" | "error";

function log(
  level: LogLevel,
  event: string,
  details: Record<string, unknown> = {},
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  });

  if (level === "error") {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

function serializeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError", message: String(error) };
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const { db, pool } = createDatabase(config.databaseUrl);
  const repository = createMonitoringRepository(db);

  const polling = startMonitoringPolling({
    intervalMs: config.pollingIntervalMs,
    runCycle: () => runMonitoringCycle({
      now: () => new Date(),
      getDueHttpMonitors: (asOf) => repository.getDueHttpMonitors(asOf),
      executeHttpMonitor: (monitor) => executeHttpMonitor(monitor, {
        checkHttp,
        persistence: repository,
      }),
    }),
    onCycleComplete: (summary) => {
      log("info", "worker.cycle.completed", { summary });
    },
    onCycleError: (error) => {
      log("error", "worker.cycle.failed", { error: serializeError(error) });
    },
  });

  log("info", "worker.started", {
    pollingIntervalMs: config.pollingIntervalMs,
  });

  let shutdownStarted = false;
  let finishShutdown!: () => void;
  const shutdownComplete = new Promise<void>((resolve) => {
    finishShutdown = resolve;
  });

  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    log("info", "worker.shutdown.requested", { signal });

    try {
      polling.stop();
      await polling.done;
      await pool.end();
      log("info", "worker.shutdown.completed", { signal });
    } catch (error) {
      log("error", "worker.shutdown.failed", {
        signal,
        error: serializeError(error),
      });
      process.exitCode = 1;
    } finally {
      finishShutdown();
    }
  };

  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

  await shutdownComplete;
}

void main().catch((error) => {
  log("error", "worker.startup.failed", { error: serializeError(error) });
  process.exitCode = 1;
});
