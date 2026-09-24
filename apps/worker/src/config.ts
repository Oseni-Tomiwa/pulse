import { DEFAULT_POLLING_INTERVAL_MS } from "./polling.js";

export type WorkerConfig = {
  databaseUrl: string;
  pollingIntervalMs: number;
};

export function loadWorkerConfig(
  environment: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to start the Pulse worker");
  }

  const configuredInterval = environment.PULSE_WORKER_POLL_INTERVAL_MS;
  const pollingIntervalMs = configuredInterval === undefined
    ? DEFAULT_POLLING_INTERVAL_MS
    : Number(configuredInterval);

  if (!Number.isFinite(pollingIntervalMs) || pollingIntervalMs <= 0) {
    throw new Error(
      "PULSE_WORKER_POLL_INTERVAL_MS must be a positive finite number",
    );
  }

  return { databaseUrl, pollingIntervalMs };
}
