import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ServiceHealthState } from "@pulse/contracts";
import type { OverviewResponse, PulseApiClient } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/async-states";
import { HealthState } from "../components/health-state";
import { PageHeader } from "./page-header";

type OverviewState = { status: "loading" } | { status: "error" } | { status: "success"; data: OverviewResponse };
const healthStates: ServiceHealthState[] = ["healthy", "degraded", "down", "unknown"];

export function OverviewPage({ apiClient }: { apiClient: PulseApiClient }) {
  const [state, setState] = useState<OverviewState>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void apiClient.getOverview({ signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setState({ status: "success", data }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [apiClient, requestVersion]);

  return <div className="m7-page">
    <PageHeader eyebrow="Workspace" title="Overview" description="Current service health across your monitoring workspace" />
    <div className="observability">
      {state.status === "loading" ? <LoadingState label="Loading overview" /> : null}
      {state.status === "error" ? <ErrorState title="Overview unavailable" description="Pulse could not load the workspace overview." onRetry={() => setRequestVersion(version => version + 1)} /> : null}
      {state.status === "success" ? <>
        <section aria-label="Workspace totals">
          <dl className="m7-metrics">
            {([ ["Projects", state.data.totals.projects], ["Services", state.data.totals.services], ["Monitors", state.data.totals.monitors], ["Open incidents", state.data.totals.openIncidents] ] as const).map(([label, count]) =>
              <div className="m7-metric" key={label}><dt>{label}</dt><dd>{count.toLocaleString()}</dd></div>)}
          </dl>
        </section>
        <div className="m7-overview-health">
          <section className="observability-section" aria-labelledby="overview-service-health">
            <div className="section-heading"><div><h2 id="overview-service-health">Service health</h2><p>Observed health across reporting enabled monitors</p></div><span className="m7-count-label">{state.data.totals.services.toLocaleString()} services</span></div>
            <dl className="m7-health-counts">{healthStates.map(candidate => <div key={candidate}><dt><HealthState state={candidate} /></dt><dd>{state.data.serviceHealth[candidate].toLocaleString()}</dd></div>)}</dl>
            <p className="configuration-note m7-note">Unknown monitors reduce reporting coverage; they do not become evidence that a service is healthy or unhealthy.</p>
          </section>
          <section className="observability-section" aria-labelledby="how-health-works">
            <h2 id="how-health-works">How Pulse reads health</h2>
            <p className="m7-explanation">Healthy means all reporting monitors are healthy. Down means all reporting monitors are unhealthy. Degraded means Pulse observes both healthy and unhealthy monitors.</p>
            <p className="m7-muted">Observation staleness is not evaluated.</p>
          </section>
        </div>
        <section className="observability-section" aria-labelledby="attention-heading">
          <div className="section-heading"><div><h2 id="attention-heading">Needs attention</h2><p>Down, degraded, and unknown services · ordered by observed severity</p></div><span className="m7-count-label">{state.data.attention.length.toLocaleString()} services</span></div>
          {state.data.attention.length === 0 ? (state.data.totals.services === 0
            ? <EmptyState title="No services yet" description="Create a Project, add a Service, and attach a Monitor to start collecting observations." action={<Link className="text-link" to="/projects">Go to Projects</Link>} />
            : <EmptyState title="No services need attention" description="No down, degraded, or unknown Services were returned in this overview." />)
            : <ul className="m7-attention-list" aria-label="Services needing attention">
              {state.data.attention.map(entry => <li key={entry.service.id}>
                <Link className="m7-attention-row" to={"/services/" + encodeURIComponent(entry.service.id)}>
                  <span className="m7-attention-identity"><strong>{entry.service.name}</strong><span>{entry.project.name}</span></span>
                  <HealthState state={entry.health.state} />
                  <span className="m7-coverage-text">{entry.health.coverage.reporting.toLocaleString()} of {entry.health.coverage.enabled.toLocaleString()} monitors reporting</span>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>)}
            </ul>}
        </section>
      </> : null}
    </div>
  </div>;
}
