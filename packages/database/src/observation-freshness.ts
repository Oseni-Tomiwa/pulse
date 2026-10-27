import type { HttpMonitor, ObservationFreshness } from "@pulse/contracts";

type FreshnessConfiguration = Pick<HttpMonitor, "enabled" | "intervalMs" | "timeoutMs">;

/** Uses CURRENT Monitor configuration; HealthChecks do not snapshot configuration. */
export function deriveObservationFreshness(
  monitor: FreshnessConfiguration,
  checkedAt: Date | null,
  now: Date,
): ObservationFreshness {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid freshness evaluation time");
  if (!monitor.enabled) return { state: "excluded", staleAt: null };
  if (checkedAt === null) return { state: "no_observation", staleAt: null };

  for (const value of [monitor.intervalMs, monitor.timeoutMs]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
      throw new RangeError("Freshness configuration must be a positive PostgreSQL integer");
    }
  }
  const deadline = checkedAt.getTime() + monitor.intervalMs + monitor.timeoutMs + Math.max(15_000, monitor.intervalMs);
  const staleAt = new Date(deadline);
  if (!Number.isSafeInteger(deadline) || !Number.isFinite(staleAt.getTime())) {
    throw new RangeError("Freshness deadline is outside the supported date range");
  }
  return { state: now.getTime() < deadline ? "fresh" : "stale", staleAt };
}
