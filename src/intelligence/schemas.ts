import { z } from "zod";
import { missionTypeSchema } from "../domain/mission/model.js";
import { domainIdSchema } from "../domain/ids.js";
import { runtimeLifecycleSchema, terminalReasonSchema } from "../runtime/model.js";

export const intelligenceSourceSchema = z.enum([
  "USER_REPORTED",
  "OBSERVED",
  "DERIVED",
  "SIMULATED",
  "MODEL_GENERATED",
  "DETERMINISTIC_RULE",
]);

export const intelligenceConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const explanationEvidenceSchema = z
  .object({
    evidenceId: domainIdSchema,
    sourceType: intelligenceSourceSchema,
    timestamp: z.iso.datetime({ offset: true }),
    claim: z.string().min(1),
    eventId: domainIdSchema.optional(),
    observationId: domainIdSchema.optional(),
    decisionId: domainIdSchema.optional(),
    routeId: domainIdSchema.optional(),
    executionId: domainIdSchema.optional(),
  })
  .strict();
export const missionInputSchema = z
  .object({
    inputId: domainIdSchema,
    receivedAt: z.iso.datetime({ offset: true }),
    text: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const missionIntentSchema = z.enum([
  "REQUEST_ASSISTANCE",
  "COMMUNICATE_STATUS",
  "COORDINATE_RESPONSE",
  "UNKNOWN",
]);

export const missionUrgencySchema = z.enum(["GENERAL", "ELEVATED", "DISTRESS", "MEDICAL", "UNKNOWN"]);

export const missionConstraintKindSchema = z.enum([
  "DELIVERY_REQUIRED",
  "HIGH_RELIABILITY",
  "CELLULAR_UNAVAILABLE",
  "BATTERY_LOW",
]);

export const missionConstraintSchema = z
  .object({
    kind: missionConstraintKindSchema,
    asserted: z.boolean(),
    provenance: intelligenceSourceSchema,
    evidenceId: domainIdSchema,
  })
  .strict();

export const missionAmbiguitySchema = z.enum([
  "UNKNOWN",
  "UNCERTAIN",
  "MULTIPLE_POSSIBLE_INTENTS",
  "INSUFFICIENT_INFORMATION",
  "UNTRUSTED_AUTHORITY_DIRECTIVE",
]);

export const missionProposalSchema = z
  .object({
    proposalId: domainIdSchema,
    intent: missionIntentSchema,
    urgency: missionUrgencySchema,
    proposedMissionType: missionTypeSchema.optional(),
    constraints: z.array(missionConstraintSchema),
    requiresClarification: z.boolean(),
    ambiguities: z.array(missionAmbiguitySchema),
  })
  .strict();

export const missionInterpretationSchema = z
  .object({
    interpretationId: domainIdSchema,
    inputId: domainIdSchema,
    summary: z.string().min(1),
    confidence: intelligenceConfidenceSchema,
    source: intelligenceSourceSchema,
    proposal: missionProposalSchema,
    evidence: z.array(explanationEvidenceSchema).min(1),
  })
  .strict();

export const incidentSignalTypeSchema = z.enum([
  "CELLULAR_PATH_FAILURE",
  "ROUTE_FAILURE",
  "BATTERY_DEGRADATION",
  "TOPOLOGY_CHANGE",
  "ACK_TIMEOUT",
  "LATE_ACK",
  "NO_VALID_ROUTE",
  "POLICY_REJECTION",
  "DELIVERY_VERIFIED",
]);

export const incidentSeveritySchema = z.enum(["INFO", "WARNING", "CRITICAL"]);

export const incidentSignalSchema = z
  .object({
    type: incidentSignalTypeSchema,
    severity: incidentSeveritySchema,
    summary: z.string().min(1),
    evidenceIds: z.array(domainIdSchema).min(1),
  })
  .strict();

export const incidentAssessmentSchema = z
  .object({
    assessmentId: domainIdSchema,
    primaryIncident: incidentSignalTypeSchema.optional(),
    secondaryConditions: z.array(incidentSignalTypeSchema),
    severity: incidentSeveritySchema,
    currentStatus: runtimeLifecycleSchema,
    terminalReason: terminalReasonSchema.optional(),
    summary: z.string().min(1),
    signals: z.array(incidentSignalSchema),
    evidence: z.array(explanationEvidenceSchema),
  })
  .strict();

export const recommendationTypeSchema = z.enum([
  "CONTINUE_CURRENT_ROUTE",
  "REQUEST_FRESH_OBSERVATION",
  "REDUCE_NON_ESSENTIAL_TRAFFIC",
  "PRESERVE_BATTERY",
  "ESCALATE_PRIORITY_FOR_REVIEW",
  "INVESTIGATE_UNAVAILABLE_RELAY",
  "WAIT_FOR_TOPOLOGY_RECOVERY",
  "REVIEW_TERMINAL_FAILURE",
]);

export const recommendationPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const decisionRecommendationSchema = z
  .object({
    recommendationId: domainIdSchema,
    type: recommendationTypeSchema,
    priority: recommendationPrioritySchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    rationale: z.string().min(1),
    evidenceIds: z.array(domainIdSchema).min(1),
    confidence: intelligenceConfidenceSchema,
    operatorActionRequired: z.boolean(),
  })
  .strict();

export const explanationQuestionSchema = z.enum([
  "WHY_ROUTE_SELECTED",
  "WHY_ROUTE_REJECTED",
  "WHY_RETRY",
  "WHY_REPLAN",
  "WHY_ABORTED",
  "WHY_SATELLITE",
  "WHY_NOT_DELIVERED",
  "WHAT_CHANGED",
  "CURRENT_STATUS",
  "LATE_ACK",
  "INCIDENT_SUMMARY",
]);

export const explanationClaimSchema = z
  .object({
    text: z.string().min(1),
    evidenceIds: z.array(domainIdSchema).min(1),
  })
  .strict();

export const operatorExplanationSchema = z
  .object({
    explanationId: domainIdSchema,
    question: explanationQuestionSchema,
    summary: z.string().min(1),
    claims: z.array(explanationClaimSchema),
    evidence: z.array(explanationEvidenceSchema),
    confidence: intelligenceConfidenceSchema,
  })
  .strict();

export const providerMissionOutputSchema = z
  .object({
    intent: missionIntentSchema,
    urgency: missionUrgencySchema,
    proposedMissionType: missionTypeSchema.optional(),
    constraints: z.array(
      z
        .object({
          kind: missionConstraintKindSchema,
          asserted: z.boolean(),
        })
        .strict(),
    ),
    requiresClarification: z.boolean(),
    ambiguities: z.array(missionAmbiguitySchema),
    summary: z.string().min(1),
    confidence: intelligenceConfidenceSchema,
  })
  .strict();

export const intelligenceFailureCodeSchema = z.enum([
  "INTELLIGENCE_PROVIDER_UNAVAILABLE",
  "INTELLIGENCE_OUTPUT_INVALID",
  "INTELLIGENCE_TIMEOUT",
  "INTELLIGENCE_SCHEMA_REJECTED",
]);

export const intelligenceRequestSchema = z
  .object({
    requestId: domainIdSchema,
    missionId: domainIdSchema,
    runId: domainIdSchema,
    correlationId: domainIdSchema,
    input: missionInputSchema,
  })
  .strict();
