import type { MonitorStatus, ServiceHealthState } from "@pulse/contracts";

export function HealthState({ state, large = false }: { state: ServiceHealthState | MonitorStatus; large?: boolean }) {
  return <strong className={"m7-state m7-state-" + state + (large ? " m7-state-large" : "")}>
    <span className="m7-state-dot" aria-hidden="true" />
    {state[0].toUpperCase() + state.slice(1)}
  </strong>;
}
