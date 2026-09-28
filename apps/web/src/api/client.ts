import type { Project } from "@pulse/contracts";
import type { JsonResponse } from "./types";

export type RequestOptions = {
  signal?: AbortSignal;
};

export type PulseApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type ProjectResponse = JsonResponse<Project>;

export type CreateProjectInput = {
  name: string;
};

export type PulseApiClient = {
  listProjects(options?: RequestOptions): Promise<ProjectResponse[]>;
  getProject(projectId: string, options?: RequestOptions): Promise<ProjectResponse>;
  createProject(input: CreateProjectInput, options?: RequestOptions): Promise<ProjectResponse>;
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
  };
}
