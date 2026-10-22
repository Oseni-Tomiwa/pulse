import { Fragment, useEffect, useState } from "react";
import type { IncidentEvidenceContext } from "@pulse/contracts";
import { Link, useParams } from "react-router-dom";
import { ApiError, type IncidentDiagnosticsResponse, type PulseApiClient } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/async-states";
import { PageHeader } from "./page-header";

type IncidentState =
  | { status: "loading" }
  | { status: "error"; code: number }
  | { status: "success"; id: string; data: IncidentDiagnosticsResponse };
type BoundaryEvidence = IncidentDiagnosticsResponse["evidence"]["opening"];

const contextLabels: Record<IncidentEvidenceContext, string> = {
  opening_predecessor: "Before opening sequence",
  opening: "Opening sequence",
  during_start: "First checks after opening",
  during_end: "Last checks before recovery / latest while open",
  recovery: "Recovery sequence",
  post_recovery: "First check after resolution",
};

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms.toLocaleString()} ms`;
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return [days ? `${days} d` : null, hours ? `${hours} hr` : null, minutes ? `${minutes} min` : null, remainder ? `${remainder} sec` : null].filter(Boolean).join(" ");
}

function BoundaryCard({ title, evidence }: { title: string; evidence: BoundaryEvidence }) {
  const { boundary, sequence } = evidence;
  const warning = boundary.match !== "exact" || !sequence.complete || sequence.contradictory || sequence.truncated;
  const headingId = title === "Opening boundary" ? "opening-boundary" : "recovery-boundary";
  return (
    <section className={"diagnostic-boundary" + (warning ? " diagnostic-warning" : "")} aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <strong className="state-badge state-neutral">{boundary.match === "exact" ? "Exact" : boundary.match === "ambiguous" ? "Ambiguous" : "Missing"}</strong>
      <p>{boundary.match === "exact"
        ? "Pulse identifies a unique HealthCheck at the boundary timestamp."
        : boundary.match === "ambiguous"
          ? "Multiple HealthChecks share the boundary timestamp. Pulse cannot identify which check triggered the transition."
          : "No persisted HealthCheck matches the boundary timestamp."}</p>
      <p><strong>{sequence.returnedCount} of {sequence.configuredThreshold} checks</strong> · {sequence.complete ? "Complete" : "Incomplete"} threshold evidence</p>
      {sequence.contradictory ? <p className="integrity-message"><strong>Contradictory persisted evidence.</strong> Selected checks include outcomes inconsistent with this threshold sequence.</p> : null}
      {sequence.truncated ? <p className="integrity-message"><strong>Threshold evidence truncated.</strong> Only part of the configured sequence is displayed.</p> : null}
    </section>
  );
}

function IncidentDetails({ data }: { data: IncidentDiagnosticsResponse }) {
  const { incident, monitor, durationMs, evidence } = data;
  return (
    <>
      <Link className="text-link hierarchy-link" to={"/monitors/" + encodeURIComponent(monitor.id)}>Back to Monitor</Link>
      <PageHeader eyebrow="Incident diagnostics" title="Incident details" description="What did Pulse actually observe around this incident?" />
      <div className="observability incident-diagnostics">
        <section className="observability-section" aria-labelledby="incident-summary">
          <div className="section-heading"><h2 id="incident-summary">Incident summary</h2><strong className={"state-badge state-" + incident.status}>{incident.status === "open" ? "Open" : "Resolved"}</strong></div>
          <dl className="configuration-list incident-summary-grid">
            <div><dt>Monitor</dt><dd>{monitor.name}</dd></div>
            <div><dt>URL</dt><dd className="configuration-value">{monitor.url}</dd></div>
            <div><dt>HTTP method</dt><dd>{monitor.method}</dd></div>
            <div><dt>Opened</dt><dd><Timestamp value={incident.startedAt} /></dd></div>
            {incident.resolvedAt !== null ? <div><dt>Resolved at</dt><dd><Timestamp value={incident.resolvedAt} /></dd></div> : null}
            <div><dt>Duration</dt><dd>{durationMs !== null ? formatDuration(durationMs) : incident.status === "open" ? "Duration becomes available after resolution." : "Duration unavailable."}</dd></div>
            <div><dt>Configured interval</dt><dd>{monitor.intervalMs.toLocaleString()} ms</dd></div>
            <div><dt>Configured timeout</dt><dd>{monitor.timeoutMs.toLocaleString()} ms</dd></div>
            <div><dt>Current failure threshold</dt><dd>{monitor.failureThreshold}</dd></div>
            <div><dt>Current recovery threshold</dt><dd>{monitor.recoveryThreshold}</dd></div>
          </dl>
          {evidence.thresholdSource === "current_monitor" ? <p className="diagnostic-config-note">Displayed failure/recovery thresholds are the Monitor’s current configuration and may differ from configuration at the time of this incident. Other Monitor settings are also current; historical configuration is not reconstructed.</p> : null}
        </section>
        <div className="diagnostic-boundaries">
          <BoundaryCard title="Opening boundary" evidence={evidence.opening} />
          {evidence.recovery !== null ? <BoundaryCard title="Recovery boundary" evidence={evidence.recovery} /> : null}
        </div>
        <section className="observability-section" aria-labelledby="diagnostic-evidence">
          <div className="section-heading"><div><h2 id="diagnostic-evidence">Observed evidence</h2><p>Persisted HTTP observations, earliest first. These observations do not establish root cause.</p></div></div>
          {evidence.truncated ? <div className="configuration-note diagnostic-warning"><strong>Bounded diagnostic window · up to 64 checks.</strong><p>Some evidence was omitted. This is not the complete Monitor history.</p></div> : null}
          {evidence.checks.length === 0 ? <EmptyState title="No persisted evidence available for this incident." description="The incident is recorded, but no HealthChecks were returned for its diagnostic selections." /> : (
            <ol className="diagnostic-timeline" aria-label="Diagnostic evidence">
              {evidence.checks.map((check, index) => {
                const previous = evidence.checks[index - 1];
                const gap = previous && evidence.gaps.some(item => item.afterCheckId === previous.id && item.beforeCheckId === check.id);
                return <Fragment key={check.id}>
                  {gap ? <li className="diagnostic-gap"><strong>Persisted checks omitted</strong><span>Evidence between these checks is not displayed.</span></li> : null}
                  <li data-testid="diagnostic-check" data-check-id={check.id} className="evidence-row diagnostic-check">
                    <div><strong className={"state-badge " + (check.healthy ? "state-healthy" : "state-unhealthy")}>{check.healthy ? "Healthy" : "Unhealthy"}</strong><Timestamp value={check.checkedAt} /></div>
                    <ul className="diagnostic-contexts" aria-label="Diagnostic contexts">{check.contexts.map(context => <li key={context}>{context === "during_end" ? (incident.status === "open" ? "Latest checks while open" : "Last checks before recovery") : contextLabels[context]}</li>)}</ul>
                    <dl className="evidence-fields">
                      {check.statusCode !== null ? <div><dt>HTTP status</dt><dd>{check.statusCode}</dd></div> : null}
                      {check.latencyMs !== null ? <div><dt>Latency</dt><dd>{check.latencyMs.toLocaleString()} ms</dd></div> : null}
                      {check.errorType !== null ? <div><dt>Error type</dt><dd>{check.errorType}</dd></div> : null}
                      {check.errorMessage !== null ? <div><dt>Error message</dt><dd className="diagnostic-message">{check.errorMessage}</dd></div> : null}
                    </dl>
                  </li>
                </Fragment>;
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

export function IncidentDetailsPage({ apiClient }: { apiClient: PulseApiClient }) {
  const { incidentId } = useParams();
  const [state, setState] = useState<IncidentState>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    if (!incidentId) { setState({ status: "error", code: 400 }); return () => controller.abort(); }
    void apiClient.getIncidentDiagnostics(incidentId, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setState({ status: "success", id: incidentId, data }); },
      cause => { if (!controller.signal.aborted) setState({ status: "error", code: cause instanceof ApiError ? cause.status : 500 }); },
    );
    return () => controller.abort();
  }, [apiClient, incidentId, requestVersion]);
  if (state.status === "loading" || (state.status === "success" && state.id !== incidentId)) return <LoadingState label="Loading incident diagnostics" />;
  if (state.status === "error") {
    const title = state.code === 400 ? "Invalid incident ID" : state.code === 404 ? "Incident not found" : "Incident diagnostics unavailable";
    const description = state.code === 400 ? "The incident link is malformed. Open diagnostics from Monitor incident history." : state.code === 404 ? "This incident does not exist or is no longer available." : "Pulse could not load this incident. Please try again.";
    return <><PageHeader eyebrow="Incident diagnostics" title={title} description={description} /><ErrorState title={title} description={description} onRetry={state.code !== 400 && state.code !== 404 ? () => setRequestVersion(version => version + 1) : undefined} /><Link className="text-link" to="/projects">Back to Projects</Link></>;
  }
  return <IncidentDetails data={state.data} />;
}
