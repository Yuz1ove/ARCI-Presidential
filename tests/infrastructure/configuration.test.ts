import { describe, expect, it } from "vitest";
import {
  StagingConfigurationError,
  StagingConfigurationRegistry,
  parseStagingInfrastructureConfiguration,
} from "../../src/infrastructure/index.js";
import { phase4GConfiguration } from "../../src/simulation/infrastructure/phase4g-scenarios.js";

const SECURITY_ADMIN = {
  authorized: true, code: "INFRA_ADMIN_AUTHORIZED", domain: "SECURITY_ADMINISTRATOR", authoritativeDelivery: false,
} as const;

function errorCode(operation: () => unknown): string {
  try { operation(); return "NO_ERROR"; }
  catch (error) { return error instanceof StagingConfigurationError ? error.code : "UNEXPECTED_ERROR"; }
}

describe("Phase 4G staging configuration integrity", () => {
  it("accepts the credential-free contract-only staging architecture", () => {
    const parsed = parseStagingInfrastructureConfiguration(phase4GConfiguration());
    expect(parsed.adapters).toHaveLength(5);
    expect(parsed.adapters.every(({ activationMode }) => activationMode === "CONTRACT_ONLY")).toBe(true);
    expect(JSON.stringify(parsed)).not.toMatch(/password|privateKey|apiKey|token/u);
  });

  it.each([
    ["password", "fixture-rejected-value"], ["token", "fixture-rejected-value"],
    ["privateKey", "fixture-rejected-value"], ["apiKey", "fixture-rejected-value"],
  ])("rejects forbidden credential field %s", (field, value) => {
    expect(errorCode(() => parseStagingInfrastructureConfiguration({ ...phase4GConfiguration(), [field]: value })))
      .toBe("STAGING_CONFIGURATION_SECRET_VALUE_FORBIDDEN");
  });

  it("rejects unknown adapters and invalid identity cross-references", () => {
    const config = phase4GConfiguration();
    expect(errorCode(() => parseStagingInfrastructureConfiguration({
      ...config, adapters: config.adapters.map((adapter, index) => index === 0 ? { ...adapter, adapterType: "UNKNOWN_BACKEND" } : adapter),
    }))).toBe("STAGING_CONFIGURATION_UNKNOWN_ADAPTER");
    expect(errorCode(() => parseStagingInfrastructureConfiguration({
      ...config, adapters: config.adapters.map((adapter, index) => index === 0 ? { ...adapter, identityReference: "identity:missing" } : adapter),
    }))).toBe("STAGING_CONFIGURATION_CROSS_REFERENCE_INVALID");
  });

  it("rejects unsupported and unknown capability cross-references", () => {
    const config = phase4GConfiguration();
    const withCapabilities = (capabilities: readonly string[]) => ({
      ...config, adapters: config.adapters.map((adapter, index) => index === 0 ? { ...adapter, requiredCapabilities: capabilities } : adapter),
    });
    expect(errorCode(() => parseStagingInfrastructureConfiguration(withCapabilities(["transaction.cas"]))))
      .toBe("STAGING_CONFIGURATION_UNSUPPORTED_CAPABILITY");
    expect(errorCode(() => parseStagingInfrastructureConfiguration(withCapabilities(["secret.unknown"]))))
      .toBe("STAGING_CONFIGURATION_CAPABILITY_UNKNOWN");
  });

  it("rejects durability, consistency, retry, and fallback weakening", () => {
    const config = phase4GConfiguration();
    const change = (index: number, update: object) => ({
      ...config, adapters: config.adapters.map((adapter, current) => current === index ? { ...adapter, ...update } : adapter),
    });
    expect(errorCode(() => parseStagingInfrastructureConfiguration(change(2, { durabilityMode: "EPHEMERAL_LOCAL" }))))
      .toBe("STAGING_CONFIGURATION_INCOMPATIBLE_DURABILITY");
    expect(errorCode(() => parseStagingInfrastructureConfiguration(change(4, { consistencyPolicy: "GENERATION_BOUND" }))))
      .toBe("STAGING_CONFIGURATION_UNSUPPORTED_TRUST_MODE");
    expect(errorCode(() => parseStagingInfrastructureConfiguration(change(2, { retryPolicy: { maximumAttempts: 2, mode: "NEVER" } }))))
      .toBe("STAGING_CONFIGURATION_INVALID_RETRY");
    expect(errorCode(() => parseStagingInfrastructureConfiguration(change(2, { fallback: { mode: "EXPLICIT_LOCAL_DEVELOPER_ONLY", adapterType: "OS_KEYCHAIN_LOCAL" } }))))
      .toBe("STAGING_CONFIGURATION_UNSAFE_FALLBACK");
  });

  it("rejects stale trust, rollback, conflict, and wrong administrative domain", () => {
    const registry = new StagingConfigurationRegistry();
    registry.apply(phase4GConfiguration(), SECURITY_ADMIN);
    expect(errorCode(() => registry.apply(phase4GConfiguration(3, 1), SECURITY_ADMIN))).toBe("STAGING_CONFIGURATION_GENERATION_STALE");
    expect(errorCode(() => registry.apply(phase4GConfiguration(1, 2), SECURITY_ADMIN))).toBe("STAGING_CONFIGURATION_ROLLBACK");
    const changed = phase4GConfiguration();
    const firstAdapter = changed.adapters[0];
    if (firstAdapter === undefined) throw new Error("TEST_ADAPTER_MISSING");
    changed.adapters[0] = { ...firstAdapter, backendName: "same-generation-conflict" };
    expect(errorCode(() => registry.apply(changed, SECURITY_ADMIN))).toBe("STAGING_CONFIGURATION_GENERATION_CONFLICT");
    expect(errorCode(() => new StagingConfigurationRegistry().apply(phase4GConfiguration(), {
      ...SECURITY_ADMIN, domain: "DATABASE_ADMINISTRATOR",
    }))).toBe("STAGING_CONFIGURATION_ACTOR_UNAUTHORIZED");
  });
});
