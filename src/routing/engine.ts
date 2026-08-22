import type { DeviceState } from "../domain/device/model.js";
import type { EnvironmentState } from "../domain/environment/model.js";
import type { IdSource } from "../domain/ids.js";
import type { MissionState } from "../domain/mission/model.js";
import type { NetworkGraph } from "../domain/network/model.js";
import { routingDecisionSchema } from "../domain/routing/model.js";
import type { EvaluatedRoute, RouteCandidate, RoutingDecision } from "../domain/routing/model.js";
import type { PolicyEngine } from "../policy/engine.js";
import { compareScoredRoutes, scoreRoute } from "./scoring.js";

export class RoutingEngine {
  public constructor(
    private readonly policy: PolicyEngine,
    private readonly ids: IdSource,
  ) {}

  public decide(input: {
    candidates: readonly RouteCandidate[];
    graph: NetworkGraph;
    environment: EnvironmentState;
    device: DeviceState;
    mission: MissionState;
    attempt?: number;
  }): RoutingDecision {
    const context = {
      graph: input.graph,
      environment: input.environment,
      device: input.device,
      mission: input.mission,
      attempt: input.attempt ?? 1,
    };
    const evaluated: EvaluatedRoute[] = input.candidates.map((route) => {
      const policyEvaluation = this.policy.evaluate(route, context);
      return policyEvaluation.allowed
        ? {
            route,
            policyEvaluation,
            scoreBreakdown: scoreRoute(route, input.mission, input.device, policyEvaluation),
          }
        : { route, policyEvaluation };
    });
    const allowed = evaluated
      .filter(
        (evaluation): evaluation is EvaluatedRoute & { scoreBreakdown: NonNullable<EvaluatedRoute["scoreBreakdown"]> } =>
          evaluation.policyEvaluation.allowed && evaluation.scoreBreakdown !== undefined,
      )
      .sort(compareScoredRoutes);

    if (allowed.length === 0) {
      return routingDecisionSchema.parse({
        decisionId: this.ids.next("decision"),
        missionId: input.mission.missionId,
        graphVersion: input.graph.graphVersion,
        alternatives: evaluated,
        decisionStatus: "NO_VALID_ROUTE",
        reasonCodes: ["NO_POLICY_VALID_ROUTE"],
      });
    }

    const winner = allowed[0];
    if (winner === undefined) throw new Error("allowed route disappeared");
    const degraded =
      winner.route.aggregateReliability < input.mission.requirements.minimumReliability ||
      (input.mission.requirements.maximumLatencyMs !== undefined &&
        winner.route.aggregateLatencyMs > input.mission.requirements.maximumLatencyMs);

    return routingDecisionSchema.parse({
      decisionId: this.ids.next("decision"),
      missionId: input.mission.missionId,
      graphVersion: input.graph.graphVersion,
      selectedRoute: winner.route,
      alternatives: [...allowed, ...evaluated.filter((route) => !route.policyEvaluation.allowed)],
      scoreBreakdown: winner.scoreBreakdown,
      policyEvaluation: winner.policyEvaluation,
      decisionStatus: degraded ? "DEGRADED" : "NORMAL",
      reasonCodes: [
        "HIGHEST_POLICY_VALID_SCORE",
        degraded ? "MISSION_TARGET_DEGRADED" : "MISSION_TARGETS_MET",
        "TIE_BREAK_RELIABILITY_LATENCY_ENERGY_HOPS_ROUTE_ID",
      ],
    });
  }
}
