import type {
  HealthCheck,
  IncidentBoundaryMatch,
  IncidentDiagnosticEvidence,
  IncidentEvidenceContext,
  IncidentThresholdEvidence,
} from "@pulse/contracts";

export const INCIDENT_EVIDENCE_LIMIT = 64;

export type IncidentEvidenceParts = {
  openingBoundaryCandidates: HealthCheck[];
  openingSequence: HealthCheck[];
  openingPredecessor: HealthCheck | null;
  openingThreshold: number;
  openingTruncated: boolean;
  duringFirst: HealthCheck[];
  duringLast: HealthCheck[];
  duringTruncated: boolean;
  recoveryBoundaryCandidates: HealthCheck[] | null;
  recoverySequence: HealthCheck[] | null;
  recoveryThreshold: number | null;
  recoveryTruncated: boolean;
  postRecovery: HealthCheck | null;
  gapBeforeIds: string[];
};

export function resolveBoundaryMatch(
  candidates: HealthCheck[],
): IncidentBoundaryMatch {
  if (candidates.length === 1) {
    return { match: "exact", checkId: candidates[0]!.id };
  }
  if (candidates.length > 1) {
    return { match: "ambiguous", checkId: null };
  }
  return { match: "missing", checkId: null };
}

function compareChecks(left: HealthCheck, right: HealthCheck): number {
  const timeDifference = left.checkedAt.getTime() - right.checkedAt.getTime();
  if (timeDifference !== 0) return timeDifference;
  const leftId = BigInt(left.id);
  const rightId = BigInt(right.id);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function thresholdEvidence(
  checks: HealthCheck[],
  configuredThreshold: number,
  expectedHealthy: boolean,
  truncated: boolean,
  hasBoundaryEvidence: boolean,
): IncidentThresholdEvidence {
  const uniqueChecks = new Map(checks.map((check) => [check.id, check]));
  return {
    configuredThreshold,
    returnedCount: uniqueChecks.size,
    complete: isThresholdSequenceComplete(
      uniqueChecks.size,
      configuredThreshold,
      truncated,
      hasBoundaryEvidence,
    ),
    contradictory: [...uniqueChecks.values()].some(
      (check) => check.healthy !== expectedHealthy,
    ),
    truncated,
  };
}

export function isThresholdSequenceComplete(
  returnedCount: number,
  configuredThreshold: number,
  truncated: boolean,
  hasBoundaryEvidence: boolean,
): boolean {
  return returnedCount === configuredThreshold && !truncated && hasBoundaryEvidence;
}

export function assembleIncidentEvidence(
  parts: IncidentEvidenceParts,
): IncidentDiagnosticEvidence {
  const checksById = new Map<
    string,
    { check: HealthCheck; contexts: Set<IncidentEvidenceContext> }
  >();

  const include = (
    checks: Array<HealthCheck | null>,
    context: IncidentEvidenceContext,
  ) => {
    for (const check of checks) {
      if (!check) continue;
      const existing = checksById.get(check.id);
      if (existing) {
        existing.contexts.add(context);
      } else {
        checksById.set(check.id, { check, contexts: new Set([context]) });
      }
    }
  };

  include([parts.openingPredecessor], "opening_predecessor");
  include(parts.openingSequence, "opening");
  include(parts.duringFirst, "during_start");
  include(parts.duringLast, "during_end");
  include(parts.recoverySequence ?? [], "recovery");
  include([parts.postRecovery], "post_recovery");

  const ordered = [...checksById.values()]
    .sort((left, right) => compareChecks(left.check, right.check));
  const capped = ordered.slice(0, INCIDENT_EVIDENCE_LIMIT);
  const capTruncated = ordered.length > INCIDENT_EVIDENCE_LIMIT;
  const checks = capped.map(({ check, contexts }) => ({
    ...check,
    contexts: [...contexts],
  }));
  const gapBeforeIds = new Set(parts.gapBeforeIds);
  const gaps = checks.flatMap((check, index) => {
    const previous = checks[index - 1];
    return previous && gapBeforeIds.has(check.id)
      ? [{ afterCheckId: previous.id, beforeCheckId: check.id }]
      : [];
  });

  const openingSequence = thresholdEvidence(
    parts.openingSequence,
    parts.openingThreshold,
    false,
    parts.openingTruncated,
    parts.openingBoundaryCandidates.length > 0,
  );
  const recovery = parts.recoveryBoundaryCandidates === null ||
      parts.recoverySequence === null ||
      parts.recoveryThreshold === null
    ? null
    : {
        boundary: resolveBoundaryMatch(parts.recoveryBoundaryCandidates),
        sequence: thresholdEvidence(
          parts.recoverySequence,
          parts.recoveryThreshold,
          true,
          parts.recoveryTruncated,
          parts.recoveryBoundaryCandidates.length > 0,
        ),
      };
  const duringTruncated = parts.duringTruncated || capTruncated;

  return {
    thresholdSource: "current_monitor",
    opening: {
      boundary: resolveBoundaryMatch(parts.openingBoundaryCandidates),
      sequence: openingSequence,
    },
    recovery,
    during: { truncated: duringTruncated },
    checks,
    gaps,
    truncated: openingSequence.truncated ||
      (recovery?.sequence.truncated ?? false) ||
      duringTruncated,
  };
}
