import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, type PulseApiClient } from "../api/client";
import { LiveRefreshStatus, RefreshWarning, useLiveResource } from "../live/live-refresh";
import { ErrorState, LoadingState } from "../components/async-states";
import { MonitorObservability } from "./monitor-observability";
import { PageHeader } from "./page-header";

export function MonitorDetailsPage({ apiClient }: { apiClient: PulseApiClient }) {
  const { monitorId } = useParams();
  const [requestVersion, setRequestVersion] = useState(0);
  const load = useCallback((signal: AbortSignal) => apiClient.getMonitor(monitorId!, { signal }), [apiClient, monitorId]);
  const resource = useLiveResource(load, monitorId ?? "missing-monitor", requestVersion, !!monitorId);
  const state = resource.status === "success" ? { status: "success" as const, monitor: resource.data }
    : resource.status === "error" && resource.cause instanceof ApiError && resource.cause.status === 404
      ? { status: "notFound" as const } : resource;

  if (state.status === "loading") return <LoadingState label="Loading monitor" />;
  if (state.status === "error") {
    return <ErrorState title="Monitor unavailable" description="Pulse could not load this Monitor." onRetry={() => setRequestVersion((version) => version + 1)} />;
  }
  if (state.status === "notFound") {
    return <div className="not-found-state"><PageHeader eyebrow="Monitor" title="Monitor not found" description="This Monitor does not exist or is no longer available." /><Link className="text-link" to="/projects">Back to Projects</Link></div>;
  }

  const { monitor } = state;
  return (
    <>
      <LiveRefreshStatus />
      {resource.status === "success" ? <RefreshWarning failed={resource.refreshFailed} label="Monitor" /> : null}
      <Link className="text-link hierarchy-link" to={"/services/" + monitor.serviceId}>Back to Service</Link>
      <PageHeader eyebrow="Project / Service / Monitor" title={monitor.name} description={"Created " + new Date(monitor.createdAt).toLocaleDateString()} />
      <dl className="configuration-list">
        <div><dt>Type</dt><dd>HTTP</dd></div>
        <div><dt>URL</dt><dd className="configuration-value">{monitor.url}</dd></div>
        <div><dt>Method</dt><dd>{monitor.method}</dd></div>
        <div><dt>Configuration</dt><dd>{monitor.enabled ? "Monitoring enabled" : "Monitoring disabled"}</dd></div>
        <div><dt>Interval</dt><dd>{monitor.intervalMs.toLocaleString()} ms</dd></div>
        <div><dt>Timeout</dt><dd>{monitor.timeoutMs.toLocaleString()} ms</dd></div>
        <div><dt>Failure threshold</dt><dd>{monitor.failureThreshold}</dd></div>
        <div><dt>Recovery threshold</dt><dd>{monitor.recoveryThreshold}</dd></div>
      </dl>
      <MonitorObservability apiClient={apiClient} monitorId={monitor.id} enabled={monitor.enabled} />
    </>
  );
}
