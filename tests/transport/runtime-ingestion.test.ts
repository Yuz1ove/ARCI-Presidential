import { describe, expect, it } from "vitest";
import {
  SealedRuntimeTransportIngestionCommand,
  authoritativeTransportRuntimeStateSchema,
  runtimeTransportIngestionCandidateSchema,
} from "../../src/index.js";

const STATE = authoritativeTransportRuntimeStateSchema.parse({
  schemaVersion: "4D.1",
  stateGeneration: 4,
  missionId: "ingestion:mission",
  execution: {
    executionId: "ingestion:execution",
    messageId: "ingestion:message",
    routeId: "ingestion:route",
    startedAt: "2031-01-01T00:00:00.000Z",
    finishedAt: "2031-01-01T00:00:00.500Z",
    status: "DELIVERED",
    attempt: 1,
    latencyMs: 500,
  },
  routeId: "ingestion:route",
  attemptId: "ingestion:attempt",
  correlationId: "ingestion:correlation",
  messageIdentity: "ingestion:message",
  lifecycle: "VERIFYING",
  routeState: "ACTIVE",
  validatedPolicyVersion: 2,
  currentPolicyVersion: 2,
  minimumEvidenceGeneration: 3,
  acknowledgementDeadlineAt: "2031-01-01T00:00:02.000Z",
  processedEvidenceIds: [],
  processedAcknowledgementIds: [],
  delivery: { status: "NOT_VERIFIED" },
});

const CANDIDATE = runtimeTransportIngestionCandidateSchema.parse({
  candidateId: "ingestion:candidate",
  evidenceId: "ingestion:evidence",
  missionId: STATE.missionId,
  executionId: STATE.execution.executionId,
  routeId: STATE.routeId,
  attemptId: STATE.attemptId,
  correlationId: STATE.correlationId,
  messageIdentity: STATE.messageIdentity,
  acknowledgementId: "ingestion:ack",
  envelopeId: "ingestion:envelope",
  evidenceGeneration: 3,
  runtimeStateGeneration: STATE.stateGeneration,
  receivedAt: "2031-01-01T00:00:01.000Z",
  sourceNodeId: "ingestion:destination",
  authenticated: true,
  deliveryEvidence: "CORRELATED_DESTINATION_ACK",
  classification: "CORRELATED",
  authority: "NON_AUTHORITATIVE",
});

describe("Phase 4D sealed-runtime ingestion command", () => {
  it("accepts a fully valid candidate only through the existing ACK verifier", () => {
    const result = new SealedRuntimeTransportIngestionCommand(STATE).execute(CANDIDATE);
    expect(result).toMatchObject({
      accepted: true,
      authoritativeDelivery: true,
      verificationStatus: "VERIFIED",
      state: { lifecycle: "COMPLETED", delivery: { status: "VERIFIED" } },
    });
    expect(result.events.map(({ type }) => type)).toEqual([
      "verification.started",
      "verification.ack_received",
      "mission.delivered",
      "runtime.completed",
    ]);
  });

  it.each([
    ["missionId", "ingestion:mission:wrong", "WRONG_MISSION"],
    ["executionId", "ingestion:execution:wrong", "WRONG_EXECUTION"],
    ["routeId", "ingestion:route:wrong", "WRONG_ROUTE"],
    ["attemptId", "ingestion:attempt:wrong", "WRONG_ATTEMPT"],
    ["correlationId", "ingestion:correlation:wrong", "WRONG_CORRELATION"],
    ["messageIdentity", "ingestion:message:wrong", "WRONG_MESSAGE"],
  ] as const)("independently rejects wrong %s", (field, value, failureCode) => {
    expect(new SealedRuntimeTransportIngestionCommand(STATE).execute({ ...CANDIDATE, [field]: value }))
      .toMatchObject({ accepted: false, authoritativeDelivery: false, failureCode, events: [] });
  });

  it("rejects stale runtime generation and stale policy state", () => {
    expect(new SealedRuntimeTransportIngestionCommand(STATE).execute({
      ...CANDIDATE,
      runtimeStateGeneration: 3,
    })).toMatchObject({ failureCode: "STALE_RUNTIME_STATE", authoritativeDelivery: false });
    const stalePolicy = authoritativeTransportRuntimeStateSchema.parse({ ...STATE, currentPolicyVersion: 3 });
    expect(new SealedRuntimeTransportIngestionCommand(stalePolicy).execute(CANDIDATE))
      .toMatchObject({ failureCode: "POLICY_STATE_STALE", authoritativeDelivery: false });
  });

  it("rejects inactive route and stale evidence generation", () => {
    const retired = authoritativeTransportRuntimeStateSchema.parse({ ...STATE, routeState: "RETIRED" });
    expect(new SealedRuntimeTransportIngestionCommand(retired).execute(CANDIDATE))
      .toMatchObject({ failureCode: "ROUTE_NOT_ACTIVE" });
    expect(new SealedRuntimeTransportIngestionCommand(STATE).execute({ ...CANDIDATE, evidenceGeneration: 2 }))
      .toMatchObject({ failureCode: "EVIDENCE_GENERATION_STALE" });
  });

  it("rejects persisted duplicate evidence before verification", () => {
    const duplicate = authoritativeTransportRuntimeStateSchema.parse({
      ...STATE,
      processedEvidenceIds: [CANDIDATE.evidenceId],
    });
    expect(new SealedRuntimeTransportIngestionCommand(duplicate).execute(CANDIDATE))
      .toMatchObject({ accepted: false, failureCode: "DUPLICATE_EVIDENCE", events: [] });
  });

  it("rejects conflicting reuse of one evidence identity", () => {
    const command = new SealedRuntimeTransportIngestionCommand(STATE);
    command.execute({ ...CANDIDATE, routeId: "ingestion:route:wrong" });
    expect(command.execute(CANDIDATE)).toMatchObject({
      accepted: false,
      authoritativeDelivery: false,
      failureCode: "CONFLICTING_EVIDENCE",
      events: [],
    });
  });

  it("rejects a cryptographically authentic but late ACK through verification", () => {
    expect(new SealedRuntimeTransportIngestionCommand(STATE).execute({
      ...CANDIDATE,
      receivedAt: "2031-01-01T00:00:03.000Z",
    })).toMatchObject({ failureCode: "ACK_VERIFICATION_FAILED", authoritativeDelivery: false });
  });

  it("has no direct delivery mutation command in its public surface", () => {
    const command = new SealedRuntimeTransportIngestionCommand(STATE) as unknown as Record<string, unknown>;
    expect(command.setDelivered).toBeUndefined();
    expect(command.markVerified).toBeUndefined();
    expect(command.forceComplete).toBeUndefined();
  });
});
