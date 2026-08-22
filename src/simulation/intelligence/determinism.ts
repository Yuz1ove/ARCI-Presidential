import { runIntelligenceScenario } from "./engine.js";
import type { IntelligenceScenarioName } from "./schema.js";

export const INTELLIGENCE_DETERMINISM_SCENARIOS: readonly IntelligenceScenarioName[] = [
  "natural-language-medical-emergency",
  "ambiguous-assistance-request",
  "prompt-injection-attempt",
  "incident-explanation",
  "late-ack-explanation",
  "no-valid-route",
  "provider-failure",
  "invalid-model-output",
  "mission-priority-interpretation",
  "explanation-determinism",
];

export interface IntelligenceDeterminismResult {
  readonly scenario: IntelligenceScenarioName;
  readonly replays: number;
  readonly deterministic: boolean;
}
export async function intelligenceFingerprint(name: IntelligenceScenarioName): Promise<string> {
  const result = await runIntelligenceScenario(name);
  return JSON.stringify({
    interpretation: result.interpretation,
    previousInterpretation: result.previousInterpretation,
    incident: result.incident,
    recommendationTypes: result.recommendations.map((item) => item.type),
    recommendationEvidence: result.recommendations.map((item) => item.evidenceIds),
    explanations: result.explanations,
    providerFailure: result.providerFailure,
    fallbackUsed: result.fallbackUsed,
    intelligenceEventChain: result.intelligenceEvents.map((event) => ({
      sequence: event.sequence,
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
      causationId: event.causationId,
      payload: event.payload,
    })),
    runtime: result.runtime === undefined
      ? undefined
      : {
          routeHistory: result.runtime.state.metrics.routeHistory,
          executionIds: result.runtime.state.executionHistory.map((item) => item.executionId),
          adaptations: result.runtime.state.adaptations,
          terminalState: result.runtime.state.lifecycle,
          terminalReason: result.runtime.state.terminalReason,
          verification: result.runtime.state.verification,
          eventOrdering: result.runtime.events.map((event) => ({
            sequence: event.sequence,
            eventType: event.eventType,
            correlationId: event.correlationId,
            causationId: event.causationId,
          })),
        },
  });
}

export async function runIntelligenceDeterminismGate(
  replays = 10,
  scenarios: readonly IntelligenceScenarioName[] = INTELLIGENCE_DETERMINISM_SCENARIOS,
): Promise<readonly IntelligenceDeterminismResult[]> {
  if (!Number.isInteger(replays) || replays < 2) {
    throw new Error("intelligence determinism gate requires at least two replays");
  }
  const results: IntelligenceDeterminismResult[] = [];
  for (const scenario of scenarios) {
    const baseline = await intelligenceFingerprint(scenario);
    let deterministic = true;
    for (let replay = 2; replay <= replays; replay += 1) {
      if ((await intelligenceFingerprint(scenario)) !== baseline) deterministic = false;
    }
    results.push({ scenario, replays, deterministic });
  }
  return results;
}
