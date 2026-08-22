import type {
  AdaptationAction,
  AdaptationTrigger,
  RuntimeLimits,
  StarryRuntimeState,
} from "./model.js";

export interface AdaptationDecision {
  readonly action: AdaptationAction;
  readonly reason: string;
}

export function decideAdaptation(
  trigger: AdaptationTrigger,
  state: StarryRuntimeState,
  limits: RuntimeLimits,
  attemptsForRoute: number,
): AdaptationDecision {
  switch (trigger) {
    case "ACK_TIMEOUT":
      return attemptsForRoute < limits.maxAttemptsPerRoute &&
        state.metrics.executionAttempts < limits.maxExecutionAttempts
        ? { action: "RETRY_ROUTE", reason: "ACK missing within verification window" }
        : { action: "REPLAN", reason: "Per-route ACK retry budget exhausted" };
    case "GRAPH_STALE":
      return { action: "REFRESH_OBSERVATION", reason: "Observation graph version is stale" };
    case "RELIABILITY_DEGRADED":
      return { action: "REVALIDATE_ROUTE", reason: "Observed route reliability degraded" };
    case "POLICY_REJECTION":
      return { action: "ABORT_MISSION", reason: "No final-validator-approved route exists" };
    case "EXECUTION_FAILED":
      return { action: "REPLAN", reason: "Typed execution failure requires a new decision" };
    case "ROUTE_INVALIDATED":
      return { action: "REPLAN", reason: "Selected route was invalidated in flight" };
    case "NETWORK_TOPOLOGY_CHANGED":
      return { action: "REPLAN", reason: "Network topology changed" };
    case "BATTERY_CRITICAL":
      return { action: "REPLAN", reason: "Device battery crossed the critical threshold" };
    case "MISSION_REQUIREMENTS_CHANGED":
      return { action: "REPLAN", reason: "Mission requirements changed" };
  }
}
