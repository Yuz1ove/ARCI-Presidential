import {
  runtimeTransportIngestionCandidateSchema,
  type RuntimeTransportIngestionCandidate,
} from "../runtime/transport-ingestion.js";
import {
  transportCorrelationSchema,
  transportEvidenceProjectionSchema,
  transportEvidenceSchema,
  type TransportEvidence,
  type TransportEvidenceProjection,
} from "./schemas.js";

export class IngestionCandidateError extends Error {
  public constructor(
    public readonly code: "CANDIDATE_NOT_CORRELATED" | "CANDIDATE_NOT_AUTHENTICATED" | "CANDIDATE_IDENTITY_INCOMPLETE",
  ) {
    super(code);
    this.name = "IngestionCandidateError";
  }
}

export function buildRuntimeIngestionCandidate(
  rawEvidence: TransportEvidence,
  rawProjection: TransportEvidenceProjection,
  input: {
    readonly candidateId: string;
    readonly evidenceGeneration: number;
    readonly runtimeStateGeneration: number;
    readonly sourceNodeId: string;
  },
): RuntimeTransportIngestionCandidate {
  const evidence = transportEvidenceSchema.parse(rawEvidence);
  const projection = transportEvidenceProjectionSchema.parse(rawProjection);
  if (
    projection.correlationDecision !== "CORRELATED_ACK" ||
    projection.deliveryEvidence !== "CORRELATED_DESTINATION_ACK" ||
    projection.authoritativeDelivery !== false ||
    projection.correlatedAcknowledgementId !== evidence.acknowledgementId
  ) {
    throw new IngestionCandidateError("CANDIDATE_NOT_CORRELATED");
  }
  if (evidence.authentication?.status !== "AUTHENTICATED") {
    throw new IngestionCandidateError("CANDIDATE_NOT_AUTHENTICATED");
  }
  const correlation = transportCorrelationSchema.safeParse(evidence.correlation);
  if (!correlation.success || evidence.acknowledgementId === undefined) {
    throw new IngestionCandidateError("CANDIDATE_IDENTITY_INCOMPLETE");
  }
  return runtimeTransportIngestionCandidateSchema.parse({
    candidateId: input.candidateId,
    evidenceId: evidence.evidenceId,
    ...correlation.data,
    acknowledgementId: evidence.acknowledgementId,
    envelopeId: evidence.authentication.envelopeId,
    evidenceGeneration: input.evidenceGeneration,
    runtimeStateGeneration: input.runtimeStateGeneration,
    receivedAt: evidence.observedAt,
    sourceNodeId: input.sourceNodeId,
    authenticated: true,
    deliveryEvidence: "CORRELATED_DESTINATION_ACK",
    classification: "CORRELATED",
    authority: "NON_AUTHORITATIVE",
  });
}
