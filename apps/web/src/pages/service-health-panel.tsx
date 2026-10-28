import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import type { MonitorStatusResponse, MonitorResponse, PulseApiClient, ServiceHealthResponse } from "../api/client";
import { ErrorState, LoadingState } from "../components/async-states";
import { LatestObservation } from "../components/latest-observation";
import { RefreshWarning, useLiveResource } from "../live/live-refresh";
import { HealthState } from "../components/health-state";

const explanations: Record<ServiceHealthResponse["state"], string> = {
  healthy: "All fresh observations from enabled monitors are healthy.",
  degraded: "Pulse currently observes both healthy and unhealthy fresh evidence.",
  down: "All fresh observations from enabled monitors are unhealthy.",
  unknown: "No enabled monitor has a fresh observation.",
};
export function ServiceHealthPanel({ apiClient, serviceId, refreshVersion }: { apiClient: PulseApiClient; serviceId: string; refreshVersion: number }) {
  const [retryVersion, setRetryVersion] = useState(0);
  const load = useCallback((signal: AbortSignal) => apiClient.getServiceHealth(serviceId, { signal }), [apiClient, serviceId]);
  const state = useLiveResource(load, serviceId, refreshVersion + retryVersion);

  return <section className="details-section m7-service-health" aria-label="Service health">
    {state.status !== "success" ? <h2 id="service-health-heading">Current Service Health</h2> : null}
    {state.status === "loading" ? <LoadingState label="Loading service health" /> : null}
    {state.status === "error" ? <ErrorState title="Service health unavailable" description="Pulse could not load this Service's derived health." onRetry={() => setRetryVersion(version => version + 1)} /> : null}
    {state.status === "success" ? <>
      <RefreshWarning failed={state.refreshFailed} label="Service health" />
      <div className="observability-section m7-service-hero">
        <div><h2 id="service-health-heading">Current Service Health</h2><HealthState state={state.data.state} large /><p className="m7-muted">{explanations[state.data.state]}</p></div>
        <div className="m7-coverage"><span>Current coverage</span><strong>{state.data.coverage.reporting.toLocaleString()} / {state.data.coverage.enabled.toLocaleString()}</strong><span>enabled monitors with fresh evidence</span></div>
      </div>
      <ul className="m7-metrics" aria-label="Monitor health counts">
        {([ ["Total monitors", state.data.monitors.total], ["Fresh observations", state.data.monitors.reporting], ["Stale observations", state.data.monitors.stale ?? 0], ["No observation", state.data.monitors.unknown] ] as const).map(([label, count]) => <li className="m7-metric" key={label}><span>{label}</span><strong>{count.toLocaleString()}</strong>{label === "Total monitors" ? <small>{state.data.monitors.enabled.toLocaleString()} enabled · {state.data.monitors.disabled.toLocaleString()} disabled</small> : null}</li>)}
      </ul>
      <p className="configuration-note m7-note"><strong>Coverage is separate from health.</strong> Disabled monitors do not participate. Stale observations and monitors with no observation reduce current coverage without becoming evidence of healthy or unhealthy current health. Historical outcomes remain unchanged.</p>
    </> : null}
  </section>;
}

export function ServiceMonitorCard({ apiClient, monitor }: { apiClient: PulseApiClient; monitor: MonitorResponse }) {
  const load = useCallback((signal: AbortSignal) => apiClient.getMonitorStatus(monitor.id, { signal }), [apiClient, monitor.id]);
  const state = useLiveResource(load, monitor.id, 0, monitor.enabled);
  return <Link className="monitor-card m7-monitor-card" to={"/monitors/" + encodeURIComponent(monitor.id)}>
    <span className="m7-monitor-identity"><strong>{monitor.name}</strong><span>{monitor.method} {monitor.url}</span><small>{monitor.enabled ? "Monitoring enabled" : "Monitoring disabled"}</small></span>
    {!monitor.enabled ? <strong className="m7-disabled">Disabled · excluded</strong>
      : state.status === "loading" ? <span role="status">Loading observation</span>
        : state.status === "error" ? <span>Observation unavailable</span>
          : <div className="monitor-observation"><LatestObservation status={state.data} />
              {state.data.openIncident ? <span className="state-badge state-open">Incident open</span> : null}
              <RefreshWarning failed={state.refreshFailed} label="Observation" />
            </div>}
  </Link>;
}
