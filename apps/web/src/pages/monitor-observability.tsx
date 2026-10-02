import { useEffect, useState } from "react";
import type { UptimeWindow } from "@pulse/contracts";
import type {
  HealthCheckResponse,
  IncidentResponse,
  MonitorStatusResponse,
  MonitorUptimeResponse,
  PulseApiClient,
} from "../api/client";
import { LoadingState } from "../components/async-states";

type ResourceState<T> =
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; data: T };

function SectionError({ title, retryLabel, onRetry }: {
  title: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="section-error" role="alert">
      <strong>{title}</strong>
      <button className="button button-secondary" type="button" aria-label={retryLabel} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function StatusSection({ apiClient, monitorId }: { apiClient: PulseApiClient; monitorId: string }) {
  const [state, setState] = useState<ResourceState<MonitorStatusResponse>>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void apiClient.getMonitorStatus(monitorId, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setState({ status: "success", data }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [apiClient, monitorId, requestVersion]);

  return (
    <section className="observability-section" aria-labelledby="status-heading">
      <h2 id="status-heading">Current state</h2>
      {state.status === "loading" ? <LoadingState label="Loading status" /> : null}
      {state.status === "error" ? <SectionError title="Status unavailable" retryLabel="Retry status" onRetry={() => setRequestVersion((version) => version + 1)} /> : null}
      {state.status === "success" ? (
        <div className="status-grid">
          <article className="summary-card">
            <span className="summary-label">Latest probe</span>
            <strong className={"state-badge state-" + state.data.probeStatus}>
              {state.data.probeStatus[0].toUpperCase() + state.data.probeStatus.slice(1)}
            </strong>
            {state.data.latestCheck ? (
              <p>Checked {formatDate(state.data.latestCheck.checkedAt)} - {state.data.latestCheck.latencyMs.toLocaleString()} ms</p>
            ) : <p>No Health Check evidence yet.</p>}
          </article>
          <article className="summary-card">
            <span className="summary-label">Incident state</span>
            {state.data.openIncident ? (
              <>
                <strong className="state-badge state-open">Open incident</strong>
                <p>Started {formatDate(state.data.openIncident.startedAt)}</p>
              </>
            ) : (
              <>
                <strong className="state-badge state-neutral">No open incident</strong>
                <p>No active incident is recorded.</p>
              </>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}

function UptimeSection({ apiClient, monitorId }: { apiClient: PulseApiClient; monitorId: string }) {
  const [window, setWindow] = useState<UptimeWindow>("24h");
  const [state, setState] = useState<ResourceState<MonitorUptimeResponse>>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void apiClient.getMonitorUptime(monitorId, window, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted && data.window === window) setState({ status: "success", data });
      },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [apiClient, monitorId, requestVersion, window]);

  return (
    <section className="observability-section" aria-labelledby="uptime-heading">
      <div className="section-heading">
        <div>
          <h2 id="uptime-heading">Check-based uptime</h2>
          <p>Healthy checks as a share of persisted checks in the selected window.</p>
        </div>
        <div className="window-selector" aria-label="Uptime window">
          {(["24h", "7d", "30d"] as const).map((candidate) => (
            <button type="button" key={candidate} aria-pressed={window === candidate} onClick={() => setWindow(candidate)}>
              {candidate}
            </button>
          ))}
        </div>
      </div>
      {state.status === "loading" ? <LoadingState label={"Loading " + window + " uptime"} /> : null}
      {state.status === "error" ? <SectionError title="Uptime unavailable" retryLabel="Retry uptime" onRetry={() => setRequestVersion((version) => version + 1)} /> : null}
      {state.status === "success" ? (
        <div className="uptime-card">
          {state.data.uptimePercentage === null || state.data.totalChecks === 0
            ? <strong>No checks in this window.</strong>
            : <strong className="uptime-percentage">{state.data.uptimePercentage}%</strong>}
          <dl className="uptime-counts">
            <div><dt>Total checks</dt><dd>{state.data.totalChecks}</dd></div>
            <div><dt>Healthy</dt><dd>{state.data.healthyChecks}</dd></div>
            <div><dt>Unhealthy</dt><dd>{state.data.unhealthyChecks}</dd></div>
          </dl>
          <p>{formatDate(state.data.from)} to {formatDate(state.data.to)}</p>
        </div>
      ) : null}
    </section>
  );
}

function HealthChecksSection({ apiClient, monitorId }: { apiClient: PulseApiClient; monitorId: string }) {
  const [state, setState] = useState<ResourceState<HealthCheckResponse[]>>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void apiClient.listHealthChecks(monitorId, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setState({ status: "success", data }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [apiClient, monitorId, requestVersion]);

  return (
    <section className="observability-section" aria-labelledby="checks-heading">
      <h2 id="checks-heading">Recent Health Checks</h2>
      {state.status === "loading" ? <LoadingState label="Loading Health Checks" /> : null}
      {state.status === "error" ? <SectionError title="Health Checks unavailable" retryLabel="Retry Health Checks" onRetry={() => setRequestVersion((version) => version + 1)} /> : null}
      {state.status === "success" && state.data.length === 0 ? <p className="section-empty">No Health Checks yet.</p> : null}
      {state.status === "success" && state.data.length > 0 ? (
        <div className="evidence-list">
          {state.data.map((check) => (
            <article data-testid="health-check" data-check-id={check.id} className="evidence-row" key={check.id}>
              <div>
                <strong className={"state-badge " + (check.healthy ? "state-healthy" : "state-unhealthy")}>
                  {check.healthy ? "Healthy" : "Unhealthy"}
                </strong>
                <span>{formatDate(check.checkedAt)}</span>
              </div>
              <dl className="evidence-fields">
                {check.statusCode !== null ? <div><dt>HTTP</dt><dd>{check.statusCode}</dd></div> : null}
                <div><dt>Latency</dt><dd>{check.latencyMs.toLocaleString()} ms</dd></div>
                {check.errorType ? <div><dt>Error type</dt><dd>{check.errorType}</dd></div> : null}
                {check.errorMessage ? <div><dt>Message</dt><dd>{check.errorMessage}</dd></div> : null}
              </dl>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function IncidentsSection({ apiClient, monitorId }: { apiClient: PulseApiClient; monitorId: string }) {
  const [state, setState] = useState<ResourceState<IncidentResponse[]>>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void apiClient.listIncidents(monitorId, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setState({ status: "success", data }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [apiClient, monitorId, requestVersion]);

  return (
    <section className="observability-section" aria-labelledby="incidents-heading">
      <h2 id="incidents-heading">Incident history</h2>
      {state.status === "loading" ? <LoadingState label="Loading incidents" /> : null}
      {state.status === "error" ? <SectionError title="Incidents unavailable" retryLabel="Retry incidents" onRetry={() => setRequestVersion((version) => version + 1)} /> : null}
      {state.status === "success" && state.data.length === 0 ? <p className="section-empty">No incidents yet.</p> : null}
      {state.status === "success" && state.data.length > 0 ? (
        <div className="evidence-list">
          {state.data.map((incident) => (
            <article data-testid="incident" className="evidence-row" key={incident.id}>
              <div>
                <strong className={"state-badge state-" + incident.status}>
                  {incident.status === "open" ? "Open" : "Resolved"}
                </strong>
                <span>Started {formatDate(incident.startedAt)}</span>
              </div>
              {incident.resolvedAt ? <p>Resolved at {formatDate(incident.resolvedAt)}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function MonitorObservability({ apiClient, monitorId, enabled }: {
  apiClient: PulseApiClient;
  monitorId: string;
  enabled: boolean;
}) {
  return (
    <div className="observability">
      {!enabled ? <p className="configuration-note">Scheduling is disabled. Operational sections show persisted evidence.</p> : null}
      <StatusSection apiClient={apiClient} monitorId={monitorId} />
      <UptimeSection apiClient={apiClient} monitorId={monitorId} />
      <HealthChecksSection apiClient={apiClient} monitorId={monitorId} />
      <IncidentsSection apiClient={apiClient} monitorId={monitorId} />
    </div>
  );
}
