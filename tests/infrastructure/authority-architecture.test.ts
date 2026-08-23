import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const infrastructureFiles = [
  "administration.ts", "capabilities.ts", "checkpoint.ts", "configuration.ts",
  "contracts.ts", "failure-recovery.ts", "index.ts", "model.ts",
];

describe("Phase 4G staging infrastructure authority architecture", () => {
  it("keeps adapters isolated from privileged delivery-completion modules", () => {
    for (const file of infrastructureFiles) {
      const source = readFileSync(resolve("src/infrastructure", file), "utf8");
      expect(source).not.toMatch(/from ["']\.\.\/(runtime|verification|control-plane|provider)\//u);
      expect(source).not.toMatch(/mission\.delivered|verification\.ack_received|runtime\.completed/u);
    }
  });

  it("provides no direct delivery setter, authority promotion, socket, or environment credential path", () => {
    const source = infrastructureFiles.map((file) => readFileSync(resolve("src/infrastructure", file), "utf8")).join("\n");
    expect(source).not.toMatch(/\b(setDelivered|markDelivered|markVerified|forceComplete|trustProviderStatus|overrideDelivery)\s*\(/u);
    expect(source).not.toMatch(/authoritativeDelivery\s*:\s*true/u);
    expect(source).not.toMatch(/node:(http|https|net|tls)|process\.env|fetch\s*\(|rejectUnauthorized\s*:\s*false/u);
  });

  it("does not silently fall back from hardened adapter classes", () => {
    const source = readFileSync(resolve("src/infrastructure/contracts.ts"), "utf8");
    expect(source).not.toMatch(/InMemory|IN_MEMORY|LocalFallback|fallbackAdapter/u);
    expect(source).toMatch(/health:\s*"UNAVAILABLE"/u);
    expect(source).toMatch(/INFRASTRUCTURE_BACKEND_UNAVAILABLE/u);
  });

  it("keeps infrastructure administrative roles distinct and non-authoritative", () => {
    const source = readFileSync(resolve("src/infrastructure/administration.ts"), "utf8");
    for (const domain of [
      "DATABASE_ADMINISTRATOR", "VAULT_ADMINISTRATOR", "PKI_ADMINISTRATOR",
      "AUDIT_STORAGE_ADMINISTRATOR", "QUOTA_ADMINISTRATOR",
    ]) expect(source).toContain(domain);
    expect(source).not.toMatch(/authoritativeDelivery\s*:\s*true/u);
  });
});
