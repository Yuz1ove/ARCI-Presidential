import { z } from "zod";
import { domainIdSchema } from "../domain/ids.js";

const reported = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("status", [
    z.object({ status: z.literal("UNKNOWN") }).strict(),
    z.object({ status: z.literal("REPORTED"), value }).strict(),
  ]);

export const transportFamilySchema = z.enum([
  "CELLULAR",
  "WIFI",
  "WIFI_DIRECT",
  "BLUETOOTH",
  "LORA",
  "SATELLITE",
  "SMS_GATEWAY",
  "CARRIER_API",
  "SDR",
  "RELAY",
  "OTHER",
]);

export const evidenceClassificationSchema = z.enum([
  "OBSERVED",
  "DERIVED",
  "RECOMMENDED",
  "AUTHORITATIVE",
]);

export const transportFailureCodeSchema = z.enum([
  "TRANSPORT_UNAVAILABLE",
  "DEVICE_UNAVAILABLE",
  "ADAPTER_FAILURE",
  "PROVIDER_FAILURE",
  "AUTHENTICATION_FAILURE",
  "RATE_LIMITED",
  "REQUEST_REJECTED",
  "TRANSMISSION_TIMEOUT",
  "RECEIPT_TIMEOUT",
  "MALFORMED_PROVIDER_RESPONSE",
  "CORRELATION_FAILURE",
  "DUPLICATE_EVIDENCE",
  "UNSUPPORTED_TRANSPORT_OPERATION",
  "SIGNATURE_INVALID",
  "SIGNER_UNKNOWN",
  "EVIDENCE_REPLAYED",
]);

export const transportFailureSchema = z
  .object({
    code: transportFailureCodeSchema,
    retryable: z.boolean(),
    detailCode: z.string().min(1).max(80).regex(/^[A-Z][A-Z0-9_]*$/u).optional(),
    transportId: domainIdSchema.optional(),
    attemptId: domainIdSchema.optional(),
    correlationId: domainIdSchema.optional(),
  })
  .strict();

export const transportCapabilitiesSchema = z
  .object({
    directionality: reported(z.enum(["OUTBOUND_ONLY", "INBOUND_ONLY", "BIDIRECTIONAL"])),
    supportsBroadcast: reported(z.boolean()),
    supportsUnicast: reported(z.boolean()),
    latencyClass: reported(z.enum(["REAL_TIME", "INTERACTIVE", "DELAY_TOLERANT"])),
    bandwidthClass: reported(z.enum(["TINY", "LOW", "MEDIUM", "HIGH"])),
    maximumPayloadBytes: reported(z.number().int().positive()),
    costClass: reported(z.enum(["NO_INCREMENTAL_COST", "LOW", "MEDIUM", "HIGH"])),
    energyClass: reported(z.enum(["LOW", "MEDIUM", "HIGH"])),
    geographicScope: reported(z.enum(["LOCAL", "REGIONAL", "GLOBAL", "CONSTRAINED"])),
    acknowledgmentSupport: reported(z.enum(["NONE", "PROVIDER_RECEIPT", "DESTINATION_ACK"])),
    authenticationSupport: reported(z.enum(["NONE", "PROVIDER", "PEER", "BOTH"])),
    encryption: reported(z.enum(["NONE_REPORTED", "IN_TRANSIT", "END_TO_END"])),
    storeAndForward: reported(z.boolean()),
    relay: reported(z.boolean()),
    providerDependency: reported(z.boolean()),
    deviceDependency: reported(z.boolean()),
  })
  .strict();

export const transportDescriptorSchema = z
  .object({
    adapterId: domainIdSchema,
    transportId: domainIdSchema,
    family: transportFamilySchema,
    displayName: z.string().trim().min(1).max(100),
    contractVersion: z.literal("4C.1"),
    capabilities: transportCapabilitiesSchema,
  })
  .strict();

export const transportAvailabilitySchema = z
  .object({
    transportId: domainIdSchema,
    status: z.enum(["AVAILABLE", "UNAVAILABLE", "DEGRADED", "UNKNOWN"]),
    observedAt: z.iso.datetime({ offset: true }),
    observationId: domainIdSchema,
    classification: z.literal("OBSERVED"),
    authority: z.literal("EVIDENCE_ONLY"),
  })
  .strict();

export const transportHealthSchema = z
  .object({
    transportId: domainIdSchema,
    status: z.enum(["HEALTHY", "DEGRADED", "FAILED", "UNKNOWN"]),
    observedAt: z.iso.datetime({ offset: true }),
    observationId: domainIdSchema,
    classification: z.literal("OBSERVED"),
    authority: z.literal("EVIDENCE_ONLY"),
    failure: transportFailureSchema.optional(),
  })
  .strict();

export const transportSecurityContextSchema = z
  .object({
    credentialReference: domainIdSchema.optional(),
    expectedTransportIdentity: domainIdSchema.optional(),
    authentication: z.enum(["NONE", "PROVIDER", "PEER", "BOTH"]),
    encryption: z.enum(["NONE", "IN_TRANSIT", "END_TO_END"]),
  })
  .strict();

export const transportCorrelationSchema = z
  .object({
    missionId: domainIdSchema,
    executionId: domainIdSchema,
    routeId: domainIdSchema,
    attemptId: domainIdSchema,
    correlationId: domainIdSchema,
    messageIdentity: domainIdSchema,
  })
  .strict();

export const outboundTransmissionRequestSchema = z
  .object({
    requestId: domainIdSchema,
    idempotencyKey: domainIdSchema,
    transportId: domainIdSchema,
    correlation: transportCorrelationSchema,
    payload: z
      .object({
        payloadReference: domainIdSchema,
        messageIdentity: domainIdSchema,
        mediaType: z.string().trim().min(1).max(100),
        byteLength: z.number().int().nonnegative(),
      })
      .strict(),
    security: transportSecurityContextSchema,
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.payload.messageIdentity !== request.correlation.messageIdentity) {
      context.addIssue({
        code: "custom",
        path: ["payload", "messageIdentity"],
        message: "payload and correlation message identities must match",
      });
    }
  });

export const transmissionAttemptSchema = z
  .object({
    requestId: domainIdSchema,
    idempotencyKey: domainIdSchema,
    transportId: domainIdSchema,
    correlation: transportCorrelationSchema,
    status: z.enum(["ACCEPTED", "REJECTED", "FAILED", "TIMED_OUT", "UNKNOWN_AFTER_TIMEOUT"]),
    attemptedAt: z.iso.datetime({ offset: true }),
    providerAssignedId: domainIdSchema.optional(),
    failure: transportFailureSchema.optional(),
  })
  .strict();

export const transmissionReceiptSchema = z
  .object({
    receiptId: domainIdSchema,
    providerAssignedId: domainIdSchema.optional(),
    transportId: domainIdSchema,
    correlation: transportCorrelationSchema,
    kind: z.enum(["PROVIDER_ACCEPTED", "PROVIDER_QUEUED", "PROVIDER_TRANSMITTED"]),
    observedAt: z.iso.datetime({ offset: true }),
    classification: z.literal("OBSERVED"),
    authority: z.literal("EVIDENCE_ONLY"),
  })
  .strict();

export const externalSignalKindSchema = z.enum([
  "SIGNAL_UNAVAILABLE",
  "TRANSPORT_AVAILABLE",
  "DEVICE_DISCONNECTED",
  "PACKET_ACCEPTED",
  "PACKET_TRANSMITTED",
  "PROVIDER_QUEUED",
  "PROVIDER_RECEIPT",
  "DESTINATION_ACK",
  "DESTINATION_REJECTED",
  "TIMEOUT",
  "TRANSPORT_DEGRADED",
  "RELAY_DISCOVERED",
  "ADAPTER_HEALTH",
]);

export const untrustedTransportSignalSchema = z
  .object({
    observationId: domainIdSchema,
    transportId: domainIdSchema,
    kind: externalSignalKindSchema,
    observedAt: z.iso.datetime({ offset: true }),
    sequence: z.number().int().positive(),
    missionId: domainIdSchema.optional(),
    executionId: domainIdSchema.optional(),
    routeId: domainIdSchema.optional(),
    attemptId: domainIdSchema.optional(),
    correlationId: domainIdSchema.optional(),
    messageIdentity: domainIdSchema.optional(),
    acknowledgementId: domainIdSchema.optional(),
    providerAssignedId: domainIdSchema.optional(),
    externalText: z.string().max(500).optional(),
  })
  .strict();

export const inboundTransportObservationSchema = z
  .object({
    observationId: domainIdSchema,
    transportId: domainIdSchema,
    kind: externalSignalKindSchema,
    observedAt: z.iso.datetime({ offset: true }),
    sequence: z.number().int().positive(),
    correlation: transportCorrelationSchema.partial().optional(),
    acknowledgementId: domainIdSchema.optional(),
    providerAssignedId: domainIdSchema.optional(),
    containedExternalText: z.boolean(),
    classification: z.literal("OBSERVED"),
    trust: z.literal("UNTRUSTED_EXTERNAL"),
    authority: z.literal("EVIDENCE_ONLY"),
  })
  .strict();

export const transportEvidenceSchema = inboundTransportObservationSchema.extend({
  evidenceId: domainIdSchema,
  authentication: z
    .discriminatedUnion("status", [
      z.object({ status: z.literal("NOT_CHECKED") }).strict(),
      z
        .object({
          status: z.literal("AUTHENTICATED"),
          keyId: domainIdSchema,
          envelopeId: domainIdSchema,
          algorithm: z.literal("Ed25519"),
        })
        .strict(),
    ])
    .optional(),
}).strict();

export const correlationDecisionSchema = z.enum([
  "NOT_APPLICABLE",
  "PROVIDER_RECEIPT_ONLY",
  "CORRELATED_ACK",
  "STALE_ACK",
  "DUPLICATE_ACK",
  "REPLAYED_ACK",
  "UNKNOWN_ACK",
  "WRONG_MISSION",
  "WRONG_EXECUTION",
  "WRONG_ROUTE",
  "WRONG_ATTEMPT",
  "WRONG_CORRELATION",
  "WRONG_MESSAGE",
  "INCOMPLETE_CORRELATION",
  "CONFLICTING_ACK",
]);

export const transportEvidenceProjectionSchema = z
  .object({
    transportId: domainIdSchema,
    evidenceCount: z.number().int().nonnegative(),
    providerReceiptObserved: z.boolean(),
    correlationDecision: correlationDecisionSchema,
    correlatedAcknowledgementId: domainIdSchema.optional(),
    deliveryEvidence: z.enum(["NONE", "PROVIDER_RECEIPT_ONLY", "CORRELATED_DESTINATION_ACK"]),
    authoritativeDelivery: z.literal(false),
    classification: z.literal("DERIVED"),
    lastSequence: z.number().int().nonnegative(),
  })
  .strict();

export type TransportFamily = z.infer<typeof transportFamilySchema>;
export type EvidenceClassification = z.infer<typeof evidenceClassificationSchema>;
export type TransportFailureCode = z.infer<typeof transportFailureCodeSchema>;
export type TransportFailure = z.infer<typeof transportFailureSchema>;
export type TransportCapabilities = z.infer<typeof transportCapabilitiesSchema>;
export type TransportDescriptor = z.infer<typeof transportDescriptorSchema>;
export type TransportAvailability = z.infer<typeof transportAvailabilitySchema>;
export type TransportHealth = z.infer<typeof transportHealthSchema>;
export type TransportSecurityContext = z.infer<typeof transportSecurityContextSchema>;
export type TransportCorrelation = z.infer<typeof transportCorrelationSchema>;
export type OutboundTransmissionRequest = z.infer<typeof outboundTransmissionRequestSchema>;
export type TransmissionAttempt = z.infer<typeof transmissionAttemptSchema>;
export type TransmissionReceipt = z.infer<typeof transmissionReceiptSchema>;
export type UntrustedTransportSignal = z.infer<typeof untrustedTransportSignalSchema>;
export type InboundTransportObservation = z.infer<typeof inboundTransportObservationSchema>;
export type TransportEvidence = z.infer<typeof transportEvidenceSchema>;
export type CorrelationDecision = z.infer<typeof correlationDecisionSchema>;
export type TransportEvidenceProjection = z.infer<typeof transportEvidenceProjectionSchema>;
