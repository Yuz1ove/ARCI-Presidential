import type { DomainEvent } from "../../domain/events/model.js";
import type { StarryRuntimeResult } from "../../runtime/model.js";
import type { ExplanationEvidence, MissionInput } from "../model.js";
import { explanationEvidenceSchema } from "../schemas.js";

function eventClaim(event: DomainEvent): string {
  const rawRouteId =
    typeof event.payload.routeId === "string"
      ? event.payload.routeId
      : typeof event.payload.selectedRouteId === "string"
        ? event.payload.selectedRouteId
        : undefined;
  const routeId = rawRouteId === undefined ? "" : ` for ${rawRouteId}`;
  const rawReason =
    typeof event.payload.reason === "string"
      ? event.payload.reason
      : typeof event.payload.failureReason === "string"
        ? event.payload.failureReason
        : undefined;
  const reason = rawReason === undefined ? "" : `: ${rawReason}`;
  switch (event.eventType) {
    case "execution.attempt_failed":
      return `Execution failed${routeId}${reason}.`;
    case "verification.ack_ignored":
      return `An acknowledgement was ignored${reason}.`;
    case "verification.ack_received":
      return `A correlated acknowledgement was received${routeId}.`;
    case "mission.delivered":
      return "Mission delivery was recorded after verification.";
    case "route.updated":
      return `The deterministic core selected a validated route${routeId}.`;
    case "route.candidates_scored":
      return `${String(event.payload.candidateCount)} route candidates were scored deterministically.`;
    case "policy.approved":
      return `Policy and final validation approved the route${routeId} with no hard violations.`;
    case "policy.rejected":
      return `Policy rejected the available routing decision${reason}.`;
    case "route.invalidated":
      return `The active route was invalidated${routeId}${reason}.`;
    case "adaptation.decided":
      return `The runtime selected adaptation ${String(event.payload.action)}${reason}.`;
    case "runtime.failed":
      return `The runtime terminated with failure${reason}.`;
    case "runtime.completed":
      return "The runtime completed after a verified acknowledgement.";
    case "observation.normalized":
      return `Observation ${String(event.payload.observationId)} was normalized as runtime evidence.`;
    default:
      return `Runtime event ${event.eventType} occurred.`;
  }
}

export function evidenceFromMissionInput(input: MissionInput): ExplanationEvidence {
  return explanationEvidenceSchema.parse({
    evidenceId: `${input.inputId}:evidence:001`,
    sourceType: "USER_REPORTED",
    timestamp: input.receivedAt,
    claim: input.text,
  });
}

export function collectRuntimeEvidence(result: StarryRuntimeResult): readonly ExplanationEvidence[] {
  return result.events.map((event) => {
    const routeId =
      typeof event.payload.routeId === "string"
        ? event.payload.routeId
        : typeof event.payload.selectedRouteId === "string"
          ? event.payload.selectedRouteId
          : undefined;
    const executionId =
      typeof event.payload.executionId === "string" ? event.payload.executionId : undefined;
    const decisionId =
      typeof event.payload.decisionId === "string" ? event.payload.decisionId : undefined;
    const observationId =
      typeof event.payload.observationId === "string" ? event.payload.observationId : undefined;
    return explanationEvidenceSchema.parse({
      evidenceId: `${result.state.runId}:evidence:${event.sequence.toString().padStart(4, "0")}`,
      sourceType: event.eventType.startsWith("observation.")
        ? event.payload.simulation === true
          ? "SIMULATED"
          : "OBSERVED"
        : "DERIVED",
      timestamp: event.timestamp,
      claim: eventClaim(event),
      eventId: event.eventId,
      ...(routeId === undefined ? {} : { routeId }),
      ...(executionId === undefined ? {} : { executionId }),
      ...(decisionId === undefined ? {} : { decisionId }),
      ...(observationId === undefined ? {} : { observationId }),
    });
  });
}
