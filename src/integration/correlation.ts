import { z } from "zod";
import { domainIdSchema } from "../domain/ids.js";
import {
  transportCorrelationSchema,
  transportEvidenceProjectionSchema,
  transportEvidenceSchema,
  type CorrelationDecision,
  type TransportCorrelation,
  type TransportEvidence,
  type TransportEvidenceProjection,
  type TransportFailure,
} from "./schemas.js";

export interface CorrelationPolicy {
  readonly transportId: string;
  readonly expected: TransportCorrelation;
  readonly minimumObservationSequence: number;
  readonly retiredExecutionIds: readonly string[];
  readonly previouslyAcceptedAcknowledgementIds: readonly string[];
}

export class TransportCorrelationError extends Error {
  public constructor(public readonly failure: TransportFailure) {
    super(failure.code);
    this.name = "TransportCorrelationError";
  }
}

const correlationKeys = [
  "missionId",
  "executionId",
  "routeId",
  "attemptId",
  "correlationId",
  "messageIdentity",
] as const;

function mismatchDecision(
  evidence: TransportEvidence,
  policy: CorrelationPolicy,
): CorrelationDecision | undefined {
  const correlation = evidence.correlation;
  if (correlation === undefined || correlationKeys.some((key) => correlation[key] === undefined)) {
    return "INCOMPLETE_CORRELATION";
  }
  const complete = transportCorrelationSchema.safeParse(correlation);
  if (!complete.success || evidence.acknowledgementId === undefined) {
    return "INCOMPLETE_CORRELATION";
  }
  if (complete.data.missionId !== policy.expected.missionId) return "WRONG_MISSION";
  if (policy.retiredExecutionIds.includes(complete.data.executionId)) return "STALE_ACK";
  if (complete.data.executionId !== policy.expected.executionId) return "WRONG_EXECUTION";
  if (complete.data.routeId !== policy.expected.routeId) return "WRONG_ROUTE";
  if (complete.data.attemptId !== policy.expected.attemptId) return "WRONG_ATTEMPT";
  if (complete.data.correlationId !== policy.expected.correlationId) return "WRONG_CORRELATION";
  if (complete.data.messageIdentity !== policy.expected.messageIdentity) return "WRONG_MESSAGE";
  if (evidence.sequence < policy.minimumObservationSequence) return "STALE_ACK";
  if (policy.previouslyAcceptedAcknowledgementIds.includes(evidence.acknowledgementId)) {
    return "REPLAYED_ACK";
  }
  return undefined;
}

/**
 * Produces an evidence-only projection. Even a fully correlated destination ACK
 * remains a candidate for the sealed runtime verifier, never mission authority.
 */
export function projectTransportEvidence(
  rawEvidence: readonly TransportEvidence[],
  rawPolicy: CorrelationPolicy,
): TransportEvidenceProjection {
  const expected = transportCorrelationSchema.parse(rawPolicy.expected);
  const policy: CorrelationPolicy = {
    transportId: domainIdSchema.parse(rawPolicy.transportId),
    expected,
    minimumObservationSequence: z.number().int().positive().parse(
      rawPolicy.minimumObservationSequence,
    ),
    retiredExecutionIds: [...rawPolicy.retiredExecutionIds].sort(),
    previouslyAcceptedAcknowledgementIds: [
      ...rawPolicy.previouslyAcceptedAcknowledgementIds,
    ].sort(),
  };
  const evidenceIds = new Set<string>();
  const evidence = rawEvidence
    .map((record) => {
      const parsed = transportEvidenceSchema.safeParse(record);
      if (!parsed.success) {
        throw new TransportCorrelationError({
          code: "MALFORMED_PROVIDER_RESPONSE",
          retryable: false,
          detailCode: "PERSISTED_EVIDENCE_SCHEMA_INVALID",
          transportId: policy.transportId,
        });
      }
      if (evidenceIds.has(parsed.data.evidenceId)) {
        throw new TransportCorrelationError({
          code: "DUPLICATE_EVIDENCE",
          retryable: false,
          detailCode: "DUPLICATE_REPLAY_EVIDENCE_ID",
          transportId: policy.transportId,
        });
      }
      evidenceIds.add(parsed.data.evidenceId);
      return parsed.data;
    })
    .sort((left, right) => left.sequence - right.sequence || left.evidenceId.localeCompare(right.evidenceId));
  const relevant = evidence.filter(({ transportId }) => transportId === policy.transportId);
  const providerReceiptObserved = relevant.some(({ kind }) =>
    ["PACKET_ACCEPTED", "PACKET_TRANSMITTED", "PROVIDER_QUEUED", "PROVIDER_RECEIPT"].includes(kind),
  );
  const ackEvidence = relevant.filter(({ kind }) =>
    kind === "DESTINATION_ACK" || kind === "DESTINATION_REJECTED",
  );

  let correlationDecision: CorrelationDecision = providerReceiptObserved
    ? "PROVIDER_RECEIPT_ONLY"
    : "NOT_APPLICABLE";
  let correlatedAcknowledgementId: string | undefined;

  if (ackEvidence.length > 0) {
    const classified = ackEvidence.map((record) => ({
      record,
      mismatch: mismatchDecision(record, policy),
    }));
    const matching = classified.filter(({ mismatch }) => mismatch === undefined);
    const rejected = matching.filter(({ record }) => record.kind === "DESTINATION_REJECTED");
    const acknowledged = matching.filter(({ record }) => record.kind === "DESTINATION_ACK");

    if (rejected.length > 0 && acknowledged.length > 0) {
      correlationDecision = "CONFLICTING_ACK";
    } else if (rejected.length > 0) {
      correlationDecision = "CONFLICTING_ACK";
    } else if (acknowledged.length > 1) {
      const ids = new Set(acknowledged.map(({ record }) => record.acknowledgementId));
      correlationDecision = ids.size === 1 ? "DUPLICATE_ACK" : "CONFLICTING_ACK";
    } else if (acknowledged.length === 1) {
      correlationDecision = "CORRELATED_ACK";
      correlatedAcknowledgementId = acknowledged[0]?.record.acknowledgementId;
    } else {
      correlationDecision = classified[0]?.mismatch ?? "UNKNOWN_ACK";
    }
  }

  return transportEvidenceProjectionSchema.parse({
    transportId: policy.transportId,
    evidenceCount: relevant.length,
    providerReceiptObserved,
    correlationDecision,
    ...(correlatedAcknowledgementId === undefined ? {} : { correlatedAcknowledgementId }),
    deliveryEvidence:
      correlationDecision === "CORRELATED_ACK"
        ? "CORRELATED_DESTINATION_ACK"
        : providerReceiptObserved
          ? "PROVIDER_RECEIPT_ONLY"
          : "NONE",
    authoritativeDelivery: false,
    classification: "DERIVED",
    lastSequence: relevant.reduce((maximum, record) => Math.max(maximum, record.sequence), 0),
  });
}
