import type { DeviceState } from "../domain/device/model.js";
import type { EnvironmentState } from "../domain/environment/model.js";
import type { IdSource } from "../domain/ids.js";
import type { MissionState } from "../domain/mission/model.js";
import { edgeById, nodeById, type NetworkGraph } from "../domain/network/model.js";
import {
  executionCapabilitySchema,
  type FinalValidationResult,
} from "../domain/policy/model.js";
import type {
  PolicyEvaluation,
  RouteCandidate,
  RoutingDecision,
} from "../domain/routing/model.js";

export const POLICY_VERSION = "phase1-policy-v1" as const;
export const EMERGENCY_RELIABILITY_FLOOR = 0.72;
export const LOW_BATTERY_PERCENT = 10;

export interface PolicyContext {
  readonly graph: NetworkGraph;
  readonly environment: EnvironmentState;
  readonly device: DeviceState;
  readonly mission: MissionState;
  readonly attempt: number;
}

export class PolicyEngine {
  public evaluate(route: RouteCandidate, context: PolicyContext): PolicyEvaluation {
    const hardViolations: string[] = [];
    const softWarnings: string[] = [];
    const appliedPolicies = ["ROUTE_INTEGRITY", "AVAILABILITY", "MISSION_REQUIREMENTS", "RETRY_BUDGET"];

    if (!route.validity.valid || route.nodes.length !== route.edges.length + 1) {
      hardViolations.push("MALFORMED_ROUTE");
    }
    if (route.graphVersion !== context.graph.graphVersion) hardViolations.push("STALE_GRAPH_VERSION");
    if (route.nodes.at(0)?.nodeId !== context.mission.originNodeId) hardViolations.push("WRONG_ORIGIN");
    if (route.nodes.at(-1)?.nodeId !== context.mission.destinationNodeId) {
      hardViolations.push("WRONG_DESTINATION");
    }

    for (let index = 0; index < route.edges.length; index += 1) {
      const routeEdge = route.edges[index];
      const graphEdge = routeEdge === undefined ? undefined : edgeById(context.graph, routeEdge.edgeId);
      const from = route.nodes[index];
      const to = route.nodes[index + 1];
      if (
        routeEdge === undefined ||
        graphEdge === undefined ||
        from === undefined ||
        to === undefined ||
        graphEdge.from !== from.nodeId ||
        graphEdge.to !== to.nodeId
      ) {
        hardViolations.push("DISCONNECTED_ROUTE");
        continue;
      }
      if (!graphEdge.available) hardViolations.push(`EDGE_UNAVAILABLE:${graphEdge.edgeId}`);
      if (nodeById(context.graph, from.nodeId)?.available !== true) {
        hardViolations.push(`NODE_UNAVAILABLE:${from.nodeId}`);
      }
      if (nodeById(context.graph, to.nodeId)?.available !== true) {
        hardViolations.push(`NODE_UNAVAILABLE:${to.nodeId}`);
      }
    }

    const firstMedium = route.edges[0]?.medium;
    if (
      firstMedium !== undefined &&
      firstMedium !== "RELAY_LINK" &&
      firstMedium !== "MESH" &&
      !context.device.availableInterfaces.includes(firstMedium)
    ) {
      hardViolations.push(`UNSUPPORTED_INTERFACE:${firstMedium}`);
    }
    if (context.attempt > context.mission.requirements.retryTolerance + 1) {
      hardViolations.push("RETRY_BUDGET_EXCEEDED");
    }

    if (
      context.mission.type === "MEDICAL_EMERGENCY" &&
      route.aggregateReliability < EMERGENCY_RELIABILITY_FLOOR
    ) {
      hardViolations.push("BELOW_EMERGENCY_RELIABILITY_FLOOR");
    } else if (route.aggregateReliability < context.mission.requirements.minimumReliability) {
      softWarnings.push("BELOW_MISSION_RELIABILITY_TARGET");
    }
    const maximumLatencyMs = context.mission.requirements.maximumLatencyMs;
    if (maximumLatencyMs !== undefined && route.aggregateLatencyMs > maximumLatencyMs) {
      softWarnings.push("ABOVE_MISSION_LATENCY_TARGET");
    }

    if (context.device.batteryPercent < LOW_BATTERY_PERCENT) {
      appliedPolicies.push("LOW_BATTERY_ENERGY_PREFERENCE");
      if (context.mission.type === "MEDICAL_EMERGENCY") {
        appliedPolicies.push("EMERGENCY_SOFT_ENERGY_OVERRIDE");
      } else if (route.aggregateEnergyCost >= 0.35) {
        softWarnings.push("HIGH_ENERGY_ON_LOW_BATTERY");
      }
    }
    if (route.aggregateMonetaryCost >= 0.7 && context.mission.type === "GENERAL") {
      softWarnings.push("HIGH_MONETARY_COST");
    }

    return {
      allowed: hardViolations.length === 0,
      hardViolations: [...new Set(hardViolations)],
      softWarnings: [...new Set(softWarnings)],
      appliedPolicies,
    };
  }
}

export class FinalPolicyValidator {
  public constructor(
    private readonly policy: PolicyEngine,
    private readonly ids: IdSource,
  ) {}

  public validate(
    decision: RoutingDecision,
    candidates: readonly RouteCandidate[],
    context: PolicyContext,
    validatedAt: string,
  ): FinalValidationResult {
    if (decision.selectedRoute === undefined) {
      return { allowed: false, reasons: ["NO_SELECTED_ROUTE"] };
    }
    const member = candidates.find((candidate) => candidate.routeId === decision.selectedRoute?.routeId);
    if (member === undefined) return { allowed: false, reasons: ["ROUTE_NOT_IN_CANDIDATE_SET"] };

    const evaluation = this.policy.evaluate(member, context);
    if (!evaluation.allowed || evaluation.hardViolations.length > 0) {
      return { allowed: false, reasons: evaluation.hardViolations };
    }

    return {
      allowed: true,
      capability: executionCapabilitySchema.parse({
        capabilityId: this.ids.next("capability"),
        decisionId: decision.decisionId,
        missionId: decision.missionId,
        route: member,
        policyVersion: POLICY_VERSION,
        validatedAt,
      }),
    };
  }
}
