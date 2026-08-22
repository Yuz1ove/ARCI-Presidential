import { describe, expect, it } from "vitest";
import {
  CONTROL_PLANE_DETERMINISM_SCENARIOS,
  runControlPlaneDeterminismGate,
} from "../../src/simulation/control-plane/determinism.js";
import { runControlPlaneScenario } from "../../src/simulation/control-plane/engine.js";

describe("Phase 4A control-plane integration scenarios", () => {
  it("defines and executes all fifteen required scenarios", async () => {
    expect(CONTROL_PLANE_DETERMINISM_SCENARIOS).toHaveLength(15);
    const results = await Promise.all(CONTROL_PLANE_DETERMINISM_SCENARIOS.map(runControlPlaneScenario));
    expect(results).toHaveLength(15);
  });

  it("creates a medical mission and exposes only matched-ACK delivery", async () => {
    const result = await runControlPlaneScenario("create-medical-mission");
    expect(result.missionStatus?.missionType).toBe("MEDICAL_EMERGENCY");
    expect(result.missionStatus?.deliveryStatus).toBe("VERIFIED");
    expect(result.missionStatus?.runtimeEvidenceProvenance).toBe("SIMULATED");
  });

  it("replans from cellular to LoRa and then verifies a matched ACK", async () => {
    const result = await runControlPlaneScenario("cellular-replan-matched-ack");
    expect(result.missionStatus?.routeHistory.map((route) =>
      route.includes("cellular") ? "CELLULAR" : route.includes("lora") ? "LORA" : route,
    )).toEqual(["CELLULAR", "LORA"]);
    expect(result.missionStatus?.deliveryStatus).toBe("VERIFIED");
  });

  it("holds ambiguous and injected semantics for operator review", async () => {
    for (const name of ["ambiguous-operator-review", "api-prompt-injection"] as const) {
      const result = await runControlPlaneScenario(name);
      expect(result.outcome).toBe("REVIEW_REQUIRED");
      expect(result.operatorReviewStatus).toBe("PENDING_OPERATOR_REVIEW");
      expect(result.historyEventTypes.some((event) => event.startsWith("execution."))).toBe(false);
    }
  });

  it("rejects forged delivery and ACK API bodies before persistence", async () => {
    for (const name of ["forged-delivered", "forged-ack"] as const) {
      const result = await runControlPlaneScenario(name);
      expect(result.failureCode).toBe("INVALID_API_INPUT");
      expect(result.historyEventTypes).toEqual([]);
    }
  });

  it("reconstructs the same state after restart and isolates a stale ACK", async () => {
    const late = await runControlPlaneScenario("late-ack-after-replay");
    const restarted = await runControlPlaneScenario("simulated-restart");
    expect(late.replayEquivalent).toBe(true);
    expect(late.missionStatus?.incidentTypes).toContain("LATE_ACK");
    expect(late.missionStatus?.deliveryStatus).toBe("VERIFIED");
    expect(restarted.replayEquivalent).toBe(true);
  });

  it("fails no-route, persistence, and conflicting-state paths without delivery", async () => {
    const noRoute = await runControlPlaneScenario("no-valid-route");
    const persistence = await runControlPlaneScenario("persistence-failure");
    const conflict = await runControlPlaneScenario("conflicting-persisted-record");
    expect(noRoute.missionStatus).toMatchObject({ status: "FAILED", deliveryStatus: "NOT_VERIFIED" });
    expect(persistence.failureCode).toBe("PERSISTENCE_FAILURE");
    expect(conflict.failureCode).toBe("CONFLICTING_STATE");
  });

  it("records provider fallback without granting authority", async () => {
    const result = await runControlPlaneScenario("provider-fallback");
    expect(result.observabilityCodes).toContain("PROVIDER_FALLBACK");
    expect(result.missionStatus?.deliveryStatus).toBe("VERIFIED");
  });

  it("replays all fifteen scenarios identically ten times", async () => {
    const results = await runControlPlaneDeterminismGate(10);
    expect(results).toHaveLength(15);
    expect(results.every((result) => result.replays === 10 && result.deterministic)).toBe(true);
  }, 15_000);
});
