import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "./config.js";

describe("loadWorkerConfig", () => {
  it("requires DATABASE_URL", () => {
    expect(() => loadWorkerConfig({})).toThrow("DATABASE_URL is required");
  });

  it("uses the default polling interval", () => {
    expect(loadWorkerConfig({ DATABASE_URL: "postgresql://example.invalid/pulse" })).toEqual({
      databaseUrl: "postgresql://example.invalid/pulse",
      pollingIntervalMs: 10_000,
    });
  });

  it("parses a configured polling interval", () => {
    expect(loadWorkerConfig({
      DATABASE_URL: "postgresql://example.invalid/pulse",
      PULSE_WORKER_POLL_INTERVAL_MS: "2500",
    }).pollingIntervalMs).toBe(2_500);
  });

  it.each(["0", "-1", "NaN", "Infinity", ""])(
    "rejects invalid polling interval %s",
    (value) => {
      expect(() => loadWorkerConfig({
        DATABASE_URL: "postgresql://example.invalid/pulse",
        PULSE_WORKER_POLL_INTERVAL_MS: value,
      })).toThrow("PULSE_WORKER_POLL_INTERVAL_MS");
    },
  );
});
