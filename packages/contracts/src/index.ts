export type ServiceStatus = "healthy" | "unhealthy" | "unknown";

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
