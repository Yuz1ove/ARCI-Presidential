import { describe, expect, it } from "vitest";
import { BoundedIntelligenceAdapter } from "../../src/intelligence/llm/adapter.js";
import { IntelligenceProviderError, type IntelligenceModelProvider } from "../../src/intelligence/llm/provider.js";

const request = {
  requestId: "intelligence-request:test",
  missionId: "mission:test",
  runId: "run:test",
  correlationId: "correlation:test",
  input: {
    inputId: "input:test",
    receivedAt: "2030-01-01T00:00:00.000Z",
    text: "Need urgent medical assistance.",
  },
} as const;

class ValidProvider implements IntelligenceModelProvider {
  public readonly providerName = "valid-mock";

  public interpretMission(): Promise<unknown> {
    return Promise.resolve({
      intent: "REQUEST_ASSISTANCE",
      urgency: "MEDICAL",
      proposedMissionType: "MEDICAL_EMERGENCY",
      constraints: [
        { kind: "DELIVERY_REQUIRED", asserted: true },
        { kind: "HIGH_RELIABILITY", asserted: true },
      ],
      requiresClarification: false,
      ambiguities: [],
      summary: "Bounded provider interpretation.",
      confidence: "HIGH",
    });
  }
}

describe("constrained provider boundary", () => {
  it("accepts strict provider semantics only after deterministic reconciliation", async () => {
    const result = await new BoundedIntelligenceAdapter(new ValidProvider()).interpretMission(request);
    expect(result.source).toBe("PROVIDER");
    expect(result.fallbackUsed).toBe(false);
    expect(result.interpretation.proposal.proposedMissionType).toBe("MEDICAL_EMERGENCY");
  });

  it("rejects forbidden execution-shaped model output and falls back", async () => {
    const provider: IntelligenceModelProvider = {
      providerName: "malicious-mock",
      interpretMission: () => Promise.resolve({ route: "SATELLITE", bypassPolicy: true, delivered: true }),
    };
    const result = await new BoundedIntelligenceAdapter(provider).interpretMission(request);
    expect(result.providerFailure).toBe("INTELLIGENCE_SCHEMA_REJECTED");
    expect(result.fallbackUsed).toBe(true);
    expect(JSON.stringify(result.interpretation)).not.toContain("SATELLITE");
    expect(JSON.stringify(result.interpretation)).not.toContain("delivered");
  });

  it("classifies unavailable and timeout failures without throwing", async () => {
    for (const code of ["INTELLIGENCE_PROVIDER_UNAVAILABLE", "INTELLIGENCE_TIMEOUT"] as const) {
      const provider: IntelligenceModelProvider = {
        providerName: "failed-mock",
        interpretMission: () => Promise.reject(new IntelligenceProviderError(code, code)),
      };
      const result = await new BoundedIntelligenceAdapter(provider).interpretMission(request);
      expect(result.providerFailure).toBe(code);
      expect(result.interpretation.proposal.proposedMissionType).toBe("MEDICAL_EMERGENCY");
    }
  });

  it("emits a deterministic correlated and causal intelligence event chain", async () => {
    const result = await new BoundedIntelligenceAdapter().interpretMission(request);
    expect(result.events.map((event) => event.eventType)).toEqual([
      "intelligence.requested",
      "mission.interpretation_started",
      "intelligence.fallback_used",
      "mission.interpreted",
    ]);
    expect(new Set(result.events.map((event) => event.correlationId)).size).toBe(1);
    result.events.forEach((event, index) => {
      expect(event.sequence).toBe(index + 1);
      expect(event.causationId).toBe(index === 0 ? undefined : result.events[index - 1]?.eventId);
    });
  });

  it("does not expose execution, ACK, delivery, graph, route-history, terminal, or budget authority", async () => {
    const result = await new BoundedIntelligenceAdapter().interpretMission(request);
    const serialized = JSON.stringify(result.interpretation);
    for (const forbidden of [
      "capabilityId",
      "executionId",
      "ackId",
      "delivered",
      "maxIterations",
      "graphVersion",
      "routeHistory",
      "terminalState",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
