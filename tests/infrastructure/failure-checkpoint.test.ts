import { describe, expect, it } from "vitest";
import {
  AUDIT_CHECKPOINT_SCHEMA_VERSION,
  NonCryptographicCheckpointTestAuthority,
  classifyInfrastructureFailure,
  evaluateFailover,
  type AuditCheckpointPayload,
  type CheckpointSignerRecord,
} from "../../src/infrastructure/index.js";

const PAYLOAD: AuditCheckpointPayload = {
  schemaVersion: AUDIT_CHECKPOINT_SCHEMA_VERSION, checkpointId: "checkpoint:test:1",
  ledgerTerminalHash: "b".repeat(64), recordCount: 3, generation: 2, logicalTime: 10,
  signerIdentityReference: "identity:test.checkpoint-signer", signingKeyPurpose: "AUDIT_CHECKPOINT_SIGNING",
  verificationMaterialReference: "verification:test.checkpoint:v2",
};

function authority(state: CheckpointSignerRecord["state"] = "ACTIVE") {
  return new NonCryptographicCheckpointTestAuthority([{
    signerIdentityReference: PAYLOAD.signerIdentityReference,
    verificationMaterialReference: PAYLOAD.verificationMaterialReference,
    generation: 2, state, purpose: "AUDIT_CHECKPOINT_SIGNING",
  }]);
}

describe("Phase 4G failure, recovery, checkpoint, and failover semantics", () => {
  it("classifies all ambiguous commits as reconciliation-required and non-authoritative", () => {
    for (const failure of [
      "DATABASE_FAILURE_DURING_COMMIT", "DATABASE_RESPONSE_LOST_AFTER_COMMIT", "DATABASE_RECOVERY_AMBIGUOUS",
      "AUDIT_APPEND_SUCCEEDED_CHECKPOINT_FAILED", "ADMISSION_RESULT_LOST", "PARTIAL_NETWORK_PARTITION",
      "PROCESS_CRASH_AFTER_EXTERNAL_COMMIT", "PROCESS_RESTART_DURING_RECONCILIATION",
    ] as const) {
      expect(classifyInfrastructureFailure(failure)).toMatchObject({
        state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", authoritativeDelivery: false,
      });
    }
  });

  it("distinguishes pre-commit failure from idempotently committed admission replay", () => {
    expect(classifyInfrastructureFailure("DATABASE_FAILURE_BEFORE_COMMIT"))
      .toMatchObject({ state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY" });
    expect(classifyInfrastructureFailure("ADMISSION_REQUEST_DUPLICATED"))
      .toMatchObject({ state: "COMMITTED", code: "ADMISSION_IDEMPOTENT_REPLAY", authoritativeDelivery: false });
  });

  it("detects checkpoint mutation and keeps valid checkpoints observational", () => {
    const signer = authority();
    const envelope = signer.seal(PAYLOAD);
    expect(envelope).toMatchObject({ warning: "TEST_ONLY_NOT_PRODUCTION_SIGNING_MATERIAL", authoritativeDelivery: false });
    expect(signer.verify(envelope)).toMatchObject({ valid: true, authoritativeDelivery: false });
    expect(signer.verify({ ...envelope, payload: { ...PAYLOAD, recordCount: 4 } }))
      .toMatchObject({ valid: false, code: "AUDIT_CHECKPOINT_SIGNATURE_INVALID" });
  });

  it("allows historical verification but forbids historical signing after rotation", () => {
    const envelope = authority().seal(PAYLOAD);
    expect(authority("RETIRED").verify(envelope)).toMatchObject({ valid: true, historical: true });
    expect(() => authority("RETIRED").seal(PAYLOAD))
      .toThrowError("AUDIT_CHECKPOINT_HISTORICAL_SIGNING_FORBIDDEN");
    expect(authority("REVOKED").verify(envelope)).toMatchObject({ valid: false, code: "AUDIT_CHECKPOINT_SIGNER_REVOKED" });
  });

  it("allows only explicit identity-preserving read-only audit failover", () => {
    const base = {
      adapterClass: "PROTECTED_AUDIT_STORAGE" as const,
      sourceBackendIdentity: "backend:audit-primary", targetBackendIdentity: "backend:audit-replica",
      sourceEvidenceIdentity: "evidence:audit-ledger", targetEvidenceIdentity: "evidence:audit-ledger",
      readOnly: true, generation: 2, targetGeneration: 2, explicitlyConfigured: true,
    };
    expect(evaluateFailover(base)).toMatchObject({ allowed: true, code: "READ_ONLY_AUDIT_FAILOVER_ALLOWED" });
    expect(evaluateFailover({ ...base, readOnly: false })).toMatchObject({ allowed: false, code: "AUTHORITY_FAILOVER_FORBIDDEN" });
    expect(evaluateFailover({ ...base, targetEvidenceIdentity: "evidence:different" }))
      .toMatchObject({ allowed: false, code: "FAILOVER_EVIDENCE_IDENTITY_MISMATCH" });
    expect(evaluateFailover({ ...base, explicitlyConfigured: false }))
      .toMatchObject({ allowed: false, code: "FAILOVER_NOT_EXPLICIT" });
  });
});
