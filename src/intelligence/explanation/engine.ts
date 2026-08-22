import type { DomainEvent, DomainEventType } from "../../domain/events/model.js";
import type { StarryRuntimeResult } from "../../runtime/model.js";
import { collectRuntimeEvidence } from "../evidence/collector.js";
import type { ExplanationEvidence, ExplanationQuestion, OperatorExplanation } from "../model.js";
import { operatorExplanationSchema } from "../schemas.js";

function selectEvidence(
  runtime: StarryRuntimeResult,
  evidence: readonly ExplanationEvidence[],
  eventType: DomainEventType,
  predicate: (event: DomainEvent) => boolean = () => true,
): readonly ExplanationEvidence[] {
  const ids = new Set(
    runtime.events
      .filter((event) => event.eventType === eventType && predicate(event))
      .map((event) => event.eventId),
  );
  return evidence.filter((item) => item.eventId !== undefined && ids.has(item.eventId));
}
export function explainRuntime(
  runtime: StarryRuntimeResult,
  question: ExplanationQuestion,
  suppliedEvidence?: readonly ExplanationEvidence[],
): OperatorExplanation {
  const evidence = suppliedEvidence ?? collectRuntimeEvidence(runtime);
  let summary = `The runtime is ${runtime.state.lifecycle.toLowerCase()}.`;
  let selected: readonly ExplanationEvidence[] = [];

  switch (question) {
    case "WHY_ROUTE_SELECTED":
    case "WHY_SATELLITE":
      selected = [
        ...selectEvidence(runtime, evidence, "route.candidates_scored").slice(-1),
        ...selectEvidence(runtime, evidence, "policy.approved").slice(-1),
        ...selectEvidence(runtime, evidence, "route.updated").slice(-1),
      ];
      summary = "The deterministic router scored candidates, policy approved the selected route, and final validation authorized it.";
      break;
    case "WHY_ROUTE_REJECTED":
      selected = selectEvidence(runtime, evidence, "policy.rejected");
      summary = "The route was rejected by deterministic policy or final validation.";
      break;
    case "WHY_RETRY":
      selected = selectEvidence(
        runtime,
        evidence,
        "adaptation.decided",
        (event) => event.payload.action === "RETRY_ROUTE",
      );
      summary = "The runtime retried because the bounded deterministic adaptation policy selected RETRY_ROUTE.";
      break;
    case "WHY_REPLAN":
    case "WHAT_CHANGED":
      selected = selectEvidence(
        runtime,
        evidence,
        "adaptation.decided",
        (event) => event.payload.action === "REPLAN" || event.payload.action === "REVALIDATE_ROUTE",
      );
      summary = "A runtime event invalidated or degraded the prior plan, so bounded deterministic adaptation replanned.";
      break;
    case "WHY_ABORTED":
    case "WHY_NOT_DELIVERED":
      selected = selectEvidence(runtime, evidence, "runtime.failed");
      summary = `The mission is not delivered because the runtime ended with ${runtime.state.terminalReason ?? "an unverified terminal state"}; no model claim can substitute for a matched ACK.`;
      break;
    case "LATE_ACK":
      selected = [
        ...selectEvidence(runtime, evidence, "verification.ack_received"),
        ...selectEvidence(runtime, evidence, "verification.ack_ignored", (event) => event.payload.stale === true),
      ];
      summary = "The ACK belonged to an older execution identity, so it was ignored and the current execution remained authoritative.";
      break;
    case "INCIDENT_SUMMARY":
      selected = evidence.filter((item) =>
        ["execution.attempt_failed", "adaptation.decided", "mission.delivered"].some((type) =>
          runtime.events.some((event) => event.eventId === item.eventId && event.eventType === type),
        ),
      );
      summary = runtime.state.lifecycle === "COMPLETED"
        ? "Failures and adaptations were resolved by the deterministic runtime; delivery was recorded only after a matched ACK."
        : `The runtime terminated without verified delivery: ${runtime.state.terminalReason ?? "unknown reason"}.`;
      break;
    case "CURRENT_STATUS":
      selected = evidence.slice(-1);
      summary = `The runtime is ${runtime.state.lifecycle} with terminal reason ${runtime.state.terminalReason ?? "not yet terminal"}.`;
      break;
  }

  const uniqueEvidence = [...new Map(selected.map((item) => [item.evidenceId, item])).values()];
  return operatorExplanationSchema.parse({
    explanationId: `${runtime.state.runId}:explanation:${question.toLowerCase()}`,
    question,
    summary,
    claims: uniqueEvidence.length === 0 ? [] : [{ text: summary, evidenceIds: uniqueEvidence.map((item) => item.evidenceId) }],
    evidence: uniqueEvidence,
    confidence: uniqueEvidence.length === 0 ? "LOW" : "HIGH",
  });
}
