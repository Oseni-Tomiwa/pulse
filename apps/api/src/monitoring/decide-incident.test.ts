import { describe, expect, it } from "vitest";
import { decideIncidentAction } from "./decide-incident.js";

describe("decideIncidentAction", () => {
  it("does nothing after the first failure at the default threshold", () => {
    expect(decideIncidentAction({ recentChecks: [false], incidentOpen: false })).toBe("none");
  });

  it("does nothing after two consecutive failures at the default threshold", () => {
    expect(decideIncidentAction({ recentChecks: [false, false], incidentOpen: false })).toBe("none");
  });

  it("opens after three consecutive failures", () => {
    expect(decideIncidentAction({ recentChecks: [false, false, false], incidentOpen: false })).toBe("open");
  });

  it("does not open another incident after a fourth failure", () => {
    expect(decideIncidentAction({ recentChecks: [false, false, false, false], incidentOpen: true })).toBe("none");
  });

  it("resets the failure streak after a success", () => {
    expect(decideIncidentAction({ recentChecks: [false, true, false, false], incidentOpen: false })).toBe("none");
  });

  it("does not open on a successful check before the failure threshold", () => {
    expect(decideIncidentAction({ recentChecks: [true, false, false], incidentOpen: false })).toBe("none");
  });

  it("resolves after one success at the default recovery threshold", () => {
    expect(decideIncidentAction({ recentChecks: [true, false, false, false], incidentOpen: true })).toBe("resolve");
  });

  it("requires consecutive successes when the recovery threshold is greater than one", () => {
    expect(decideIncidentAction({ recentChecks: [true, false], incidentOpen: true, recoveryThreshold: 2 })).toBe("none");
    expect(decideIncidentAction({ recentChecks: [true, true, false], incidentOpen: true, recoveryThreshold: 2 })).toBe("resolve");
  });

  it("resets recovery progress after a failure", () => {
    expect(decideIncidentAction({ recentChecks: [true, false, true], incidentOpen: true, recoveryThreshold: 2 })).toBe("none");
  });

  it("opens immediately when the failure threshold is one", () => {
    expect(decideIncidentAction({ recentChecks: [false], incidentOpen: false, failureThreshold: 1 })).toBe("open");
  });

  it("resolves immediately when the recovery threshold is one", () => {
    expect(decideIncidentAction({ recentChecks: [true], incidentOpen: true, recoveryThreshold: 1 })).toBe("resolve");
  });

  it("does nothing for healthy checks with no incident", () => {
    expect(decideIncidentAction({ recentChecks: [true, true, true], incidentOpen: false })).toBe("none");
  });

  it("does nothing without a current check", () => {
    expect(decideIncidentAction({ recentChecks: [], incidentOpen: false })).toBe("none");
  });

  it("uses a configured failure threshold greater than three", () => {
    expect(decideIncidentAction({ recentChecks: [false, false, false], incidentOpen: false, failureThreshold: 4 })).toBe("none");
    expect(decideIncidentAction({ recentChecks: [false, false, false, false], incidentOpen: false, failureThreshold: 4 })).toBe("open");
  });

  it("rejects invalid thresholds", () => {
    expect(() => decideIncidentAction({ recentChecks: [false], incidentOpen: false, failureThreshold: 0 })).toThrow(RangeError);
    expect(() => decideIncidentAction({ recentChecks: [true], incidentOpen: true, recoveryThreshold: 1.5 })).toThrow(RangeError);
  });
});
