import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkHttp } from "./check-http.js";

const receivedMethods: string[] = [];

const testServer = createServer(async (request, response) => {
  receivedMethods.push(request.method ?? "");

  if (request.url === "/slow") {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const statusCode = request.url === "/broken" ? 500 : 200;
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: statusCode === 200 ? "ok" : "error" }));
});

let baseUrl: string;

beforeEach(() => {
  receivedMethods.length = 0;
});

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    testServer.once("error", reject);
    testServer.listen(0, "127.0.0.1", () => {
      testServer.off("error", reject);
      resolve();
    });
  });

  const address = testServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    testServer.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("checkHttp", () => {
  it("reports a successful HTTP response as healthy", async () => {
    const result = await checkHttp({
      url: `${baseUrl}/healthy`,
      method: "GET",
      timeoutMs: 10_000,
    });

    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(result.errorType).toBeNull();
    expect(result.errorMessage).toBeNull();
  });

  it("sends GET when configured for GET", async () => {
    await checkHttp({
      url: `${baseUrl}/healthy`,
      method: "GET",
      timeoutMs: 10_000,
    });

    expect(receivedMethods).toEqual(["GET"]);
  });

  it("sends HEAD when configured for HEAD", async () => {
    await checkHttp({
      url: `${baseUrl}/healthy`,
      method: "HEAD",
      timeoutMs: 10_000,
    });

    expect(receivedMethods).toEqual(["HEAD"]);
  });

  it("reports an HTTP 500 response as unhealthy", async () => {
    const result = await checkHttp({
      url: `${baseUrl}/broken`,
      method: "GET",
      timeoutMs: 10_000,
    });

    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.errorType).toBe("http_error");
    expect(result.errorMessage).toBe("HTTP 500");
  });

  it("reports a connection failure as unhealthy", async () => {
    const result = await checkHttp({
      url: "http://127.0.0.1:59999",
      method: "GET",
      timeoutMs: 10_000,
    });

    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(result.errorType).toBe("connection_error");
    expect(result.errorMessage).not.toBeNull();
  });

  it("reports a timeout as unhealthy", async () => {
    const result = await checkHttp({
      url: `${baseUrl}/slow`,
      method: "GET",
      timeoutMs: 50,
    });

    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(50);
    expect(result.errorType).toBe("timeout");
    expect(result.errorMessage).toBe("Request timed out after 50ms");
  });
});
