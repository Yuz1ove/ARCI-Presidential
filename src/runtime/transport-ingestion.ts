import { z } from "zod";
import { executionResultSchema } from "../domain/execution/model.js";
import { domainIdSchema } from "../domain/ids.js";
import { acknowledgementSchema } from "../domain/verification/model.js";
import { VerificationEngine } from "../verification/engine.js";

export const runtimeTransportIngestionCandidateSchema = z
  .object({
    candidateId: domainIdSchema,
    evidenceId: domainIdSchema,
    missionId: domainIdSchema,
    executionId: domainIdSchema,
    routeId: domainIdSchema,
    attemptId: domainIdSchema,
    correlationId: domainIdSchema,
    messageIdentity: domainIdSchema,
    acknowledgementId: domainIdSchema,
    envelopeId: domainIdSchema,
    evidenceGeneration: z.number().int().positive(),
    runtimeStateGeneration: z.number().int().positive(),
    receivedAt: z.iso.datetime({ offset: true }),
    sourceNodeId: domainIdSchema,
    authenticated: z.literal(true),
    deliveryEvidence: z.literal("CORRELATED_DESTINATION_ACK"),
    classification: z.literal("CORRELATED"),
    authority: z.literal("NON_AUTHORITATIVE"),
  })
  .strict();

export type RuntimeTransportIngestionCandidate = z.infer<typeof runtimeTransportIngestionCandidateSchema>;

const runtimeDeliveryStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_VERIFIED") }).strict(),
  z.object({ status: z.literal("VERIFIED"), acknowledgementId: domainIdSchema }).strict(),
]);

export const authoritativeTransportRuntimeStateSchema = z
  .object({
    schemaVersion: z.literal("4D.1"),
    stateGeneration: z.number().int().positive(),
    missionId: domainIdSchema,
    execution: executionResultSchema,
    routeId: domainIdSchema,
    attemptId: domainIdSchema,
    correlationId: domainIdSchema,
    messageIdentity: domainIdSchema,
    lifecycle: z.enum(["VERIFYING", "COMPLETED", "FAILED"]),
    routeState: z.enum(["ACTIVE", "RETIRED", "INVALIDATED"]),
    validatedPolicyVersion: z.number().int().positive(),
    currentPolicyVersion: z.number().int().positive(),
    minimumEvidenceGeneration: z.number().int().positive(),
    acknowledgementDeadlineAt: z.iso.datetime({ offset: true }),
    processedEvidenceIds: z.array(domainIdSchema),
    processedAcknowledgementIds: z.array(domainIdSchema),
    delivery: runtimeDeliveryStateSchema,
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.execution.routeId !== state.routeId ||
      state.execution.messageId !== state.messageIdentity
    ) {
      context.addIssue({ code: "custom", message: "authoritative execution identity mismatch" });
    }
    if (state.lifecycle === "COMPLETED" && state.delivery.status !== "VERIFIED") {
      context.addIssue({ code: "custom", message: "completed runtime requires verified delivery" });
    }
    if (state.delivery.status === "VERIFIED" && state.lifecycle !== "COMPLETED") {
      context.addIssue({ code: "custom", message: "verified delivery requires completed runtime" });
    }
  });

export type AuthoritativeTransportRuntimeState = z.infer<typeof authoritativeTransportRuntimeStateSchema>;

export const runtimeTransportIngestionFailureCodeSchema = z.enum([
  "CANDIDATE_MALFORMED",
  "STALE_RUNTIME_STATE",
  "ROUTE_NOT_ACTIVE",
  "POLICY_STATE_STALE",
  "EVIDENCE_GENERATION_STALE",
  "WRONG_MISSION",
  "WRONG_EXECUTION",
  "WRONG_ROUTE",
  "WRONG_ATTEMPT",
  "WRONG_CORRELATION",
  "WRONG_MESSAGE",
  "DUPLICATE_EVIDENCE",
  "CONFLICTING_EVIDENCE",
  "ACK_VERIFICATION_FAILED",
  "ALREADY_VERIFIED",
]);

export type RuntimeTransportIngestionFailureCode = z.infer<typeof runtimeTransportIngestionFailureCodeSchema>;

export interface RuntimeTransportAuthorityEvent {
  readonly sequence: number;
  readonly eventId: string;
  readonly type: "verification.started" | "verification.ack_received" | "mission.delivered" | "runtime.completed";
  readonly missionId: string;
  readonly executionId: string;
  readonly routeId: string;
  readonly acknowledgementId: string;
}

export type RuntimeTransportIngestionResult =
  | {
      readonly accepted: true;
      readonly authoritativeDelivery: true;
      readonly verificationStatus: "VERIFIED";
      readonly events: readonly RuntimeTransportAuthorityEvent[];
      readonly state: AuthoritativeTransportRuntimeState;
    }
  | {
      readonly accepted: false;
      readonly authoritativeDelivery: false;
      readonly failureCode: RuntimeTransportIngestionFailureCode;
      readonly events: readonly RuntimeTransportAuthorityEvent[];
      readonly state: AuthoritativeTransportRuntimeState;
    };

function fingerprint(candidate: RuntimeTransportIngestionCandidate): string {
  return JSON.stringify(runtimeTransportIngestionCandidateSchema.parse(candidate));
}

export class SealedRuntimeTransportIngestionCommand {
  private state: AuthoritativeTransportRuntimeState;
  private readonly candidateFingerprints = new Map<string, string>();
  private readonly verifier = new VerificationEngine();
  private readonly events: RuntimeTransportAuthorityEvent[] = [];

  public constructor(rawState: AuthoritativeTransportRuntimeState) {
    this.state = authoritativeTransportRuntimeStateSchema.parse(rawState);
  }

  private reject(failureCode: RuntimeTransportIngestionFailureCode): RuntimeTransportIngestionResult {
    return {
      accepted: false,
      authoritativeDelivery: false,
      failureCode,
      events: this.readEvents(),
      state: this.readState(),
    };
  }

  public execute(rawCandidate: unknown): RuntimeTransportIngestionResult {
    const parsed = runtimeTransportIngestionCandidateSchema.safeParse(rawCandidate);
    if (!parsed.success) return this.reject("CANDIDATE_MALFORMED");
    const candidate = parsed.data;
    const prior = this.candidateFingerprints.get(candidate.evidenceId);
    if (prior !== undefined) {
      return this.reject(prior === fingerprint(candidate) ? "DUPLICATE_EVIDENCE" : "CONFLICTING_EVIDENCE");
    }
    this.candidateFingerprints.set(candidate.evidenceId, fingerprint(candidate));

    if (this.state.delivery.status === "VERIFIED") return this.reject("ALREADY_VERIFIED");
    if (
      this.state.lifecycle !== "VERIFYING" ||
      candidate.runtimeStateGeneration !== this.state.stateGeneration
    ) {
      return this.reject("STALE_RUNTIME_STATE");
    }
    if (this.state.routeState !== "ACTIVE") return this.reject("ROUTE_NOT_ACTIVE");
    if (this.state.validatedPolicyVersion !== this.state.currentPolicyVersion) {
      return this.reject("POLICY_STATE_STALE");
    }
    if (candidate.evidenceGeneration < this.state.minimumEvidenceGeneration) {
      return this.reject("EVIDENCE_GENERATION_STALE");
    }
    if (candidate.missionId !== this.state.missionId) return this.reject("WRONG_MISSION");
    if (candidate.executionId !== this.state.execution.executionId) return this.reject("WRONG_EXECUTION");
    if (candidate.routeId !== this.state.routeId) return this.reject("WRONG_ROUTE");
    if (candidate.attemptId !== this.state.attemptId) return this.reject("WRONG_ATTEMPT");
    if (candidate.correlationId !== this.state.correlationId) return this.reject("WRONG_CORRELATION");
    if (candidate.messageIdentity !== this.state.messageIdentity) return this.reject("WRONG_MESSAGE");
    if (
      this.state.processedEvidenceIds.includes(candidate.evidenceId) ||
      this.state.processedAcknowledgementIds.includes(candidate.acknowledgementId)
    ) {
      return this.reject("DUPLICATE_EVIDENCE");
    }

    const acknowledgement = acknowledgementSchema.parse({
      ackId: candidate.acknowledgementId,
      messageId: candidate.messageIdentity,
      executionId: candidate.executionId,
      routeId: candidate.routeId,
      receivedAt: candidate.receivedAt,
      sourceNodeId: candidate.sourceNodeId,
    });
    const verification = this.verifier.verify(
      this.state.execution,
      acknowledgement,
      this.state.acknowledgementDeadlineAt,
    );
    if (verification.status !== "VERIFIED") return this.reject("ACK_VERIFICATION_FAILED");

    const base = {
      missionId: candidate.missionId,
      executionId: candidate.executionId,
      routeId: candidate.routeId,
      acknowledgementId: candidate.acknowledgementId,
    };
    for (const type of [
      "verification.started",
      "verification.ack_received",
      "mission.delivered",
      "runtime.completed",
    ] as const) {
      this.events.push({
        sequence: this.events.length + 1,
        eventId: `${candidate.candidateId}:${type}`,
        type,
        ...base,
      });
    }
    this.state = authoritativeTransportRuntimeStateSchema.parse({
      ...this.state,
      stateGeneration: this.state.stateGeneration + 1,
      lifecycle: "COMPLETED",
      processedEvidenceIds: [...this.state.processedEvidenceIds, candidate.evidenceId].sort(),
      processedAcknowledgementIds: [
        ...this.state.processedAcknowledgementIds,
        candidate.acknowledgementId,
      ].sort(),
      delivery: { status: "VERIFIED", acknowledgementId: candidate.acknowledgementId },
    });
    return {
      accepted: true,
      authoritativeDelivery: true,
      verificationStatus: "VERIFIED",
      events: this.readEvents(),
      state: this.readState(),
    };
  }

  public readState(): AuthoritativeTransportRuntimeState {
    return authoritativeTransportRuntimeStateSchema.parse(this.state);
  }

  public readEvents(): readonly RuntimeTransportAuthorityEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  public canonicalProjection(): string {
    return JSON.stringify({ state: this.readState(), events: this.readEvents() });
  }
}
