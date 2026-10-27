export type ServiceStatus = "healthy" | "unhealthy" | "unknown";

export type MonitorStatus = "healthy" | "unhealthy" | "unknown";

// Freshness never rewrites the health of a persisted observation.
export type ObservationFreshness =
  | { state: "fresh" | "stale"; staleAt: Date }
  | { state: "no_observation" | "excluded"; staleAt: null };

export type MonitorStatusSnapshot = {
  monitorId: string;
  probeStatus: MonitorStatus;
  latestCheck: HealthCheck | null;
  openIncident: Incident | null;
  freshness: ObservationFreshness;
};

export type UptimeWindow = "24h" | "7d" | "30d";

export type MonitorUptime = {
  monitorId: string;
  window: UptimeWindow;
  from: Date;
  to: Date;
  totalChecks: number;
  healthyChecks: number;
  unhealthyChecks: number;
  uptimePercentage: number | null;
};

export type HealthCheckErrorType =
  | "http_error"
  | "connection_error"
  | "timeout"
  | "dns_error"
  | "tls_error"
  | "network_error";

export type Project = {
  id: string;
  name: string;
  createdAt: Date;
};

export type Service = {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
};

export type HttpMonitor = {
  id: string;
  serviceId: string;
  name: string;
  kind: "http";
  url: string;
  method: "GET" | "HEAD";
  intervalMs: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  enabled: boolean;
  createdAt: Date;
};

export type HealthCheck = {
  id: string;
  monitorId: string;
  healthy: boolean;
  statusCode: number | null;
  latencyMs: number;
  checkedAt: Date;
  errorType: HealthCheckErrorType | null;
  errorMessage: string | null;
};

export type IncidentStatus = "open" | "resolved";

export type Incident = {
  id: string;
  monitorId: string;
  status: IncidentStatus;
  startedAt: Date;
  resolvedAt: Date | null;
};

export type IncidentBoundaryMatch =
  | { match: "exact"; checkId: string }
  | { match: "ambiguous"; checkId: null }
  | { match: "missing"; checkId: null };

export type IncidentEvidenceContext =
  | "opening_predecessor"
  | "opening"
  | "during_start"
  | "during_end"
  | "recovery"
  | "post_recovery";

export type IncidentDiagnosticCheck = HealthCheck & {
  contexts: IncidentEvidenceContext[];
};

export type IncidentThresholdEvidence = {
  configuredThreshold: number;
  returnedCount: number;
  complete: boolean;
  contradictory: boolean;
  truncated: boolean;
};

export type IncidentEvidenceGap = {
  afterCheckId: string;
  beforeCheckId: string;
};

export type IncidentDiagnosticEvidence = {
  thresholdSource: "current_monitor";
  opening: {
    boundary: IncidentBoundaryMatch;
    sequence: IncidentThresholdEvidence;
  };
  recovery: {
    boundary: IncidentBoundaryMatch;
    sequence: IncidentThresholdEvidence;
  } | null;
  during: { truncated: boolean };
  checks: IncidentDiagnosticCheck[];
  gaps: IncidentEvidenceGap[];
  truncated: boolean;
};

export type IncidentDiagnostics = {
  incident: Incident;
  monitor: HttpMonitor;
  durationMs: number | null;
  evidence: IncidentDiagnosticEvidence;
};

export type ServiceHealthState = "healthy" | "degraded" | "down" | "unknown";

export type ServiceHealth = {
  serviceId: string;
  state: ServiceHealthState;
  monitors: {
    total: number;
    enabled: number;
    reporting: number;
    healthy: number;
    unhealthy: number;
    // Enabled Monitors with no observation. Stale evidence is counted separately.
    unknown: number;
    disabled: number;
    // Always emitted by M8; optional for source compatibility with M7 consumers.
    stale?: number;
  };
  // reporting counts only enabled Monitors with fresh latest observations.
  coverage: { reporting: number; enabled: number };
};

export type ServiceHealthSummary = {
  service: Pick<Service, "id" | "name" | "projectId">;
  project: Pick<Project, "id" | "name">;
  health: ServiceHealth;
};

export type Overview = {
  totals: {
    projects: number;
    services: number;
    monitors: number;
    enabledMonitors: number;
    openIncidents: number;
  };
  serviceHealth: Record<ServiceHealthState, number>;
  attention: ServiceHealthSummary[];
};
