import type { TransportEvidenceRepository } from "./contracts.js";
import {
  transportEvidenceSchema,
  type TransportEvidence,
  type TransportFailure,
} from "./schemas.js";

export class TransportEvidenceRepositoryError extends Error {
  public constructor(public readonly failure: TransportFailure) {
    super(failure.code);
    this.name = "TransportEvidenceRepositoryError";
  }
}

function cloneEvidence(evidence: TransportEvidence): TransportEvidence {
  return transportEvidenceSchema.parse(evidence);
}

export class InMemoryTransportEvidenceRepository implements TransportEvidenceRepository {
  private readonly records: TransportEvidence[] = [];

  public append(inputs: readonly TransportEvidence[]): readonly TransportEvidence[] {
    const parsed = inputs.map(cloneEvidence);
    const existing = new Set(this.records.map(({ evidenceId }) => evidenceId));
    const batch = new Set<string>();
    for (const evidence of parsed) {
      if (existing.has(evidence.evidenceId) || batch.has(evidence.evidenceId)) {
        throw new TransportEvidenceRepositoryError({
          code: "DUPLICATE_EVIDENCE",
          retryable: false,
          detailCode: "DUPLICATE_EVIDENCE_ID",
          transportId: evidence.transportId,
          ...(evidence.correlation?.attemptId === undefined
            ? {}
            : { attemptId: evidence.correlation.attemptId }),
          ...(evidence.correlation?.correlationId === undefined
            ? {}
            : { correlationId: evidence.correlation.correlationId }),
        });
      }
      batch.add(evidence.evidenceId);
    }
    this.records.push(...parsed);
    return parsed.map(cloneEvidence);
  }

  public readAll(): readonly TransportEvidence[] {
    return this.records.map(cloneEvidence);
  }

  public readTransport(transportId: string): readonly TransportEvidence[] {
    return this.records
      .filter((record) => record.transportId === transportId)
      .map(cloneEvidence);
  }
}
