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
  url: string;
  status: ServiceStatus;
  checkIntervalMs: number;
  timeoutMs: number;
  createdAt: Date;
};

export type HealthCheck = {
  id: string;
  serviceId: string;
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
  serviceId: string;
  status: IncidentStatus;
  startedAt: Date;
  resolvedAt: Date | null;
};