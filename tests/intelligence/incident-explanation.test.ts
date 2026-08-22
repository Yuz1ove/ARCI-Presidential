import { describe, expect, it } from "vitest";
import { explainRuntime } from "../../src/intelligence/explanation/engine.js";
import { interpretIncident } from "../../src/intelligence/incident/interpreter.js";
import { generateRecommendations } from "../../src/intelligence/recommendation/engine.js";
import { StarryRuntime } from "../../src/runtime/engine.js";
import { getRuntimeScenarioFixture } from "../../src/simulation/runtime/fixtures.js";

function run(name: Parameters<typeof getRuntimeScenarioFixture>[0]) {
  return new StarryRuntime().run(getRuntimeScenarioFixture(name));
}

describe("evidence-backed operator intelligence", () => {
  it("classifies cellular failure and traces every signal to runtime evidence", () => {
    const runtime = run("cellular-failure-after-selection");
    const assessment = interpretIncident({ runtime });
    expect(assessment.primaryIncident).toBe("CELLULAR_PATH_FAILURE");
    const knownEvidence = new Set(assessment.evidence.map((item) => item.evidenceId));
    expect(
      assessment.signals.every((signal) => signal.evidenceIds.every((id) => knownEvidence.has(id))),
    ).toBe(true);
  });

  it("explains failure, replan, LoRa selection, and ACK-gated delivery from evidence", () => {
    const runtime = run("cellular-failure-after-selection");
    const explanation = explainRuntime(runtime, "INCIDENT_SUMMARY");
    expect(runtime.state.metrics.routeHistory[0]).toContain("cellular");
    expect(runtime.state.metrics.routeHistory.at(-1)).toContain("lora");
    expect(runtime.state.verification?.status).toBe("VERIFIED");
    expect(explanation.evidence.length).toBeGreaterThan(0);
    const evidenceIds = new Set(explanation.evidence.map((item) => item.evidenceId));
    expect(explanation.claims.every((claim) => claim.evidenceIds.every((id) => evidenceIds.has(id)))).toBe(true);
  });

  it("identifies a stale ACK and preserves the current execution identity", () => {
    const runtime = run("late-ack-after-replan");
    const assessment = interpretIncident({ runtime });
    const explanation = explainRuntime(runtime, "LATE_ACK");
    expect(assessment.signals.map((signal) => signal.type)).toContain("LATE_ACK");
    expect(explanation.summary).toContain("older execution identity");
    expect(runtime.state.verification?.executionId).toBe(runtime.state.currentExecution?.executionId);
  });

  it("offers only non-executing recommendations when no route is valid", () => {
    const runtime = run("all-routes-fail");
    const assessment = interpretIncident({ runtime });
    const recommendations = generateRecommendations(runtime, assessment);
    expect(runtime.state.terminalReason).toBe("NO_VALID_ROUTE");
    expect(recommendations.map((item) => item.type)).toEqual([
      "REQUEST_FRESH_OBSERVATION",
      "WAIT_FOR_TOPOLOGY_RECOVERY",
      "REVIEW_TERMINAL_FAILURE",
    ]);
    expect(JSON.stringify(recommendations)).not.toContain("ExecutionCapability");
    expect(runtime.events.filter((event) => event.eventType === "mission.delivered")).toHaveLength(0);
  });

  it("recommends battery preservation without changing runtime state", () => {
    const runtime = run("battery-drop");
    const before = JSON.stringify(runtime.state);
    const assessment = interpretIncident({ runtime });
    const recommendations = generateRecommendations(runtime, assessment);
    expect(recommendations.map((item) => item.type)).toContain("PRESERVE_BATTERY");
    expect(JSON.stringify(runtime.state)).toBe(before);
  });
});
