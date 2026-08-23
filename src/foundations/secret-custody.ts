import { generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

export type SecretCustodyBackend =
  | "IN_MEMORY_TEST"
  | "OS_KEYCHAIN_ADAPTER"
  | "KMS_ADAPTER"
  | "HSM_ADAPTER"
  | "VAULT_ADAPTER";

export type KeyPurpose =
  | "TRANSPORT_SIGNING"
  | "CALLBACK_SIGNING"
  | "AUDIT_SIGNING"
  | "ADMINISTRATIVE_SIGNING";

export type KeyLifecycleState =
  | "PROVISIONED"
  | "ACTIVE"
  | "GRACE"
  | "RETIRED"
  | "REVOKED"
  | "DESTROYED";

export interface SecretIdentity {
  readonly secretIdentity: string;
  readonly keyHandle: string;
  readonly keyVersion: number;
  readonly purpose: KeyPurpose;
  readonly serviceIdentity: string;
  readonly state: KeyLifecycleState;
  readonly activationGeneration?: number;
  readonly retirementGeneration?: number;
  readonly graceThroughGeneration?: number;
  readonly revoked: boolean;
  readonly publicVerificationMaterial: string;
  readonly backend: SecretCustodyBackend;
}

export interface ProvisionKeyInput {
  readonly secretIdentity: string;
  readonly keyHandle: string;
  readonly keyVersion: number;
  readonly purpose: KeyPurpose;
  readonly serviceIdentity: string;
}

export interface SignRequest {
  readonly keyHandle: string;
  readonly purpose: KeyPurpose;
  readonly serviceIdentity: string;
  readonly operation: "transport.send" | "transport.callback" | "audit.seal" | "admin.configure";
  readonly generation: number;
  readonly payload: Uint8Array;
}

export interface SecretCustodyProvider {
  readonly backend: SecretCustodyBackend;
  provision(input: ProvisionKeyInput): SecretIdentity;
  activate(keyHandle: string, generation: number): SecretIdentity;
  beginRotation(currentHandle: string, nextHandle: string, generation: number, graceThroughGeneration: number): void;
  retire(keyHandle: string, generation: number): SecretIdentity;
  revoke(keyHandle: string): SecretIdentity;
  destroy(keyHandle: string): SecretIdentity;
  advanceGeneration(generation: number): void;
  describe(keyHandle: string): SecretIdentity;
  sign(request: SignRequest): string;
}

export class SecretCustodyError extends Error {
  public constructor(public readonly code:
    | "SECRET_HANDLE_UNKNOWN"
    | "SECRET_HANDLE_DESTROYED"
    | "SECRET_HANDLE_REVOKED"
    | "SECRET_KEY_NOT_ACTIVE"
    | "SECRET_KEY_RETIRED"
    | "SECRET_PURPOSE_MISMATCH"
    | "SECRET_SERVICE_IDENTITY_MISMATCH"
    | "SECRET_OPERATION_MISMATCH"
    | "SECRET_GENERATION_STALE"
    | "SECRET_GENERATION_INVALID"
    | "SECRET_GENERATION_ROLLBACK"
    | "SECRET_DUPLICATE_ACTIVATION"
    | "SECRET_VERSION_CONFLICT"
    | "SECRET_ROTATION_INVALID"
    | "SECRET_BACKEND_NOT_CONNECTED") {
    super(code);
    this.name = "SecretCustodyError";
  }
}

interface InternalKeyRecord {
  readonly input: ProvisionKeyInput;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  state: KeyLifecycleState;
  activationGeneration?: number;
  retirementGeneration?: number;
  graceThroughGeneration?: number;
  revoked: boolean;
}

const PURPOSE_OPERATION: Readonly<Record<KeyPurpose, SignRequest["operation"]>> = {
  TRANSPORT_SIGNING: "transport.send",
  CALLBACK_SIGNING: "transport.callback",
  AUDIT_SIGNING: "audit.seal",
  ADMINISTRATIVE_SIGNING: "admin.configure",
};

function validGeneration(generation: number): boolean {
  return Number.isInteger(generation) && generation > 0;
}

function validateIdentity(value: string): void {
  if (value.length < 3 || value.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]+$/u.test(value)) {
    throw new SecretCustodyError("SECRET_GENERATION_INVALID");
  }
}

export class InMemoryTestSecretCustodyProvider implements SecretCustodyProvider {
  public readonly backend = "IN_MEMORY_TEST" as const;
  private readonly records = new Map<string, InternalKeyRecord>();
  private readonly versions = new Map<string, string>();
  private generation = 1;

  public provision(input: ProvisionKeyInput): SecretIdentity {
    validateIdentity(input.secretIdentity);
    validateIdentity(input.keyHandle);
    validateIdentity(input.serviceIdentity);
    if (!validGeneration(input.keyVersion)) throw new SecretCustodyError("SECRET_GENERATION_INVALID");
    const versionIdentity = `${input.secretIdentity}:${input.keyVersion}`;
    if (this.records.has(input.keyHandle) || this.versions.has(versionIdentity)) {
      throw new SecretCustodyError("SECRET_VERSION_CONFLICT");
    }
    const pair = generateKeyPairSync("ed25519");
    this.records.set(input.keyHandle, {
      input: { ...input }, privateKey: pair.privateKey, publicKey: pair.publicKey,
      state: "PROVISIONED", revoked: false,
    });
    this.versions.set(versionIdentity, input.keyHandle);
    return this.describe(input.keyHandle);
  }

  public activate(keyHandle: string, generation: number): SecretIdentity {
    this.assertCurrentOrFutureGeneration(generation);
    const record = this.require(keyHandle);
    if (record.state === "ACTIVE") throw new SecretCustodyError("SECRET_DUPLICATE_ACTIVATION");
    if (record.state !== "PROVISIONED") throw new SecretCustodyError("SECRET_KEY_NOT_ACTIVE");
    this.advanceGeneration(generation);
    record.state = "ACTIVE";
    record.activationGeneration = generation;
    return this.describe(keyHandle);
  }

  public beginRotation(
    currentHandle: string,
    nextHandle: string,
    generation: number,
    graceThroughGeneration: number,
  ): void {
    this.assertCurrentOrFutureGeneration(generation);
    if (!validGeneration(graceThroughGeneration) || graceThroughGeneration < generation) {
      throw new SecretCustodyError("SECRET_ROTATION_INVALID");
    }
    const current = this.require(currentHandle);
    const next = this.require(nextHandle);
    if (current.state !== "ACTIVE" || next.state !== "PROVISIONED" ||
        current.input.secretIdentity !== next.input.secretIdentity ||
        current.input.purpose !== next.input.purpose ||
        current.input.serviceIdentity !== next.input.serviceIdentity ||
        next.input.keyVersion <= current.input.keyVersion) {
      throw new SecretCustodyError("SECRET_ROTATION_INVALID");
    }
    this.advanceGeneration(generation);
    current.state = "GRACE";
    current.retirementGeneration = generation;
    current.graceThroughGeneration = graceThroughGeneration;
    next.state = "ACTIVE";
    next.activationGeneration = generation;
  }

  public retire(keyHandle: string, generation: number): SecretIdentity {
    this.assertCurrentOrFutureGeneration(generation);
    const record = this.require(keyHandle);
    if (record.state !== "ACTIVE" && record.state !== "GRACE") {
      throw new SecretCustodyError("SECRET_KEY_RETIRED");
    }
    this.advanceGeneration(generation);
    record.state = "RETIRED";
    record.retirementGeneration = generation;
    return this.describe(keyHandle);
  }

  public revoke(keyHandle: string): SecretIdentity {
    const record = this.require(keyHandle);
    if (record.state === "DESTROYED") throw new SecretCustodyError("SECRET_HANDLE_DESTROYED");
    record.state = "REVOKED";
    record.revoked = true;
    return this.describe(keyHandle);
  }

  public destroy(keyHandle: string): SecretIdentity {
    const record = this.require(keyHandle);
    record.state = "DESTROYED";
    record.revoked = true;
    return this.describe(keyHandle);
  }

  public advanceGeneration(generation: number): void {
    if (!validGeneration(generation)) throw new SecretCustodyError("SECRET_GENERATION_INVALID");
    if (generation < this.generation) throw new SecretCustodyError("SECRET_GENERATION_ROLLBACK");
    this.generation = generation;
    for (const record of this.records.values()) {
      if (record.state === "GRACE" && record.graceThroughGeneration !== undefined &&
          generation > record.graceThroughGeneration) {
        record.state = "RETIRED";
      }
    }
  }

  public describe(keyHandle: string): SecretIdentity {
    const record = this.require(keyHandle);
    const publicDer = record.publicKey.export({ type: "spki", format: "der" });
    return {
      ...record.input,
      state: record.state,
      ...(record.activationGeneration === undefined ? {} : { activationGeneration: record.activationGeneration }),
      ...(record.retirementGeneration === undefined ? {} : { retirementGeneration: record.retirementGeneration }),
      ...(record.graceThroughGeneration === undefined ? {} : { graceThroughGeneration: record.graceThroughGeneration }),
      revoked: record.revoked,
      publicVerificationMaterial: Buffer.from(publicDer).toString("base64url"),
      backend: this.backend,
    };
  }

  public sign(request: SignRequest): string {
    const record = this.require(request.keyHandle);
    if (record.state === "DESTROYED") throw new SecretCustodyError("SECRET_HANDLE_DESTROYED");
    if (record.state === "REVOKED" || record.revoked) throw new SecretCustodyError("SECRET_HANDLE_REVOKED");
    if (record.state === "RETIRED" || record.state === "GRACE") throw new SecretCustodyError("SECRET_KEY_RETIRED");
    if (record.state !== "ACTIVE") throw new SecretCustodyError("SECRET_KEY_NOT_ACTIVE");
    if (request.purpose !== record.input.purpose) throw new SecretCustodyError("SECRET_PURPOSE_MISMATCH");
    if (request.serviceIdentity !== record.input.serviceIdentity) {
      throw new SecretCustodyError("SECRET_SERVICE_IDENTITY_MISMATCH");
    }
    if (PURPOSE_OPERATION[request.purpose] !== request.operation) {
      throw new SecretCustodyError("SECRET_OPERATION_MISMATCH");
    }
    if (!validGeneration(request.generation)) throw new SecretCustodyError("SECRET_GENERATION_INVALID");
    if (request.generation < this.generation) throw new SecretCustodyError("SECRET_GENERATION_STALE");
    if (request.generation > this.generation) throw new SecretCustodyError("SECRET_GENERATION_INVALID");
    return Buffer.from(sign(null, request.payload, record.privateKey)).toString("base64url");
  }

  public verify(keyHandle: string, payload: Uint8Array, signature: string): boolean {
    const record = this.require(keyHandle);
    try {
      return verify(null, payload, record.publicKey, Buffer.from(signature, "base64url"));
    } catch {
      return false;
    }
  }

  private require(keyHandle: string): InternalKeyRecord {
    const record = this.records.get(keyHandle);
    if (record === undefined) throw new SecretCustodyError("SECRET_HANDLE_UNKNOWN");
    return record;
  }

  private assertCurrentOrFutureGeneration(generation: number): void {
    if (!validGeneration(generation)) throw new SecretCustodyError("SECRET_GENERATION_INVALID");
    if (generation < this.generation) throw new SecretCustodyError("SECRET_GENERATION_ROLLBACK");
  }
}

/** Contract-only adapter. Phase 4F deliberately does not connect to an external secret backend. */
export class ExternalSecretCustodyAdapter implements SecretCustodyProvider {
  public constructor(public readonly backend: Exclude<SecretCustodyBackend, "IN_MEMORY_TEST">) {}

  public provision(input: ProvisionKeyInput): SecretIdentity { void input; return this.unavailable(); }
  public activate(keyHandle: string, generation: number): SecretIdentity { void keyHandle; void generation; return this.unavailable(); }
  public beginRotation(currentHandle: string, nextHandle: string, generation: number, grace: number): void {
    void currentHandle; void nextHandle; void generation; void grace; this.unavailable();
  }
  public retire(keyHandle: string, generation: number): SecretIdentity { void keyHandle; void generation; return this.unavailable(); }
  public revoke(keyHandle: string): SecretIdentity { void keyHandle; return this.unavailable(); }
  public destroy(keyHandle: string): SecretIdentity { void keyHandle; return this.unavailable(); }
  public advanceGeneration(generation: number): void { void generation; this.unavailable(); }
  public describe(keyHandle: string): SecretIdentity { void keyHandle; return this.unavailable(); }
  public sign(request: SignRequest): string { void request; return this.unavailable(); }

  private unavailable(): never {
    throw new SecretCustodyError("SECRET_BACKEND_NOT_CONNECTED");
  }
}
