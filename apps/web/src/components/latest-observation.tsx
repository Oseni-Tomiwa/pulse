import type { MonitorStatusResponse } from "../api/client";
import { RelativeAge } from "../live/relative-age";
import { HealthState } from "./health-state";

const labels = { fresh: "Fresh", stale: "Stale", no_observation: "No observation", excluded: "Excluded" };

/** Uses only the backend's freshness decision; local time changes observation age only. */
export function LatestObservation({ status }: { status: MonitorStatusResponse }) {
  const freshness = status.freshness;
  return <div className="latest-observation">
    <div className="observation-badges">
      {status.probeStatus !== "unknown" ? <span className="observation-health"><span>Last observed</span> <HealthState state={status.probeStatus} /></span> : null}
      {freshness ? <strong className={"freshness-badge freshness-" + freshness.state}
        title={freshness.staleAt ? "Freshness deadline: " + new Date(freshness.staleAt).toLocaleString() : undefined}>
        {labels[freshness.state]}
      </strong> : <span>Freshness unavailable</span>}
    </div>
    {status.latestCheck ? <>
      <div className="observation-evidence">
        {status.latestCheck.statusCode !== null ? <span>HTTP {status.latestCheck.statusCode}</span> : null}
        <span><span className="observation-label">Latest latency </span><strong>{status.latestCheck.latencyMs.toLocaleString()} ms</strong></span>
        <RelativeAge checkedAt={status.latestCheck.checkedAt} />
      </div>
      {status.latestCheck.errorType ? <p className="observation-error">{status.latestCheck.errorType}{status.latestCheck.errorMessage ? ": " + status.latestCheck.errorMessage : ""}</p> : null}
    </> : <p>No Health Check evidence yet.</p>}
    {freshness?.state === "stale" ? <p className="freshness-explanation"><strong>Excluded from current health.</strong> The observation remains historical evidence but no longer participates in current health.</p> : null}
    {freshness?.state === "excluded" ? <p className="freshness-explanation">Disabled · excluded from current health.</p> : null}
  </div>;
}
