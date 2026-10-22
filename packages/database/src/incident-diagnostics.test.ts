import type { HealthCheck } from "@pulse/contracts";
import { describe, expect, it } from "vitest";
import {
  assembleIncidentEvidence,
  resolveBoundaryMatch,
  type IncidentEvidenceParts,
} from "./incident-diagnostics.js";

const monitorId = "019535d8-e8d3-7d5d-a8ef-11c85c7c738a";
const baseTime = Date.parse("2026-01-01T12:00:00.000Z");

function check(
  id: string,
  offsetMs: number,
  healthy: boolean,
  overrides: Partial<HealthCheck> = {},
): HealthCheck {
  return {
    id,
    monitorId,
    healthy,
    statusCode: healthy ? 204 : 500,
    latencyMs: 12,
    checkedAt: new Date(baseTime + offsetMs),
    errorType: healthy ? null : "http_error",
    errorMessage: healthy ? null : "HTTP 500",
    ...overrides,
  };
}

function parts(overrides: Partial<IncidentEvidenceParts> = {}): IncidentEvidenceParts {
  return {
    openingBoundaryCandidates: [],
    openingSequence: [],
    openingPredecessor: null,
    openingThreshold: 3,
    openingTruncated: false,
    duringFirst: [],
    duringLast: [],
    duringTruncated: false,
    recoveryBoundaryCandidates: null,
    recoverySequence: null,
    recoveryThreshold: null,
    recoveryTruncated: false,
    postRecovery: null,
    gapBeforeIds: [],
    ...overrides,
  };
}

describe("resolveBoundaryMatch", () => {
  it("returns an exact decimal-string ID for one timestamp candidate", () => {
    expect(resolveBoundaryMatch([check("9007199254740993", 0, false)]))
      .toEqual({ match: "exact", checkId: "9007199254740993" });
  });

  it("does not fabricate an ID when a timestamp has multiple candidates", () => {
    expect(resolveBoundaryMatch([
      check("1", 0, false),
      check("2", 0, false),
    ])).toEqual({ match: "ambiguous", checkId: null });
  });

  it("reports a missing boundary when no timestamp candidate exists", () => {
    expect(resolveBoundaryMatch([])).toEqual({ match: "missing", checkId: null });
  });
});

describe("assembleIncidentEvidence", () => {
  it("deduplicates selections and preserves every diagnostic context", () => {
    const shared = check("2", 1_000, false);
    const result = assembleIncidentEvidence(parts({
      openingSequence: [check("1", 0, false), shared],
      duringFirst: [shared, check("3", 2_000, false)],
    }));

    expect(result.checks.map(({ id }) => id)).toEqual(["1", "2", "3"]);
    expect(result.checks[1]?.contexts).toEqual(["opening", "during_start"]);
  });

  it("orders chronologically and uses numeric bigint IDs to break ties", () => {
    const result = assembleIncidentEvidence(parts({
      duringFirst: [
        check("10", 0, false),
        check("9", 0, false),
        check("11", -1_000, true),
      ],
    }));

    expect(result.checks.map(({ id }) => id)).toEqual(["11", "9", "10"]);
  });

  it("caps evidence at 64 checks and reports truncation", () => {
    const result = assembleIncidentEvidence(parts({
      duringFirst: Array.from({ length: 70 }, (_, index) =>
        check(String(index + 1), index * 1_000, false)),
    }));

    expect(result.checks).toHaveLength(64);
    expect(result.truncated).toBe(true);
    expect(result.during.truncated).toBe(true);
  });

  it("serializes known discontinuities between returned checks", () => {
    const result = assembleIncidentEvidence(parts({
      duringFirst: [check("1", 0, false), check("2", 1_000, false)],
      duringLast: [check("8", 8_000, false), check("9", 9_000, false)],
      duringTruncated: true,
      gapBeforeIds: ["8"],
    }));

    expect(result.gaps).toEqual([{ afterCheckId: "2", beforeCheckId: "8" }]);
  });

  it("reports a complete opening threshold sequence", () => {
    const result = assembleIncidentEvidence(parts({
      openingBoundaryCandidates: [check("3", 2_000, false)],
      openingSequence: [
        check("1", 0, false),
        check("2", 1_000, false),
        check("3", 2_000, false),
      ],
    }));

    expect(result.opening).toEqual({
      boundary: { match: "exact", checkId: "3" },
      sequence: {
        configuredThreshold: 3,
        returnedCount: 3,
        complete: true,
        contradictory: false,
        truncated: false,
      },
    });
  });

  it("reports contradictory persisted opening evidence without rewriting it", () => {
    const result = assembleIncidentEvidence(parts({
      openingBoundaryCandidates: [check("3", 2_000, false)],
      openingSequence: [
        check("1", 0, false),
        check("2", 1_000, true),
        check("3", 2_000, false),
      ],
    }));

    expect(result.opening.sequence).toMatchObject({
      complete: true,
      contradictory: true,
    });
  });

  it("does not call a threshold sequence complete when its boundary is missing", () => {
    const result = assembleIncidentEvidence(parts({
      openingSequence: [
        check("1", -3_000, false),
        check("2", -2_000, false),
        check("3", -1_000, false),
      ],
    }));

    expect(result.opening.boundary).toEqual({ match: "missing", checkId: null });
    expect(result.opening.sequence).toMatchObject({
      returnedCount: 3,
      complete: false,
      contradictory: false,
    });
  });

  it("reports incomplete and threshold-truncated evidence independently", () => {
    const result = assembleIncidentEvidence(parts({
      openingThreshold: 80,
      openingSequence: Array.from({ length: 52 }, (_, index) =>
        check(String(index + 1), index * 1_000, false)),
      openingTruncated: true,
    }));

    expect(result.opening.sequence).toMatchObject({
      configuredThreshold: 80,
      returnedCount: 52,
      complete: false,
      contradictory: false,
      truncated: true,
    });
    expect(result.truncated).toBe(true);
  });

  it("reports resolved recovery integrity independently from opening integrity", () => {
    const result = assembleIncidentEvidence(parts({
      recoveryBoundaryCandidates: [check("5", 5_000, true)],
      recoverySequence: [check("4", 4_000, true), check("5", 5_000, false)],
      recoveryThreshold: 2,
    }));

    expect(result.recovery).toEqual({
      boundary: { match: "exact", checkId: "5" },
      sequence: {
        configuredThreshold: 2,
        returnedCount: 2,
        complete: true,
        contradictory: true,
        truncated: false,
      },
    });
  });

  it("uses null recovery metadata for an open Incident", () => {
    expect(assembleIncidentEvidence(parts()).recovery).toBeNull();
  });
});
