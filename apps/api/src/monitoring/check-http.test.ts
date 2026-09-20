import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { checkHttp } from "./check-http.js";

const testServer = Fastify();

let baseUrl: string;

beforeAll(async () => {
  testServer.get("/healthy", async () => {
    return {
      status: "ok",
    };
  });

  testServer.get("/broken", async (_request, reply) => {
    return reply.status(500).send({
      status: "error",
    });
  });

  testServer.get("/slow", async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));

    return {
      status: "ok",
    };
  });

  await testServer.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = testServer.server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not determine test server address");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await testServer.close();
});

describe("checkHttp", () => {
  it("reports a successful HTTP response as healthy", async () => {
    const result = await checkHttp(`${baseUrl}/healthy`);

    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(result.errorType).toBeNull();
    expect(result.errorMessage).toBeNull();
  });

  it("reports an HTTP 500 response as unhealthy", async () => {
    const result = await checkHttp(`${baseUrl}/broken`);

    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.errorType).toBe("http_error");
    expect(result.errorMessage).toBe("HTTP 500");
  });

  it("reports a connection failure as unhealthy", async () => {
    const result = await checkHttp("http://127.0.0.1:59999");

    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(result.errorType).toBe("connection_error");
    expect(result.errorMessage).not.toBeNull();
  });

  it("reports a timeout as unhealthy", async () => {
    const result = await checkHttp(`${baseUrl}/slow`, 50);

    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(50);
    expect(result.errorType).toBe("timeout");
    expect(result.errorMessage).toBe("Request timed out after 50ms");
  });
});