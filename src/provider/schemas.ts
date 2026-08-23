import { z } from "zod";
import { domainIdSchema } from "../domain/ids.js";
import { transportCorrelationSchema } from "../integration/schemas.js";

export const providerOperationSchema = z.enum([
  "transport.send",
  "transport.callback",
]);

export const providerSendBodySchema = z
  .object({
    requestId: domainIdSchema,
    idempotencyKey: domainIdSchema,
    transportId: domainIdSchema,
    correlation: transportCorrelationSchema,
    payloadReference: domainIdSchema,
    payloadBytes: z.number().int().nonnegative().max(65_536),
    attemptNumber: z.number().int().positive(),
    policyGeneration: z.number().int().positive(),
  })
  .strict();

export const providerCallbackEventTypeSchema = z.enum([
  "DESTINATION_ACK",
  "DESTINATION_REJECTED",
  "PROVIDER_RECEIPT",
]);

export const providerCallbackBodySchema = z
  .object({
    callbackId: domainIdSchema,
    requestId: domainIdSchema,
    providerRequestId: domainIdSchema,
    transportId: domainIdSchema,
    correlation: transportCorrelationSchema,
    acknowledgementId: domainIdSchema.optional(),
    eventType: providerCallbackEventTypeSchema,
    evidenceGeneration: z.number().int().positive(),
    runtimeStateGeneration: z.number().int().positive(),
    observedAt: z.iso.datetime({ offset: true }),
    sourceNodeId: domainIdSchema,
  })
  .strict()
  .superRefine((callback, context) => {
    if (callback.eventType === "DESTINATION_ACK" && callback.acknowledgementId === undefined) {
      context.addIssue({ code: "custom", message: "destination acknowledgement identity required" });
    }
  });

export const providerEnvelopePayloadSchema = z
  .object({
    protocolVersion: z.literal("4E.1"),
    envelopeId: domainIdSchema,
    keyId: domainIdSchema,
    serviceIdentity: domainIdSchema,
    operation: providerOperationSchema,
    authorizationScope: providerOperationSchema,
    generation: z.number().int().positive(),
    body: z.union([providerSendBodySchema, providerCallbackBodySchema]),
  })
  .strict()
  .superRefine((envelope, context) => {
    if (envelope.operation !== envelope.authorizationScope) {
      context.addIssue({ code: "custom", message: "operation and scope must match" });
    }
    const send = providerSendBodySchema.safeParse(envelope.body).success;
    if ((envelope.operation === "transport.send") !== send) {
      context.addIssue({ code: "custom", message: "operation and body type must match" });
    }
  });

export const signedProviderEnvelopeSchema = providerEnvelopePayloadSchema
  .extend({
    algorithm: z.literal("Ed25519"),
    signature: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict();

export const providerResponseSchema = z
  .object({
    protocolVersion: z.literal("4E.1"),
    requestId: domainIdSchema,
    providerRequestId: domainIdSchema.optional(),
    outcome: z.enum(["ACCEPTED", "REJECTED", "TRANSIENT_FAILURE", "PERMANENT_FAILURE"]),
    code: z.enum([
      "PROVIDER_ACCEPTED",
      "PROVIDER_REJECTED",
      "PROVIDER_TRANSIENT_FAILURE",
      "PROVIDER_PERMANENT_FAILURE",
      "REQUEST_AUTHENTICATION_FAILED",
      "REQUEST_AUTHORIZATION_FAILED",
      "REQUEST_REPLAY_CONFLICT",
    ]),
  });

export const providerBoundaryFailureCodeSchema = z.enum([
  "PROVIDER_ENDPOINT_INVALID",
  "PROVIDER_DESTINATION_NOT_LOOPBACK",
  "PROVIDER_REDIRECT_REJECTED",
  "PROVIDER_REQUEST_TOO_LARGE",
  "PROVIDER_RESPONSE_TOO_LARGE",
  "PROVIDER_CALLBACK_TOO_LARGE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_NETWORK_FAILURE",
  "PROVIDER_RESPONSE_MALFORMED",
  "PROVIDER_REJECTED",
  "PROVIDER_TRANSIENT_FAILURE",
  "PROVIDER_PERMANENT_FAILURE",
  "REQUEST_AUTHENTICATION_FAILED",
  "REQUEST_AUTHORIZATION_FAILED",
  "CALLBACK_SCHEMA_INVALID",
  "CALLBACK_SIGNATURE_INVALID",
  "CALLBACK_SIGNER_UNKNOWN",
  "CALLBACK_SIGNER_REVOKED",
  "CALLBACK_KEY_NOT_ACTIVE",
  "CALLBACK_IDENTITY_MISMATCH",
  "CALLBACK_AUTHORIZATION_FAILED",
  "CALLBACK_REPLAYED",
  "CALLBACK_CONFLICTING",
  "PROVIDER_KILL_SWITCH_DISABLED",
]);

export type ProviderOperation = z.infer<typeof providerOperationSchema>;
export type ProviderSendBody = z.infer<typeof providerSendBodySchema>;
export type ProviderCallbackBody = z.infer<typeof providerCallbackBodySchema>;
export type ProviderEnvelopePayload = z.infer<typeof providerEnvelopePayloadSchema>;
export type SignedProviderEnvelope = z.infer<typeof signedProviderEnvelopeSchema>;
export type ProviderResponse = z.infer<typeof providerResponseSchema>;
export type ProviderBoundaryFailureCode = z.infer<typeof providerBoundaryFailureCodeSchema>;
