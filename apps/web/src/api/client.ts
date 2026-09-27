import type { Project } from "@pulse/contracts";
import type { JsonResponse } from "./types";

export type RequestOptions = {
  signal?: AbortSignal;
};

export type PulseApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
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

export function createPulseApiClient(options: PulseApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? "/api").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { accept: "application/json" },
      signal: requestOptions.signal,
    });

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
      return request<JsonResponse<Project>[]>("/projects", requestOptions);
    },
    getProject(projectId: string, requestOptions?: RequestOptions) {
      return request<JsonResponse<Project>>(
        `/projects/${encodeURIComponent(projectId)}`,
        requestOptions,
      );
    },
  };
}
