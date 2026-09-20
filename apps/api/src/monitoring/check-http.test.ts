import { describe, expect, it } from "vitest";
import { checkHttp } from "./check-http.js";

describe("checkHttp", () => {
  it("reports a successful HTTP response as healthy", async () => {
    const result = await checkHttp("https://example.com");

    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(result.errorType).toBeNull();
    expect(result.errorMessage).toBeNull();
  });
});