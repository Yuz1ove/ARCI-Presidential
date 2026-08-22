import type { DomainEvent, DomainEventType } from "../../domain/events/model.js";
import { collectRuntimeEvidence } from "../evidence/collector.js";
import type { ExplanationEvidence, IncidentAssessment, IncidentContext } from "../model.js";
import { incidentAssessmentSchema } from "../schemas.js";

function evidenceForEvent(
  evidence: readonly ExplanationEvidence[],
  event: DomainEvent | undefined,
): string | undefined {
  return event === undefined ? undefined : evidence.find((item) => item.eventId === event.eventId)?.evidenceId;
}
function firstEvent(
  events: readonly DomainEvent[],
  eventType: DomainEventType,
  predicate: (event: DomainEvent) => boolean = () => true,
): DomainEvent | undefined {
  return events.find((event) => event.eventType === eventType && predicate(event));
}

export function interpretIncident(context: IncidentContext): IncidentAssessment {
  const runtime = context.runtime;
  const evidence = context.evidence ?? collectRuntimeEvidence(runtime);
  const signals: Array<{
    type: "CELLULAR_PATH_FAILURE" | "ROUTE_FAILURE" | "BATTERY_DEGRADATION" | "TOPOLOGY_CHANGE" | "ACK_TIMEOUT" | "LATE_ACK" | "NO_VALID_ROUTE" | "POLICY_REJECTION" | "DELIVERY_VERIFIED";
    severity: "INFO" | "WARNING" | "CRITICAL";
    summary: string;
    evidenceIds: string[];
  }> = [];
  const addSignal = (
    type: (typeof signals)[number]["type"],
    severity: (typeof signals)[number]["severity"],
    summary: string,
    event: DomainEvent | undefined,
  ): void => {
    const evidenceId = evidenceForEvent(evidence, event);
    if (evidenceId !== undefined) signals.push({ type, severity, summary, evidenceIds: [evidenceId] });
  };

  const cellularFailure = firstEvent(
    runtime.events,
    "execution.attempt_failed",
    (event) => typeof event.payload.routeId === "string" && event.payload.routeId.includes("cellular"),
  );
  const routeFailure = firstEvent(runtime.events, "execution.attempt_failed");
  const battery = firstEvent(
    runtime.events,
    "adaptation.decided",
    (event) => event.payload.trigger === "BATTERY_CRITICAL",
  );
  const topology = firstEvent(runtime.events, "route.invalidated");
  const ackTimeout = firstEvent(
    runtime.events,
    "adaptation.decided",
    (event) => event.payload.trigger === "ACK_TIMEOUT",
  );
  const lateAck = firstEvent(
    runtime.events,
    "verification.ack_ignored",
    (event) => event.payload.stale === true,
  );
  const noRoute = firstEvent(
    runtime.events,
    "runtime.failed",
    (event) => event.payload.reason === "NO_VALID_ROUTE",
  );
  const policyRejection = firstEvent(runtime.events, "policy.rejected");
  const verified = firstEvent(runtime.events, "mission.delivered");

  addSignal("CELLULAR_PATH_FAILURE", "WARNING", "The selected cellular path failed during execution.", cellularFailure);
  if (cellularFailure === undefined) {
    addSignal("ROUTE_FAILURE", "WARNING", "A selected route failed during execution.", routeFailure);
  }
  addSignal("BATTERY_DEGRADATION", "WARNING", "Battery telemetry triggered deterministic adaptation.", battery);
  addSignal("TOPOLOGY_CHANGE", "WARNING", "A topology change invalidated the active route.", topology);
  addSignal("ACK_TIMEOUT", "WARNING", "A delivered attempt did not receive a matched ACK in time.", ackTimeout);
  addSignal("LATE_ACK", "INFO", "An ACK for an older execution was ignored as stale.", lateAck);
  addSignal("NO_VALID_ROUTE", "CRITICAL", "No final-validator-approved route remained available.", noRoute);
  addSignal("POLICY_REJECTION", "CRITICAL", "Policy or final validation rejected the routing decision.", policyRejection);
  addSignal("DELIVERY_VERIFIED", "INFO", "Delivery was recorded only after a matched ACK.", verified);

  const priority = [
    "NO_VALID_ROUTE",
    "POLICY_REJECTION",
    "CELLULAR_PATH_FAILURE",
    "ROUTE_FAILURE",
    "TOPOLOGY_CHANGE",
    "BATTERY_DEGRADATION",
    "ACK_TIMEOUT",
    "LATE_ACK",
    "DELIVERY_VERIFIED",
  ] as const;
  const primaryIncident = priority.find((type) => signals.some((signal) => signal.type === type));
  const primary = signals.find((signal) => signal.type === primaryIncident);
  const severity = signals.some((signal) => signal.severity === "CRITICAL")
    ? "CRITICAL"
    : signals.some((signal) => signal.severity === "WARNING")
      ? "WARNING"
      : "INFO";

  return incidentAssessmentSchema.parse({
    assessmentId: `${runtime.state.runId}:incident`,
    ...(primaryIncident === undefined ? {} : { primaryIncident }),
    secondaryConditions: signals
      .map((signal) => signal.type)
      .filter((type) => type !== primaryIncident),
    severity,
    currentStatus: runtime.state.lifecycle,
    ...(runtime.state.terminalReason === undefined ? {} : { terminalReason: runtime.state.terminalReason }),
    summary: primary?.summary ?? `The runtime is ${runtime.state.lifecycle.toLowerCase()} with no classified incident signal.`,
    signals,
    evidence,
  });
}
