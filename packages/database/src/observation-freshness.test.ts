import { describe, expect, it } from "vitest";
import * as database from "./index.js";

const checkedAt = new Date("2026-10-27T12:00:00.000Z");
const monitor = { enabled: true, intervalMs: 60_000, timeoutMs: 10_000 };

describe("observation freshness", () => {
  it.each([
    [1_000, "2026-10-27T12:00:26.000Z"],
    [30_000, "2026-10-27T12:01:10.000Z"],
    [60_000, "2026-10-27T12:02:10.000Z"],
    [300_000, "2026-10-27T12:10:10.000Z"],
  ])("derives the deadline for interval %i", (intervalMs, deadline) => {
    expect(database.deriveObservationFreshness({ ...monitor, intervalMs }, checkedAt, checkedAt))
      .toEqual({ state: "fresh", staleAt: new Date(deadline) });
  });
  it.each([
    ["2026-10-27T12:02:09.999Z", "fresh"],
    ["2026-10-27T12:02:10.000Z", "stale"],
    ["2026-10-27T12:02:10.001Z", "stale"],
  ])("classifies the exact boundary at %s", (now, state) => {
    expect(database.deriveObservationFreshness(monitor, checkedAt, new Date(now)))
      .toEqual({ state, staleAt: new Date("2026-10-27T12:02:10.000Z") });
  });
  it("distinguishes no observation from disabled exclusion", () => {
    expect(database.deriveObservationFreshness(monitor, null, checkedAt))
      .toEqual({ state: "no_observation", staleAt: null });
    for (const latest of [null, checkedAt]) {
      expect(database.deriveObservationFreshness({ ...monitor, enabled: false }, latest, checkedAt))
        .toEqual({ state: "excluded", staleAt: null });
    }
  });
  it("does not overflow for maximum persisted configuration", () => {
    expect(database.deriveObservationFreshness({ ...monitor, intervalMs: 2_147_483_647, timeoutMs: 2_147_483_647 }, new Date(0), new Date(0)))
      .toEqual({ state: "fresh", staleAt: new Date(6_442_450_941) });
  });
  it("rejects invalid dates and unrepresentable deadlines rather than reporting fresh", () => {
    expect(() => database.deriveObservationFreshness(monitor, new Date(NaN), checkedAt)).toThrow(RangeError);
    expect(() => database.deriveObservationFreshness(monitor, checkedAt, new Date(NaN))).toThrow(RangeError);
    expect(() => database.deriveObservationFreshness(monitor, new Date(8_640_000_000_000_000), checkedAt)).toThrow(RangeError);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, Infinity, NaN])("rejects invalid configuration %s", value => {
    expect(() => database.deriveObservationFreshness({ ...monitor, intervalMs: value }, checkedAt, checkedAt)).toThrow(RangeError);
    expect(() => database.deriveObservationFreshness({ ...monitor, timeoutMs: value }, checkedAt, checkedAt)).toThrow(RangeError);
  });
});
