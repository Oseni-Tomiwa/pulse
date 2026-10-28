import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import type { ServiceHealthState } from "@pulse/contracts";
import type { PulseApiClient } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/async-states";
import { HealthState } from "../components/health-state";
import { PageHeader } from "./page-header";

import { LiveRefreshStatus, RefreshWarning, useLiveResource } from "../live/live-refresh";
const healthStates: ServiceHealthState[] = ["healthy", "degraded", "down", "unknown"];

export function OverviewPage({ apiClient }: { apiClient: PulseApiClient }) {
  const [requestVersion, setRequestVersion] = useState(0);
  const load = useCallback((signal: AbortSignal) => apiClient.getOverview({ signal }), [apiClient]);
  const state = useLiveResource(load, "overview", requestVersion);

  return <div className="m7-page">
    <PageHeader eyebrow="Workspace" title="Overview" description="Current service health across your monitoring workspace" />
    <LiveRefreshStatus />
    <div className="observability">
      {state.status === "loading" ? <LoadingState label="Loading overview" /> : null}
      {state.status === "error" ? <ErrorState title="Overview unavailable" description="Pulse could not load the workspace overview." onRetry={() => setRequestVersion(version => version + 1)} /> : null}
      {state.status === "success" ? <>
        <RefreshWarning failed={state.refreshFailed} label="Overview" />
        <section aria-label="Workspace totals">
          <dl className="m7-metrics">
            {([ ["Projects", state.data.totals.projects], ["Services", state.data.totals.services], ["Monitors", state.data.totals.monitors], ["Open incidents", state.data.totals.openIncidents] ] as const).map(([label, count]) =>
              <div className="m7-metric" key={label}><dt>{label}</dt><dd>{count.toLocaleString()}</dd></div>)}
          </dl>
        </section>
        <div className="m7-overview-health">
          <section className="observability-section" aria-labelledby="overview-service-health">
            <div className="section-heading"><div><h2 id="overview-service-health">Service health</h2><p>Current health uses fresh observations only</p></div><span className="m7-count-label">{state.data.totals.services.toLocaleString()} services</span></div>
            <dl className="m7-health-counts">{healthStates.map(candidate => <div key={candidate}><dt><HealthState state={candidate} /></dt><dd>{state.data.serviceHealth[candidate].toLocaleString()}</dd></div>)}</dl>
            <p className="configuration-note m7-note">Freshness is separate from health. Stale observations remain historical evidence but do not count toward current health or coverage.</p>
          </section>
          <section className="observability-section" aria-labelledby="how-health-works">
            <h2 id="how-health-works">How Pulse reads current health</h2>
            <p className="m7-explanation">Healthy means all current observations are healthy. Down means all are unhealthy. Degraded means fresh evidence is mixed. If no fresh observation remains, the Service is Unknown.</p>
            <p className="m7-muted">Current coverage counts enabled monitors with fresh observations.</p>
          </section>
        </div>
        <section className="observability-section" aria-labelledby="attention-heading">
          <div className="section-heading"><div><h2 id="attention-heading">Needs attention</h2><p>Health problems, unknown health, and incomplete current coverage</p></div><span className="m7-count-label">{state.data.attention.length.toLocaleString()} services</span></div>
          {state.data.attention.length === 0 ? (state.data.totals.services === 0
            ? <EmptyState title="No services yet" description="Create a Project, add a Service, and attach a Monitor to start collecting observations." action={<Link className="text-link" to="/projects">Go to Projects</Link>} />
            : <EmptyState title="No services need attention" description="All Services have Healthy current health and complete current coverage." />)
            : <ul className="m7-attention-list" aria-label="Services needing attention">
              {state.data.attention.map(entry => <li key={entry.service.id}>
                <Link className="m7-attention-row" to={"/services/" + encodeURIComponent(entry.service.id)}>
                  <span className="m7-attention-identity"><strong>{entry.service.name}</strong><span>{entry.project.name}</span></span>
                  <HealthState state={entry.health.state} />
                  <span className="m7-coverage-text">{entry.health.coverage.reporting.toLocaleString()} of {entry.health.coverage.enabled.toLocaleString()} current{entry.health.state === "healthy" && entry.health.coverage.reporting < entry.health.coverage.enabled ? <small className="coverage-reason">Incomplete current coverage</small> : null}</span>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>)}
            </ul>}
        </section>
      </> : null}
    </div>
  </div>;
}
