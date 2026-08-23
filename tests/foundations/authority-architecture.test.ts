import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const foundationFiles = [
  "administration.ts", "admission.ts", "audit.ts", "canonical.ts", "configuration.ts", "index.ts",
  "operational-controls.ts", "secret-custody.ts", "service-identity.ts", "transactional-store.ts",
];

describe("Phase 4F authority architecture", () => {
  it("keeps production foundations isolated from privileged delivery mutation modules", () => {
    for (const file of foundationFiles) {
      const source = readFileSync(resolve("src/foundations", file), "utf8");
      expect(source).not.toMatch(/from ["']\.\.\/(runtime|verification|control-plane|provider)\//u);
      expect(source).not.toMatch(/mission\.delivered|verification\.ack_received|runtime\.completed/u);
    }
  });

  it("provides no direct delivery setter or authority promotion surface", () => {
    const source = foundationFiles.map((file) => readFileSync(resolve("src/foundations", file), "utf8")).join("\n");
    expect(source).not.toMatch(/\b(setDelivered|markDelivered|markVerified|forceComplete|trustProviderStatus|overrideDelivery)\s*\(/u);
    expect(source).not.toMatch(/authoritativeDelivery\s*:\s*true/u);
  });

  it("keeps audit observational and independent of provider-controlled prose", () => {
    const source = readFileSync(resolve("src/foundations/audit.ts"), "utf8");
    expect(source).not.toMatch(/from ["']\.\.\/(integration|provider|runtime|verification|control-plane)\//u);
    expect(source).not.toMatch(/providerText|providerProse|deliveryClaim/u);
  });
});
