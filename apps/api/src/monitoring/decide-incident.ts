export type IncidentAction = "none" | "open" | "resolve";

export type IncidentDecisionInput = {
  /** Includes the current check, ordered newest first. */
  recentChecks: readonly boolean[];
  incidentOpen: boolean;
  failureThreshold?: number;
  recoveryThreshold?: number;
};

export function decideIncidentAction({
  recentChecks,
  incidentOpen,
  failureThreshold = 3,
  recoveryThreshold = 1,
}: IncidentDecisionInput): IncidentAction {
  if (!Number.isSafeInteger(failureThreshold) || failureThreshold <= 0) {
    throw new RangeError("failureThreshold must be a positive integer");
  }
  if (!Number.isSafeInteger(recoveryThreshold) || recoveryThreshold <= 0) {
    throw new RangeError("recoveryThreshold must be a positive integer");
  }

  const threshold = incidentOpen ? recoveryThreshold : failureThreshold;
  const targetHealth = incidentOpen;

  for (let index = 0; index < threshold; index += 1) {
    if (recentChecks[index] !== targetHealth) {
      return "none";
    }
  }

  return incidentOpen ? "resolve" : "open";
}
