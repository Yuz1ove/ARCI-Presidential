import { describe, expect, it } from "vitest";
import {
  adaptWeights,
  decide,
  injectFailure,
  runAdaptiveScenario,
} from "../../src/presidential/engine.js";
import { COMPETITION_SCENARIOS, scenarioById } from "../../src/presidential/fixtures.js";
import type { CompetitionScenario, FailureType, WeightKey } from "../../src/presidential/model.js";

const WEIGHT_KEYS: readonly WeightKey[] = [
  "reliability", "latency", "coverage", "priority", "energy", "cost",
  "congestion", "hazard", "deliveryProbability", "bandwidth",
];

function withoutLinks(scenario: CompetitionScenario): CompetitionScenario {
  return {
    ...scenario,
    recoveryLinkIds: [],
    state: {
      ...scenario.state,
      communication: scenario.state.communication.map((link) => ({ ...link, available: false })),
    },
  };
}

describe("Presidential deterministic decision engine", () => {
  it("normalizes adaptive weights and explains agriculture adjustments", () => {
    const scenario = scenarioById("SCENARIO_02");
    const agriculture = scenario.messages.find(({ demandType }) => demandType === "AGRICULTURAL_PRODUCTION")!;
    const trace = adaptWeights(agriculture, scenario.state);
    expect(WEIGHT_KEYS.reduce((sum, key) => sum + trace.effective[key], 0)).toBeCloseTo(1, 5);
    expect(trace.adjustments.bandwidth).toBeGreaterThan(0);
    expect(trace.adjustments.energy).toBeGreaterThan(0);
    expect(trace.reasons.some((reason) => reason.includes("AGRICULTURE"))).toBe(true);
  });

  it("hard-rejects unavailable or payload-incompatible links instead of assigning a low score", () => {
    const scenario = scenarioById("SCENARIO_02");
    const agriculture = scenario.messages.find(({ demandType }) => demandType === "AGRICULTURAL_PRODUCTION")!;
    const trace = decide(scenario.state, agriculture);
    expect(trace.selectedAction).toBeNull();
    expect(trace.candidates.every(({ score }) => score === null)).toBe(true);
    expect(trace.candidates.find(({ linkId }) => linkId === "cellular-4g")?.constraints)
      .toContainEqual(expect.objectContaining({ code: "PAYLOAD_SUPPORTED", passed: false }));
  });

  it("ranks eligible candidates from inspectable feature contributions", () => {
    const scenario = scenarioById("SCENARIO_01");
    const message = scenario.messages[0]!;
    const trace = decide(scenario.state, message);
    const winner = trace.selectedAction!;
    expect(winner.linkId).toBe("lora-gateway");
    expect(WEIGHT_KEYS.reduce((sum, key) => sum + winner.contributions[key], 0)).toBeCloseTo(winner.score!, 5);
    expect(trace.rejectedAlternatives).toHaveLength(trace.candidates.length - 1);
  });

  it("keeps the same fixture replay bit-for-bit deterministic", () => {
    for (const scenario of COMPETITION_SCENARIOS) {
      const signatures = Array.from({ length: 10 }, () => runAdaptiveScenario(scenario).canonicalSignature);
      expect(new Set(signatures)).toHaveLength(1);
    }
  });

  it("runs local store, queue, recovery, forward and matched ACK", () => {
    const result = runAdaptiveScenario(scenarioById("SCENARIO_02"));
    const agriculture = result.messages.find(({ id }) => id === "msg-02-agriculture")!;
    const traces = result.traces.filter(({ message }) => message.id === agriculture.id);
    expect(traces.map(({ outcome }) => outcome)).toEqual(["QUEUED", "ACK_VERIFIED"]);
    expect(agriculture.routeHistory).toEqual(["STORE_AND_FORWARD", "drone-relay"]);
    expect(agriculture.deliveryTimestamp).toBeDefined();
    expect(result.metrics.queueDepthFinal).toBe(0);
  });

  it("invalidates a failed selected link, recalculates and verifies an alternate ACK", () => {
    const result = runAdaptiveScenario(scenarioById("SCENARIO_03"));
    expect(result.traces.map(({ outcome }) => outcome)).toEqual(["FAILED", "ACK_VERIFIED"]);
    expect(result.traces[0]!.selectedAction?.linkId).toBe("ridge-mesh");
    expect(result.traces[1]!.selectedAction?.linkId).not.toBe("ridge-mesh");
    expect(result.traces[1]!.replanReason).toContain("invalidated");
    expect(result.metrics.replanCount).toBe(1);
  });

  it("fails closed to a queue when every route is unavailable", () => {
    const result = runAdaptiveScenario(withoutLinks(scenarioById("SCENARIO_01")));
    expect(result.messages.every(({ status }) => status === "QUEUED")).toBe(true);
    expect(result.messages.every(({ routeHistory }) => routeHistory.includes("STORE_AND_FORWARD"))).toBe(true);
    expect(result.metrics.messageDeliveryRate).toBe(0);
  });

  it("supports all eight UI failure injections as deterministic state mutations", () => {
    const types: readonly FailureType[] = [
      "TOWER_FAILURE", "PACKET_LOSS", "LATENCY_SPIKE", "BANDWIDTH_COLLAPSE",
      "ROAD_CLOSURE", "DEBRIS_FLOW", "POWER_LOSS", "NODE_ISOLATION",
    ];
    for (const type of types) {
      const initial = scenarioById("SCENARIO_01");
      const injected = injectFailure(initial, type);
      expect(injected).not.toBe(initial);
      expect(injected.injections.at(-1)?.type).toBe(type);
      expect(runAdaptiveScenario(injected).canonicalSignature).toBe(runAdaptiveScenario(injected).canonicalSignature);
    }
  });
});
