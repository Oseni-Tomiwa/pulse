import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  type MonitorResponse,
  type PulseApiClient,
  type ServiceResponse,
} from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/async-states";
import { CreateMonitorForm } from "./create-monitor-form";
import { PageHeader } from "./page-header";

type ServiceState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error" }
  | { status: "success"; service: ServiceResponse };

type MonitorsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; monitors: MonitorResponse[] };

export function ServiceDetailsPage({ apiClient }: { apiClient: PulseApiClient }) {
  const { serviceId } = useParams();
  const [serviceState, setServiceState] = useState<ServiceState>({ status: "loading" });
  const [monitorsState, setMonitorsState] = useState<MonitorsState>({ status: "idle" });
  const [serviceRequestVersion, setServiceRequestVersion] = useState(0);
  const [monitorsRequestVersion, setMonitorsRequestVersion] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (!serviceId) {
      setServiceState({ status: "notFound" });
      return () => controller.abort();
    }
    setServiceState({ status: "loading" });
    setMonitorsState({ status: "idle" });
    setCreating(false);
    void apiClient.getService(serviceId, { signal: controller.signal }).then(
      (service) => {
        if (!controller.signal.aborted) setServiceState({ status: "success", service });
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setServiceState(cause instanceof ApiError && cause.status === 404 ? { status: "notFound" } : { status: "error" });
      },
    );
    return () => controller.abort();
  }, [apiClient, serviceId, serviceRequestVersion]);

  useEffect(() => {
    if (serviceState.status !== "success" || !serviceId) return;
    const controller = new AbortController();
    setMonitorsState({ status: "loading" });
    setCreating(false);
    void apiClient.listMonitors(serviceId, { signal: controller.signal }).then(
      (monitors) => {
        if (!controller.signal.aborted) setMonitorsState({ status: "success", monitors });
      },
      () => {
        if (!controller.signal.aborted) setMonitorsState({ status: "error" });
      },
    );
    return () => controller.abort();
  }, [apiClient, serviceId, serviceState.status, monitorsRequestVersion]);

  function addCreatedMonitor(monitor: MonitorResponse) {
    setMonitorsState((current) => current.status === "success"
      ? { status: "success", monitors: [monitor, ...current.monitors.filter(({ id }) => id !== monitor.id)] }
      : current);
    setCreating(false);
  }

  if (serviceState.status === "loading") return <LoadingState label="Loading service" />;
  if (serviceState.status === "error") {
    return <ErrorState title="Service unavailable" description="Pulse could not load this Service." onRetry={() => setServiceRequestVersion((version) => version + 1)} />;
  }
  if (serviceState.status === "notFound") {
    return <div className="not-found-state"><PageHeader eyebrow="Service" title="Service not found" description="This Service does not exist or is no longer available." /><Link className="text-link" to="/projects">Back to Projects</Link></div>;
  }

  return (
    <>
      <Link className="text-link hierarchy-link" to={"/projects/" + serviceState.service.projectId}>Back to Project</Link>
      <div className="page-toolbar">
        <PageHeader eyebrow="Project / Service" title={serviceState.service.name} description={"Created " + new Date(serviceState.service.createdAt).toLocaleDateString()} />
        {monitorsState.status === "success" && !creating ? <button className="button" type="button" onClick={() => setCreating(true)}>Create Monitor</button> : null}
      </div>
      <section className="details-section" aria-labelledby="monitors-heading">
        <h2 id="monitors-heading">Monitors</h2>
        {monitorsState.status === "idle" || monitorsState.status === "loading" ? <LoadingState label="Loading monitors" /> : null}
        {monitorsState.status === "error" ? <ErrorState title="Monitors unavailable" description="Pulse could not load this Service's Monitors." onRetry={() => setMonitorsRequestVersion((version) => version + 1)} /> : null}
        {monitorsState.status === "success" ? (
          <>
            {creating && serviceId ? <CreateMonitorForm apiClient={apiClient} serviceId={serviceId} onCancel={() => setCreating(false)} onCreated={addCreatedMonitor} /> : null}
            {monitorsState.monitors.length === 0 ? <EmptyState title="No monitors yet" description="Create an HTTP Monitor for this Service." /> : (
              <div className="monitor-grid">
                {monitorsState.monitors.map((monitor) => (
                  <Link className="monitor-card" to={"/monitors/" + monitor.id} key={monitor.id}>
                    <strong>{monitor.name}</strong>
                    <span>{monitor.method} {monitor.url}</span>
                    <span>{monitor.enabled ? "Monitoring enabled" : "Monitoring disabled"}</span>
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>
    </>
  );
}
