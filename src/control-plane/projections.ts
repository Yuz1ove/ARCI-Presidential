import { z } from "zod";
import { ControlPlaneFailure } from "./failures.js";
import type {
  MissionReadModel,
  PublicHistoryRecord,
  RuntimeHistoryRecord,
  RuntimeReadModel,
} from "./model.js";
import {
  missionReadModelSchema,
  publicHistoryRecordSchema,
  runtimeHistoryRecordSchema,
  runtimeReadModelSchema,
} from "./schemas.js";

const payloadId = (record: RuntimeHistoryRecord, key: string): string | undefined => {
  const value = record.payload[key];
  return typeof value === "string" ? value : undefined;
};

const stringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];

function validatedRecords(rawRecords: readonly RuntimeHistoryRecord[]): readonly RuntimeHistoryRecord[] {
  try {
    const records = rawRecords.map((record) => runtimeHistoryRecordSchema.parse(record));
    const ids = new Set<string>();
    let previousSequence = 0;
    for (const record of records) {
      if (ids.has(record.eventId)) {
        throw new ControlPlaneFailure("REPLAY_FAILURE", `duplicate replay event: ${record.eventId}`);
      }
      if (record.sequence <= previousSequence) {
        throw new ControlPlaneFailure("REPLAY_FAILURE", "history sequence is not strictly increasing");
      }
      ids.add(record.eventId);
      previousSequence = record.sequence;
    }
    return records;
  } catch (error) {
    if (error instanceof ControlPlaneFailure) throw error;
    if (error instanceof z.ZodError) {
      throw new ControlPlaneFailure("REPLAY_FAILURE", "persisted history failed strict schema validation");
    }
    throw new ControlPlaneFailure("REPLAY_FAILURE", "persisted history could not be replayed");
  }
}

interface AcceptedExecution {
  readonly routeId: string;
  readonly correlationId: string;
}

interface ReceivedAck {
  readonly executionId: string;
  readonly routeId: string;
  readonly correlationId: string;
}

interface VerifiedDelivery {
  readonly executionId: string;
  readonly routeId: string;
  readonly ackId: string;
  readonly correlationId: string;
}

function verifiedDeliveries(records: readonly RuntimeHistoryRecord[]): readonly VerifiedDelivery[] {
  const accepted = new Map<string, AcceptedExecution>();
  const verificationStarted = new Set<string>();
  const acknowledgements = new Map<string, ReceivedAck>();

  for (const record of records) {
    if (record.source !== "SIMULATED_RUNTIME") continue;
    if (record.eventType === "execution.attempt_accepted" && record.payload.status === "DELIVERED") {
      const executionId = record.executionId ?? payloadId(record, "executionId");
      const routeId = payloadId(record, "routeId");
      if (executionId !== undefined && routeId !== undefined) {
        accepted.set(executionId, { routeId, correlationId: record.correlationId });
      }
    }
    if (record.eventType === "verification.started") {
      const executionId = record.executionId ?? payloadId(record, "executionId");
      if (executionId !== undefined) verificationStarted.add(executionId);
    }
    if (record.eventType === "verification.ack_received") {
      const ackId = payloadId(record, "ackId");
      const executionId = record.executionId ?? payloadId(record, "executionId");
      const routeId = payloadId(record, "routeId");
      if (ackId !== undefined && executionId !== undefined && routeId !== undefined) {
        acknowledgements.set(ackId, { executionId, routeId, correlationId: record.correlationId });
      }
    }
  }

  const deliveries: VerifiedDelivery[] = [];
  for (const record of records) {
    if (record.source !== "SIMULATED_RUNTIME" || record.eventType !== "mission.delivered") continue;
    const executionId = record.executionId ?? payloadId(record, "executionId");
    const routeId = payloadId(record, "routeId");
    const ackId = payloadId(record, "ackId");
    if (executionId === undefined || routeId === undefined || ackId === undefined) continue;
    const execution = accepted.get(executionId);
    const acknowledgement = acknowledgements.get(ackId);
    if (
      execution?.routeId === routeId &&
      execution.correlationId === record.correlationId &&
      verificationStarted.has(executionId) &&
      acknowledgement?.executionId === executionId &&
      acknowledgement.routeId === routeId &&
      acknowledgement.correlationId === record.correlationId
    ) {
      deliveries.push({ executionId, routeId, ackId, correlationId: record.correlationId });
    }
  }
  return deliveries;
}

export function projectMissionHistory(
  rawRecords: readonly RuntimeHistoryRecord[],
  missionId: string,
): MissionReadModel {
  const records = validatedRecords(rawRecords);
  if (records.length === 0) {
    throw new ControlPlaneFailure("UNKNOWN_MISSION", `unknown mission: ${missionId}`);
  }
  if (records.some((record) => record.missionId !== missionId)) {
    throw new ControlPlaneFailure("PROJECTION_FAILURE", "projection contains records for another mission");
  }

  const routes: string[] = [];
  const adaptations: string[] = [];
  const incidentTypes: string[] = [];
  const explanationIds: string[] = [];
  const recommendationTypes: string[] = [];
  let missionType: string | undefined;
  let currentExecutionId: string | undefined;
  let reviewStatus: string | undefined;
  let cancellationRequested = false;

  for (const record of records) {
    if (
      record.eventType === "control.mission_proposal_accepted" ||
      record.eventType === "control.mission_update_accepted"
    ) {
      missionType = payloadId(record, "missionType") ?? missionType;
    }
    if (record.eventType === "control.operator_review_requested") {
      reviewStatus = "PENDING_OPERATOR_REVIEW";
    }
    if (record.eventType === "control.operator_review_approved") reviewStatus = "APPROVED";
    if (record.eventType === "control.operator_review_rejected") reviewStatus = "REJECTED";
    if (record.eventType === "control.cancellation_requested") cancellationRequested = true;
    if (record.eventType === "route.updated") {
      const routeId = payloadId(record, "selectedRouteId");
      if (routeId !== undefined) routes.push(routeId);
    }
    if (record.eventType === "adaptation.decided") {
      const trigger = payloadId(record, "trigger");
      const action = payloadId(record, "action");
      if (trigger !== undefined && action !== undefined) adaptations.push(`${trigger}:${action}`);
    }
    if (record.eventType.startsWith("execution.")) {
      currentExecutionId = record.executionId ?? payloadId(record, "executionId") ?? currentExecutionId;
    }
    if (record.eventType === "incident.interpreted") {
      incidentTypes.push(...stringArray(record.payload.incidentTypes));
    }
    if (record.eventType === "explanation.generated") {
      const explanationId = payloadId(record, "explanationId");
      if (explanationId !== undefined) explanationIds.push(explanationId);
    }
    if (record.eventType === "recommendation.generated") {
      const recommendationType = payloadId(record, "recommendationType");
      if (recommendationType !== undefined) recommendationTypes.push(recommendationType);
    }
  }

  const deliveries = verifiedDeliveries(records);
  const deliveriesByCorrelation = new Map<string, Map<string, VerifiedDelivery>>();
  for (const delivery of deliveries) {
    const correlated = deliveriesByCorrelation.get(delivery.correlationId) ?? new Map<string, VerifiedDelivery>();
    correlated.set(`${delivery.executionId}:${delivery.routeId}:${delivery.ackId}`, delivery);
    deliveriesByCorrelation.set(delivery.correlationId, correlated);
  }
  if ([...deliveriesByCorrelation.values()].some((items) => items.size > 1)) {
    throw new ControlPlaneFailure("CONFLICTING_STATE", "one runtime run contains conflicting deliveries");
  }
  const completionRecords = records.filter(
    (record) =>
      record.source === "SIMULATED_RUNTIME" &&
      record.eventType === "runtime.completed" &&
      record.payload.reason === "VERIFIED_ACK",
  );
  const failedRecords = records.filter(
    (record) => record.source === "SIMULATED_RUNTIME" && record.eventType === "runtime.failed",
  );
  const completedCorrelations = new Set(completionRecords.map((record) => record.correlationId));
  const failedCorrelations = new Set(failedRecords.map((record) => record.correlationId));
  if ([...completedCorrelations].some((correlationId) => failedCorrelations.has(correlationId))) {
    throw new ControlPlaneFailure("CONFLICTING_STATE", "one runtime run contains conflicting terminal records");
  }
  for (const completion of completionRecords) {
    if ((deliveriesByCorrelation.get(completion.correlationId)?.size ?? 0) !== 1) {
      throw new ControlPlaneFailure("REPLAY_FAILURE", "completion has no unique matched ACK evidence chain");
    }
  }

  const terminalRecords = [...completionRecords, ...failedRecords].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const currentTerminal = terminalRecords.at(-1);
  const completed = currentTerminal?.eventType === "runtime.completed";
  const failed = currentTerminal?.eventType === "runtime.failed";
  const delivery = completed && currentTerminal !== undefined
    ? [...(deliveriesByCorrelation.get(currentTerminal.correlationId)?.values() ?? [])][0]
    : undefined;
  const terminalReason = completed
    ? "VERIFIED_ACK"
    : failed && currentTerminal !== undefined
      ? payloadId(currentTerminal, "reason")
      : undefined;
  const status = cancellationRequested
    ? "CANCELLATION_REQUESTED"
    : completed
      ? "COMPLETED"
      : failed
        ? "FAILED"
        : reviewStatus === "PENDING_OPERATOR_REVIEW"
          ? "PENDING_OPERATOR_REVIEW"
          : "ACTIVE";

  return missionReadModelSchema.parse({
    missionId,
    status,
    ...(missionType === undefined ? {} : { missionType }),
    ...(reviewStatus === undefined ? {} : { reviewStatus }),
    routeHistory: routes,
    adaptationHistory: adaptations,
    ...(currentExecutionId === undefined ? {} : { currentExecutionId }),
    incidentTypes: [...new Set(incidentTypes)],
    explanationIds,
    recommendationTypes,
    deliveryStatus: completed && delivery !== undefined ? "VERIFIED" : "NOT_VERIFIED",
    ...(completed && delivery !== undefined ? { verifiedAckId: delivery.ackId } : {}),
    ...(completed ? { terminalState: "COMPLETED" as const } : {}),
    ...(failed ? { terminalState: "FAILED" as const } : {}),
    ...(terminalReason === undefined ? {} : { terminalReason }),
    userAssertionProvenance: "USER_REPORTED",
    runtimeEvidenceProvenance: "SIMULATED",
    lastSequence: records.at(-1)?.sequence ?? 0,
  });
}

export function projectRuntimeHistory(rawRecords: readonly RuntimeHistoryRecord[]): RuntimeReadModel {
  const records = validatedRecords(rawRecords);
  const missionIds = [...new Set(records.map((record) => record.missionId))].sort();
  const missions = missionIds.map((missionId) =>
    projectMissionHistory(records.filter((record) => record.missionId === missionId), missionId),
  );
  return runtimeReadModelSchema.parse({
    mode: "SIMULATION",
    persistence: "AVAILABLE",
    missionCount: missions.length,
    activeMissionCount: missions.filter((mission) =>
      ["ACTIVE", "PENDING_OPERATOR_REVIEW", "CANCELLATION_REQUESTED"].includes(mission.status),
    ).length,
    lastSequence: records.at(-1)?.sequence ?? 0,
  });
}

export function publicHistory(records: readonly RuntimeHistoryRecord[]): readonly PublicHistoryRecord[] {
  return validatedRecords(records).map((record) =>
    publicHistoryRecordSchema.parse({
      eventId: record.eventId,
      missionId: record.missionId,
      ...(record.executionId === undefined ? {} : { executionId: record.executionId }),
      eventType: record.eventType,
      correlationId: record.correlationId,
      ...(record.causationId === undefined ? {} : { causationId: record.causationId }),
      sequence: record.sequence,
      timestamp: record.timestamp,
      source: record.source,
      provenance: record.provenance,
      summary: record.eventType,
    }),
  );
}
