import type { StarryRuntimeResult } from "../../runtime/model.js";
import type { DecisionRecommendation, IncidentAssessment } from "../model.js";
import { decisionRecommendationSchema } from "../schemas.js";

function signalEvidence(assessment: IncidentAssessment, type: string): readonly string[] {
  return assessment.signals.find((signal) => signal.type === type)?.evidenceIds ?? [];
}
export function generateRecommendations(
  runtime: StarryRuntimeResult,
  assessment: IncidentAssessment,
): readonly DecisionRecommendation[] {
  const recommendations: DecisionRecommendation[] = [];
  const add = (input: Omit<DecisionRecommendation, "recommendationId">): void => {
    recommendations.push(
      decisionRecommendationSchema.parse({
        ...input,
        recommendationId: `${runtime.state.runId}:recommendation:${(recommendations.length + 1).toString().padStart(3, "0")}`,
      }),
    );
  };

  const noRouteEvidence = signalEvidence(assessment, "NO_VALID_ROUTE");
  if (noRouteEvidence.length > 0) {
    add({
      type: "REQUEST_FRESH_OBSERVATION",
      priority: "HIGH",
      title: "Request fresh network evidence",
      summary: "Obtain an updated topology observation before another deterministic run.",
      rationale: "The current run terminated because no validated route remained.",
      evidenceIds: [...noRouteEvidence],
      confidence: "HIGH",
      operatorActionRequired: true,
    });
    add({
      type: "WAIT_FOR_TOPOLOGY_RECOVERY",
      priority: "MEDIUM",
      title: "Wait for topology recovery",
      summary: "Monitor for restored infrastructure without claiming delivery.",
      rationale: "Waiting does not mutate runtime state or bypass route validation.",
      evidenceIds: [...noRouteEvidence],
      confidence: "MEDIUM",
      operatorActionRequired: true,
    });
    add({
      type: "REVIEW_TERMINAL_FAILURE",
      priority: "HIGH",
      title: "Review terminal failure",
      summary: "Escalate the typed terminal reason to an operator.",
      rationale: "The intelligence layer cannot restart or override the failed runtime.",
      evidenceIds: [...noRouteEvidence],
      confidence: "HIGH",
      operatorActionRequired: true,
    });
    return recommendations;
  }

  const batteryEvidence = signalEvidence(assessment, "BATTERY_DEGRADATION");
  if (batteryEvidence.length > 0) {
    add({
      type: "PRESERVE_BATTERY",
      priority: "HIGH",
      title: "Preserve battery",
      summary: "Reduce avoidable device energy use while the deterministic runtime continues.",
      rationale: "Observed battery degradation already triggered runtime adaptation.",
      evidenceIds: [...batteryEvidence],
      confidence: "HIGH",
      operatorActionRequired: true,
    });
    add({
      type: "REDUCE_NON_ESSENTIAL_TRAFFIC",
      priority: "MEDIUM",
      title: "Reduce non-essential traffic",
      summary: "Defer traffic unrelated to the active mission.",
      rationale: "This operator action can conserve energy without choosing a route.",
      evidenceIds: [...batteryEvidence],
      confidence: "MEDIUM",
      operatorActionRequired: true,
    });
  }

  if (runtime.state.lifecycle !== "FAILED" && runtime.state.currentRoutingDecision?.selectedRoute !== undefined) {
    const routeEvidence = assessment.evidence.filter(
      (item) => item.routeId === runtime.state.currentRoutingDecision?.selectedRoute?.routeId,
    );
    const lastEvidence = assessment.evidence.at(-1);
    const evidenceIds = routeEvidence.length > 0
      ? [routeEvidence.at(-1)?.evidenceId].filter((id): id is string => id !== undefined)
      : lastEvidence === undefined
        ? []
        : [lastEvidence.evidenceId];
    if (evidenceIds.length > 0) {
      add({
        type: "CONTINUE_CURRENT_ROUTE",
        priority: "LOW",
        title: "Retain the validated runtime decision",
        summary: "Allow the deterministic core to remain authoritative.",
        rationale: "The recommendation does not select, authorize, or execute the route.",
        evidenceIds,
        confidence: "HIGH",
        operatorActionRequired: false,
      });
    }
  }

  return recommendations;
}
