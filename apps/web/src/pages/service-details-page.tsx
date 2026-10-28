import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  type MonitorResponse,
  type PulseApiClient,
} from "../api/client";
import { LiveRefreshStatus, RefreshWarning, useLiveResource } from "../live/live-refresh";
import { EmptyState, ErrorState, LoadingState } from "../components/async-states";
import { CreateMonitorForm } from "./create-monitor-form";
import { PageHeader } from "./page-header";
import { ServiceHealthPanel, ServiceMonitorCard } from "./service-health-panel";

export function ServiceDetailsPage({ apiClient }: { apiClient: PulseApiClient }) {
  const { serviceId } = useParams();
  const [serviceRequestVersion, setServiceRequestVersion] = useState(0);
  const [monitorsRequestVersion, setMonitorsRequestVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [healthVersion, setHealthVersion] = useState(0);
  useEffect(() => { setCreating(false); }, [serviceId]);
  const loadService = useCallback((signal: AbortSignal) => apiClient.getService(serviceId!, { signal }), [apiClient, serviceId]);
  const serviceResource = useLiveResource(loadService, serviceId ?? "missing-service", serviceRequestVersion, !!serviceId);
  const serviceState = serviceResource.status === "success" ? { status: "success" as const, service: serviceResource.data }
    : serviceResource.status === "error" && serviceResource.cause instanceof ApiError && serviceResource.cause.status === 404
      ? { status: "notFound" as const } : serviceResource;
  const loadMonitors = useCallback((signal: AbortSignal) => apiClient.listMonitors(serviceId!, { signal }), [apiClient, serviceId]);
  const monitorsResource = useLiveResource(loadMonitors, serviceId ?? "missing-service", monitorsRequestVersion, serviceState.status === "success");
  const monitorsState = monitorsResource.status === "success" ? { status: "success" as const, monitors: monitorsResource.data } : monitorsResource;

  function addCreatedMonitor(monitor: MonitorResponse) {
    setHealthVersion(version => version + 1);
    monitorsResource.setData(monitors => [monitor, ...monitors.filter(({ id }) => id !== monitor.id)]);
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
      <LiveRefreshStatus />
      {serviceResource.status === "success" ? <RefreshWarning failed={serviceResource.refreshFailed} label="Service" /> : null}
      <Link className="text-link hierarchy-link" to={"/projects/" + serviceState.service.projectId}>Back to Project</Link>
      <div className="page-toolbar">
        <PageHeader eyebrow="Project / Service" title={serviceState.service.name} description={"Created " + new Date(serviceState.service.createdAt).toLocaleDateString()} />
        {monitorsState.status === "success" && !creating ? <button className="button" type="button" onClick={() => setCreating(true)}>Create Monitor</button> : null}
      </div>
      <ServiceHealthPanel key={serviceState.service.id} apiClient={apiClient} serviceId={serviceState.service.id} refreshVersion={healthVersion} />
      <section className="details-section observability-section m7-page" aria-labelledby="monitors-heading">
        <div className="section-heading"><div><h2 id="monitors-heading">Monitors</h2><p>Historical outcome and freshness are shown separately</p></div></div>
        {monitorsState.status === "loading" ? <LoadingState label="Loading monitors" /> : null}
        {monitorsState.status === "error" ? <ErrorState title="Monitors unavailable" description="Pulse could not load this Service's Monitors." onRetry={() => setMonitorsRequestVersion((version) => version + 1)} /> : null}
        {monitorsResource.status === "success" ? <RefreshWarning failed={monitorsResource.refreshFailed} label="Monitors" /> : null}
        {monitorsState.status === "success" ? (
          <>
            {creating && serviceId ? <CreateMonitorForm apiClient={apiClient} serviceId={serviceId} onCancel={() => setCreating(false)} onCreated={addCreatedMonitor} /> : null}
            {monitorsState.monitors.length === 0 ? <EmptyState title="No monitors yet" description="Create an HTTP Monitor for this Service." /> : (
              <div className="m7-monitor-list">
                {monitorsState.monitors.map((monitor) => (
                  <ServiceMonitorCard key={monitor.id} apiClient={apiClient} monitor={monitor} />
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>
    </>
  );
}
