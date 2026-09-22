import { describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "./integration-safety.js";

describe("requireTestDatabaseUrl", () => {
  it("requires an explicit test URL", () => {
    expect(() => requireTestDatabaseUrl(undefined, undefined)).toThrow("TEST_DATABASE_URL is required");
  });

  it("accepts a test-marked PostgreSQL database without a localhost assumption", () => {
    expect(requireTestDatabaseUrl("postgresql://user:pass@db.example.net/pulse_integration", undefined))
      .toBe("postgresql://user:pass@db.example.net/pulse_integration");
  });

  it("rejects an unmarked or obviously production target", () => {
    expect(() => requireTestDatabaseUrl("postgresql://db.example.net/pulse", undefined)).toThrow("test marker");
    expect(() => requireTestDatabaseUrl("postgresql://prod.example.net/pulse_test", undefined)).toThrow("production");
    expect(() => requireTestDatabaseUrl("postgresql://db.example.net/pulse_prod_test", undefined)).toThrow("production");
  });

  it("rejects the application database even when credentials differ", () => {
    expect(() => requireTestDatabaseUrl(
      "postgresql://tester:secret@db.example.net/pulse_test",
      "postgresql://app:other@db.example.net/pulse_test?sslmode=require",
    )).toThrow("must not target");
  });
});
