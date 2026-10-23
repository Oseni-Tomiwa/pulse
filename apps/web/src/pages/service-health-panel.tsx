import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MonitorStatusResponse, MonitorResponse, PulseApiClient, ServiceHealthResponse } from "../api/client";
import { ErrorState, LoadingState } from "../components/async-states";
import { HealthState } from "../components/health-state";

const explanations: Record<ServiceHealthResponse["state"], string> = {
  healthy: "All reporting enabled monitors are healthy.",
  degraded: "Pulse observes both healthy and unhealthy enabled monitors.",
  down: "All reporting enabled monitors are unhealthy.",
  unknown: "No enabled monitors are reporting persisted HealthCheck evidence.",
};
type HealthResource = { status: "loading" } | { status: "error" } | { status: "success"; data: ServiceHealthResponse };

export function ServiceHealthPanel({ apiClient, serviceId, refreshVersion }: { apiClient: PulseApiClient; serviceId: string; refreshVersion: number }) {
  const [state, setState] = useState<HealthResource>({ status: "loading" });
  const [retryVersion, setRetryVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void apiClient.getServiceHealth(serviceId, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setState({ status: "success", data }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [apiClient, serviceId, refreshVersion, retryVersion]);

  return <section className="details-section m7-service-health" aria-labelledby="service-health-heading">
    {state.status !== "success" ? <h2 id="service-health-heading">Service health</h2> : null}
    {state.status === "loading" ? <LoadingState label="Loading service health" /> : null}
    {state.status === "error" ? <ErrorState title="Service health unavailable" description="Pulse could not load this Service's derived health." onRetry={() => setRetryVersion(version => version + 1)} /> : null}
    {state.status === "success" ? <>
      <div className="observability-section m7-service-hero">
        <div><h2 id="service-health-heading">Service health</h2><HealthState state={state.data.state} large /><p className="m7-muted">{explanations[state.data.state]}</p></div>
        <div className="m7-coverage"><span>Reporting coverage</span><strong>{state.data.coverage.reporting.toLocaleString()} / {state.data.coverage.enabled.toLocaleString()}</strong><span>enabled monitors reporting</span></div>
      </div>
      <ul className="m7-metrics" aria-label="Monitor health counts">
        {([ ["Total monitors", state.data.monitors.total], ["Healthy", state.data.monitors.healthy], ["Unhealthy", state.data.monitors.unhealthy], ["Unknown", state.data.monitors.unknown] ] as const).map(([label, count]) => <li className="m7-metric" key={label}><span>{label}</span><strong>{count.toLocaleString()}</strong>{label === "Total monitors" ? <small>{state.data.monitors.enabled.toLocaleString()} enabled · {state.data.monitors.disabled.toLocaleString()} disabled</small> : null}</li>)}
      </ul>
      <p className="configuration-note m7-note"><strong>Coverage is separate from health.</strong> Disabled monitors do not participate. Enabled monitors without a HealthCheck are Unknown and reduce reporting coverage without being treated as healthy or unhealthy.</p>
    </> : null}
  </section>;
}

type ObservationResource = { status: "loading" } | { status: "error" } | { status: "success"; data: MonitorStatusResponse };
export function ServiceMonitorCard({ apiClient, monitor }: { apiClient: PulseApiClient; monitor: MonitorResponse }) {
  const [state, setState] = useState<ObservationResource>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    if (!monitor.enabled) return () => controller.abort();
    setState({ status: "loading" });
    void apiClient.getMonitorStatus(monitor.id, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setState({ status: "success", data }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [apiClient, monitor.id, monitor.enabled]);

  return <Link className="monitor-card m7-monitor-card" to={"/monitors/" + encodeURIComponent(monitor.id)}>
    <span className="m7-monitor-identity"><strong>{monitor.name}</strong><span>{monitor.method} {monitor.url}</span><small>{monitor.enabled ? "Monitoring enabled" : "Monitoring disabled"}</small></span>
    {!monitor.enabled ? <strong className="m7-disabled">Disabled · excluded</strong>
      : state.status === "loading" ? <span role="status">Loading observation</span>
        : state.status === "error" ? <span>Observation unavailable</span>
          : <HealthState state={state.data.probeStatus} />}
  </Link>;
}
