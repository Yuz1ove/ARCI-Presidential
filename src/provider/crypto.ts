import { generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { domainIdSchema } from "../domain/ids.js";
import {
  providerEnvelopePayloadSchema,
  signedProviderEnvelopeSchema,
  type ProviderEnvelopePayload,
  type SignedProviderEnvelope,
} from "./schemas.js";

export interface EphemeralSigningHandle {
  readonly identity: string;
  readonly keyId: string;
  signEnvelope(payload: Omit<ProviderEnvelopePayload, "keyId" | "serviceIdentity">): SignedProviderEnvelope;
}

export interface PublicVerificationKey {
  readonly identity: string;
  readonly keyId: string;
  readonly publicKey: KeyObject;
}

export interface SecretMaterialProvider {
  createEphemeralSigningHandle(identity: string, keyId: string): EphemeralSigningHandle;
  publicVerificationKey(keyId: string): PublicVerificationKey;
}

export function canonicalProviderPayload(payload: ProviderEnvelopePayload): Uint8Array {
  return Buffer.from(JSON.stringify(providerEnvelopePayloadSchema.parse(payload)), "utf8");
}

class InMemorySigningHandle implements EphemeralSigningHandle {
  readonly #privateKey: KeyObject;

  public constructor(
    public readonly identity: string,
    public readonly keyId: string,
    privateKey: KeyObject,
  ) {
    this.#privateKey = privateKey;
  }

  public signEnvelope(
    input: Omit<ProviderEnvelopePayload, "keyId" | "serviceIdentity">,
  ): SignedProviderEnvelope {
    const payload = providerEnvelopePayloadSchema.parse({
      ...input,
      keyId: this.keyId,
      serviceIdentity: this.identity,
    });
    return signedProviderEnvelopeSchema.parse({
      ...payload,
      algorithm: "Ed25519",
      signature: Buffer.from(sign(null, canonicalProviderPayload(payload), this.#privateKey)).toString("base64url"),
    });
  }
}

/** Ephemeral only: private KeyObjects never leave this process-memory vault. */
export class EphemeralSecretMaterialProvider implements SecretMaterialProvider {
  private readonly keys = new Map<string, { readonly identity: string; readonly privateKey: KeyObject; readonly publicKey: KeyObject }>();

  public createEphemeralSigningHandle(identity: string, keyId: string): EphemeralSigningHandle {
    domainIdSchema.parse(identity);
    domainIdSchema.parse(keyId);
    if (this.keys.has(keyId)) throw new Error("SECRET_KEY_ID_DUPLICATE");
    const pair = generateKeyPairSync("ed25519");
    this.keys.set(keyId, { identity, privateKey: pair.privateKey, publicKey: pair.publicKey });
    return new InMemorySigningHandle(identity, keyId, pair.privateKey);
  }

  public publicVerificationKey(keyId: string): PublicVerificationKey {
    const key = this.keys.get(keyId);
    if (key === undefined) throw new Error("SECRET_KEY_UNKNOWN");
    return { identity: key.identity, keyId, publicKey: key.publicKey };
  }
}

export type VerificationKeyStatus = "ACTIVE" | "GRACE" | "REVOKED";

interface VerificationKeyRecord extends PublicVerificationKey {
  status: VerificationKeyStatus;
  validFromGeneration: number;
  validThroughGeneration?: number;
}

export type ProviderAuthenticationResult =
  | { readonly ok: true; readonly envelope: SignedProviderEnvelope }
  | {
      readonly ok: false;
      readonly code:
        | "CALLBACK_SCHEMA_INVALID"
        | "CALLBACK_SIGNATURE_INVALID"
        | "CALLBACK_SIGNER_UNKNOWN"
        | "CALLBACK_SIGNER_REVOKED"
        | "CALLBACK_KEY_NOT_ACTIVE"
        | "CALLBACK_IDENTITY_MISMATCH";
    };

export class DeterministicVerificationKeyRing {
  private readonly records = new Map<string, VerificationKeyRecord>();
  private activeKeyId: string | undefined;
  private validationGeneration = 1;

  public trust(key: PublicVerificationKey, validFromGeneration = 1): void {
    if (this.records.has(key.keyId)) throw new Error("KEY_RING_DUPLICATE_KEY");
    this.records.set(key.keyId, { ...key, status: "ACTIVE", validFromGeneration });
    this.activeKeyId ??= key.keyId;
  }

  public rotate(next: PublicVerificationKey, generation: number, graceThroughGeneration: number): void {
    const current = this.activeKeyId === undefined ? undefined : this.records.get(this.activeKeyId);
    if (current !== undefined) {
      current.status = "GRACE";
      current.validThroughGeneration = graceThroughGeneration;
    }
    this.trust(next, generation);
    this.activeKeyId = next.keyId;
    this.advanceToGeneration(generation);
  }

  public advanceToGeneration(generation: number): void {
    if (!Number.isInteger(generation) || generation < this.validationGeneration) {
      throw new Error("KEY_RING_GENERATION_INVALID");
    }
    this.validationGeneration = generation;
  }

  public revoke(keyId: string): void {
    const record = this.records.get(keyId);
    if (record === undefined) throw new Error("KEY_RING_KEY_UNKNOWN");
    record.status = "REVOKED";
  }

  public authenticate(
    input: unknown,
    expectedIdentity: string,
    expectedOperation: "transport.send" | "transport.callback",
  ): ProviderAuthenticationResult {
    const parsed = signedProviderEnvelopeSchema.safeParse(input);
    if (!parsed.success || parsed.data.operation !== expectedOperation) {
      return { ok: false, code: "CALLBACK_SCHEMA_INVALID" };
    }
    const envelope = parsed.data;
    const record = this.records.get(envelope.keyId);
    if (record === undefined) return { ok: false, code: "CALLBACK_SIGNER_UNKNOWN" };
    if (record.identity !== expectedIdentity || envelope.serviceIdentity !== expectedIdentity) {
      return { ok: false, code: "CALLBACK_IDENTITY_MISMATCH" };
    }
    if (record.status === "REVOKED") return { ok: false, code: "CALLBACK_SIGNER_REVOKED" };
    if (
      envelope.generation < record.validFromGeneration ||
      (record.status === "GRACE" &&
        (record.validThroughGeneration === undefined ||
          envelope.generation > record.validThroughGeneration ||
          this.validationGeneration > record.validThroughGeneration))
    ) {
      return { ok: false, code: "CALLBACK_KEY_NOT_ACTIVE" };
    }
    const { algorithm: _algorithm, signature, ...payload } = envelope;
    void _algorithm;
    let authentic = false;
    try {
      authentic = verify(
        null,
        canonicalProviderPayload(providerEnvelopePayloadSchema.parse(payload)),
        record.publicKey,
        Buffer.from(signature, "base64url"),
      );
    } catch {
      authentic = false;
    }
    return authentic
      ? { ok: true, envelope }
      : { ok: false, code: "CALLBACK_SIGNATURE_INVALID" };
  }

  public projection(): readonly { keyId: string; identity: string; status: VerificationKeyStatus; validFromGeneration: number; validThroughGeneration?: number }[] {
    return [...this.records.values()]
      .map(({ publicKey: _publicKey, ...record }) => {
        void _publicKey;
        return { ...record };
      })
      .sort((left, right) => left.keyId.localeCompare(right.keyId));
  }
}
