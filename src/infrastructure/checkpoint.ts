import { canonicalJson, sha256, type CanonicalValue } from "../foundations/canonical.js";

export const AUDIT_CHECKPOINT_SCHEMA_VERSION = "4G.CHECKPOINT.1" as const;
export const TEST_ONLY_CHECKPOINT_ALGORITHM = "TEST_ONLY_NON_CRYPTOGRAPHIC_SHA256" as const;

export interface AuditCheckpointPayload {
  readonly schemaVersion: typeof AUDIT_CHECKPOINT_SCHEMA_VERSION;
  readonly checkpointId: string;
  readonly ledgerTerminalHash: string;
  readonly recordCount: number;
  readonly generation: number;
  readonly logicalTime: number;
  readonly signerIdentityReference: string;
  readonly signingKeyPurpose: "AUDIT_CHECKPOINT_SIGNING";
  readonly verificationMaterialReference: string;
}

export interface TestOnlyAuditCheckpointEnvelope {
  readonly payload: AuditCheckpointPayload;
  readonly signature: string;
  readonly algorithm: typeof TEST_ONLY_CHECKPOINT_ALGORITHM;
  readonly warning: "TEST_ONLY_NOT_PRODUCTION_SIGNING_MATERIAL";
  readonly authoritativeDelivery: false;
}

export type CheckpointKeyState = "ACTIVE" | "RETIRED" | "REVOKED";

export interface CheckpointSignerRecord {
  readonly signerIdentityReference: string;
  readonly verificationMaterialReference: string;
  readonly generation: number;
  readonly state: CheckpointKeyState;
  readonly purpose: "AUDIT_CHECKPOINT_SIGNING";
}

export type CheckpointVerification =
  | { readonly valid: true; readonly code: "AUDIT_CHECKPOINT_VALID"; readonly historical: boolean; readonly authoritativeDelivery: false }
  | { readonly valid: false; readonly code: "AUDIT_CHECKPOINT_MALFORMED" | "AUDIT_CHECKPOINT_SIGNER_UNKNOWN" | "AUDIT_CHECKPOINT_SIGNER_REVOKED" | "AUDIT_CHECKPOINT_SIGNATURE_INVALID" | "AUDIT_CHECKPOINT_GENERATION_INVALID"; readonly authoritativeDelivery: false };

export class AuditCheckpointError extends Error {
  public constructor(public readonly code:
    | "AUDIT_CHECKPOINT_SIGNER_UNKNOWN"
    | "AUDIT_CHECKPOINT_HISTORICAL_SIGNING_FORBIDDEN"
    | "AUDIT_CHECKPOINT_SIGNER_REVOKED"
    | "AUDIT_CHECKPOINT_GENERATION_INVALID"
    | "AUDIT_CHECKPOINT_MALFORMED") {
    super(code);
    this.name = "AuditCheckpointError";
  }
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{2,159}$/u;

function validatePayload(payload: AuditCheckpointPayload): void {
  if (payload.schemaVersion !== AUDIT_CHECKPOINT_SCHEMA_VERSION || !ID_PATTERN.test(payload.checkpointId) ||
      !HASH_PATTERN.test(payload.ledgerTerminalHash) || !Number.isInteger(payload.recordCount) || payload.recordCount < 0 ||
      !Number.isInteger(payload.generation) || payload.generation <= 0 ||
      !Number.isInteger(payload.logicalTime) || payload.logicalTime < 0 ||
      !ID_PATTERN.test(payload.signerIdentityReference) || !ID_PATTERN.test(payload.verificationMaterialReference) ||
      payload.signingKeyPurpose !== "AUDIT_CHECKPOINT_SIGNING") {
    throw new AuditCheckpointError("AUDIT_CHECKPOINT_MALFORMED");
  }
}

function testOnlySignature(payload: AuditCheckpointPayload): string {
  return `test-only:${sha256(canonicalJson(payload as unknown as CanonicalValue))}`;
}

/**
 * A deterministic lifecycle and envelope test double. It contains no key, provides no security,
 * cannot use a production algorithm, and must never be registered outside tests/simulations.
 */
export class NonCryptographicCheckpointTestAuthority {
  private readonly signers = new Map<string, CheckpointSignerRecord>();

  public constructor(records: readonly CheckpointSignerRecord[]) {
    for (const record of records) this.signers.set(record.signerIdentityReference, structuredClone(record));
  }

  public seal(payload: AuditCheckpointPayload): TestOnlyAuditCheckpointEnvelope {
    validatePayload(payload);
    const signer = this.signers.get(payload.signerIdentityReference);
    if (signer === undefined || signer.verificationMaterialReference !== payload.verificationMaterialReference) {
      throw new AuditCheckpointError("AUDIT_CHECKPOINT_SIGNER_UNKNOWN");
    }
    if (signer.state === "REVOKED") throw new AuditCheckpointError("AUDIT_CHECKPOINT_SIGNER_REVOKED");
    if (signer.state !== "ACTIVE") throw new AuditCheckpointError("AUDIT_CHECKPOINT_HISTORICAL_SIGNING_FORBIDDEN");
    if (signer.generation !== payload.generation) {
      throw new AuditCheckpointError("AUDIT_CHECKPOINT_GENERATION_INVALID");
    }
    return {
      payload: structuredClone(payload), signature: testOnlySignature(payload),
      algorithm: TEST_ONLY_CHECKPOINT_ALGORITHM,
      warning: "TEST_ONLY_NOT_PRODUCTION_SIGNING_MATERIAL",
      authoritativeDelivery: false,
    };
  }

  public verify(envelope: TestOnlyAuditCheckpointEnvelope): CheckpointVerification {
    try { validatePayload(envelope.payload); }
    catch { return { valid: false, code: "AUDIT_CHECKPOINT_MALFORMED", authoritativeDelivery: false }; }
    if (envelope.algorithm !== TEST_ONLY_CHECKPOINT_ALGORITHM ||
        envelope.warning !== "TEST_ONLY_NOT_PRODUCTION_SIGNING_MATERIAL" || envelope.authoritativeDelivery !== false) {
      return { valid: false, code: "AUDIT_CHECKPOINT_MALFORMED", authoritativeDelivery: false };
    }
    const signer = this.signers.get(envelope.payload.signerIdentityReference);
    if (signer === undefined || signer.verificationMaterialReference !== envelope.payload.verificationMaterialReference) {
      return { valid: false, code: "AUDIT_CHECKPOINT_SIGNER_UNKNOWN", authoritativeDelivery: false };
    }
    if (signer.state === "REVOKED") {
      return { valid: false, code: "AUDIT_CHECKPOINT_SIGNER_REVOKED", authoritativeDelivery: false };
    }
    if (signer.generation !== envelope.payload.generation) {
      return { valid: false, code: "AUDIT_CHECKPOINT_GENERATION_INVALID", authoritativeDelivery: false };
    }
    if (envelope.signature !== testOnlySignature(envelope.payload)) {
      return { valid: false, code: "AUDIT_CHECKPOINT_SIGNATURE_INVALID", authoritativeDelivery: false };
    }
    return { valid: true, code: "AUDIT_CHECKPOINT_VALID", historical: signer.state === "RETIRED", authoritativeDelivery: false };
  }
}
