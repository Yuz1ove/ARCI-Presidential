import { StarryRuntime } from "../../runtime/engine.js";
import { getRuntimeScenarioFixture } from "./fixtures.js";
import type { RuntimeScenarioName } from "./schema.js";

export const DETERMINISM_SCENARIOS: readonly RuntimeScenarioName[] = [
  "cellular-failure-after-selection",
  "sequential-degradation",
  "ack-lost",
  "medical-emergency-low-battery",
  "all-routes-fail",
  "oscillating-topology",
];

export interface DeterminismScenarioResult {
  readonly scenario: RuntimeScenarioName;
  readonly replays: number;
  readonly deterministic: boolean;
}

export function runtimeFingerprint(name: RuntimeScenarioName): string {
  const result = new StarryRuntime().run(getRuntimeScenarioFixture(name));
  return JSON.stringify({
    routeHistory: result.state.metrics.routeHistory,
    routeIds: [
      ...result.state.previousRouteDecisions.flatMap((decision) =>
        decision.selectedRoute === undefined ? [] : [decision.selectedRoute.routeId],
      ),
      ...(result.state.currentRoutingDecision?.selectedRoute === undefined
        ? []
        : [result.state.currentRoutingDecision.selectedRoute.routeId]),
    ],
    decisionIds: [
      ...result.state.previousRouteDecisions.map((decision) => decision.decisionId),
      ...(result.state.currentRoutingDecision === undefined
        ? []
        : [result.state.currentRoutingDecision.decisionId]),
    ],
    executionIds: result.state.executionHistory.map((execution) => execution.executionId),
    executionOutcomes: result.state.executionHistory.map((execution) => ({
      routeId: execution.routeId,
      status: execution.status,
      reason: execution.failureReason,
    })),
    adaptationTriggers: result.state.adaptations.map((adaptation) => adaptation.trigger),
    adaptationActions: result.state.adaptations.map((adaptation) => adaptation.action),
    retries: result.state.metrics.retries,
    replans: result.state.metrics.replans,
    terminalState: result.state.lifecycle,
    terminalReason: result.state.terminalReason,
    verification: result.state.verification,
    eventSequence: result.events.map((event) => ({
      sequence: event.sequence,
      eventId: event.eventId,
      eventType: event.eventType,
      causationId: event.causationId,
      correlationId: event.correlationId,
      payload: event.payload,
    })),
    metrics: result.state.metrics,
  });
}

export function runRuntimeDeterminismGate(
  replays = 10,
  scenarios: readonly RuntimeScenarioName[] = DETERMINISM_SCENARIOS,
): readonly DeterminismScenarioResult[] {
  if (!Number.isInteger(replays) || replays < 2) {
    throw new Error("determinism gate requires at least two replays");
  }
  return scenarios.map((scenario) => {
    const baseline = runtimeFingerprint(scenario);
    let deterministic = true;
    for (let replay = 2; replay <= replays; replay += 1) {
      if (runtimeFingerprint(scenario) !== baseline) deterministic = false;
    }
    return { scenario, replays, deterministic };
  });
}
