import type { z } from "zod";
import type { MissionState } from "../../domain/mission/model.js";
import { evidenceFromMissionInput } from "../evidence/collector.js";
import type { IntelligenceSource, MissionInput, MissionInterpretation } from "../model.js";
import {
  missionInputSchema,
  missionInterpretationSchema,
  providerMissionOutputSchema,
} from "../schemas.js";
import { missionRules } from "./rules.js";

type ProviderMissionOutput = z.infer<typeof providerMissionOutputSchema>;

export function interpretMissionDeterministically(
  rawInput: MissionInput,
  source: IntelligenceSource = "DETERMINISTIC_RULE",
): MissionInterpretation {
  const input = missionInputSchema.parse(rawInput);
  const evidence = evidenceFromMissionInput(input);
  const medical = missionRules.medical(input.text);
  const assistance = missionRules.assistance(input.text);
  const general = missionRules.generalCommunication(input.text);
  const authorityDirective = missionRules.authorityDirective(input.text);
  const cellularUnavailable = missionRules.cellularUnavailable(input.text);
  const batteryLow = missionRules.batteryLow(input.text);

  const understood = !authorityDirective && (medical || assistance || general);
  const intent = authorityDirective
    ? "UNKNOWN"
    : assistance || medical
      ? "REQUEST_ASSISTANCE"
      : general
        ? "COMMUNICATE_STATUS"
        : "UNKNOWN";
  const urgency = medical ? "MEDICAL" : understood && assistance ? "DISTRESS" : general ? "GENERAL" : "UNKNOWN";
  const proposedMissionType = medical
    ? "MEDICAL_EMERGENCY"
    : understood && assistance
      ? "DISTRESS"
      : general
        ? "GENERAL"
        : undefined;
  const ambiguities = authorityDirective
    ? ["UNTRUSTED_AUTHORITY_DIRECTIVE" as const]
    : understood
      ? []
      : ["INSUFFICIENT_INFORMATION" as const];
  const constraints = [
    ...(understood && (assistance || medical)
      ? [
          {
            kind: "DELIVERY_REQUIRED" as const,
            asserted: true,
            provenance: "DERIVED" as const,
            evidenceId: evidence.evidenceId,
          },
          {
            kind: "HIGH_RELIABILITY" as const,
            asserted: true,
            provenance: "DERIVED" as const,
            evidenceId: evidence.evidenceId,
          },
        ]
      : []),
    ...(cellularUnavailable
      ? [{ kind: "CELLULAR_UNAVAILABLE" as const, asserted: true, provenance: "USER_REPORTED" as const, evidenceId: evidence.evidenceId }]
      : []),
    ...(batteryLow
      ? [{ kind: "BATTERY_LOW" as const, asserted: true, provenance: "USER_REPORTED" as const, evidenceId: evidence.evidenceId }]
      : []),
  ];

  return missionInterpretationSchema.parse({
    interpretationId: `${input.inputId}:interpretation`,
    inputId: input.inputId,
    summary: authorityDirective
      ? "The input contains an untrusted authority directive and does not create a mission decision."
      : medical
        ? "A medical assistance request was identified; environmental statements remain user-reported."
        : assistance
          ? "An assistance request was identified without inventing a medical condition."
          : general
            ? "A general communication request was identified."
            : "The request is too ambiguous to establish a bounded mission proposal.",
    confidence: medical || general ? "HIGH" : assistance ? "MEDIUM" : "LOW",
    source,
    proposal: {
      proposalId: `${input.inputId}:proposal`,
      intent,
      urgency,
      ...(proposedMissionType === undefined ? {} : { proposedMissionType }),
      constraints,
      requiresClarification: !understood,
      ambiguities,
    },
    evidence: [evidence],
  });
}
export function reconcileProviderMissionOutput(
  rawInput: MissionInput,
  rawOutput: unknown,
): MissionInterpretation {
  const output: ProviderMissionOutput = providerMissionOutputSchema.parse(rawOutput);
  const bounded = interpretMissionDeterministically(rawInput, "MODEL_GENERATED");
  const sameIntent = output.intent === bounded.proposal.intent;
  const sameUrgency = output.urgency === bounded.proposal.urgency;
  const sameMissionType = output.proposedMissionType === bounded.proposal.proposedMissionType;
  if (!sameIntent || !sameUrgency || !sameMissionType) {
    throw new Error("provider semantics conflict with deterministic constraint reconciliation");
  }
  return missionInterpretationSchema.parse({
    ...bounded,
    summary: output.summary,
    confidence: output.confidence,
  });
}

export function missionProposalToMissionPatch(
  interpretation: MissionInterpretation,
): Pick<MissionState, "type"> | undefined {
  if (interpretation.proposal.requiresClarification) return undefined;
  const type = interpretation.proposal.proposedMissionType;
  return type === undefined ? undefined : { type };
}
