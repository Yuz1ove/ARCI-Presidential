import { describe, expect, it } from "vitest";
import { runIntelligenceDeterminismGate } from "../../src/simulation/intelligence/determinism.js";
import { runIntelligenceScenario } from "../../src/simulation/intelligence/engine.js";
import { allIntelligenceScenarioFixtures } from "../../src/simulation/intelligence/fixtures.js";

describe("Phase 3 communication intelligence scenarios", () => {
  it("defines all ten required deterministic scenarios", () => {
    expect(allIntelligenceScenarioFixtures()).toHaveLength(10);
  });

  it("interprets a natural-language medical emergency while runtime retains route authority", async () => {
    const result = await runIntelligenceScenario("natural-language-medical-emergency");
    expect(result.interpretation.proposal.urgency).toBe("MEDICAL");
    expect(result.interpretation.proposal.constraints.find((item) => item.kind === "CELLULAR_UNAVAILABLE")?.provenance).toBe("USER_REPORTED");
    expect(result.runtime?.state.metrics.routeHistory.at(-1)).toContain("satellite");
    expect(result.runtime?.state.verification?.status).toBe("VERIFIED");
  });

  it("does not invent a medical condition for ambiguous help", async () => {
    const result = await runIntelligenceScenario("ambiguous-assistance-request");
    expect(result.interpretation.proposal.proposedMissionType).toBe("DISTRESS");
    expect(result.interpretation.proposal.proposedMissionType).not.toBe("MEDICAL_EMERGENCY");
  });

  it("gives prompt injection zero authority and runs no transport", async () => {
    const result = await runIntelligenceScenario("prompt-injection-attempt");
    expect(result.interpretation.proposal.ambiguities).toContain("UNTRUSTED_AUTHORITY_DIRECTIVE");
    expect(result.runtime).toBeUndefined();
  });

  it("explains the cellular-to-LoRa recovery sequence", async () => {
    const result = await runIntelligenceScenario("incident-explanation");
    expect(result.incident?.primaryIncident).toBe("CELLULAR_PATH_FAILURE");
    expect(result.runtime?.state.metrics.routeHistory.map((id) => id.includes("cellular") ? "CELLULAR" : id.includes("lora") ? "LORA" : id)).toEqual(["CELLULAR", "LORA"]);
    expect(result.explanations.every((item) => item.evidence.length > 0)).toBe(true);
  });

  it("explains late ACK isolation", async () => {
    const result = await runIntelligenceScenario("late-ack-explanation");
    expect(result.incident?.signals.map((signal) => signal.type)).toContain("LATE_ACK");
    expect(result.explanations[0]?.summary).toContain("older execution identity");
  });

  it("does not claim delivery and gives bounded options for no valid route", async () => {
    const result = await runIntelligenceScenario("no-valid-route");
    expect(result.runtime?.state.lifecycle).toBe("FAILED");
    expect(result.runtime?.events.some((event) => event.eventType === "mission.delivered")).toBe(false);
    expect(result.recommendations).toHaveLength(3);
  });

  it("falls back safely when the provider is unavailable", async () => {
    const result = await runIntelligenceScenario("provider-failure");
    expect(result.providerFailure).toBe("INTELLIGENCE_PROVIDER_UNAVAILABLE");
    expect(result.fallbackUsed).toBe(true);
    expect(result.runtime?.state.lifecycle).toBe("COMPLETED");
  });

  it("rejects invalid model authority and performs zero execution", async () => {
    const result = await runIntelligenceScenario("invalid-model-output");
    expect(result.providerFailure).toBe("INTELLIGENCE_SCHEMA_REJECTED");
    expect(result.runtime).toBeUndefined();
    expect(JSON.stringify(result.interpretation)).not.toContain("bypassPolicy");
  });

  it("proposes a priority update while existing runtime machinery replans", async () => {
    const result = await runIntelligenceScenario("mission-priority-interpretation");
    expect(result.previousInterpretation?.proposal.proposedMissionType).toBe("GENERAL");
    expect(result.interpretation.proposal.proposedMissionType).toBe("MEDICAL_EMERGENCY");
    expect(result.runtime?.state.adaptations[0]?.trigger).toBe("MISSION_REQUIREMENTS_CHANGED");
  });

  it("replays all ten structured scenarios identically ten times", async () => {
    const results = await runIntelligenceDeterminismGate(10);
    expect(results).toHaveLength(10);
    expect(results.every((result) => result.replays === 10 && result.deterministic)).toBe(true);
  });
});
