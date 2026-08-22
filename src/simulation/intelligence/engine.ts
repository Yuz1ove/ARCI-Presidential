import type { DomainEvent } from "../../domain/events/model.js";
import { explainRuntime } from "../../intelligence/explanation/engine.js";
import { interpretIncident } from "../../intelligence/incident/interpreter.js";
import { BoundedIntelligenceAdapter } from "../../intelligence/llm/adapter.js";
import { IntelligenceProviderError, type IntelligenceModelProvider } from "../../intelligence/llm/provider.js";
import { missionProposalToMissionPatch } from "../../intelligence/mission/interpreter.js";
import type {
  DecisionRecommendation,
  IncidentAssessment,
  IntelligenceFailureCode,
  MissionInterpretation,
  OperatorExplanation,
} from "../../intelligence/model.js";
import { generateRecommendations } from "../../intelligence/recommendation/engine.js";
import { StarryRuntime } from "../../runtime/engine.js";
import type { StarryRuntimeResult } from "../../runtime/model.js";
import { getRuntimeScenarioFixture } from "../runtime/fixtures.js";
import { getIntelligenceScenarioFixture } from "./fixtures.js";
import type { IntelligenceScenarioName } from "./schema.js";

class UnavailableProvider implements IntelligenceModelProvider {
  public readonly providerName = "unavailable-fixture";

  public interpretMission(): Promise<unknown> {
    return Promise.reject(
      new IntelligenceProviderError(
        "INTELLIGENCE_PROVIDER_UNAVAILABLE",
        "provider unavailable in deterministic fixture",
      ),
    );
  }
}

class InvalidOutputProvider implements IntelligenceModelProvider {
  public readonly providerName = "invalid-output-fixture";

  public interpretMission(): Promise<unknown> {
    return Promise.resolve({ route: "SATELLITE", bypassPolicy: true, delivered: true });
  }
}

export interface IntelligenceScenarioResult {
  readonly name: IntelligenceScenarioName;
  readonly input: string;
  readonly interpretation: MissionInterpretation;
  readonly previousInterpretation?: MissionInterpretation;
  readonly runtime?: StarryRuntimeResult;
  readonly incident?: IncidentAssessment;
  readonly recommendations: readonly DecisionRecommendation[];
  readonly explanations: readonly OperatorExplanation[];
  readonly providerFailure?: IntelligenceFailureCode;
  readonly fallbackUsed: boolean;
  readonly intelligenceEvents: readonly DomainEvent[];
}

function requestFor(name: IntelligenceScenarioName, text: string) {
  const timestamp = "2030-01-01T00:00:00.000Z";
  return {
    requestId: `intelligence-scenario:${name}:request`,
    missionId: `intelligence-scenario:${name}:mission`,
    runId: `intelligence-scenario:${name}:run`,
    correlationId: `intelligence-scenario:${name}:correlation`,
    input: {
      inputId: `intelligence-scenario:${name}:input`,
      receivedAt: timestamp,
      text,
    },
  } as const;
}

function providerFor(name: IntelligenceScenarioName): IntelligenceModelProvider | undefined {
  if (name === "provider-failure") return new UnavailableProvider();
  if (name === "invalid-model-output") return new InvalidOutputProvider();
  return undefined;
}

export async function runIntelligenceScenario(
  name: IntelligenceScenarioName,
): Promise<IntelligenceScenarioResult> {
  const fixture = getIntelligenceScenarioFixture(name);
  const adapter = new BoundedIntelligenceAdapter(providerFor(name));
  const response = await adapter.interpretMission(requestFor(name, fixture.input));
  let previousInterpretation: MissionInterpretation | undefined;
  if (name === "mission-priority-interpretation") {
    previousInterpretation = (
      await new BoundedIntelligenceAdapter().interpretMission(
        requestFor(name, "general communication"),
      )
    ).interpretation;
  }

  let runtime: StarryRuntimeResult | undefined;
  if (fixture.runtimeScenario !== undefined) {
    const runtimeFixture = getRuntimeScenarioFixture(fixture.runtimeScenario);
    if (name === "mission-priority-interpretation") {
      const missionPatch = missionProposalToMissionPatch(response.interpretation);
      if (missionPatch === undefined) {
        throw new Error("priority interpretation did not produce a mission proposal");
      }
      runtime = new StarryRuntime().run({
        ...runtimeFixture,
        observations: runtimeFixture.observations.map((observation) =>
          observation.target === "MISSION"
            ? { ...observation, patch: missionPatch }
            : observation,
        ),
      });
    } else {
      runtime = new StarryRuntime().run(runtimeFixture);
    }
  }
  const incident = runtime === undefined ? undefined : interpretIncident({ runtime });
  const recommendations =
    runtime === undefined || incident === undefined
      ? []
      : generateRecommendations(runtime, incident);
  const explanations =
    runtime === undefined
      ? []
      : name === "late-ack-explanation"
        ? [explainRuntime(runtime, "LATE_ACK")]
        : name === "no-valid-route"
          ? [explainRuntime(runtime, "WHY_NOT_DELIVERED")]
          : name === "incident-explanation" || name === "explanation-determinism"
            ? [explainRuntime(runtime, "INCIDENT_SUMMARY"), explainRuntime(runtime, "WHY_REPLAN")]
            : [explainRuntime(runtime, "WHY_ROUTE_SELECTED")];

  return {
    name,
    input: fixture.input,
    interpretation: response.interpretation,
    ...(previousInterpretation === undefined ? {} : { previousInterpretation }),
    ...(runtime === undefined ? {} : { runtime }),
    ...(incident === undefined ? {} : { incident }),
    recommendations,
    explanations,
    ...(response.providerFailure === undefined ? {} : { providerFailure: response.providerFailure }),
    fallbackUsed: response.fallbackUsed,
    intelligenceEvents: response.events,
  };
}
