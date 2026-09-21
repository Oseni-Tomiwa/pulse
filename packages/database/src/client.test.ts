import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "./index.js";

afterEach(() => vi.unstubAllEnvs());

describe("createDatabase", () => {
  it("does not require DATABASE_URL merely to import the package", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    expect(createDatabase).toBeTypeOf("function");
  });

  it("reads DATABASE_URL only when explicitly creating a client", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/pulse_test");
    const { db, pool } = createDatabase();

    expect(db).toBeDefined();
    expect(pool.options.connectionString).toBe("postgresql://localhost/pulse_test");
    expect(pool.totalCount).toBe(0);
    await pool.end();
  });

  it("accepts an explicit connection URL", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    const { pool } = createDatabase("postgresql://localhost/explicit_test");

    expect(pool.options.connectionString).toBe("postgresql://localhost/explicit_test");
    expect(pool.totalCount).toBe(0);
    await pool.end();
  });

  it("rejects client creation when no URL is available", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    expect(() => createDatabase()).toThrow("DATABASE_URL is required");
  });
});
