import { z } from "zod";
import { domainIdSchema } from "../domain/ids.js";
import { missionTypeSchema } from "../domain/mission/model.js";
import { runtimeLifecycleSchema, terminalReasonSchema } from "../runtime/model.js";
import { runtimeScenarioNameSchema } from "../simulation/runtime/schema.js";
import {
  intelligenceSourceSchema,
  missionAmbiguitySchema,
  recommendationTypeSchema,
  incidentSignalTypeSchema,
} from "../intelligence/schemas.js";

const commandEnvelope = {
  commandId: domainIdSchema,
  missionId: domainIdSchema,
  correlationId: domainIdSchema,
  receivedAt: z.iso.datetime({ offset: true }),
};

export const proposeMissionCommandSchema = z
  .object({
    ...commandEnvelope,
    type: z.literal("PROPOSE_MISSION"),
    text: z.string().trim().min(1).max(4_000),
    simulationScenario: runtimeScenarioNameSchema,
  })
  .strict();

export const requestMissionUpdateCommandSchema = z
  .object({
    ...commandEnvelope,
    type: z.literal("REQUEST_MISSION_UPDATE"),
    text: z.string().trim().min(1).max(4_000),
    simulationScenario: runtimeScenarioNameSchema,
  })
  .strict();

export const requestCancellationCommandSchema = z
  .object({
    ...commandEnvelope,
    type: z.literal("REQUEST_CANCELLATION"),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const operatorReviewDecisionSchema = z.enum(["APPROVED", "REJECTED"]);
export const operatorReviewStatusSchema = z.enum([
  "PENDING_OPERATOR_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
]);

export const acknowledgeOperatorReviewCommandSchema = z
  .object({
    ...commandEnvelope,
    type: z.literal("ACKNOWLEDGE_OPERATOR_REVIEW"),
    reviewId: domainIdSchema,
    decision: operatorReviewDecisionSchema,
  })
  .strict();

export const requestFreshObservationCommandSchema = z
  .object({
    ...commandEnvelope,
    type: z.literal("REQUEST_FRESH_OBSERVATION"),
  })
  .strict();

export const operatorCommandSchema = z.discriminatedUnion("type", [
  proposeMissionCommandSchema,
  requestMissionUpdateCommandSchema,
  requestCancellationCommandSchema,
  acknowledgeOperatorReviewCommandSchema,
  requestFreshObservationCommandSchema,
]);

export const missionStatusQuerySchema = z
  .object({ type: z.literal("GET_MISSION_STATUS"), missionId: domainIdSchema })
  .strict();
export const missionEventsQuerySchema = z
  .object({ type: z.literal("GET_MISSION_EVENTS"), missionId: domainIdSchema })
  .strict();
export const missionIncidentsQuerySchema = z
  .object({ type: z.literal("GET_MISSION_INCIDENTS"), missionId: domainIdSchema })
  .strict();
export const missionExplanationsQuerySchema = z
  .object({ type: z.literal("GET_MISSION_EXPLANATIONS"), missionId: domainIdSchema })
  .strict();
export const missionRecommendationsQuerySchema = z
  .object({ type: z.literal("GET_MISSION_RECOMMENDATIONS"), missionId: domainIdSchema })
  .strict();
export const runtimeStatusQuerySchema = z.object({ type: z.literal("GET_RUNTIME_STATUS") }).strict();

export const controlPlaneQuerySchema = z.discriminatedUnion("type", [
  missionStatusQuerySchema,
  missionEventsQuerySchema,
  missionIncidentsQuerySchema,
  missionExplanationsQuerySchema,
  missionRecommendationsQuerySchema,
  runtimeStatusQuerySchema,
]);

export const historySourceSchema = z.enum([
  "CONTROL_PLANE",
  "OPERATOR",
  "INTELLIGENCE",
  "SIMULATED_RUNTIME",
]);

export const historyProvenanceSchema = intelligenceSourceSchema;

export const runtimeHistoryRecordSchema = z
  .object({
    eventId: domainIdSchema,
    missionId: domainIdSchema,
    executionId: domainIdSchema.optional(),
    eventType: z.string().min(1).max(128).regex(/^[a-z][a-z0-9._-]*$/u),
    correlationId: domainIdSchema,
    causationId: domainIdSchema.optional(),
    sequence: z.number().int().positive(),
    timestamp: z.iso.datetime({ offset: true }),
    source: historySourceSchema,
    provenance: historyProvenanceSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const runtimeHistoryAppendInputSchema = runtimeHistoryRecordSchema.omit({ sequence: true });

export const missionControlStatusSchema = z.enum([
  "PENDING_OPERATOR_REVIEW",
  "ACTIVE",
  "COMPLETED",
  "FAILED",
  "CANCELLATION_REQUESTED",
]);

export const deliveryReadStatusSchema = z.enum(["NOT_VERIFIED", "VERIFIED"]);

export const missionReadModelSchema = z
  .object({
    missionId: domainIdSchema,
    status: missionControlStatusSchema,
    missionType: missionTypeSchema.optional(),
    reviewStatus: operatorReviewStatusSchema.optional(),
    routeHistory: z.array(domainIdSchema),
    adaptationHistory: z.array(z.string()),
    currentExecutionId: domainIdSchema.optional(),
    incidentTypes: z.array(incidentSignalTypeSchema),
    explanationIds: z.array(domainIdSchema),
    recommendationTypes: z.array(recommendationTypeSchema),
    deliveryStatus: deliveryReadStatusSchema,
    verifiedAckId: domainIdSchema.optional(),
    terminalState: runtimeLifecycleSchema.optional(),
    terminalReason: terminalReasonSchema.optional(),
    userAssertionProvenance: z.literal("USER_REPORTED"),
    runtimeEvidenceProvenance: z.literal("SIMULATED"),
    lastSequence: z.number().int().nonnegative(),
  })
  .strict();

export const runtimeReadModelSchema = z
  .object({
    mode: z.literal("SIMULATION"),
    persistence: z.enum(["AVAILABLE", "FAILED"]),
    missionCount: z.number().int().nonnegative(),
    activeMissionCount: z.number().int().nonnegative(),
    lastSequence: z.number().int().nonnegative(),
  })
  .strict();

export const operatorReviewSchema = z
  .object({
    reviewId: domainIdSchema,
    missionId: domainIdSchema,
    commandId: domainIdSchema,
    requestedAt: z.iso.datetime({ offset: true }),
    status: operatorReviewStatusSchema,
    reason: z.string().min(1),
    proposedMissionType: missionTypeSchema.optional(),
    ambiguities: z.array(missionAmbiguitySchema),
  })
  .strict();

export const publicHistoryRecordSchema = runtimeHistoryRecordSchema.omit({ payload: true }).extend({
  summary: z.string().min(1),
});

export const CONTROL_PLANE_API_ROUTES = [
  { method: "POST", path: "/missions", command: "PROPOSE_MISSION" },
  { method: "GET", path: "/missions/:id", query: "GET_MISSION_STATUS" },
  { method: "POST", path: "/missions/:id/updates", command: "REQUEST_MISSION_UPDATE" },
  { method: "POST", path: "/missions/:id/cancel", command: "REQUEST_CANCELLATION" },
  { method: "GET", path: "/missions/:id/events", query: "GET_MISSION_EVENTS" },
  { method: "GET", path: "/missions/:id/incidents", query: "GET_MISSION_INCIDENTS" },
  { method: "GET", path: "/missions/:id/explanations", query: "GET_MISSION_EXPLANATIONS" },
  { method: "GET", path: "/missions/:id/recommendations", query: "GET_MISSION_RECOMMENDATIONS" },
  { method: "POST", path: "/operator-reviews/:id", command: "ACKNOWLEDGE_OPERATOR_REVIEW" },
  { method: "GET", path: "/runtime/status", query: "GET_RUNTIME_STATUS" },
] as const;
