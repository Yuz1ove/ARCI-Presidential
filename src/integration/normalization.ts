import { z } from "zod";
import type { NormalizationResult } from "./contracts.js";
import {
  transportEvidenceSchema,
  untrustedTransportSignalSchema,
  type TransportFailure,
} from "./schemas.js";

const malformed = (transportId?: string): TransportFailure => ({
  code: "MALFORMED_PROVIDER_RESPONSE",
  retryable: false,
  detailCode: "STRICT_NORMALIZATION_FAILED",
  ...(transportId === undefined ? {} : { transportId }),
});

/**
 * Converts a bounded, provider-mapped signal into evidence. Provider prose is
 * deliberately reduced to a boolean and can never become an instruction or fact.
 */
export function normalizeTransportSignal(input: unknown): NormalizationResult {
  const parsed = untrustedTransportSignalSchema.safeParse(input);
  if (!parsed.success) {
    const possibleTransportId =
      typeof input === "object" && input !== null && "transportId" in input &&
      typeof input.transportId === "string"
        ? input.transportId
        : undefined;
    return { ok: false, failure: malformed(possibleTransportId) };
  }

  const signal = parsed.data;
  const correlationEntries = {
    ...(signal.missionId === undefined ? {} : { missionId: signal.missionId }),
    ...(signal.executionId === undefined ? {} : { executionId: signal.executionId }),
    ...(signal.routeId === undefined ? {} : { routeId: signal.routeId }),
    ...(signal.attemptId === undefined ? {} : { attemptId: signal.attemptId }),
    ...(signal.correlationId === undefined ? {} : { correlationId: signal.correlationId }),
    ...(signal.messageIdentity === undefined ? {} : { messageIdentity: signal.messageIdentity }),
  };

  try {
    return {
      ok: true,
      evidence: transportEvidenceSchema.parse({
        evidenceId: signal.observationId,
        observationId: signal.observationId,
        transportId: signal.transportId,
        kind: signal.kind,
        observedAt: signal.observedAt,
        sequence: signal.sequence,
        ...(Object.keys(correlationEntries).length === 0 ? {} : { correlation: correlationEntries }),
        ...(signal.acknowledgementId === undefined
          ? {}
          : { acknowledgementId: signal.acknowledgementId }),
        ...(signal.providerAssignedId === undefined
          ? {}
          : { providerAssignedId: signal.providerAssignedId }),
        containedExternalText: signal.externalText !== undefined,
        classification: "OBSERVED",
        trust: "UNTRUSTED_EXTERNAL",
        authority: "EVIDENCE_ONLY",
      }),
    };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, failure: malformed(signal.transportId) };
    throw error;
  }
}
