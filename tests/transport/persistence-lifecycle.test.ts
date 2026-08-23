import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Ed25519SigningIdentity,
  FileDurableOutbox,
  FileDurableTransportEvidenceRepository,
  LocalLoopbackTransportAdapter,
  SealedRuntimeTransportIngestionCommand,
  VerificationIdentityRegistry,
  authenticateTransportEnvelope,
  authoritativeTransportRuntimeStateSchema,
  buildRuntimeIngestionCandidate,
  createSignedTransportEnvelope,
  normalizeTransportSignal,
  outboundTransmissionRequestSchema,
  projectTransportEvidence,
  untrustedTransportSignalSchema,
} from "../../src/index.js";

const AT = "2031-01-01T00:00:00.000Z";
const CORRELATION = {
  missionId: "lifecycle:mission",
  executionId: "lifecycle:execution",
  routeId: "lifecycle:route",
  attemptId: "lifecycle:attempt",
  correlationId: "lifecycle:correlation",
  messageIdentity: "lifecycle:message",
} as const;
const REQUEST = outboundTransmissionRequestSchema.parse({
  requestId: "lifecycle:request",
  idempotencyKey: "lifecycle:idempotency",
  transportId: "transport:local-loopback",
  correlation: CORRELATION,
  payload: {
    payloadReference: "lifecycle:payload",
    messageIdentity: CORRELATION.messageIdentity,
    mediaType: "application/octet-stream",
    byteLength: 8,
  },
  security: { authentication: "PEER", encryption: "NONE" },
  requestedAt: AT,
});

let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "starrylink-lifecycle-test-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Phase 4D process-style reconstruction lifecycle", () => {
  it("reconstructs outbox and evidence repeatedly before sealed runtime ingestion", async () => {
    const outboxPath = join(root, "outbox.json");
    let outbox = new FileDurableOutbox(outboxPath);
    outbox.enqueue(REQUEST);
    const queuedProjection = outbox.canonicalProjection();

    outbox = new FileDurableOutbox(outboxPath);
    expect(outbox.canonicalProjection()).toBe(queuedProjection);
    outbox.claim(REQUEST.requestId, "worker:lifecycle", AT);
    const adapter = new LocalLoopbackTransportAdapter({
      observedAt: AT,
      availability: "AVAILABLE",
      health: "HEALTHY",
      attempt: "ACCEPTED",
    });
    outbox.recordAttempt(REQUEST.requestId, await adapter.transmit(REQUEST));
    outbox.resolveAttempt(REQUEST.requestId);
    expect(new FileDurableOutbox(outboxPath).require(REQUEST.requestId).status).toBe("ACCEPTED");

    const evidencePath = join(root, "evidence.json");
    let evidenceStore = new FileDurableTransportEvidenceRepository(evidencePath);
    const receipt = normalizeTransportSignal({
      observationId: "lifecycle:receipt",
      transportId: REQUEST.transportId,
      kind: "PROVIDER_RECEIPT",
      observedAt: AT,
      sequence: 1,
      providerAssignedId: "lifecycle:local-attempt",
    });
    if (!receipt.ok) throw new Error(receipt.failure.code);
    evidenceStore.append([receipt.evidence]);
    const receiptProjection = evidenceStore.canonicalProjection();

    evidenceStore = new FileDurableTransportEvidenceRepository(evidencePath);
    expect(evidenceStore.canonicalProjection()).toBe(receiptProjection);
    const keyPair = generateKeyPairSync("ed25519");
    const signer = new Ed25519SigningIdentity("key:lifecycle:destination", keyPair.privateKey);
    const registry = new VerificationIdentityRegistry([
      { keyId: signer.keyId, algorithm: "Ed25519", publicKey: keyPair.publicKey },
    ]);
    const signal = untrustedTransportSignalSchema.parse({
      observationId: "lifecycle:evidence:ack",
      transportId: REQUEST.transportId,
      kind: "DESTINATION_ACK",
      observedAt: "2031-01-01T00:00:01.000Z",
      sequence: 2,
      ...CORRELATION,
      acknowledgementId: "lifecycle:ack",
    });
    const envelope = createSignedTransportEnvelope({ envelopeId: "lifecycle:envelope", signal }, signer);
    const authenticated = authenticateTransportEnvelope(envelope, registry, {
      expectedKeyId: signer.keyId,
      previouslyAcceptedEnvelopeIds: evidenceStore.acceptedEnvelopeIds(),
      previouslyAcceptedAcknowledgementIds: evidenceStore.acceptedAcknowledgementIds(),
    });
    if (!authenticated.ok) throw new Error(authenticated.failure.code);
    evidenceStore.append([authenticated.evidence]);
    const policy = {
      transportId: REQUEST.transportId,
      expected: CORRELATION,
      minimumObservationSequence: 1,
      retiredExecutionIds: [],
      previouslyAcceptedAcknowledgementIds: [],
    } as const;
    const correlated = projectTransportEvidence(evidenceStore.readAll(), policy);

    const evidenceProjection = evidenceStore.canonicalProjection();
    evidenceStore = new FileDurableTransportEvidenceRepository(evidencePath);
    expect(evidenceStore.canonicalProjection()).toBe(evidenceProjection);
    expect(projectTransportEvidence(evidenceStore.readAll(), policy)).toEqual(correlated);
    const candidate = buildRuntimeIngestionCandidate(authenticated.evidence, correlated, {
      candidateId: "lifecycle:candidate",
      evidenceGeneration: 1,
      runtimeStateGeneration: 5,
      sourceNodeId: "lifecycle:destination",
    });
    expect(candidate.authority).toBe("NON_AUTHORITATIVE");

    const state = authoritativeTransportRuntimeStateSchema.parse({
      schemaVersion: "4D.1",
      stateGeneration: 5,
      missionId: CORRELATION.missionId,
      execution: {
        executionId: CORRELATION.executionId,
        messageId: CORRELATION.messageIdentity,
        routeId: CORRELATION.routeId,
        startedAt: AT,
        finishedAt: "2031-01-01T00:00:00.500Z",
        status: "DELIVERED",
        attempt: 1,
        latencyMs: 500,
      },
      routeId: CORRELATION.routeId,
      attemptId: CORRELATION.attemptId,
      correlationId: CORRELATION.correlationId,
      messageIdentity: CORRELATION.messageIdentity,
      lifecycle: "VERIFYING",
      routeState: "ACTIVE",
      validatedPolicyVersion: 1,
      currentPolicyVersion: 1,
      minimumEvidenceGeneration: 1,
      acknowledgementDeadlineAt: "2031-01-01T00:00:02.000Z",
      processedEvidenceIds: [],
      processedAcknowledgementIds: [],
      delivery: { status: "NOT_VERIFIED" },
    });
    const command = new SealedRuntimeTransportIngestionCommand(state);
    const result = command.execute(candidate);
    expect(result).toMatchObject({ accepted: true, authoritativeDelivery: true });
    expect(authoritativeTransportRuntimeStateSchema.parse(result.state)).toEqual(command.readState());
  });
});
