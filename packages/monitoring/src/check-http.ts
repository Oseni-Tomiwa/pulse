import type { HealthCheckErrorType, HttpMonitor } from "@pulse/contracts";

export type HttpCheckOptions = {
  url: string;
  method: HttpMonitor["method"];
  timeoutMs: number;
};

export type HttpCheckResult = {
  healthy: boolean;
  statusCode: number | null;
  latencyMs: number;
  checkedAt: Date;
  errorType: HealthCheckErrorType | null;
  errorMessage: string | null;
};

export async function checkHttp(
  { url, method, timeoutMs }: HttpCheckOptions,
): Promise<HttpCheckResult> {
  const checkedAt = new Date();
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        healthy: false,
        statusCode: response.status,
        latencyMs,
        checkedAt,
        errorType: "http_error",
        errorMessage: `HTTP ${response.status}`,
      };
    }

    return {
      healthy: true,
      statusCode: response.status,
      latencyMs,
      checkedAt,
      errorType: null,
      errorMessage: null,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);

    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return {
        healthy: false,
        statusCode: null,
        latencyMs,
        checkedAt,
        errorType: "timeout",
        errorMessage: `Request timed out after ${timeoutMs}ms`,
      };
    }

    const message =
      error instanceof Error ? error.message : "Unknown connection error";

    return {
      healthy: false,
      statusCode: null,
      latencyMs,
      checkedAt,
      errorType: "connection_error",
      errorMessage: message,
    };
  }
}
