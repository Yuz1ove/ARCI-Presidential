import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DurableEvidenceStoreError,
  Ed25519SigningIdentity,
  FileDurableTransportEvidenceRepository,
  VerificationIdentityRegistry,
  authenticateTransportEnvelope,
  createSignedTransportEnvelope,
  untrustedTransportSignalSchema,
} from "../../src/integration/index.js";

const keyPair = generateKeyPairSync("ed25519");
const otherPair = generateKeyPairSync("ed25519");
const signer = new Ed25519SigningIdentity("key:test:trusted", keyPair.privateKey);
const otherSigner = new Ed25519SigningIdentity("key:test:other", otherPair.privateKey);
const registry = new VerificationIdentityRegistry([
  { keyId: signer.keyId, algorithm: "Ed25519", publicKey: keyPair.publicKey },
  { keyId: otherSigner.keyId, algorithm: "Ed25519", publicKey: otherPair.publicKey },
]);
const signal = untrustedTransportSignalSchema.parse({
  observationId: "crypto:evidence",
  transportId: "transport:local-loopback",
  kind: "DESTINATION_ACK",
  observedAt: "2031-01-01T00:00:01.000Z",
  sequence: 1,
  missionId: "crypto:mission",
  executionId: "crypto:execution",
  routeId: "crypto:route",
  attemptId: "crypto:attempt",
  correlationId: "crypto:correlation",
  messageIdentity: "crypto:message",
  acknowledgementId: "crypto:ack",
});

let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "starrylink-evidence-test-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

function authenticate(envelope: unknown, acceptedEnvelopeIds: readonly string[] = []) {
  return authenticateTransportEnvelope(envelope, registry, {
    expectedKeyId: signer.keyId,
    previouslyAcceptedEnvelopeIds: acceptedEnvelopeIds,
    previouslyAcceptedAcknowledgementIds: [],
  });
}

describe("Phase 4D cryptographic evidence and durable storage", () => {
  it("authenticates Ed25519 evidence without granting delivery authority", () => {
    const result = authenticate(createSignedTransportEnvelope({ envelopeId: "crypto:envelope", signal }, signer));
    expect(result).toMatchObject({
      ok: true,
      evidence: {
        classification: "OBSERVED",
        trust: "UNTRUSTED_EXTERNAL",
        authority: "EVIDENCE_ONLY",
        authentication: { status: "AUTHENTICATED", algorithm: "Ed25519" },
      },
    });
  });

  it("rejects an altered signed payload", () => {
    const envelope = createSignedTransportEnvelope({ envelopeId: "crypto:altered", signal }, signer);
    expect(authenticate({ ...envelope, signal: { ...signal, routeId: "crypto:route:altered" } }))
      .toMatchObject({ ok: false, failure: { code: "SIGNATURE_INVALID" } });
  });

  it("distinguishes wrong expected identity from unknown key identity", () => {
    const wrong = createSignedTransportEnvelope({ envelopeId: "crypto:wrong", signal }, otherSigner);
    expect(authenticate(wrong)).toMatchObject({ ok: false, failure: { code: "AUTHENTICATION_FAILURE" } });
    const unknownRegistry = new VerificationIdentityRegistry([]);
    expect(authenticateTransportEnvelope(wrong, unknownRegistry, {
      expectedKeyId: signer.keyId,
      previouslyAcceptedEnvelopeIds: [],
      previouslyAcceptedAcknowledgementIds: [],
    })).toMatchObject({ ok: false, failure: { code: "SIGNER_UNKNOWN" } });
  });

  it("rejects replay by signed envelope identity independently of wall time", () => {
    const envelope = createSignedTransportEnvelope({ envelopeId: "crypto:replay", signal }, signer);
    expect(authenticate(envelope, ["crypto:replay"]))
      .toMatchObject({ ok: false, failure: { code: "EVIDENCE_REPLAYED" } });
  });

  it("persists authenticated evidence append-only and reconstructs canonically", () => {
    const authenticated = authenticate(createSignedTransportEnvelope({ envelopeId: "crypto:persist", signal }, signer));
    if (!authenticated.ok) throw new Error(authenticated.failure.code);
    const path = join(root, "evidence.json");
    const first = new FileDurableTransportEvidenceRepository(path);
    first.append([authenticated.evidence]);
    expect(new FileDurableTransportEvidenceRepository(path).canonicalProjection()).toBe(first.canonicalProjection());
  });

  it("rejects duplicates atomically across reconstruction", () => {
    const authenticated = authenticate(createSignedTransportEnvelope({ envelopeId: "crypto:duplicate", signal }, signer));
    if (!authenticated.ok) throw new Error(authenticated.failure.code);
    const path = join(root, "evidence.json");
    new FileDurableTransportEvidenceRepository(path).append([authenticated.evidence]);
    const restarted = new FileDurableTransportEvidenceRepository(path);
    expect(() => restarted.append([authenticated.evidence])).toThrow(DurableEvidenceStoreError);
    expect(restarted.readAll()).toHaveLength(1);
  });

  it("fails malformed persisted records closed", () => {
    const path = join(root, "evidence.json");
    writeFileSync(path, '{"schemaVersion":"4D.1","records":[{"authority":"AUTHORITATIVE"}]}\n');
    expect(() => new FileDurableTransportEvidenceRepository(path).readAll()).toThrow(DurableEvidenceStoreError);
  });

  it("never persists signatures or private key material", () => {
    const envelope = createSignedTransportEnvelope({ envelopeId: "crypto:isolated", signal }, signer);
    const authenticated = authenticate(envelope);
    if (!authenticated.ok) throw new Error(authenticated.failure.code);
    const path = join(root, "evidence.json");
    new FileDurableTransportEvidenceRepository(path).append([authenticated.evidence]);
    const persisted = readFileSync(path, "utf8");
    expect(persisted).not.toContain(envelope.signature);
    expect(persisted).not.toContain("PRIVATE KEY");
  });
});
