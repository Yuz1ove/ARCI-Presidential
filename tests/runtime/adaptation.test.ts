import { describe, expect, it } from "vitest";
import { decideAdaptation } from "../../src/runtime/adaptation.js";
import { StarryRuntime } from "../../src/runtime/engine.js";
import type {
  AdaptationAction,
  AdaptationTrigger,
  StarryRuntimeState,
} from "../../src/runtime/model.js";
import { getRuntimeScenarioFixture } from "../../src/simulation/runtime/fixtures.js";

describe("deterministic adaptation decisions", () => {
  const fixture = getRuntimeScenarioFixture("sequential-degradation");
  const state = new StarryRuntime().run(fixture).state as StarryRuntimeState;

  it.each<[AdaptationTrigger, AdaptationAction]>([
    ["EXECUTION_FAILED", "REPLAN"],
    ["ROUTE_INVALIDATED", "REPLAN"],
    ["NETWORK_TOPOLOGY_CHANGED", "REPLAN"],
    ["GRAPH_STALE", "REFRESH_OBSERVATION"],
    ["RELIABILITY_DEGRADED", "REVALIDATE_ROUTE"],
    ["BATTERY_CRITICAL", "REPLAN"],
    ["MISSION_REQUIREMENTS_CHANGED", "REPLAN"],
    ["POLICY_REJECTION", "ABORT_MISSION"],
  ])("maps %s to %s", (trigger, expected) => {
    expect(decideAdaptation(trigger, state, fixture.limits, 1).action).toBe(expected);
  });

  it("retries a route only within its per-route budget", () => {
    expect(decideAdaptation("ACK_TIMEOUT", state, fixture.limits, 1).action).toBe(
      "RETRY_ROUTE",
    );
    expect(
      decideAdaptation(
        "ACK_TIMEOUT",
        { ...state, metrics: { ...state.metrics, executionAttempts: 1 } },
        fixture.limits,
        fixture.limits.maxAttemptsPerRoute,
      ).action,
    ).toBe("REPLAN");
  });
});
