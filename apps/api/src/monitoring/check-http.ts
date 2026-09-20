export type HttpCheckResult = {
  healthy: boolean;
  statusCode: number | null;
  latencyMs: number;
  checkedAt: Date;
  errorType: string | null;
  errorMessage: string | null;
};

export async function checkHttp(url: string): Promise<HttpCheckResult> {
  const checkedAt = new Date();
  const startedAt = performance.now();

  const response = await fetch(url);

  const latencyMs = Math.round(performance.now() - startedAt);

  return {
    healthy: response.ok,
    statusCode: response.status,
    latencyMs,
    checkedAt,
    errorType: null,
    errorMessage: null,
  };
}