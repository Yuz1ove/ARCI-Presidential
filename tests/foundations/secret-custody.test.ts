import { describe, expect, it } from "vitest";
import {
  ExternalSecretCustodyAdapter,
  InMemoryTestSecretCustodyProvider,
  SecretCustodyError,
  type SecretCustodyBackend,
} from "../../src/foundations/index.js";

function activeProvider() {
  const provider = new InMemoryTestSecretCustodyProvider();
  provider.provision({
    secretIdentity: "secret:test:runtime", keyHandle: "handle:test:runtime:v1", keyVersion: 1,
    purpose: "TRANSPORT_SIGNING", serviceIdentity: "service:test:runtime",
  });
  provider.activate("handle:test:runtime:v1", 1);
  return provider;
}

function sign(provider: InMemoryTestSecretCustodyProvider, generation = 1) {
  return provider.sign({
    keyHandle: "handle:test:runtime:v1", purpose: "TRANSPORT_SIGNING", serviceIdentity: "service:test:runtime",
    operation: "transport.send", generation, payload: Buffer.from("bounded-payload"),
  });
}

describe("Phase 4F secret custody and lifecycle", () => {
  it("signs only through an opaque active handle and retains public verification material", () => {
    const provider = activeProvider();
    const metadata = provider.describe("handle:test:runtime:v1");
    const signature = sign(provider);
    expect(provider.verify(metadata.keyHandle, Buffer.from("bounded-payload"), signature)).toBe(true);
    expect(JSON.stringify(metadata)).not.toMatch(/privateKey|PRIVATE KEY|secret bytes/u);
    const publicMaterial = metadata.publicVerificationMaterial;
    provider.destroy(metadata.keyHandle);
    expect(provider.describe(metadata.keyHandle).publicVerificationMaterial).toBe(publicMaterial);
    expect(() => sign(provider)).toThrowError(new SecretCustodyError("SECRET_HANDLE_DESTROYED"));
  });

  it("fails closed for lifecycle, purpose, identity, operation, and generation violations", () => {
    const revoked = activeProvider();
    revoked.revoke("handle:test:runtime:v1");
    expect(() => sign(revoked)).toThrowError(new SecretCustodyError("SECRET_HANDLE_REVOKED"));

    const retired = activeProvider();
    retired.retire("handle:test:runtime:v1", 1);
    expect(() => sign(retired)).toThrowError(new SecretCustodyError("SECRET_KEY_RETIRED"));

    const provider = activeProvider();
    expect(() => provider.activate("handle:test:runtime:v1", 1))
      .toThrowError(new SecretCustodyError("SECRET_DUPLICATE_ACTIVATION"));
    expect(() => provider.sign({
      keyHandle: "handle:test:runtime:v1", purpose: "AUDIT_SIGNING", serviceIdentity: "service:test:runtime",
      operation: "audit.seal", generation: 1, payload: Buffer.from("x"),
    })).toThrowError(new SecretCustodyError("SECRET_PURPOSE_MISMATCH"));
    expect(() => provider.sign({
      keyHandle: "handle:test:runtime:v1", purpose: "TRANSPORT_SIGNING", serviceIdentity: "service:test:wrong",
      operation: "transport.send", generation: 1, payload: Buffer.from("x"),
    })).toThrowError(new SecretCustodyError("SECRET_SERVICE_IDENTITY_MISMATCH"));
    expect(() => provider.sign({
      keyHandle: "handle:test:runtime:v1", purpose: "TRANSPORT_SIGNING", serviceIdentity: "service:test:runtime",
      operation: "transport.callback", generation: 1, payload: Buffer.from("x"),
    })).toThrowError(new SecretCustodyError("SECRET_OPERATION_MISMATCH"));
    provider.advanceGeneration(2);
    expect(() => sign(provider, 1)).toThrowError(new SecretCustodyError("SECRET_GENERATION_STALE"));
    expect(() => provider.advanceGeneration(1)).toThrowError(new SecretCustodyError("SECRET_GENERATION_ROLLBACK"));
    expect(() => provider.describe("handle:test:unknown")).toThrowError(new SecretCustodyError("SECRET_HANDLE_UNKNOWN"));
  });

  it("rotates with bounded public verification overlap and prevents historical signing", () => {
    const provider = activeProvider();
    const oldSignature = sign(provider);
    provider.provision({
      secretIdentity: "secret:test:runtime", keyHandle: "handle:test:runtime:v2", keyVersion: 2,
      purpose: "TRANSPORT_SIGNING", serviceIdentity: "service:test:runtime",
    });
    provider.beginRotation("handle:test:runtime:v1", "handle:test:runtime:v2", 2, 3);
    expect(provider.describe("handle:test:runtime:v1").state).toBe("GRACE");
    expect(provider.verify("handle:test:runtime:v1", Buffer.from("bounded-payload"), oldSignature)).toBe(true);
    expect(() => sign(provider, 2)).toThrowError(new SecretCustodyError("SECRET_KEY_RETIRED"));
    provider.advanceGeneration(4);
    expect(provider.describe("handle:test:runtime:v1").state).toBe("RETIRED");
  });

  it("exposes explicit non-connected contracts for OS keychain, KMS, HSM, and Vault", () => {
    const backends: readonly Exclude<SecretCustodyBackend, "IN_MEMORY_TEST">[] = [
      "OS_KEYCHAIN_ADAPTER", "KMS_ADAPTER", "HSM_ADAPTER", "VAULT_ADAPTER",
    ];
    for (const backend of backends) {
      const adapter = new ExternalSecretCustodyAdapter(backend);
      expect(adapter.backend).toBe(backend);
      expect(() => adapter.describe("handle:test:none"))
        .toThrowError(new SecretCustodyError("SECRET_BACKEND_NOT_CONNECTED"));
    }
  });
});
