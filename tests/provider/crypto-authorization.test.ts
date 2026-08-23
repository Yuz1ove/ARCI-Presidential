import { describe, expect, it } from "vitest";
import {
  DeterministicVerificationKeyRing,
  EphemeralSecretMaterialProvider,
  ProviderAuthorizationPolicy,
  providerSendBodySchema,
} from "../../src/provider/index.js";

const BODY = providerSendBodySchema.parse({
  requestId: "provider:test:request", idempotencyKey: "provider:test:idempotency",
  transportId: "provider:test:transport",
  correlation: {
    missionId: "provider:test:mission", executionId: "provider:test:execution",
    routeId: "provider:test:route", attemptId: "provider:test:attempt",
    correlationId: "provider:test:correlation", messageIdentity: "provider:test:message",
  },
  payloadReference: "provider:test:payload", payloadBytes: 32, attemptNumber: 1, policyGeneration: 3,
});

function signed(handle: ReturnType<EphemeralSecretMaterialProvider["createEphemeralSigningHandle"]>, generation: number) {
  return handle.signEnvelope({
    protocolVersion: "4E.1", envelopeId: `provider:test:envelope:${generation}`,
    operation: "transport.send", authorizationScope: "transport.send", generation, body: BODY,
  });
}

describe("Phase 4E identity, key ring, and authorization", () => {
  it("keeps signing handles opaque and private material out of projections", () => {
    const vault = new EphemeralSecretMaterialProvider();
    const handle = vault.createEphemeralSigningHandle("service:test:arci", "key:test:arci:1");
    expect(JSON.stringify(handle)).not.toMatch(/private|secret|BEGIN/u);
    const ring = new DeterministicVerificationKeyRing();
    ring.trust(vault.publicVerificationKey(handle.keyId));
    expect(JSON.stringify(ring.projection())).not.toMatch(/private|BEGIN|signature/u);
  });

  it("separates signature authentication from operation authorization", () => {
    const vault = new EphemeralSecretMaterialProvider();
    const handle = vault.createEphemeralSigningHandle("service:test:arci", "key:test:arci:1");
    const ring = new DeterministicVerificationKeyRing();
    ring.trust(vault.publicVerificationKey(handle.keyId));
    const authentication = ring.authenticate(signed(handle, 3), handle.identity, "transport.send");
    expect(authentication.ok).toBe(true);
    if (!authentication.ok) throw new Error(authentication.code);
    expect(new ProviderAuthorizationPolicy([]).authorize(authentication.envelope)).toBe(false);
    expect(new ProviderAuthorizationPolicy([{
      serviceIdentity: handle.identity, operation: "transport.send", routeId: BODY.correlation.routeId,
      requestId: BODY.requestId, attemptId: BODY.correlation.attemptId, minimumPolicyGeneration: 3,
    }]).authorize(authentication.envelope)).toBe(true);
  });

  it("supports bounded rotation overlap and rejects expired, revoked, unknown, and wrong identities", () => {
    const vault = new EphemeralSecretMaterialProvider();
    const oldKey = vault.createEphemeralSigningHandle("service:test:provider", "key:test:provider:1");
    const newKey = vault.createEphemeralSigningHandle("service:test:provider", "key:test:provider:2");
    const wrong = vault.createEphemeralSigningHandle("service:test:wrong", "key:test:wrong:1");
    const unknown = vault.createEphemeralSigningHandle("service:test:provider", "key:test:unknown:1");
    const ring = new DeterministicVerificationKeyRing();
    ring.trust(vault.publicVerificationKey(oldKey.keyId));
    ring.trust(vault.publicVerificationKey(wrong.keyId));
    ring.rotate(vault.publicVerificationKey(newKey.keyId), 3, 4);
    expect(ring.authenticate(signed(oldKey, 4), oldKey.identity, "transport.send").ok).toBe(true);
    expect(ring.authenticate(signed(oldKey, 5), oldKey.identity, "transport.send"))
      .toMatchObject({ ok: false, code: "CALLBACK_KEY_NOT_ACTIVE" });
    expect(ring.authenticate(signed(newKey, 3), newKey.identity, "transport.send").ok).toBe(true);
    ring.advanceToGeneration(5);
    expect(ring.authenticate(signed(oldKey, 4), oldKey.identity, "transport.send"))
      .toMatchObject({ ok: false, code: "CALLBACK_KEY_NOT_ACTIVE" });
    expect(ring.authenticate(signed(unknown, 3), unknown.identity, "transport.send"))
      .toMatchObject({ ok: false, code: "CALLBACK_SIGNER_UNKNOWN" });
    expect(ring.authenticate(signed(wrong, 3), oldKey.identity, "transport.send"))
      .toMatchObject({ ok: false, code: "CALLBACK_IDENTITY_MISMATCH" });
    ring.revoke(newKey.keyId);
    expect(ring.authenticate(signed(newKey, 3), newKey.identity, "transport.send"))
      .toMatchObject({ ok: false, code: "CALLBACK_SIGNER_REVOKED" });
  });
});
