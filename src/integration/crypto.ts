import { sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { domainIdSchema } from "../domain/ids.js";
import { normalizeTransportSignal } from "./normalization.js";
import {
  transportEvidenceSchema,
  transportFailureSchema,
  untrustedTransportSignalSchema,
  type TransportEvidence,
  type TransportFailure,
  type UntrustedTransportSignal,
} from "./schemas.js";

export const signedTransportEnvelopePayloadSchema = z
  .object({
    protocolVersion: z.literal("4D.1"),
    envelopeId: domainIdSchema,
    keyId: domainIdSchema,
    signal: untrustedTransportSignalSchema,
  })
  .strict();

export const signedTransportEnvelopeSchema = signedTransportEnvelopePayloadSchema
  .extend({
    algorithm: z.literal("Ed25519"),
    signature: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict();

export type SignedTransportEnvelopePayload = z.infer<typeof signedTransportEnvelopePayloadSchema>;
export type SignedTransportEnvelope = z.infer<typeof signedTransportEnvelopeSchema>;

export interface SigningIdentity {
  readonly keyId: string;
  readonly algorithm: "Ed25519";
  sign(payload: Uint8Array): Uint8Array;
}

export interface VerificationIdentity {
  readonly keyId: string;
  readonly algorithm: "Ed25519";
  readonly publicKey: KeyObject;
}

export class Ed25519SigningIdentity implements SigningIdentity {
  public readonly algorithm = "Ed25519" as const;

  public constructor(
    public readonly keyId: string,
    private readonly privateKey: KeyObject,
  ) {
    domainIdSchema.parse(keyId);
    if (privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error("SIGNING_IDENTITY_INVALID");
    }
  }

  public sign(payload: Uint8Array): Uint8Array {
    return sign(null, payload, this.privateKey);
  }
}

export class VerificationIdentityRegistry {
  private readonly identities = new Map<string, VerificationIdentity>();

  public constructor(identities: readonly VerificationIdentity[]) {
    for (const identity of identities) {
      domainIdSchema.parse(identity.keyId);
      if (
        identity.algorithm !== "Ed25519" ||
        identity.publicKey.type !== "public" ||
        identity.publicKey.asymmetricKeyType !== "ed25519" ||
        this.identities.has(identity.keyId)
      ) {
        throw new Error("VERIFICATION_IDENTITY_INVALID");
      }
      this.identities.set(identity.keyId, identity);
    }
  }

  public resolve(keyId: string): VerificationIdentity | undefined {
    return this.identities.get(keyId);
  }
}

export function canonicalSignedPayload(payload: SignedTransportEnvelopePayload): Uint8Array {
  const parsed = signedTransportEnvelopePayloadSchema.parse(payload);
  return Buffer.from(JSON.stringify(parsed), "utf8");
}

export function createSignedTransportEnvelope(
  input: {
    readonly envelopeId: string;
    readonly signal: UntrustedTransportSignal;
  },
  identity: SigningIdentity,
): SignedTransportEnvelope {
  const payload = signedTransportEnvelopePayloadSchema.parse({
    protocolVersion: "4D.1",
    envelopeId: input.envelopeId,
    keyId: identity.keyId,
    signal: input.signal,
  });
  return signedTransportEnvelopeSchema.parse({
    ...payload,
    algorithm: identity.algorithm,
    signature: Buffer.from(identity.sign(canonicalSignedPayload(payload))).toString("base64url"),
  });
}

export type CryptographicEvidenceResult =
  | { readonly ok: true; readonly evidence: TransportEvidence }
  | { readonly ok: false; readonly failure: TransportFailure };

function cryptoFailure(
  code: "SIGNATURE_INVALID" | "SIGNER_UNKNOWN" | "EVIDENCE_REPLAYED" | "AUTHENTICATION_FAILURE",
  detailCode: string,
  transportId?: string,
): CryptographicEvidenceResult {
  return {
    ok: false,
    failure: transportFailureSchema.parse({
      code,
      retryable: false,
      detailCode,
      ...(transportId === undefined ? {} : { transportId }),
    }),
  };
}

export function authenticateTransportEnvelope(
  rawEnvelope: unknown,
  registry: VerificationIdentityRegistry,
  policy: {
    readonly expectedKeyId: string;
    readonly previouslyAcceptedEnvelopeIds: readonly string[];
    readonly previouslyAcceptedAcknowledgementIds: readonly string[];
  },
): CryptographicEvidenceResult {
  const parsed = signedTransportEnvelopeSchema.safeParse(rawEnvelope);
  if (!parsed.success) return cryptoFailure("SIGNATURE_INVALID", "SIGNED_ENVELOPE_MALFORMED");
  const envelope = parsed.data;
  if (policy.previouslyAcceptedEnvelopeIds.includes(envelope.envelopeId)) {
    return cryptoFailure("EVIDENCE_REPLAYED", "SIGNED_ENVELOPE_REPLAYED", envelope.signal.transportId);
  }
  if (
    envelope.signal.acknowledgementId !== undefined &&
    policy.previouslyAcceptedAcknowledgementIds.includes(envelope.signal.acknowledgementId)
  ) {
    return cryptoFailure("EVIDENCE_REPLAYED", "ACK_IDENTITY_REPLAYED", envelope.signal.transportId);
  }
  const identity = registry.resolve(envelope.keyId);
  if (identity === undefined) {
    return cryptoFailure("SIGNER_UNKNOWN", "SIGNING_KEY_ID_UNKNOWN", envelope.signal.transportId);
  }
  if (envelope.keyId !== policy.expectedKeyId) {
    return cryptoFailure("AUTHENTICATION_FAILURE", "SIGNING_IDENTITY_MISMATCH", envelope.signal.transportId);
  }
  const payload = signedTransportEnvelopePayloadSchema.parse({
    protocolVersion: envelope.protocolVersion,
    envelopeId: envelope.envelopeId,
    keyId: envelope.keyId,
    signal: envelope.signal,
  });
  let authentic = false;
  try {
    authentic = verify(
      null,
      canonicalSignedPayload(payload),
      identity.publicKey,
      Buffer.from(envelope.signature, "base64url"),
    );
  } catch {
    authentic = false;
  }
  if (!authentic) {
    return cryptoFailure("SIGNATURE_INVALID", "SIGNATURE_VERIFICATION_FAILED", envelope.signal.transportId);
  }
  const normalized = normalizeTransportSignal(envelope.signal);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    evidence: transportEvidenceSchema.parse({
      ...normalized.evidence,
      authentication: {
        status: "AUTHENTICATED",
        keyId: envelope.keyId,
        envelopeId: envelope.envelopeId,
        algorithm: "Ed25519",
      },
    }),
  };
}
