import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, type MonitorResponse, type PulseApiClient } from "../api/client";
import { ErrorState, LoadingState } from "../components/async-states";
import { MonitorObservability } from "./monitor-observability";
import { PageHeader } from "./page-header";

type MonitorState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error" }
  | { status: "success"; monitor: MonitorResponse };

export function MonitorDetailsPage({ apiClient }: { apiClient: PulseApiClient }) {
  const { monitorId } = useParams();
  const [state, setState] = useState<MonitorState>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!monitorId) {
      setState({ status: "notFound" });
      return () => controller.abort();
    }
    setState({ status: "loading" });
    void apiClient.getMonitor(monitorId, { signal: controller.signal }).then(
      (monitor) => {
        if (!controller.signal.aborted) setState({ status: "success", monitor });
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setState(cause instanceof ApiError && cause.status === 404 ? { status: "notFound" } : { status: "error" });
      },
    );
    return () => controller.abort();
  }, [apiClient, monitorId, requestVersion]);

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
