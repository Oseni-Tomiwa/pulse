import type {
  HealthCheck,
  HttpMonitor,
  Incident,
  MonitorStatus,
  MonitorUptime,
  Project,
  Service,
  UptimeWindow,
} from "@pulse/contracts";
import type { JsonResponse } from "./types";

export type RequestOptions = {
  signal?: AbortSignal;
};

export type PulseApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type ProjectResponse = JsonResponse<Project>;
export type ServiceResponse = JsonResponse<Service>;
export type MonitorResponse = JsonResponse<HttpMonitor>;
export type HealthCheckResponse = JsonResponse<HealthCheck>;
export type IncidentResponse = JsonResponse<Incident>;
export type MonitorUptimeResponse = JsonResponse<MonitorUptime>;
export type MonitorStatusResponse = {
  monitorId: string;
  probeStatus: MonitorStatus;
  latestCheck: HealthCheckResponse | null;
  openIncident: IncidentResponse | null;
};

export type CreateProjectInput = {
  name: string;
};

export type CreateServiceInput = {
  name: string;
};

export type CreateMonitorInput = {
  name: string;
  url: string;
  method?: HttpMonitor["method"];
  intervalMs?: number;
  timeoutMs?: number;
  failureThreshold?: number;
  recoveryThreshold?: number;
  enabled?: boolean;
};

export type PulseApiClient = {
  listProjects(options?: RequestOptions): Promise<ProjectResponse[]>;
  getProject(projectId: string, options?: RequestOptions): Promise<ProjectResponse>;
  createProject(input: CreateProjectInput, options?: RequestOptions): Promise<ProjectResponse>;
  listServices(projectId: string, options?: RequestOptions): Promise<ServiceResponse[]>;
  createService(
    projectId: string,
    input: CreateServiceInput,
    options?: RequestOptions,
  ): Promise<ServiceResponse>;
  getService(serviceId: string, options?: RequestOptions): Promise<ServiceResponse>;
  listMonitors(serviceId: string, options?: RequestOptions): Promise<MonitorResponse[]>;
  createMonitor(
    serviceId: string,
    input: CreateMonitorInput,
    options?: RequestOptions,
  ): Promise<MonitorResponse>;
  getMonitor(monitorId: string, options?: RequestOptions): Promise<MonitorResponse>;
  getMonitorStatus(monitorId: string, options?: RequestOptions): Promise<MonitorStatusResponse>;
  getMonitorUptime(monitorId: string, window: UptimeWindow, options?: RequestOptions): Promise<MonitorUptimeResponse>;
  listHealthChecks(monitorId: string, options?: RequestOptions): Promise<HealthCheckResponse[]>;
  listIncidents(monitorId: string, options?: RequestOptions): Promise<IncidentResponse[]>;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createPulseApiClient(options: PulseApiClientOptions = {}): PulseApiClient {
  const baseUrl = (options.baseUrl ?? "/api").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(
    path: string,
    requestOptions: RequestOptions & { method?: "POST"; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    const init: RequestInit = { headers, signal: requestOptions.signal };
    if (requestOptions.method) init.method = requestOptions.method;
    if (requestOptions.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(requestOptions.body);
    }

    const response = await fetchImpl(`${baseUrl}${path}`, init);

    if (!response.ok) {
      let message = "Request failed";
      if (response.headers.get("content-type")?.includes("application/json")) {
        try {
          const body: unknown = await response.json();
          if (
            typeof body === "object" && body !== null &&
            "error" in body && typeof body.error === "string"
          ) {
            message = body.error;
          }
        } catch {
          // Keep the generic message when an upstream response is not valid JSON.
        }
      }
      throw new ApiError(response.status, message);
    }

    return response.json() as Promise<T>;
  }

  return {
    listProjects(requestOptions?: RequestOptions) {
      return request<ProjectResponse[]>("/projects", requestOptions);
    },
    getProject(projectId: string, requestOptions?: RequestOptions) {
      return request<ProjectResponse>(
        `/projects/${encodeURIComponent(projectId)}`,
        requestOptions,
      );
    },
    createProject(input: CreateProjectInput, requestOptions?: RequestOptions) {
      return request<ProjectResponse>("/projects", {
        ...requestOptions,
        method: "POST",
        body: input,
      });
    },
    listServices(projectId: string, requestOptions?: RequestOptions) {
      return request<ServiceResponse[]>(
        `/projects/${encodeURIComponent(projectId)}/services`,
        requestOptions,
      );
    },
    createService(
      projectId: string,
      input: CreateServiceInput,
      requestOptions?: RequestOptions,
    ) {
      return request<ServiceResponse>(
        `/projects/${encodeURIComponent(projectId)}/services`,
        {
          ...requestOptions,
          method: "POST",
          body: input,
        },
      );
    },
    getService(serviceId: string, requestOptions?: RequestOptions) {
      return request<ServiceResponse>(
        `/services/${encodeURIComponent(serviceId)}`,
        requestOptions,
      );
    },
    listMonitors(serviceId: string, requestOptions?: RequestOptions) {
      return request<MonitorResponse[]>(
        "/services/" + encodeURIComponent(serviceId) + "/monitors",
        requestOptions,
      );
    },
    createMonitor(
      serviceId: string,
      input: CreateMonitorInput,
      requestOptions?: RequestOptions,
    ) {
      return request<MonitorResponse>(
        "/services/" + encodeURIComponent(serviceId) + "/monitors",
        { ...requestOptions, method: "POST", body: input },
      );
    },
    getMonitor(monitorId: string, requestOptions?: RequestOptions) {
      return request<MonitorResponse>(
        "/monitors/" + encodeURIComponent(monitorId),
        requestOptions,
      );
    },
    getMonitorStatus(monitorId: string, requestOptions?: RequestOptions) {
      return request<MonitorStatusResponse>(
        "/monitors/" + encodeURIComponent(monitorId) + "/status",
        requestOptions,
      );
    },
    getMonitorUptime(monitorId: string, window: UptimeWindow, requestOptions?: RequestOptions) {
      return request<MonitorUptimeResponse>(
        "/monitors/" + encodeURIComponent(monitorId) + "/uptime?window=" + encodeURIComponent(window),
        requestOptions,
      );
    },
    listHealthChecks(monitorId: string, requestOptions?: RequestOptions) {
      return request<HealthCheckResponse[]>(
        "/monitors/" + encodeURIComponent(monitorId) + "/checks",
        requestOptions,
      );
    },
    listIncidents(monitorId: string, requestOptions?: RequestOptions) {
      return request<IncidentResponse[]>(
        "/monitors/" + encodeURIComponent(monitorId) + "/incidents",
        requestOptions,
      );
    },
  };
}
