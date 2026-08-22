import type { z } from "zod";
import type { DomainEvent } from "../domain/events/model.js";
import type { StarryRuntimeResult } from "../runtime/model.js";
import type {
  decisionRecommendationSchema,
  explanationEvidenceSchema,
  explanationQuestionSchema,
  incidentAssessmentSchema,
  intelligenceConfidenceSchema,
  intelligenceFailureCodeSchema,
  intelligenceRequestSchema,
  intelligenceSourceSchema,
  missionAmbiguitySchema,
  missionConstraintSchema,
  missionInputSchema,
  missionIntentSchema,
  missionInterpretationSchema,
  missionProposalSchema,
  missionUrgencySchema,
  operatorExplanationSchema,
  providerMissionOutputSchema,
} from "./schemas.js";

export type IntelligenceSource = z.infer<typeof intelligenceSourceSchema>;
export type IntelligenceConfidence = z.infer<typeof intelligenceConfidenceSchema>;
export type ExplanationEvidence = z.infer<typeof explanationEvidenceSchema>;
export type MissionInput = z.infer<typeof missionInputSchema>;
export type MissionIntent = z.infer<typeof missionIntentSchema>;
export type MissionUrgency = z.infer<typeof missionUrgencySchema>;
export type MissionConstraint = z.infer<typeof missionConstraintSchema>;
export type MissionAmbiguity = z.infer<typeof missionAmbiguitySchema>;
export type MissionProposal = z.infer<typeof missionProposalSchema>;
export type MissionInterpretation = z.infer<typeof missionInterpretationSchema>;
export type IncidentAssessment = z.infer<typeof incidentAssessmentSchema>;
export type DecisionRecommendation = z.infer<typeof decisionRecommendationSchema>;
export type ExplanationQuestion = z.infer<typeof explanationQuestionSchema>;
export type OperatorExplanation = z.infer<typeof operatorExplanationSchema>;
export type ProviderMissionOutput = z.infer<typeof providerMissionOutputSchema>;
export type IntelligenceFailureCode = z.infer<typeof intelligenceFailureCodeSchema>;
export type IntelligenceRequest = z.infer<typeof intelligenceRequestSchema>;

export interface IncidentContext {
  readonly runtime: StarryRuntimeResult;
  readonly evidence?: readonly ExplanationEvidence[];
}
export interface IntelligenceResponse {
  readonly requestId: string;
  readonly interpretation: MissionInterpretation;
  readonly source: "PROVIDER" | "DETERMINISTIC_FALLBACK";
  readonly fallbackUsed: boolean;
  readonly providerFailure?: IntelligenceFailureCode;
  readonly events: readonly DomainEvent[];
}
