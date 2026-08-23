import { describe, expect, it } from "vitest";
import {
  DisconnectedStagingAdapter,
  negotiateCapabilities,
  observeAdapterHealth,
} from "../../src/infrastructure/index.js";

describe("Phase 4G disconnected adapter and capability contracts", () => {
  it("fails unavailable without silently selecting an in-memory backend", () => {
    const adapter = new DisconnectedStagingAdapter("VAULT_TRANSIT_KV", "backend:staging-vault", 2, "evidence:staging-vault");
    expect(adapter.describe()).toMatchObject({ adapterType: "VAULT_TRANSIT_KV", health: "UNAVAILABLE", generation: 2 });
    expect(adapter.execute({
      operationId: "operation:secret:1", operation: "secret.sign", generation: 2,
      idempotencyKey: "idempotency:secret:1", requiredCapabilities: ["secret.versioned"],
    })).toMatchObject({ code: "INFRASTRUCTURE_BACKEND_UNAVAILABLE", retry: "NEVER", authoritativeDelivery: false });
  });

  it("rejects stale, future, unknown, and unsupported capability requests", () => {
    const adapter = new DisconnectedStagingAdapter("POSTGRESQL_TRANSACTIONAL", "backend:postgres", 2, "evidence:postgres");
    const request = { operationId: "operation:tx:1", operation: "transaction.commit", generation: 2,
      idempotencyKey: "idempotency:tx:1", requiredCapabilities: ["transaction.cas"] };
    expect(() => adapter.execute({ ...request, generation: 1 })).toThrowError("INFRASTRUCTURE_GENERATION_STALE");
    expect(() => adapter.execute({ ...request, generation: 3 })).toThrowError("INFRASTRUCTURE_GENERATION_AHEAD");
    expect(() => adapter.execute({ ...request, requiredCapabilities: ["transaction.magic"] })).toThrowError("INFRASTRUCTURE_CAPABILITY_UNKNOWN");
    expect(() => adapter.execute({ ...request, requiredCapabilities: ["audit.verify"] })).toThrowError("INFRASTRUCTURE_CAPABILITY_UNSUPPORTED");
  });

  it("never infers unknown or cross-class capabilities", () => {
    expect(negotiateCapabilities("OS_KEYCHAIN_LOCAL", ["secret.destroy"])).toMatchObject({ compatible: false, code: "CAPABILITY_UNSUPPORTED" });
    expect(negotiateCapabilities("VAULT_TRANSIT_KV", ["secret.plaintext-export"])).toMatchObject({ compatible: false, code: "CAPABILITY_UNKNOWN" });
    expect(negotiateCapabilities("IMMUTABLE_OBJECT_CHECKPOINT", ["admission.atomic"])).toMatchObject({ compatible: false, code: "CAPABILITY_UNSUPPORTED" });
  });

  it("keeps health evidence observational", () => {
    const adapter = new DisconnectedStagingAdapter("SPIFFE_SPIRE_PRIVATE_CA", "backend:spire", 2, "evidence:spire");
    expect(observeAdapterHealth(adapter.describe(), 10)).toEqual({
      backendIdentity: "backend:spire", generation: 2, health: "UNAVAILABLE", observedAtTick: 10,
      authority: "OBSERVATIONAL", authoritativeDelivery: false,
    });
  });
});
